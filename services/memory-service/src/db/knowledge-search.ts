import type { Pool, PoolClient } from "pg";
import { pool } from "./pool.js";
import type { Identity } from "../http/identity.js";
import type { KnowledgeSearchInput, KnowledgeSource, SearchHit } from "../domain/search.js";
import { RRF_K } from "../domain/search.js";
import { vectorToSql } from "../embedding/serialize.js";
import { getEmbeddingProvider } from "../embedding/index.js";

type Executor = Pool | PoolClient;

const CANDIDATE_LIMIT = 50;

interface RankedRow {
  source: KnowledgeSource;
  id: string;
  category: string | null;
  title: string | null;
  heading_path: string[] | null;
  document_id: string | null;
  content: string;
  tags: string[] | null;
  created_at: Date;
  score: number;
}

/**
 * Cross-source hybrid search across memories + document_chunks + messages.
 *
 * Per source:
 *   - memories       : lexical (trgm) + vector
 *   - document_chunks: lexical (trgm) + vector
 *   - messages       : lexical only (no embedding column / trgm in Phase 1)
 *
 * Each (source, mode) candidate list is RRF'd into a single ranking. We RRF
 * across modalities AND across sources because raw scores aren't comparable.
 */
export class KnowledgeSearch {
  constructor(private readonly executor: Executor = pool) {}

  async search(identity: Identity, input: KnowledgeSearchInput): Promise<SearchHit[]> {
    const sources = new Set(input.sources);
    const wantsVector = input.mode === "vector" || input.mode === "hybrid";
    const wantsLexical = input.mode === "lexical" || input.mode === "hybrid";

    let queryVec: number[] | null = null;
    let modelTag: string | null = null;
    if (wantsVector) {
      const provider = getEmbeddingProvider();
      const [vec] = await provider.embed([input.query]);
      if (vec) {
        queryVec = vec;
        modelTag = provider.modelTag;
      }
    }

    const tasks: Promise<RankedRow[]>[] = [];

    if (sources.has("memories")) {
      if (wantsLexical) tasks.push(this.lexicalMemories(identity, input));
      if (wantsVector && queryVec && modelTag) tasks.push(this.vectorMemories(identity, input, queryVec, modelTag));
    }
    if (sources.has("document_chunks")) {
      if (wantsLexical) tasks.push(this.lexicalChunks(identity, input));
      if (wantsVector && queryVec && modelTag) tasks.push(this.vectorChunks(identity, input, queryVec, modelTag));
    }
    if (sources.has("messages")) {
      if (wantsLexical) tasks.push(this.lexicalMessages(identity, input));
      // messages have no embedding column in Phase 1 — vector skipped intentionally.
    }

    const lists = await Promise.all(tasks);
    return rrfMergeMany(lists, input.top_k);
  }

  // ─── memories ──────────────────────────────────────────────────────────
  private async lexicalMemories(identity: Identity, input: KnowledgeSearchInput): Promise<RankedRow[]> {
    const params: unknown[] = [identity.business_id, identity.user_id, input.query];
    const where = ["business_id = $1", "user_id = $2", "deleted_at IS NULL", "content % $3"];
    appendMemoryFilters(input, params, where);
    params.push(CANDIDATE_LIMIT);
    const sql = `
      SELECT id, category, name AS title, NULL::text[] AS heading_path,
             NULL::uuid AS document_id, content, tags, created_at,
             similarity(content, $3) AS score
      FROM memories
      WHERE ${where.join(" AND ")}
      ORDER BY score DESC
      LIMIT $${params.length}
    `;
    const { rows } = await this.executor.query(sql, params);
    return rows.map((r): RankedRow => ({ source: "memories", ...rowDefaults(r) }));
  }

  private async vectorMemories(
    identity: Identity,
    input: KnowledgeSearchInput,
    vec: number[],
    modelTag: string
  ): Promise<RankedRow[]> {
    const vecSql = vectorToSql(vec);
    const params: unknown[] = [identity.business_id, identity.user_id, vecSql, modelTag];
    const where = [
      "business_id = $1",
      "user_id = $2",
      "deleted_at IS NULL",
      "embedding IS NOT NULL",
      "embedding_model = $4"
    ];
    appendMemoryFilters(input, params, where);
    params.push(CANDIDATE_LIMIT);
    const sql = `
      SELECT id, category, name AS title, NULL::text[] AS heading_path,
             NULL::uuid AS document_id, content, tags, created_at,
             1 - (embedding <=> $3::vector) AS score
      FROM memories
      WHERE ${where.join(" AND ")}
      ORDER BY embedding <=> $3::vector ASC
      LIMIT $${params.length}
    `;
    const { rows } = await this.executor.query(sql, params);
    return rows.map((r): RankedRow => ({ source: "memories", ...rowDefaults(r) }));
  }

  // ─── document_chunks ───────────────────────────────────────────────────
  private async lexicalChunks(identity: Identity, input: KnowledgeSearchInput): Promise<RankedRow[]> {
    const params: unknown[] = [identity.business_id, input.query];
    const where = ["c.business_id = $1", "d.deleted_at IS NULL", "c.content % $2"];
    appendDocumentFilters(input, params, where);
    params.push(CANDIDATE_LIMIT);
    const sql = `
      SELECT c.id, d.category, d.title, c.heading_path, d.id AS document_id,
             c.content, d.tags, c.created_at,
             similarity(c.content, $2) AS score
      FROM document_chunks c
      JOIN documents d ON d.id = c.document_id
      WHERE ${where.join(" AND ")}
      ORDER BY score DESC
      LIMIT $${params.length}
    `;
    const { rows } = await this.executor.query(sql, params);
    return rows.map((r): RankedRow => ({ source: "document_chunks", ...rowDefaults(r) }));
  }

  private async vectorChunks(
    identity: Identity,
    input: KnowledgeSearchInput,
    vec: number[],
    modelTag: string
  ): Promise<RankedRow[]> {
    const vecSql = vectorToSql(vec);
    const params: unknown[] = [identity.business_id, vecSql, modelTag];
    const where = [
      "c.business_id = $1",
      "d.deleted_at IS NULL",
      "c.embedding IS NOT NULL",
      "c.embedding_model = $3"
    ];
    appendDocumentFilters(input, params, where);
    params.push(CANDIDATE_LIMIT);
    const sql = `
      SELECT c.id, d.category, d.title, c.heading_path, d.id AS document_id,
             c.content, d.tags, c.created_at,
             1 - (c.embedding <=> $2::vector) AS score
      FROM document_chunks c
      JOIN documents d ON d.id = c.document_id
      WHERE ${where.join(" AND ")}
      ORDER BY c.embedding <=> $2::vector ASC
      LIMIT $${params.length}
    `;
    const { rows } = await this.executor.query(sql, params);
    return rows.map((r): RankedRow => ({ source: "document_chunks", ...rowDefaults(r) }));
  }

  // ─── messages (lexical only) ───────────────────────────────────────────
  private async lexicalMessages(identity: Identity, input: KnowledgeSearchInput): Promise<RankedRow[]> {
    const params: unknown[] = [identity.business_id, identity.user_id, `%${input.query}%`];
    const where = [
      "business_id = $1",
      "user_id = $2",
      "content IS NOT NULL",
      "content ILIKE $3"
    ];
    if (input.filters?.since) {
      params.push(input.filters.since);
      where.push(`created_at >= $${params.length}`);
    }
    params.push(CANDIDATE_LIMIT);
    const sql = `
      SELECT id, NULL::text AS category, NULL::text AS title,
             NULL::text[] AS heading_path, NULL::uuid AS document_id,
             content, NULL::text[] AS tags, created_at,
             0.5::real AS score
      FROM messages
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT $${params.length}
    `;
    const { rows } = await this.executor.query(sql, params);
    return rows.map((r): RankedRow => ({ source: "messages", ...rowDefaults(r) }));
  }
}

function appendMemoryFilters(input: KnowledgeSearchInput, params: unknown[], where: string[]): void {
  const f = input.filters;
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

function appendDocumentFilters(input: KnowledgeSearchInput, params: unknown[], where: string[]): void {
  const f = input.filters;
  if (!f) return;
  if (f.document_category && f.document_category.length > 0) {
    params.push(f.document_category);
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

function rowDefaults(r: any): Omit<RankedRow, "source"> {
  return {
    id: r.id,
    category: r.category ?? null,
    title: r.title ?? null,
    heading_path: r.heading_path ?? null,
    document_id: r.document_id ?? null,
    content: r.content,
    tags: r.tags ?? null,
    created_at: r.created_at,
    score: typeof r.score === "string" ? parseFloat(r.score) : r.score
  };
}

/**
 * Merge multiple ranked candidate lists into a single result. RRF treats each
 * (source, modality) list as an independent voter. A row that ranks well in
 * multiple lists wins.
 *
 * Dedup key is (source, id): the same UUID could theoretically appear across
 * sources (it won't in practice, but we don't want to assume).
 */
export function rrfMergeMany(lists: RankedRow[][], topK: number): SearchHit[] {
  type Bucket = {
    row: RankedRow;
    rrf: number;
    lex?: number;
    vec?: number;
  };
  const byKey = new Map<string, Bucket>();
  for (const list of lists) {
    list.forEach((row, idx) => {
      const key = `${row.source}:${row.id}`;
      const bonus = 1 / (RRF_K + idx + 1);
      const existing = byKey.get(key);
      // We don't know if this list is lexical or vector from here; we mark
      // the score under the source's own breakdown bucket using a heuristic:
      // scores in [0, 1] derived from cosine sim look the same as trgm sim.
      // Since the route caller knows mode, we expose the raw score and let
      // the bucket aggregate. For simpler downstream display we record the
      // best raw score seen for the row.
      if (existing) {
        existing.rrf += bonus;
        if (row.score > (existing.lex ?? -Infinity) && row.score > (existing.vec ?? -Infinity)) {
          existing.lex = row.score;
        }
      } else {
        byKey.set(key, { row, rrf: bonus, lex: row.score });
      }
    });
  }
  return Array.from(byKey.values())
    .sort((a, b) => b.rrf - a.rrf)
    .slice(0, topK)
    .map(({ row, rrf }) => toHit(row, rrf));
}

function toHit(row: RankedRow, rrf: number): SearchHit {
  const sourceLabel: SearchHit["source"] =
    row.source === "memories" ? "memory" :
    row.source === "document_chunks" ? "document_chunk" : "message";
  const hit: SearchHit = {
    id: row.id,
    source: sourceLabel,
    content: row.content,
    score: rrf,
    score_breakdown: { rrf },
    tags: row.tags ?? [],
    created_at: row.created_at?.toISOString?.()
  };
  if (row.category) hit.category = row.category;
  if (row.title) hit.title = row.title;
  if (row.heading_path && row.heading_path.length > 0) hit.heading_path = row.heading_path;
  if (row.document_id) hit.document_id = row.document_id;
  return hit;
}

export type { RankedRow };
