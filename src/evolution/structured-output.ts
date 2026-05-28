/**
 * Phase 2.5 — 结构化抽取 schema。
 *
 * Evolution Judge 升级版返回的 JSON 形态：在原有 memory_actions 基础上，
 * 增加 entities + relations 两个顶层数组，把会话里出现的业务实体和关系
 * 一次性抽出来，由 Engine 解析后通过 memory-service 落库。
 *
 * 关键点：
 * - entities[].local_id 是本批 payload 内部的占位符（无 business_id 前缀），
 *   relations[].subject 和 relations[].object_ref 通过 local_id 引用同批实体；
 * - Engine 在落库时先 resolve / upsert 每个实体拿到正式 id，再把 relations
 *   里的 local_id 替换成正式 id 写入；
 * - 所有字段对 LLM 都是 optional 友好：解析失败时退化到 Phase 1 的纯
 *   memory_actions 路径，不阻塞主流程。
 */

import { z } from "zod";

/* ── 实体 ─────────────────────────────────────────────────────────────────── */

const ExternalIdsSchema = z.record(z.string(), z.string());
const StrongAttributesSchema = z.record(z.string(), z.string());
const AttributesSchema = z.record(z.string(), z.unknown());

export const ExtractedEntitySchema = z.object({
  /** 仅在本 payload 内唯一即可，例如 "c001" / "p_han_ev"。Engine 加 business_id 前缀。 */
  local_id: z.string().min(1).max(220),
  type: z.string().min(1).max(80),
  name: z.string().min(1).max(200),
  aliases: z.array(z.string().max(200)).max(20).optional(),
  /** 业务系统主键（CRM ID / DMS ID 等） */
  external_ids: ExternalIdsSchema.optional(),
  /** 高信号属性（手机号 / 邮箱等），用于 resolver 评分 */
  strong_attributes: StrongAttributesSchema.optional(),
  /** 其他属性，原样落库 */
  attributes: AttributesSchema.optional(),
  /** 模型对该实体存在性的置信度 */
  confidence: z.number().min(0).max(1).optional()
});

export type ExtractedEntity = z.infer<typeof ExtractedEntitySchema>;

/* ── 关系 ─────────────────────────────────────────────────────────────────── */

/** subject 可以是 local_id（本批新实体）或已知 entity 的 full_id。 */
const EntityRefSchema = z.union([
  z.object({ local_id: z.string().min(1).max(220) }).strict(),
  z.object({ full_id: z.string().min(1).max(240) }).strict()
]);

export const ExtractedRelationSchema = z.object({
  subject: EntityRefSchema,
  predicate: z.string().min(1).max(120),
  /** 互斥：要么 object 引用一个实体，要么 object_value 是字面量。 */
  object: EntityRefSchema.optional(),
  object_value: z.unknown().optional(),
  occurred_at: z.string().datetime().optional(),
  confidence: z.number().min(0).max(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
}).refine(
  (rel) => Boolean(rel.object) !== (rel.object_value !== undefined),
  { message: "exactly one of object or object_value must be set" }
);

export type ExtractedRelation = z.infer<typeof ExtractedRelationSchema>;

/* ── 顶层结构 ─────────────────────────────────────────────────────────────── */

const MemoryActionSchema = z.object({
  op: z.enum(["upsert", "remove"]),
  type: z.enum(["preference", "fact", "procedure", "episode", "feedback", "project", "reference", "user"]),
  key: z.string().min(1).max(200),
  value: z.string().max(8000).optional(),
  confidence: z.number().min(0).max(1).optional(),
  source: z.string().max(200).optional()
});

export const ExtractionResultSchema = z.object({
  should_evolve: z.boolean().optional(),
  confidence: z.number().min(0).max(1).optional(),
  reason: z.string().max(500).optional(),
  memory_actions: z.array(MemoryActionSchema).max(50).optional(),
  entities: z.array(ExtractedEntitySchema).max(50).optional(),
  relations: z.array(ExtractedRelationSchema).max(100).optional()
});

export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

/**
 * 安全解析：无论入参是 JSON 字符串还是已解析对象，都返回
 *   { ok: true, data } 或 { ok: false, reason }。
 * 调用方收到 ok:false 时应回退到 Phase 1 的 plain memory_actions 路径。
 */
export function parseExtractionResult(raw: unknown): { ok: true; data: ExtractionResult } | { ok: false; reason: string } {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch (err) {
      return { ok: false, reason: `json_parse_failed:${err instanceof Error ? err.message : "unknown"}` };
    }
  }
  const result = ExtractionResultSchema.safeParse(value);
  if (!result.success) {
    return { ok: false, reason: `schema_invalid:${result.error.issues.map((i) => i.path.join(".")).join(",")}` };
  }
  return { ok: true, data: result.data };
}
