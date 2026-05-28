import type { Pool, PoolClient } from "pg";
import { pool } from "./pool.js";
import type { EntityRow } from "./types.js";
import { toEntityDto } from "./entity-repo.js";
import type { ResolveCandidate, ResolveRequest, ResolveResult } from "../domain/resolver.js";
import type { Identity } from "../http/identity.js";

type Executor = Pool | PoolClient;

const SELECT_COLUMNS = `
  id, business_id, type, name, aliases, external_ids, attributes,
  embedding_model, embedded_at, created_at, updated_at, deleted_at, merged_into
`;

// 打分常量。external_ids 命中权重最高，强属性其次，name 相似度只是加权。
const SCORE_EXTERNAL_ID = 1.0;
const SCORE_STRONG_ATTR = 0.4;
const SCORE_NAME_WEIGHT = 0.3;

interface ScoredCandidate {
  row: EntityRow;
  score: number;
  reasons: string[];
}

export class EntityResolver {
  constructor(private readonly executor: Executor = pool) {}

  withClient(client: PoolClient): EntityResolver {
    return new EntityResolver(client);
  }

  async resolve(identity: Identity, req: ResolveRequest): Promise<ResolveResult> {
    const merged = new Map<string, ScoredCandidate>();
    const upsertCandidate = (row: EntityRow, addScore: number, reason: string) => {
      const existing = merged.get(row.id);
      if (existing) {
        existing.score += addScore;
        if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
      } else {
        merged.set(row.id, { row, score: addScore, reasons: [reason] });
      }
    };

    // ===== Level 1: external_ids 命中 =====
    if (req.external_ids) {
      for (const [key, value] of Object.entries(req.external_ids)) {
        const rows = await this.queryByExternalId(identity, req.type, key, value);
        for (const row of rows) {
          upsertCandidate(row, SCORE_EXTERNAL_ID, `external_ids.${key}=${value}`);
        }
      }
    }

    // ===== Level 2: 强属性匹配 =====
    if (req.strong_attributes && Object.keys(req.strong_attributes).length > 0) {
      const rows = await this.queryByStrongAttributes(identity, req.type, req.strong_attributes);
      for (const row of rows) {
        // 每个命中字段单独算分，调用方传几个匹配几个就累加几次
        for (const [key, value] of Object.entries(req.strong_attributes)) {
          const attrVal = (row.attributes ?? {})[key];
          if (attrVal !== undefined && String(attrVal) === value) {
            upsertCandidate(row, SCORE_STRONG_ATTR, `attributes.${key}=${value}`);
          }
        }
      }
    }

    // ===== Level 3: name_hint trigram 相似度 =====
    if (req.name_hint) {
      const rows = await this.queryByNameSimilarity(identity, req.type, req.name_hint);
      for (const { row, similarity } of rows) {
        upsertCandidate(row, similarity * SCORE_NAME_WEIGHT, `name~${req.name_hint} (${similarity.toFixed(2)})`);
      }
    }

    // 排序、截断
    const sorted = Array.from(merged.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, req.max_candidates);

    const candidates: ResolveCandidate[] = sorted.map((c) => ({
      entity: toEntityDto(c.row),
      score: Math.round(c.score * 1000) / 1000,
      reasons: c.reasons
    }));

    const top = candidates[0];
    const matched = top && top.score >= req.match_threshold ? top.entity : null;

    return { matched, candidates };
  }

  private async queryByExternalId(
    identity: Identity,
    type: string,
    key: string,
    value: string
  ): Promise<EntityRow[]> {
    const sql = `
      SELECT ${SELECT_COLUMNS}
      FROM entities
      WHERE business_id = $1
        AND type = $2
        AND external_ids ->> $3 = $4
        AND deleted_at IS NULL
        AND merged_into IS NULL
      LIMIT 50
    `;
    const { rows } = await this.executor.query<EntityRow>(sql, [
      identity.business_id, type, key, value
    ]);
    return rows;
  }

  private async queryByStrongAttributes(
    identity: Identity,
    type: string,
    attrs: Record<string, string>
  ): Promise<EntityRow[]> {
    // OR 任一字段匹配 → 候选；具体打分在调用方按命中字段数累加。
    // 用 jsonb @> 检查 key=value 的存在；多 key 走 OR。
    const orFragments: string[] = [];
    const params: unknown[] = [identity.business_id, type];
    for (const [key, value] of Object.entries(attrs)) {
      params.push(JSON.stringify({ [key]: value }));
      orFragments.push(`attributes @> $${params.length}::jsonb`);
    }
    const sql = `
      SELECT ${SELECT_COLUMNS}
      FROM entities
      WHERE business_id = $1
        AND type = $2
        AND (${orFragments.join(" OR ")})
        AND deleted_at IS NULL
        AND merged_into IS NULL
      LIMIT 50
    `;
    const { rows } = await this.executor.query<EntityRow>(sql, params);
    return rows;
  }

  private async queryByNameSimilarity(
    identity: Identity,
    type: string,
    nameHint: string
  ): Promise<Array<{ row: EntityRow; similarity: number }>> {
    // 用 pg_trgm 的 similarity()，阈值 0.3 过滤明显无关项
    const sql = `
      SELECT ${SELECT_COLUMNS}, similarity(name, $3) AS sim
      FROM entities
      WHERE business_id = $1
        AND type = $2
        AND deleted_at IS NULL
        AND merged_into IS NULL
        AND similarity(name, $3) > 0.3
      ORDER BY sim DESC
      LIMIT 20
    `;
    const { rows } = await this.executor.query<EntityRow & { sim: number }>(sql, [
      identity.business_id, type, nameHint
    ]);
    return rows.map(({ sim, ...row }) => ({ row: row as EntityRow, similarity: sim }));
  }
}
