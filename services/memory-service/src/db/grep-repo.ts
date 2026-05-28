import type { Pool, PoolClient } from "pg";
import { pool } from "./pool.js";
import type { Identity } from "../http/identity.js";
import type { GrepHit, GrepRequest } from "../domain/grep.js";

type Executor = Pool | PoolClient;

const EXCERPT_PADDING = 80;

export class GrepRepo {
  constructor(private readonly executor: Executor = pool) {}

  async grepMemories(identity: Identity, req: GrepRequest): Promise<GrepHit[]> {
    const op = req.case_insensitive ? "~*" : "~";
    const params: unknown[] = [identity.business_id, identity.user_id, req.pattern];
    const where: string[] = [
      "business_id = $1",
      "user_id = $2",
      "deleted_at IS NULL",
      `content ${op} $3`
    ];
    appendCommonFilters(req, params, where);
    params.push(req.limit);
    const sql = `
      SELECT id, category, content, created_at
      FROM memories
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT $${params.length}
    `;
    const { rows } = await this.executor.query<{
      id: string; category: string; content: string; created_at: Date;
    }>(sql, params);
    return rows.map((r) => ({
      id: r.id,
      source: "memory" as const,
      category: r.category,
      match_excerpt: excerptAround(r.content, req.pattern, req.case_insensitive),
      created_at: r.created_at.toISOString()
    }));
  }

  async grepDocuments(identity: Identity, req: GrepRequest): Promise<GrepHit[]> {
    const op = req.case_insensitive ? "~*" : "~";
    const params: unknown[] = [identity.business_id, req.pattern];
    const where: string[] = [
      "c.business_id = $1",
      "d.deleted_at IS NULL",
      `c.content ${op} $2`
    ];
    appendDocumentFilters(req, params, where);
    params.push(req.limit);
    const sql = `
      SELECT c.id, c.document_id, c.heading_path, c.content, c.created_at,
             d.source_path, d.category
      FROM document_chunks c
      JOIN documents d ON d.id = c.document_id
      WHERE ${where.join(" AND ")}
      ORDER BY c.created_at DESC
      LIMIT $${params.length}
    `;
    const { rows } = await this.executor.query<{
      id: string; document_id: string; heading_path: string[] | null;
      content: string; created_at: Date; source_path: string; category: string | null;
    }>(sql, params);
    return rows.map((r) => ({
      id: r.id,
      source: "document_chunk" as const,
      document_id: r.document_id,
      source_path: r.source_path,
      heading_path: r.heading_path ?? [],
      category: r.category,
      match_excerpt: excerptAround(r.content, req.pattern, req.case_insensitive),
      created_at: r.created_at.toISOString()
    }));
  }
}

function appendCommonFilters(req: GrepRequest, params: unknown[], where: string[]): void {
  const f = req.filters;
  if (!f) return;
  if (f.category && f.category.length > 0) {
    params.push(f.category);
    where.push(`category = ANY($${params.length})`);
  }
  if (f.tags && f.tags.length > 0) {
    params.push(f.tags);
    where.push(`tags && $${params.length}::text[]`);
  }
  if (f.since) {
    params.push(f.since);
    where.push(`created_at >= $${params.length}`);
  }
}

function appendDocumentFilters(req: GrepRequest, params: unknown[], where: string[]): void {
  const f = req.filters;
  if (!f) return;
  if (f.category && f.category.length > 0) {
    params.push(f.category);
    where.push(`d.category = ANY($${params.length})`);
  }
  if (f.tags && f.tags.length > 0) {
    params.push(f.tags);
    where.push(`d.tags && $${params.length}::text[]`);
  }
  if (f.since) {
    params.push(f.since);
    where.push(`c.created_at >= $${params.length}`);
  }
}

/**
 * Returns a window around the first regex match, with ellipses if truncated.
 * Falls back to leading slice if pattern doesn't compile in JS (PG was happy).
 */
export function excerptAround(content: string, pattern: string, caseInsensitive: boolean): string {
  let re: RegExp | null = null;
  try {
    re = new RegExp(pattern, caseInsensitive ? "i" : "");
  } catch {
    re = null;
  }
  if (!re) return content.slice(0, 240);
  const m = re.exec(content);
  if (!m) return content.slice(0, 240);
  const start = Math.max(0, m.index - EXCERPT_PADDING);
  const end = Math.min(content.length, m.index + m[0].length + EXCERPT_PADDING);
  const head = start > 0 ? "…" : "";
  const tail = end < content.length ? "…" : "";
  return `${head}${content.slice(start, end)}${tail}`;
}
