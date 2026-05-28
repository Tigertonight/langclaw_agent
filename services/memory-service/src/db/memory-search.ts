import type { Pool, PoolClient } from "pg";
import { pool } from "./pool.js";
import type { Identity } from "../http/identity.js";
import type { MemorySearchInput, SearchHit } from "../domain/search.js";
import { RRF_K } from "../domain/search.js";
import { vectorToSql } from "../embedding/serialize.js";
import { getEmbeddingProvider } from "../embedding/index.js";
import type { SpanHandle } from "../../../../packages/observability-sdk/src/index.js";

type Executor = Pool | PoolClient;

export interface RankedRow {
  id: string;
  category: string;
  name: string;
  content: string;
  tags: string[] | null;
  created_at: Date;
  score: number;
}

const CANDIDATE_LIMIT = 50;

export class MemorySearch {
  constructor(private readonly executor: Executor = pool) {}

  async search(
    identity: Identity,
    input: MemorySearchInput,
    parentSpan?: SpanHandle
  ): Promise<SearchHit[]> {
    const filterClauses: string[] = [
      "business_id = $1",
      "user_id = $2",
      "deleted_at IS NULL"
    ];
    const params: unknown[] = [identity.business_id, identity.user_id];
    const f = input.filters ?? {};
    if (f.category && f.category.length > 0) {
      params.push(f.category);
      filterClauses.push(`category = ANY($${params.length})`);
    }
    if (f.tags && f.tags.length > 0) {
      params.push(f.tags);
      filterClauses.push(`tags && $${params.length}::text[]`);
    }
    if (f.since) {
      params.push(f.since);
      filterClauses.push(`created_at >= $${params.length}`);
    }
    const where = filterClauses.join(" AND ");

    if (input.mode === "lexical") {
      const rows = await this.tracedLexical(input.query, where, params, parentSpan);
      return rows.slice(0, input.top_k).map((r) => toHit(r, "lexical"));
    }
    if (input.mode === "vector") {
      const rows = await this.tracedVector(input.query, where, params, parentSpan);
      return rows.slice(0, input.top_k).map((r) => toHit(r, "vector"));
    }
    // hybrid
    const [lex, vec] = await Promise.all([
      this.tracedLexical(input.query, where, params, parentSpan),
      this.tracedVector(input.query, where, params, parentSpan)
    ]);
    return tracedRrf(lex, vec, input.top_k, parentSpan);
  }

  private async tracedLexical(
    query: string,
    where: string,
    baseParams: unknown[],
    parentSpan?: SpanHandle
  ): Promise<RankedRow[]> {
    if (!parentSpan) return this.lexical(query, where, baseParams);
    const span = parentSpan.childSpan({
      name: "memory.search.lex",
      input: { query, top_k: CANDIDATE_LIMIT }
    });
    try {
      const rows = await this.lexical(query, where, baseParams);
      span.end({
        hits: rows.map((r) => ({ id: r.id, score: r.score, name: r.name }))
      });
      return rows;
    } catch (err) {
      span.end(undefined, err);
      throw err;
    }
  }

  private async tracedVector(
    query: string,
    where: string,
    baseParams: unknown[],
    parentSpan?: SpanHandle
  ): Promise<RankedRow[]> {
    if (!parentSpan) return this.vector(query, where, baseParams);
    const span = parentSpan.childSpan({
      name: "memory.search.vector",
      input: { query, top_k: CANDIDATE_LIMIT }
    });
    try {
      const rows = await this.vector(query, where, baseParams);
      span.update({ model: getEmbeddingProvider().modelTag });
      span.end({
        hits: rows.map((r) => ({ id: r.id, score: r.score, name: r.name }))
      });
      return rows;
    } catch (err) {
      span.end(undefined, err);
      throw err;
    }
  }

  private async lexical(query: string, where: string, baseParams: unknown[]): Promise<RankedRow[]> {
    const params = [...baseParams, query, CANDIDATE_LIMIT];
    const queryIdx = baseParams.length + 1;
    const limitIdx = baseParams.length + 2;
    const sql = `
      SELECT id, category, name, content, tags, created_at,
             similarity(content, $${queryIdx}) AS score
      FROM memories
      WHERE ${where}
        AND content % $${queryIdx}
      ORDER BY score DESC
      LIMIT $${limitIdx}
    `;
    const { rows } = await this.executor.query<RankedRow>(sql, params);
    return rows;
  }

  private async vector(query: string, where: string, baseParams: unknown[]): Promise<RankedRow[]> {
    const provider = getEmbeddingProvider();
    const [vec] = await provider.embed([query]);
    if (!vec) return [];
    const params = [...baseParams, vectorToSql(vec), provider.modelTag, CANDIDATE_LIMIT];
    const vecIdx = baseParams.length + 1;
    const modelIdx = baseParams.length + 2;
    const limitIdx = baseParams.length + 3;
    const sql = `
      SELECT id, category, name, content, tags, created_at,
             1 - (embedding <=> $${vecIdx}::vector) AS score
      FROM memories
      WHERE ${where}
        AND embedding IS NOT NULL
        AND embedding_model = $${modelIdx}
      ORDER BY embedding <=> $${vecIdx}::vector ASC
      LIMIT $${limitIdx}
    `;
    const { rows } = await this.executor.query<RankedRow>(sql, params);
    return rows;
  }
}

function toHit(row: RankedRow, kind: "lexical" | "vector"): SearchHit {
  return {
    id: row.id,
    source: "memory",
    category: row.category,
    content: row.content,
    tags: row.tags ?? [],
    score: row.score,
    score_breakdown: { [kind]: row.score },
    created_at: row.created_at.toISOString()
  };
}

function tracedRrf(
  lex: RankedRow[],
  vec: RankedRow[],
  topK: number,
  parentSpan?: SpanHandle
): SearchHit[] {
  if (!parentSpan) return rrfMerge(lex, vec, topK);
  const span = parentSpan.childSpan({
    name: "memory.search.rrf",
    input: { lex_count: lex.length, vec_count: vec.length, top_k: topK, k: RRF_K }
  });
  try {
    const merged = rrfMerge(lex, vec, topK);
    span.end({
      hits: merged.map((h) => ({
        id: h.id,
        score: h.score,
        score_breakdown: h.score_breakdown
      }))
    });
    return merged;
  } catch (err) {
    span.end(undefined, err);
    throw err;
  }
}

/**
 * Reciprocal Rank Fusion. We don't trust raw scores across modalities (cosine
 * sim vs trigram sim live on different scales), so we fuse by rank only.
 */
export function rrfMerge(lex: RankedRow[], vec: RankedRow[], topK: number): SearchHit[] {
  const byId = new Map<string, { row: RankedRow; rrf: number; lex?: number; vec?: number }>();
  lex.forEach((row, idx) => {
    byId.set(row.id, { row, rrf: 1 / (RRF_K + idx + 1), lex: row.score });
  });
  vec.forEach((row, idx) => {
    const existing = byId.get(row.id);
    const rrfBonus = 1 / (RRF_K + idx + 1);
    if (existing) {
      existing.rrf += rrfBonus;
      existing.vec = row.score;
    } else {
      byId.set(row.id, { row, rrf: rrfBonus, vec: row.score });
    }
  });
  return Array.from(byId.values())
    .sort((a, b) => b.rrf - a.rrf)
    .slice(0, topK)
    .map(({ row, rrf, lex: ls, vec: vs }) => ({
      id: row.id,
      source: "memory" as const,
      category: row.category,
      content: row.content,
      tags: row.tags ?? [],
      score: rrf,
      score_breakdown: {
        rrf,
        lexical: ls,
        vector: vs
      },
      created_at: row.created_at.toISOString()
    }));
}
