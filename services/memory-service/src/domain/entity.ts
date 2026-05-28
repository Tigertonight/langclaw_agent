import { z } from "zod";

const ENTITY_LOCAL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_:.\-]{0,200}$/;

// 实体本地 id（不含 business_id 前缀），由调用方传入。最终持久化时拼成
// `${business_id}:${local_id}`，DB CHECK 强制租户前缀。
export const EntityCreateSchema = z.object({
  local_id: z.string().regex(ENTITY_LOCAL_ID_RE, {
    message: "local_id must be alphanumerics + ._:- and start with alphanum"
  }),
  type: z.string().min(1).max(80),
  name: z.string().min(1).max(200),
  aliases: z.array(z.string().min(1).max(200)).max(64).optional(),
  external_ids: z.record(z.string()).optional(),
  attributes: z.record(z.unknown()).optional()
}).strict();

export type EntityCreateInput = z.infer<typeof EntityCreateSchema>;

export const EntityPatchSchema = z.object({
  type: z.string().min(1).max(80).optional(),
  name: z.string().min(1).max(200).optional(),
  aliases: z.array(z.string().min(1).max(200)).max(64).optional(),
  external_ids: z.record(z.string()).optional(),
  attributes: z.record(z.unknown()).optional()
}).strict().refine((v) => Object.keys(v).length > 0, {
  message: "patch body must contain at least one field"
});

export type EntityPatchInput = z.infer<typeof EntityPatchSchema>;

export const EntityListQuerySchema = z.object({
  type: z.string().optional(),
  name_contains: z.string().min(1).max(200).optional(),
  external_id_key: z.string().min(1).max(80).optional(),
  external_id_value: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional()
}).refine(
  (v) => (v.external_id_key === undefined) === (v.external_id_value === undefined),
  { message: "external_id_key and external_id_value must be provided together" }
);

export type EntityListQuery = z.infer<typeof EntityListQuerySchema>;

export interface EntityDto {
  id: string;
  business_id: string;
  type: string;
  name: string;
  aliases: string[];
  external_ids: Record<string, string>;
  attributes: Record<string, unknown>;
  embedding_model: string | null;
  embedded_at: string | null;
  created_at: string;
  updated_at: string;
  merged_into: string | null;
}

export function buildEntityId(businessId: string, localId: string): string {
  return `${businessId}:${localId}`;
}
