import { z } from "zod";

export const DocumentIngestSchema = z.object({
  source_path: z.string().min(1).max(1000),
  content: z.string().min(1).max(2_000_000),
  category: z.string().max(80).optional(),
  tags: z.array(z.string().min(1).max(80)).max(32).optional(),
  metadata: z.record(z.unknown()).optional(),
  /** Override frontmatter title; otherwise extracted from first H1 or frontmatter.title. */
  title: z.string().max(500).optional()
}).strict();

export type DocumentIngestInput = z.infer<typeof DocumentIngestSchema>;

export const DocumentBatchIngestSchema = z.object({
  items: z.array(DocumentIngestSchema).min(1).max(200)
}).strict();

export interface DocumentDto {
  id: string;
  business_id: string;
  source_path: string;
  source_hash: string;
  title: string | null;
  category: string | null;
  tags: string[];
  frontmatter: Record<string, unknown>;
  metadata: Record<string, unknown>;
  ingested_at: string;
  updated_at: string;
  chunks_count?: number;
}

export interface DocumentChunkDto {
  id: string;
  document_id: string;
  chunk_index: number;
  heading_path: string[];
  content: string;
  char_start: number;
  char_end: number;
  embedding_model: string | null;
}
