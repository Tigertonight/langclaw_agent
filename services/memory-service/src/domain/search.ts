import { z } from "zod";

export const SearchModeSchema = z.enum(["lexical", "vector", "hybrid"]);
export type SearchMode = z.infer<typeof SearchModeSchema>;

export const SearchFiltersSchema = z.object({
  category: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  since: z.string().datetime().optional()
}).strict();

export type SearchFilters = z.infer<typeof SearchFiltersSchema>;

export const MemorySearchSchema = z.object({
  query: z.string().min(1).max(2000),
  filters: SearchFiltersSchema.optional(),
  mode: SearchModeSchema.default("hybrid"),
  top_k: z.number().int().min(1).max(50).default(10),
  rerank: z.boolean().default(true)
}).strict();

export type MemorySearchInput = z.infer<typeof MemorySearchSchema>;

export interface ScoreBreakdown {
  vector?: number;
  lexical?: number;
  recency?: number;
  rrf?: number;
}

export interface SearchHit {
  id: string;
  source: "memory" | "document_chunk" | "message";
  category?: string;
  title?: string;
  heading_path?: string[];
  document_id?: string;
  content: string;
  tags?: string[];
  score: number;
  score_breakdown?: ScoreBreakdown;
  highlights?: string[];
  created_at?: string;
}

export const RRF_K = 60;

export const KnowledgeSourceSchema = z.enum(["memories", "document_chunks", "messages"]);
export type KnowledgeSource = z.infer<typeof KnowledgeSourceSchema>;

export const KnowledgeSearchSchema = z.object({
  query: z.string().min(1).max(2000),
  sources: z.array(KnowledgeSourceSchema).min(1).max(3).default(["memories", "document_chunks"]),
  filters: z.object({
    category: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    document_category: z.array(z.string()).optional(),
    since: z.string().datetime().optional()
  }).strict().optional(),
  mode: SearchModeSchema.default("hybrid"),
  top_k: z.number().int().min(1).max(50).default(10)
}).strict();

export type KnowledgeSearchInput = z.infer<typeof KnowledgeSearchSchema>;
