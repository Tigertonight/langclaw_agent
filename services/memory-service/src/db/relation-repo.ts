import type { Pool, PoolClient } from "pg";
import { pool } from "./pool.js";
import type { Json, RelationRow } from "./types.js";
import type { RelationCreateInput, RelationDto, RelationQueryInput } from "../domain/relation.js";
import type { Identity } from "../http/identity.js";

type Executor = Pool | PoolClient;

const SELECT_COLUMNS = `
  id, business_id, subject_id, predicate, object_id, object_value,
  occurred_at, source_memory_id, confidence, metadata, created_at, deleted_at
`;

export class RelationRepo {
  constructor(private readonly executor: Executor = pool) {}

  withClient(client: PoolClient): RelationRepo {
    return new RelationRepo(client);
  }

  async create(identity: Identity, input: RelationCreateInput): Promise<RelationRow> {
    const sql = `
      INSERT INTO relations (
        business_id, subject_id, predicate, object_id, object_value,
        occurred_at, source_memory_id, confidence, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING ${SELECT_COLUMNS}
    `;
    const params = [
      identity.business_id,
      input.subject_id,
      input.predicate,
      input.object_id ?? null,
      input.object_value === undefined ? null : JSON.stringify(input.object_value),
      input.occurred_at ?? null,
      input.source_memory_id ?? null,
      input.confidence ?? 1.0,
      JSON.stringify(input.metadata ?? {})
    ];
    const { rows } = await this.executor.query<RelationRow>(sql, params);
    return rows[0]!;
  }

  async query(identity: Identity, q: RelationQueryInput): Promise<{ items: RelationRow[]; nextCursor: string | null }> {
    const where: string[] = ["business_id = $1", "deleted_at IS NULL"];
    const params: unknown[] = [identity.business_id];

    if (q.subject_id) {
      params.push(q.subject_id);
      where.push(`subject_id = $${params.length}`);
    }
    if (q.predicate) {
      params.push(q.predicate);
      where.push(`predicate = $${params.length}`);
    }
    if (q.object_id) {
      params.push(q.object_id);
      where.push(`object_id = $${params.length}`);
    }
    if (q.occurred_from) {
      params.push(q.occurred_from);
      where.push(`occurred_at >= $${params.length}`);
    }
    if (q.occurred_to) {
      params.push(q.occurred_to);
      where.push(`occurred_at <= $${params.length}`);
    }
    if (q.cursor) {
      const decoded = decodeCursor(q.cursor);
      if (decoded) {
        params.push(decoded.created_at, decoded.id);
        where.push(`(created_at, id) < ($${params.length - 1}, $${params.length})`);
      }
    }

    params.push(q.limit + 1);
    const limitIdx = params.length;

    const sql = `
      SELECT ${SELECT_COLUMNS}
      FROM relations
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC, id DESC
      LIMIT $${limitIdx}
    `;
    const { rows } = await this.executor.query<RelationRow>(sql, params);

    let nextCursor: string | null = null;
    if (rows.length > q.limit) {
      const last = rows[q.limit - 1]!;
      nextCursor = encodeCursor({ created_at: last.created_at.toISOString(), id: last.id });
      rows.length = q.limit;
    }
    return { items: rows, nextCursor };
  }

  async softDelete(identity: Identity, id: string): Promise<boolean> {
    const { rowCount } = await this.executor.query(
      `UPDATE relations
       SET deleted_at = now()
       WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
      [id, identity.business_id]
    );
    return (rowCount ?? 0) > 0;
  }
}

export function toRelationDto(row: RelationRow): RelationDto {
  return {
    id: row.id,
    business_id: row.business_id,
    subject_id: row.subject_id,
    predicate: row.predicate,
    object_id: row.object_id,
    object_value: (row.object_value ?? null) as Json | null,
    occurred_at: row.occurred_at?.toISOString() ?? null,
    source_memory_id: row.source_memory_id,
    confidence: row.confidence,
    metadata: (row.metadata ?? {}) as Record<string, Json>,
    created_at: row.created_at.toISOString()
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
