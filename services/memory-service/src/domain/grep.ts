import { z } from "zod";

const PATTERN_MAX = 500;
const SAFE_PATTERN_RE = /^[^]{1,500}$/; // size guard only; PG validates regex itself

export const GrepRequestSchema = z.object({
  pattern: z.string().min(1).max(PATTERN_MAX).refine(
    (p) => SAFE_PATTERN_RE.test(p),
    { message: "pattern too long" }
  ),
  case_insensitive: z.boolean().default(true),
  limit: z.number().int().min(1).max(500).default(100),
  filters: z.object({
    category: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    since: z.string().datetime().optional()
  }).strict().optional()
}).strict();

export type GrepRequest = z.infer<typeof GrepRequestSchema>;

export interface GrepHit {
  id: string;
  source: "memory" | "document_chunk";
  document_id?: string;
  source_path?: string;
  heading_path?: string[];
  category?: string | null;
  match_excerpt: string;
  created_at: string;
}
