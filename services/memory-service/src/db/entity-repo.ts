import type { Pool, PoolClient } from "pg";
import { pool } from "./pool.js";
import type { EntityRow, Json } from "./types.js";
import {
  buildEntityId,
  type EntityCreateInput,
  type EntityDto,
  type EntityListQuery,
  type EntityPatchInput
} from "../domain/entity.js";
import type { Identity } from "../http/identity.js";

type Executor = Pool | PoolClient;

const SELECT_COLUMNS = `
  id, business_id, type, name, aliases, external_ids, attributes,
  embedding_model, embedded_at, created_at, updated_at, deleted_at, merged_into
`;

export class EntityRepo {
  constructor(private readonly executor: Executor = pool) {}

  withClient(client: PoolClient): EntityRepo {
    return new EntityRepo(client);
  }

  async create(identity: Identity, input: EntityCreateInput): Promise<EntityRow> {
    const id = buildEntityId(identity.business_id, input.local_id);
    const sql = `
      INSERT INTO entities (
        id, business_id, type, name, aliases, external_ids, attributes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING ${SELECT_COLUMNS}
    `;
    const params = [
      id,
      identity.business_id,
      input.type,
      input.name,
      input.aliases ?? null,
      JSON.stringify(input.external_ids ?? {}),
      JSON.stringify(input.attributes ?? {})
    ];
    const { rows } = await this.executor.query<EntityRow>(sql, params);
    return rows[0]!;
  }

  async upsert(identity: Identity, input: EntityCreateInput): Promise<EntityRow> {
    const id = buildEntityId(identity.business_id, input.local_id);
    const sql = `
      INSERT INTO entities (
        id, business_id, type, name, aliases, external_ids, attributes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE SET
        type = EXCLUDED.type,
        name = EXCLUDED.name,
        aliases = EXCLUDED.aliases,
        external_ids = entities.external_ids || EXCLUDED.external_ids,
        attributes = entities.attributes || EXCLUDED.attributes,
        updated_at = now()
      RETURNING ${SELECT_COLUMNS}
    `;
    const params = [
      id,
      identity.business_id,
      input.type,
      input.name,
      input.aliases ?? null,
      JSON.stringify(input.external_ids ?? {}),
      JSON.stringify(input.attributes ?? {})
    ];
    const { rows } = await this.executor.query<EntityRow>(sql, params);
    return rows[0]!;
  }

  async getById(identity: Identity, id: string): Promise<EntityRow | null> {
    const { rows } = await this.executor.query<EntityRow>(
      `SELECT ${SELECT_COLUMNS}
       FROM entities
       WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
      [id, identity.business_id]
    );
    return rows[0] ?? null;
  }

  async patch(identity: Identity, id: string, patch: EntityPatchInput): Promise<EntityRow | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (frag: string, value: unknown) => {
      params.push(value);
      sets.push(`${frag} = $${params.length}`);
    };

    if (patch.type !== undefined) push("type", patch.type);
    if (patch.name !== undefined) push("name", patch.name);
    if (patch.aliases !== undefined) push("aliases", patch.aliases);
    if (patch.external_ids !== undefined) {
      // shallow-merge so partial updates don't drop existing keys
      params.push(JSON.stringify(patch.external_ids));
      sets.push(`external_ids = external_ids || $${params.length}::jsonb`);
    }
    if (patch.attributes !== undefined) {
      params.push(JSON.stringify(patch.attributes));
      sets.push(`attributes = attributes || $${params.length}::jsonb`);
    }

    sets.push("updated_at = now()");

    params.push(id, identity.business_id);
    const idIdx = params.length - 1;
    const bizIdx = params.length;

    const sql = `
      UPDATE entities
      SET ${sets.join(", ")}
      WHERE id = $${idIdx}
        AND business_id = $${bizIdx}
        AND deleted_at IS NULL
      RETURNING ${SELECT_COLUMNS}
    `;
    const { rows } = await this.executor.query<EntityRow>(sql, params);
    return rows[0] ?? null;
  }

  async softDelete(identity: Identity, id: string): Promise<boolean> {
    const { rowCount } = await this.executor.query(
      `UPDATE entities
       SET deleted_at = now(), updated_at = now()
       WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
      [id, identity.business_id]
    );
    return (rowCount ?? 0) > 0;
  }

  async list(identity: Identity, query: EntityListQuery): Promise<{ items: EntityRow[]; nextCursor: string | null }> {
    const where: string[] = [
      "business_id = $1",
      "deleted_at IS NULL",
      "merged_into IS NULL"
    ];
    const params: unknown[] = [identity.business_id];

    if (query.type) {
      params.push(query.type);
      where.push(`type = $${params.length}`);
    }
    if (query.name_contains) {
      params.push(`%${query.name_contains}%`);
      where.push(`name ILIKE $${params.length}`);
    }
    if (query.external_id_key && query.external_id_value) {
      params.push(query.external_id_key);
      params.push(query.external_id_value);
      where.push(`external_ids ->> $${params.length - 1} = $${params.length}`);
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
      FROM entities
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC, id DESC
      LIMIT $${limitIdx}
    `;
    const { rows } = await this.executor.query<EntityRow>(sql, params);

    let nextCursor: string | null = null;
    if (rows.length > query.limit) {
      const last = rows[query.limit - 1]!;
      nextCursor = encodeCursor({ created_at: last.created_at.toISOString(), id: last.id });
      rows.length = query.limit;
    }
    return { items: rows, nextCursor };
  }
}

export function toEntityDto(row: EntityRow): EntityDto {
  return {
    id: row.id,
    business_id: row.business_id,
    type: row.type,
    name: row.name,
    aliases: row.aliases ?? [],
    external_ids: row.external_ids ?? {},
    attributes: (row.attributes ?? {}) as Record<string, Json>,
    embedding_model: row.embedding_model,
    embedded_at: row.embedded_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    merged_into: row.merged_into
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
