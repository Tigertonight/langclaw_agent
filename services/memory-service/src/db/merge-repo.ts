import type { Pool, PoolClient } from "pg";
import { pool } from "./pool.js";
import type { EntityRow } from "./types.js";
import type { EntityMergeLogDto } from "../domain/merge.js";
import type { Identity } from "../http/identity.js";
import { HttpError } from "../http/errors.js";

type Executor = Pool | PoolClient;

const ENTITY_COLS = `
  id, business_id, type, name, aliases, external_ids, attributes,
  embedding_model, embedded_at, created_at, updated_at, deleted_at, merged_into
`;

interface MergeLogRow {
  id: string;
  business_id: string;
  source_entity_id: string;
  target_entity_id: string;
  reason: string | null;
  merged_by: string | null;
  merged_at: Date;
  rolled_back_at: Date | null;
}

export interface MergeOutcome {
  source: EntityRow;
  target: EntityRow;
  log: EntityMergeLogDto;
  relations_migrated: number;
}

export class MergeRepo {
  constructor(private readonly executor: Executor = pool) {}

  // 合并 source → target。要求两实体同 business_id、未删除、未已被合并。
  // 关系自动迁移：subject_id / object_id 中所有指向 source 的都改写到 target。
  // memories.entity_refs 也跟着改写。
  // 整个动作走事务，失败回滚。
  async merge(
    identity: Identity,
    targetId: string,
    sourceId: string,
    reason: string | undefined,
    mergedBy: string | undefined
  ): Promise<MergeOutcome> {
    if (targetId === sourceId) {
      throw HttpError.badRequest("target_id must differ from source_id");
    }
    return await this.runInTx(async (client) => {
      const target = await this.lockEntity(client, identity, targetId);
      if (!target) throw HttpError.notFound("target entity not found");
      if (target.merged_into) throw HttpError.conflict("target entity is itself already merged");

      const source = await this.lockEntity(client, identity, sourceId);
      if (!source) throw HttpError.notFound("source entity not found");
      if (source.merged_into) throw HttpError.conflict("source entity is already merged");

      // 软合并：把 source.merged_into 指向 target，外部检索自动跳过。
      const updated = await client.query<EntityRow>(
        `UPDATE entities
         SET merged_into = $2, updated_at = now()
         WHERE id = $1 AND business_id = $3
         RETURNING ${ENTITY_COLS}`,
        [sourceId, targetId, identity.business_id]
      );

      // 关系迁移：subject_id / object_id 改写到 target。
      const subjUpdate = await client.query(
        `UPDATE relations SET subject_id = $1
         WHERE business_id = $3 AND subject_id = $2 AND deleted_at IS NULL`,
        [targetId, sourceId, identity.business_id]
      );
      const objUpdate = await client.query(
        `UPDATE relations SET object_id = $1
         WHERE business_id = $3 AND object_id = $2 AND deleted_at IS NULL`,
        [targetId, sourceId, identity.business_id]
      );
      const migrated = (subjUpdate.rowCount ?? 0) + (objUpdate.rowCount ?? 0);

      // memories.entity_refs 数组改写（array_replace 原地替换元素）
      await client.query(
        `UPDATE memories
         SET entity_refs = array_replace(entity_refs, $2, $1),
             updated_at = now()
         WHERE business_id = $3 AND entity_refs @> ARRAY[$2]::TEXT[]`,
        [targetId, sourceId, identity.business_id]
      );

      const logRes = await client.query<MergeLogRow>(
        `INSERT INTO entity_merge_log (
           business_id, source_entity_id, target_entity_id, reason, merged_by
         ) VALUES ($1, $2, $3, $4, $5)
         RETURNING id, business_id, source_entity_id, target_entity_id,
                   reason, merged_by, merged_at, rolled_back_at`,
        [identity.business_id, sourceId, targetId, reason ?? null, mergedBy ?? null]
      );

      return {
        source: updated.rows[0]!,
        target,
        log: toLogDto(logRes.rows[0]!),
        relations_migrated: migrated
      };
    });
  }

  // unmerge：撤销最近一次未回滚的 merge（source → target），恢复 source.merged_into=NULL。
  // 注意：合并时已迁移过的关系/memories 不能可靠回退（target 自己也可能在合并后接收过新关系），
  // 所以这里只回退实体本身的 merged_into 指针 + 标记 log，关系不再回写。
  // 这是 spec "merge 可逆" 的最小可用实现。
  async unmerge(identity: Identity, sourceId: string): Promise<EntityMergeLogDto> {
    return await this.runInTx(async (client) => {
      const source = await this.lockEntity(client, identity, sourceId);
      if (!source) throw HttpError.notFound("source entity not found");
      if (!source.merged_into) throw HttpError.conflict("source entity is not merged");

      const logRes = await client.query<MergeLogRow>(
        `SELECT id, business_id, source_entity_id, target_entity_id,
                reason, merged_by, merged_at, rolled_back_at
         FROM entity_merge_log
         WHERE business_id = $1 AND source_entity_id = $2 AND rolled_back_at IS NULL
         ORDER BY merged_at DESC
         LIMIT 1`,
        [identity.business_id, sourceId]
      );
      const log = logRes.rows[0];
      if (!log) throw HttpError.conflict("no rollback-able merge log found");

      await client.query(
        `UPDATE entities SET merged_into = NULL, updated_at = now()
         WHERE id = $1 AND business_id = $2`,
        [sourceId, identity.business_id]
      );

      const updatedLog = await client.query<MergeLogRow>(
        `UPDATE entity_merge_log
         SET rolled_back_at = now()
         WHERE id = $1
         RETURNING id, business_id, source_entity_id, target_entity_id,
                   reason, merged_by, merged_at, rolled_back_at`,
        [log.id]
      );
      return toLogDto(updatedLog.rows[0]!);
    });
  }

  private async lockEntity(
    client: PoolClient,
    identity: Identity,
    id: string
  ): Promise<EntityRow | null> {
    const { rows } = await client.query<EntityRow>(
      `SELECT ${ENTITY_COLS}
       FROM entities
       WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL
       FOR UPDATE`,
      [id, identity.business_id]
    );
    return rows[0] ?? null;
  }

  private async runInTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    if ("connect" in this.executor && typeof (this.executor as Pool).connect === "function") {
      const client = await (this.executor as Pool).connect();
      try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    } else {
      // already a client (e.g. nested) — caller owns the tx
      return await fn(this.executor as PoolClient);
    }
  }
}

function toLogDto(row: MergeLogRow): EntityMergeLogDto {
  return {
    id: row.id,
    business_id: row.business_id,
    source_entity_id: row.source_entity_id,
    target_entity_id: row.target_entity_id,
    reason: row.reason,
    merged_by: row.merged_by,
    merged_at: row.merged_at.toISOString(),
    rolled_back_at: row.rolled_back_at?.toISOString() ?? null
  };
}
