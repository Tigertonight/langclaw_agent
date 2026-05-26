/**
 * Engine Contract: Tool
 * Stability: stable
 *
 * 工具分类、报告组装、Agentic Fallback 等协议。
 * DomainPack 通过此协议声明工具分类和 LLM 答案生成扩展。
 */

import type { JsonObject, ToolResult } from "./base-types.js";

// ─── Catalog Domain ──────────────────────────────────────────────────────────

export interface CatalogDomainDefinition {
  /** domain taxonomy id，如 "dealer.inventory" */
  id: string;
  /** 展示标签 */
  label: string;
  description?: string;
  icon?: string;
  /** 所属 DomainPack id */
  ownerDomain?: string;
}

// ─── Report Composer ─────────────────────────────────────────────────────────

/**
 * Report Composer 定义。
 * 由 DomainPack 声明，用于在 LLM 答案生成阶段组装域特定的结构化报告。
 * 当 intent_code 匹配时，LLM 层会调用 compose() 替代通用答案生成。
 */
export interface ReportComposerDefinition {
  id: string;
  /** 检查当前路由/工具结果是否应由此 composer 处理 */
  matches(input: { question: string; route?: { intent_code?: string } | null; toolResults: ToolResult[] }): boolean;
  /** 组装结构化报告 */
  compose(input: { question: string; route?: { intent_code?: string } | null; toolResults: ToolResult[] }): { answer: string; artifacts: JsonObject[] } | null;
}

// ─── Agentic Fallback ────────────────────────────────────────────────────────

/**
 * Agentic Fallback 定义。
 * 当 LLM API 不可用时，agentic-handler 会遍历所有注册的 fallback，
 * 找到第一个匹配的 fallback 执行预定义的工具调用序列。
 */
export interface AgenticFallbackDefinition {
  id: string;
  /** 检查消息是否匹配此 fallback */
  matches(message: string): boolean;
  /** 返回要执行的工具调用列表 */
  calls(message: string): Array<{ tool_name: string; args: JsonObject }>;
  /** 组装最终答案 */
  composeAnswer(observations: Array<{ call: { tool_name: string; args: JsonObject }; answer?: string }>): string;
}
