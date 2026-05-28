import type { Pool, PoolClient } from "pg";
import { pool } from "./pool.js";
import type { Json, MemoryRow } from "./types.js";
import type { MemoryCreateInput, MemoryDto, MemoryListQuery, MemoryPatchInput } from "../domain/memory.js";
import type { Identity } from "../http/identity.js";

type Executor = Pool | PoolClient;

const SELECT_COLUMNS = `
  id, business_id, user_id, agent_id, category, name, description, content,
  source, confidence, tags, metadata, embedding_model, embedded_at,
  created_at, updated_at, expired_at, deleted_at
`;

export class MemoryRepo {
  constructor(private readonly executor: Executor = pool) {}

  withClient(client: PoolClient): MemoryRepo {
    return new MemoryRepo(client);
  }

  async create(identity: Identity, input: MemoryCreateInput): Promise<MemoryRow> {
    const sql = `
      INSERT INTO memories (
        business_id, user_id, agent_id,
        category, name, description, content,
        source, confidence, tags, metadata, expired_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING ${SELECT_COLUMNS}
    `;
    const params = [
      identity.business_id,
      identity.user_id,
      identity.agent_id ?? null,
      input.category,
      input.name,
      input.description ?? null,
      input.content,
      input.source ?? null,
      input.confidence ?? 1.0,
      input.tags ?? null,
      JSON.stringify(input.metadata ?? {}),
      input.expired_at ?? null
    ];
    const { rows } = await this.executor.query<MemoryRow>(sql, params);
    return rows[0]!;
  }

  async getById(identity: Identity, id: string): Promise<MemoryRow | null> {
    const { rows } = await this.executor.query<MemoryRow>(
      `SELECT ${SELECT_COLUMNS}
       FROM memories
       WHERE id = $1 AND business_id = $2 AND user_id = $3 AND deleted_at IS NULL`,
      [id, identity.business_id, identity.user_id]
    );
    return rows[0] ?? null;
  }

  async patch(identity: Identity, id: string, patch: MemoryPatchInput): Promise<MemoryRow | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (frag: string, value: unknown) => {
      params.push(value);
      sets.push(`${frag} = $${params.length}`);
    };

    if (patch.name !== undefined) push("name", patch.name);
    if (patch.description !== undefined) push("description", patch.description);
    if (patch.content !== undefined) {
      push("content", patch.content);
      // 内容变更后旧 embedding 失效，由 worker 重生成
      sets.push("embedding = NULL", "embedding_model = NULL", "embedded_at = NULL");
    }
    if (patch.confidence !== undefined) push("confidence", patch.confidence);
    if (patch.tags !== undefined) push("tags", patch.tags);
    if (patch.metadata !== undefined) push("metadata", JSON.stringify(patch.metadata));
    if (patch.expired_at !== undefined) push("expired_at", patch.expired_at);

    sets.push("updated_at = now()");

    params.push(id, identity.business_id, identity.user_id);
    const idIdx = params.length - 2;
    const bizIdx = params.length - 1;
    const userIdx = params.length;

    const sql = `
      UPDATE memories
      SET ${sets.join(", ")}
      WHERE id = $${idIdx}
        AND business_id = $${bizIdx}
        AND user_id = $${userIdx}
        AND deleted_at IS NULL
      RETURNING ${SELECT_COLUMNS}
    `;
    const { rows } = await this.executor.query<MemoryRow>(sql, params);
    return rows[0] ?? null;
  }

  async softDelete(identity: Identity, id: string): Promise<boolean> {
    const { rowCount } = await this.executor.query(
      `UPDATE memories
       SET deleted_at = now(), updated_at = now()
       WHERE id = $1 AND business_id = $2 AND user_id = $3 AND deleted_at IS NULL`,
      [id, identity.business_id, identity.user_id]
    );
    return (rowCount ?? 0) > 0;
  }

  async list(identity: Identity, query: MemoryListQuery): Promise<{ items: MemoryRow[]; nextCursor: string | null }> {
    const where: string[] = [
      "business_id = $1",
      "user_id = $2",
      "deleted_at IS NULL"
    ];
    const params: unknown[] = [identity.business_id, identity.user_id];

    if (query.category) {
      params.push(query.category);
      where.push(`category = $${params.length}`);
    }
    if (query.tag) {
      params.push(query.tag);
      where.push(`$${params.length} = ANY(tags)`);
    }
    if (query.since) {
      params.push(query.since);
      where.push(`created_at >= $${params.length}`);
    }
    if (query.cursor) {
      const decoded = decodeCursor(query.cursor);
      if (decoded) {
        params.push(decoded.created_at, decoded.id);
        where.push(`(created_at, id) < ($${params.length - 1}, $${params.length})`);
      }
    }

    params.push(query.limit + 1);
    const limitIdx = params.length;

    const sql = `
      SELECT ${SELECT_COLUMNS}
      FROM memories
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC, id DESC
      LIMIT $${limitIdx}
    `;
    const { rows } = await this.executor.query<MemoryRow>(sql, params);

    let nextCursor: string | null = null;
    if (rows.length > query.limit) {
      const last = rows[query.limit - 1]!;
      nextCursor = encodeCursor({ created_at: last.created_at.toISOString(), id: last.id });
      rows.length = query.limit;
    }
    return { items: rows, nextCursor };
  }
}

export function toMemoryDto(row: MemoryRow): MemoryDto {
  return {
    id: row.id,
    business_id: row.business_id,
    user_id: row.user_id,
    agent_id: row.agent_id,
    category: row.category,
    name: row.name,
    description: row.description,
    content: row.content,
    source: row.source,
    confidence: row.confidence,
    tags: row.tags ?? [],
    metadata: (row.metadata ?? {}) as Record<string, Json>,
    embedding_model: row.embedding_model,
    embedded_at: row.embedded_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    expired_at: row.expired_at?.toISOString() ?? null
  };
}

interface CursorPayload {
  created_at: string;
  id: string;
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(raw: string): CursorPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof parsed?.created_at !== "string" || typeof parsed?.id !== "string") return null;
    return parsed as CursorPayload;
  } catch {
    return null;
  }
}
