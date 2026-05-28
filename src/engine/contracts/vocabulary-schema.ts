/**
 * Engine Contract: Vocabulary
 * Stability: experimental
 *
 * 词表文件的 zod schema。每个 DomainPack 在 data/domains/<pack>/vocabulary.yaml
 * 维护一份；Engine 通过 vocabulary/loader 读入并转换成 EvolutionExtractionContract。
 *
 * 同一份 schema 同时用于：
 *   - 正式词表（vocabulary.yaml）：approved=true 的条目才会注入运行时
 *   - curator 草稿（vocabulary.draft.yaml）：所有条目都带 sources/frequency/examples
 *
 * 形态保持稳定：新增字段必须 optional，避免老 yaml 文件加载失败。
 */

import { z } from "zod";

/* ── 单个词表条目 ─────────────────────────────────────────────────────────── */

const VocabularyEntrySchema = z.object({
  /** 规范形式（canonical）。LLM 在抽取时必须输出这个值。 */
  canonical: z.string().min(1).max(120),
  /** 同义词折叠表。模型抽到这里面任何一个都视作 canonical。 */
  aliases: z.array(z.string().min(1).max(120)).max(50).optional(),
  /** 自由文本注释，仅作 prompt few-shot 时给模型的提示。 */
  description: z.string().max(500).optional(),
  /** 是否已通过人工审核。loader 只注入 approved=true 的条目。 */
  approved: z.boolean().default(false),
  /** 出处来源标签：db_schema | trace | domain_pack | manual。 */
  sources: z.array(z.enum(["db_schema", "trace", "domain_pack", "manual"])).optional(),
  /** curator 统计的出现频次，仅 draft 携带。 */
  frequency: z.number().int().nonnegative().optional(),
  /** 几个原文示例，便于人工审核时判断含义。 */
  examples: z.array(z.string().max(400)).max(5).optional(),
  /** 审核通过的时间戳（ISO-8601）。 */
  approved_at: z.string().datetime().optional(),
  /** 审核人。 */
  approved_by: z.string().max(120).optional()
});

export type VocabularyEntry = z.infer<typeof VocabularyEntrySchema>;

/* ── Few-shot 示例 ────────────────────────────────────────────────────────── */

const FewShotExampleSchema = z.object({
  label: z.string().min(1).max(120),
  user_message: z.string().min(1).max(2000),
  assistant_answer: z.string().max(2000),
  /** 期望模型抽出的 JSON（必须是合法 JSON 字符串）。 */
  expected_json: z.string().min(2).max(8000),
  approved: z.boolean().default(false)
});

export type FewShotExample = z.infer<typeof FewShotExampleSchema>;

/* ── 整个词表文件 ─────────────────────────────────────────────────────────── */

export const VocabularyFileSchema = z.object({
  /** 所属 DomainPack 的 id（与目录名一致）。loader 会校验匹配。 */
  pack_id: z.string().min(1).max(80),
  /** Schema 版本号，便于后续演进。当前固定 "1"。 */
  schema_version: z.literal("1").default("1"),
  /** 业务领域简介，作为 prompt 中的 domainLabel。 */
  domain_label: z.string().max(200).optional(),
  /** 实体类型词表（customer/product/order ...）。 */
  entity_types: z.array(VocabularyEntrySchema).max(200).default([]),
  /** 谓词词表（ordered/prefers/complained_about ...）。 */
  predicates: z.array(VocabularyEntrySchema).max(300).default([]),
  /** 强属性键词表（phone/email/id_card ...）。 */
  strong_attribute_keys: z.array(VocabularyEntrySchema).max(100).default([]),
  /** Few-shot 示例。 */
  few_shot_examples: z.array(FewShotExampleSchema).max(20).default([]),
  /** 文件级元信息——curator 写、loader 不读。 */
  metadata: z.object({
    generated_at: z.string().datetime().optional(),
    generated_by: z.string().max(120).optional(),
    notes: z.string().max(2000).optional()
  }).optional()
});

export type VocabularyFile = z.infer<typeof VocabularyFileSchema>;

/**
 * 安全解析。无论入参是 yaml 解析后对象还是 JSON，都返回
 *   { ok: true, data } 或 { ok: false, reason }。
 */
export function parseVocabularyFile(raw: unknown): { ok: true; data: VocabularyFile } | { ok: false; reason: string } {
  const result = VocabularyFileSchema.safeParse(raw);
  if (!result.success) {
    return { ok: false, reason: `vocab_schema_invalid:${result.error.issues.map((i) => i.path.join(".") + ":" + i.message).slice(0, 3).join("|")}` };
  }
  return { ok: true, data: result.data };
}
