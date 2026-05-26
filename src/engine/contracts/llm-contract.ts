/**
 * Engine Contract: LLM Heuristics
 * Stability: stable
 *
 * LLM 启发式协议。供 DomainPack 声明本地 LLM 客户端用于意图识别和工具规划的
 * 业务启发式，避免在 src/llm/local-llm.ts 中硬编码业务关键词或字段名。
 *
 * 这些启发式只对 LocalLLMClient 生效（本地兜底路径）。OpenAI/真实 LLM 的
 * prompt 不依赖这些 — 它通过 DomainPack.routerPromptHints / answerPromptHints 等
 * 已有字段配置 system prompt。
 */

import type { ToolCall } from "./base-types.js";

// ─── Local Policy Question Pattern ───────────────────────────────────────────

/**
 * "这个问题应该路由到 KNOWLEDGE_QA"的启发式。
 *
 * 替代 local-llm.ts 中硬编码的 isLeavePolicyQuestion。
 * 任何域可以声明：当用户问到本域的"制度/政策/流程"类问题时，
 * 把意图归类到 KNOWLEDGE_QA。
 *
 * 示例：attendance 域声明"问到请假怎么办"→ KNOWLEDGE_QA。
 */
export interface LocalPolicyQuestionPattern {
  /** 唯一标识 */
  id: string;
  /** 命中后给出的 reason 文本（用于 classifyIntent 的 reason 字段） */
  reason?: string;
  /** 判断函数：返回 true 表示这是一个本域的策略/政策类问题 */
  matches(question: string): boolean;
}

// ─── Local Planner Heuristic ─────────────────────────────────────────────────

/**
 * "本地兜底规划器"的启发式。
 *
 * 替代 local-llm.ts 中硬编码的 isPersonalCustomerOverviewQuestion +
 * buildPersonalCustomerOverviewPlan。任何域可以声明：当问题命中模式时，
 * 直接返回一组预设的工具调用计划（不走 query parser）。
 *
 * 用于本地 LLM 客户端无法走真实规划路径时的快速兜底。
 */
export interface LocalPlannerHeuristic {
  /** 唯一标识 */
  id: string;
  /** 优先级（数值越小越优先），默认 100 */
  priority?: number;
  /** 是否命中此模式 */
  matches(question: string): boolean;
  /** 返回工具调用计划 */
  buildPlan(question: string): {
    calls: ToolCall[];
    reason?: string;
  };
}

// ─── Knowledge Chunk Heading Hint ────────────────────────────────────────────

/**
 * 知识库 chunk 选择启发式。
 *
 * 替代 local-llm.ts chooseAnswerChunk 中硬编码的 headingHints 表。
 * 当用户问题包含 questionKeyword 时，优先选择 metadata.heading 命中
 * matchHeadings 任一字符串的 chunk。
 *
 * 示例：dealer 域声明 { questionKeyword: "权限", matchHeadings: ["权限", "客户数据访问"] }。
 */
export interface KnowledgeChunkHeadingHint {
  /** 用户问题中的触发关键词 */
  questionKeyword: string;
  /** 命中时优先选择的 heading 字符串列表（任一匹配即可） */
  matchHeadings: string[];
}

// ─── Important Sentence Keyword ──────────────────────────────────────────────

/**
 * 知识库 chunk 重要句提取启发式。
 *
 * 替代 local-llm.ts summarizeChunk 中硬编码的关键词数组。
 * 当用户问题和某个句子同时包含此关键词时，该句子被视为重要句优先返回。
 *
 * 示例：attendance 域贡献 ["报销", "试用期", "年假", "审批"]。
 */
export type ImportantSentenceKeyword = string;
