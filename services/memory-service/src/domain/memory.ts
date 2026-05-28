import { z } from "zod";
import { MEMORY_CATEGORIES } from "../db/types.js";

export const MemoryCreateSchema = z.object({
  category: z.enum(MEMORY_CATEGORIES as [string, ...string[]]),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  content: z.string().min(1).max(20_000),
  source: z.string().max(120).nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
  tags: z.array(z.string().min(1).max(80)).max(32).optional(),
  metadata: z.record(z.unknown()).optional(),
  expired_at: z.string().datetime().nullable().optional()
}).strict();

export type MemoryCreateInput = z.infer<typeof MemoryCreateSchema>;

export const MemoryPatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  content: z.string().min(1).max(20_000).optional(),
  confidence: z.number().min(0).max(1).optional(),
  tags: z.array(z.string().min(1).max(80)).max(32).optional(),
  metadata: z.record(z.unknown()).optional(),
  expired_at: z.string().datetime().nullable().optional()
}).strict().refine((v) => Object.keys(v).length > 0, {
  message: "patch body must contain at least one field"
});

export type MemoryPatchInput = z.infer<typeof MemoryPatchSchema>;

export const MemoryListQuerySchema = z.object({
  category: z.string().optional(),
  tag: z.string().optional(),
  since: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional()
});

export type MemoryListQuery = z.infer<typeof MemoryListQuerySchema>;

export interface MemoryDto {
  id: string;
  business_id: string;
  user_id: string;
  agent_id: string | null;
  category: string;
  name: string;
  description: string | null;
  content: string;
  source: string | null;
  confidence: number;
  tags: string[];
  metadata: Record<string, unknown>;
  embedding_model: string | null;
  embedded_at: string | null;
  created_at: string;
  updated_at: string;
  expired_at: string | null;
}

export const EMBEDDING_STATUS = {
  QUEUED: "queued",
  DONE: "done"
} as const;

export type EmbeddingStatus = (typeof EMBEDDING_STATUS)[keyof typeof EMBEDDING_STATUS];
