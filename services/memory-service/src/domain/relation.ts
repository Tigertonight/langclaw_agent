import { z } from "zod";

// 三元组写入。object_id 与 object_value 必须二选一（DB CHECK 也强制）。
export const RelationCreateSchema = z.object({
  subject_id: z.string().min(1).max(240),
  predicate: z.string().min(1).max(120),
  object_id: z.string().min(1).max(240).nullable().optional(),
  object_value: z.unknown().optional(),
  occurred_at: z.string().datetime().nullable().optional(),
  source_memory_id: z.string().uuid().nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
  metadata: z.record(z.unknown()).optional()
}).strict().refine((v) => {
  const hasObjId = v.object_id !== null && v.object_id !== undefined;
  const hasObjVal = v.object_value !== undefined;
  return hasObjId !== hasObjVal;
}, { message: "exactly one of object_id or object_value is required" });

export type RelationCreateInput = z.infer<typeof RelationCreateSchema>;

export const RelationQuerySchema = z.object({
  subject_id: z.string().min(1).max(240).optional(),
  predicate: z.string().min(1).max(120).optional(),
  object_id: z.string().min(1).max(240).optional(),
  occurred_from: z.string().datetime().optional(),
  occurred_to: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(500).default(100),
  cursor: z.string().optional()
}).strict().refine(
  (v) => v.subject_id !== undefined || v.predicate !== undefined || v.object_id !== undefined,
  { message: "at least one of subject_id, predicate, or object_id is required" }
);

export type RelationQueryInput = z.infer<typeof RelationQuerySchema>;

export interface RelationDto {
  id: string;
  business_id: string;
  subject_id: string;
  predicate: string;
  object_id: string | null;
  object_value: unknown | null;
  occurred_at: string | null;
  source_memory_id: string | null;
  confidence: number;
  metadata: Record<string, unknown>;
  created_at: string;
}
