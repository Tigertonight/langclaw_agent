/**
 * Engine Contract: Intent
 * Stability: stable
 *
 * 意图路由协议。包含确定性规则、参数提取器、短修正规则等。
 * DomainPack 通过此协议声明路由规则，Engine 的 IntentRouter 消费这些规则。
 */

import type { JsonObject, JsonValue } from "./base-types.js";

// ─── Extractor ───────────────────────────────────────────────────────────────

export interface ExtractorContext {
  message: string;
  params?: JsonObject;
  args?: JsonObject;
}

/** Extractor 函数签名 */
export type ExtractorFn = (text: string, ctx?: ExtractorContext) => JsonValue | undefined;

/**
 * 组合式 extractor 规格：引用已注册的 extractor 名称，并可附加默认值和参数。
 *
 * 示例：
 *   leave_time_range: { use: "attendance.leave_time_range", default: "近三个月" }
 */
export interface ExtractorSpec {
  /** 引用已注册的 extractor 名称 */
  use: string;
  /** 当 extractor 返回 undefined 时使用的默认值 */
  default?: JsonValue;
  /**
   * 传递给 extractor 的额外参数，通过 ExtractorContext.args 注入。
   * 不支持运行时动态修改 extractor 函数签名。
   */
  args?: JsonObject;
}

export interface DomainExtractor {
  /** 全局唯一名称，建议 <domain>.<name> 格式 */
  name: string;
  extract(text: string, ctx?: ExtractorContext): JsonValue | undefined;
}

// ─── Deterministic Rule ──────────────────────────────────────────────────────

export interface RuleInput {
  message: string;
  params?: JsonObject;
}

export interface RuleMatch {
  intentCode: string;
  params?: JsonObject;
  reasoning?: string;
  source?: string;
}

export interface DeterministicRuleDefinition {
  /** 规则唯一标识 */
  id: string;
  /** 命中后路由到的 intent_code */
  intentCode: string;
  /**
   * 优先级（数值越小越优先）。
   * 跨 domain 的显式优先级控制。
   */
  priority?: number;
  /** 正向匹配模式（regex 字符串） */
  patterns?: string[];
  /** 反向排除模式（regex 字符串） */
  negativePatterns?: string[];
  /**
   * 参数提取器映射。
   * - string: 引用已注册的 extractor 名称
   * - ExtractorSpec: 组合式引用（带默认值和参数）
   * - ExtractorFn: TypeScript domain pack 的逃生口（不进入 JSON manifest）
   */
  extractors?: Record<string, string | ExtractorSpec | ExtractorFn>;
  /** 静态参数（命中时直接合并到 route params） */
  params?: JsonObject;
  /**
   * 自定义匹配函数（逃生口）。
   * 如果提供，patterns/negativePatterns 将被忽略，完全由此函数决定是否命中。
   */
  match?: (input: RuleInput) => RuleMatch | null;
}

/**
 * Intent code 推断函数。
 * 由 DomainPack 声明，用于从用户消息文本推断 intent_code。
 * 返回 null 表示此函数不处理该消息。
 */
export type IntentCodeInferenceFn = (message: string) => string | null;

// ─── Correction Delta Rule ───────────────────────────────────────────────────

/**
 * 短修正 delta 规则：用于 intent-router 的 buildShortCorrectionDelta。
 * 将 extractor 输出映射到 schema 中的多个候选字段。
 */
export interface CorrectionDeltaRule {
  /** 规则唯一标识 */
  id: string;
  /** 源 extractor 名称 */
  extractor: string;
  /** 候选目标字段列表（按优先级排序） */
  targetFields: string[];
  /** 可选：值归一化 extractor 名称（如 normalize_series） */
  normalizeExtractor?: string;
  /** 可选：消歧正则映射（text regex → 优先字段） */
  disambiguate?: Array<{ pattern: string; field: string }>;
  /** 可选：文本匹配正则（匹配时触发特殊行为，如清空字段） */
  textPattern?: string;
  /** 可选：匹配时设置的值（null 表示清空） */
  setValue?: JsonValue | null;
  /** 可选：匹配时设置的目标字段列表 */
  setFields?: string[];
}
