import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { pool } from "./pool.js";
import type { Identity } from "../http/identity.js";
import type { DocumentDto, DocumentIngestInput } from "../domain/document.js";
import type { ParsedChunk } from "../ingest/parser.js";

type Executor = Pool | PoolClient;

interface DocumentRow {
  id: string;
  business_id: string;
  source_path: string;
  source_hash: string;
  title: string | null;
  frontmatter: Record<string, unknown>;
  category: string | null;
  tags: string[] | null;
  metadata: Record<string, unknown>;
  ingested_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export type IngestStatus = "ingested" | "unchanged" | "updated";

export interface IngestResult {
  document: DocumentDto;
  status: IngestStatus;
  chunks_count: number;
}

export class DocumentRepo {
  constructor(private readonly executor: Executor = pool) {}

  static hash(content: string): string {
    return `sha256:${createHash("sha256").update(content).digest("hex")}`;
  }

  async findByPath(identity: Identity, source_path: string): Promise<DocumentRow | null> {
    const { rows } = await this.executor.query<DocumentRow>(
      `SELECT id, business_id, source_path, source_hash, title, frontmatter, category, tags,
              metadata, ingested_at, updated_at, deleted_at
       FROM documents
       WHERE business_id = $1 AND source_path = $2 AND deleted_at IS NULL`,
      [identity.business_id, source_path]
    );
    return rows[0] ?? null;
  }

  async findById(identity: Identity, id: string): Promise<DocumentRow | null> {
    const { rows } = await this.executor.query<DocumentRow>(
      `SELECT id, business_id, source_path, source_hash, title, frontmatter, category, tags,
              metadata, ingested_at, updated_at, deleted_at
       FROM documents
       WHERE business_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [identity.business_id, id]
    );
    return rows[0] ?? null;
  }

  async list(identity: Identity, filters: { category?: string; limit?: number }): Promise<DocumentRow[]> {
    const params: unknown[] = [identity.business_id];
    let where = "business_id = $1 AND deleted_at IS NULL";
    if (filters.category) {
      params.push(filters.category);
      where += ` AND category = $${params.length}`;
    }
    params.push(filters.limit ?? 100);
    const sql = `
      SELECT id, business_id, source_path, source_hash, title, frontmatter, category, tags,
             metadata, ingested_at, updated_at, deleted_at
      FROM documents
      WHERE ${where}
      ORDER BY ingested_at DESC
      LIMIT $${params.length}
    `;
    const { rows } = await this.executor.query<DocumentRow>(sql, params);
    return rows;
  }

  async listChunks(identity: Identity, documentId: string): Promise<{
    id: string; chunk_index: number; heading_path: string[] | null;
    content: string; char_start: number | null; char_end: number | null;
  }[]> {
    const { rows } = await this.executor.query<{
      id: string; chunk_index: number; heading_path: string[] | null;
      content: string; char_start: number | null; char_end: number | null;
    }>(
      `SELECT c.id, c.chunk_index, c.heading_path, c.content, c.char_start, c.char_end
       FROM document_chunks c
       JOIN documents d ON d.id = c.document_id
       WHERE c.document_id = $1 AND c.business_id = $2 AND d.deleted_at IS NULL
       ORDER BY c.chunk_index ASC`,
      [documentId, identity.business_id]
    );
    return rows;
  }

  async softDelete(identity: Identity, id: string): Promise<boolean> {
    const { rowCount } = await this.executor.query(
      `UPDATE documents
       SET deleted_at = now(), updated_at = now()
       WHERE business_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [identity.business_id, id]
    );
    return (rowCount ?? 0) > 0;
  }

  async upsert(
    identity: Identity,
    input: DocumentIngestInput,
    parsed: { frontmatter: Record<string, unknown>; title: string | null; chunks: ParsedChunk[] }
  ): Promise<IngestResult> {
    const hash = DocumentRepo.hash(input.content);
    const existing = await this.findByPath(identity, input.source_path);

    if (existing && existing.source_hash === hash) {
      return {
        document: rowToDto(existing, parsed.chunks.length),
        status: "unchanged",
        chunks_count: parsed.chunks.length
      };
    }

    const client = "query" in this.executor && "release" in this.executor
      ? (this.executor as PoolClient)
      : await pool.connect();
    const owns = client !== this.executor;
    try {
      if (owns) await client.query("BEGIN");
      const docRow = existing
        ? await this.update(client, identity, existing.id, input, parsed, hash)
        : await this.insert(client, identity, input, parsed, hash);
      await this.replaceChunks(client, identity, docRow.id, parsed.chunks);
      if (owns) await client.query("COMMIT");
      return {
        document: rowToDto(docRow, parsed.chunks.length),
        status: existing ? "updated" : "ingested",
        chunks_count: parsed.chunks.length
      };
    } catch (err) {
      if (owns) await client.query("ROLLBACK");
      throw err;
    } finally {
      if (owns) client.release();
    }
  }

  private async insert(
    client: Executor,
    identity: Identity,
    input: DocumentIngestInput,
    parsed: { frontmatter: Record<string, unknown>; title: string | null },
    hash: string
  ): Promise<DocumentRow> {
    const sql = `
      INSERT INTO documents (
        business_id, source_path, source_hash, title, frontmatter,
        category, tags, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, business_id, source_path, source_hash, title, frontmatter, category, tags,
                metadata, ingested_at, updated_at, deleted_at
    `;
    const params = [
      identity.business_id,
      input.source_path,
      hash,
      input.title ?? parsed.title,
      JSON.stringify(parsed.frontmatter),
      input.category ?? null,
      input.tags ?? null,
      JSON.stringify(input.metadata ?? {})
    ];
    const { rows } = await client.query<DocumentRow>(sql, params);
    return rows[0]!;
  }

  private async update(
    client: Executor,
    identity: Identity,
    id: string,
    input: DocumentIngestInput,
    parsed: { frontmatter: Record<string, unknown>; title: string | null },
    hash: string
  ): Promise<DocumentRow> {
    const sql = `
      UPDATE documents
      SET source_hash = $1,
          title = $2,
          frontmatter = $3,
          category = COALESCE($4, category),
          tags = COALESCE($5, tags),
          metadata = $6,
          updated_at = now()
      WHERE business_id = $7 AND id = $8
      RETURNING id, business_id, source_path, source_hash, title, frontmatter, category, tags,
                metadata, ingested_at, updated_at, deleted_at
    `;
    const params = [
      hash,
      input.title ?? parsed.title,
      JSON.stringify(parsed.frontmatter),
      input.category ?? null,
      input.tags ?? null,
      JSON.stringify(input.metadata ?? {}),
      identity.business_id,
      id
    ];
    const { rows } = await client.query<DocumentRow>(sql, params);
    return rows[0]!;
  }

  private async replaceChunks(client: Executor, identity: Identity, documentId: string, chunks: ParsedChunk[]): Promise<void> {
    await client.query("DELETE FROM document_chunks WHERE document_id = $1", [documentId]);
    if (chunks.length === 0) return;
    const valuesSql: string[] = [];
    const params: unknown[] = [];
    for (const chunk of chunks) {
      params.push(documentId, identity.business_id, chunk.index, chunk.heading_path, chunk.content, chunk.char_start, chunk.char_end);
      const base = params.length - 7;
      valuesSql.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`);
    }
    await client.query(
      `INSERT INTO document_chunks (document_id, business_id, chunk_index, heading_path, content, char_start, char_end)
       VALUES ${valuesSql.join(", ")}`,
      params
    );
  }
}

function rowToDto(row: DocumentRow, chunksCount: number): DocumentDto {
  return {
    id: row.id,
    business_id: row.business_id,
    source_path: row.source_path,
    source_hash: row.source_hash,
    title: row.title,
    category: row.category,
    tags: row.tags ?? [],
    frontmatter: row.frontmatter ?? {},
    metadata: row.metadata ?? {},
    ingested_at: row.ingested_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    chunks_count: chunksCount
  };
}

export { rowToDto as documentRowToDto };
export type { DocumentRow };
