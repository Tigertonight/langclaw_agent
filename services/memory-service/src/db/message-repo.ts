import type { Pool, PoolClient } from "pg";
import { pool } from "./pool.js";
import type { Identity } from "../http/identity.js";
import type { MessageDto, MessageItem, MessageListQuery, MessageRole } from "../domain/message.js";

type Executor = Pool | PoolClient;

interface MessageRow {
  id: string;
  business_id: string;
  user_id: string;
  agent_id: string | null;
  session_id: string;
  turn_index: number;
  role: string;
  content: string | null;
  tool_call: Record<string, unknown> | null;
  tool_result: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export class MessageRepo {
  constructor(private readonly executor: Executor = pool) {}

  /**
   * Bulk insert. Uses VALUES tuples in a single statement for throughput.
   * No upsert: callers should not retry on conflict — duplicate (session,turn)
   * combos surface as a 23505 unique violation only if a unique index is added
   * later; current schema allows duplicates intentionally so retries don't 500.
   */
  async insertBatch(identity: Identity, items: MessageItem[]): Promise<number> {
    if (items.length === 0) return 0;
    const valuesSql: string[] = [];
    const params: unknown[] = [];
    for (const m of items) {
      params.push(
        identity.business_id,
        identity.user_id,
        m.agent_id ?? identity.agent_id ?? null,
        m.session_id,
        m.turn_index,
        m.role,
        m.content ?? null,
        m.tool_call ? JSON.stringify(m.tool_call) : null,
        m.tool_result ? JSON.stringify(m.tool_result) : null,
        JSON.stringify(m.metadata ?? {})
      );
      const base = params.length - 10;
      valuesSql.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10})`);
    }
    const sql = `
      INSERT INTO messages (
        business_id, user_id, agent_id, session_id, turn_index,
        role, content, tool_call, tool_result, metadata
      )
      VALUES ${valuesSql.join(", ")}
    `;
    const { rowCount } = await this.executor.query(sql, params);
    return rowCount ?? 0;
  }

  async list(identity: Identity, q: MessageListQuery): Promise<{ items: MessageDto[]; next_cursor: string | null }> {
    const params: unknown[] = [identity.business_id, identity.user_id];
    const where: string[] = ["business_id = $1", "user_id = $2"];
    if (q.session_id) {
      params.push(q.session_id);
      where.push(`session_id = $${params.length}`);
    }
    if (q.since) {
      params.push(q.since);
      where.push(`created_at >= $${params.length}`);
    }
    if (q.cursor) {
      const decoded = decodeCursor(q.cursor);
      if (decoded) {
        params.push(decoded.created_at, decoded.id);
        where.push(`(created_at, id) < ($${params.length - 1}, $${params.length})`);
      }
    }
    params.push(q.limit + 1);
    const sql = `
      SELECT id, business_id, user_id, agent_id, session_id, turn_index,
             role, content, tool_call, tool_result, metadata, created_at
      FROM messages
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length}
    `;
    const { rows } = await this.executor.query<MessageRow>(sql, params);
    const hasMore = rows.length > q.limit;
    const trimmed = hasMore ? rows.slice(0, q.limit) : rows;
    const items = trimmed.map(rowToDto);
    const last = trimmed[trimmed.length - 1];
    const next_cursor = hasMore && last ? encodeCursor(last.created_at, last.id) : null;
    return { items, next_cursor };
  }
}

function rowToDto(row: MessageRow): MessageDto {
  return {
    id: row.id,
    session_id: row.session_id,
    turn_index: row.turn_index,
    role: row.role as MessageRole,
    content: row.content,
    tool_call: row.tool_call,
    tool_result: row.tool_result,
    metadata: row.metadata ?? {},
    created_at: row.created_at.toISOString()
  };
}

function encodeCursor(created_at: Date, id: string): string {
  return Buffer.from(JSON.stringify({ t: created_at.toISOString(), i: id }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { created_at: string; id: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { t: string; i: string };
    if (typeof parsed.t === "string" && typeof parsed.i === "string") {
      return { created_at: parsed.t, id: parsed.i };
    }
    return null;
  } catch {
    return null;
  }
}
