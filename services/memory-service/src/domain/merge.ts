import { z } from "zod";

export const EntityMergeSchema = z.object({
  source_id: z.string().min(1).max(240),
  reason: z.string().max(200).optional(),
  merged_by: z.string().max(120).optional()
}).strict();

export type EntityMergeInput = z.infer<typeof EntityMergeSchema>;

export interface EntityMergeLogDto {
  id: string;
  business_id: string;
  source_entity_id: string;
  target_entity_id: string;
  reason: string | null;
  merged_by: string | null;
  merged_at: string;
  rolled_back_at: string | null;
}
