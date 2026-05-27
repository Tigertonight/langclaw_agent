import { resolveEntities } from "./entity-resolver.js";
import { getQueryAdapters, getResourceDetectionKeywords } from "../domains/runtime-registry.js";
import type { QueryIR, UserContext } from "../types/agent-contracts.js";

interface ParseBusinessQueryInput {
  user: UserContext;
  question: string;
  history?: Array<{ text?: string }>;
  conversationContext?: {
    continuation?: { is_likely_continuation?: boolean };
    last_task?: { target?: string };
  };
}

export async function parseBusinessQuery({ user, question, history = [], conversationContext }: ParseBusinessQueryInput): Promise<QueryIR | null> {
  const operation = inferOperation(question);

  // 通过 registry 动态查找 domain query adapter（上下文延续 + NLP 启发式）
  const adapters = getQueryAdapters();
  for (const adapter of adapters) {
    const isContinuation = conversationContext?.last_task?.target
      && adapter.supports({ intentCode: "", resource: conversationContext.last_task.target, params: {}, manifest: {} as never })
      && conversationContext?.continuation?.is_likely_continuation;
    if (isContinuation || adapter.isRelevantQuestion?.(question)) {
      const result = adapter.parseQuery?.({ question, operation, forcedTarget: undefined, user });
      if (result) return result;
    }
  }

  // 如果没有 adapter 匹配，尝试通过 entity resolution 做最后兜底
  const entities = await resolveEntities(question, history);
  if (entities.department || entities.customer || entities.employee) {
    // 有实体但没有 adapter 匹配 — 再次尝试带实体信息的 adapter
    for (const adapter of adapters) {
      if (adapter.isRelevantQuestion?.(question)) {
        const result = adapter.parseQuery?.({ question, operation, forcedTarget: undefined, user });
        if (result) return result;
      }
    }
  }

  return null;
}

export async function planDomainMultiQuery({ question, operation = inferOperation(String(question ?? "")) }: { question?: string; operation?: string } = {}): Promise<QueryIR[] | null> {
  const text = String(question ?? "");
  // 通过 registry 动态查找 domain query adapter 的多资源规划
  const adapters = getQueryAdapters();
  for (const adapter of adapters) {
    if (adapter.isRelevantQuestion?.(text)) {
      const result = adapter.planMultiQuery?.({ question: text, operation });
      if (result) return result;
    }
  }
  return null;
}

export async function isBusinessDataQuestion(question: string): Promise<boolean> {
  const entities = await resolveEntities(question);
  // 通过 registry 动态查找 domain query adapter 的问题识别
  const adapters = getQueryAdapters();
  const isDomainQuestion = adapters.some((a) => a.isRelevantQuestion?.(question));
  const isDomainAnalysis = adapters.some((a) => a.isAnalysisQuestion?.(question));
  return Boolean(entities.customer || entities.employee || entities.department)
    || isDomainQuestion
    || isDomainAnalysis
    || inferOperation(question) === "aggregate";
}

/**
 * 判断用户问题是否属于域分析类问题。
 * 通过 registry 动态查找 domain query adapter 的分析意图识别。
 */
export function isDomainAnalysisQuestion(question: unknown): boolean {
  const text = String(question ?? "");
  const adapters = getQueryAdapters();
  return adapters.some((a) => a.isAnalysisQuestion?.(text));
}

/**
 * 判断用户问题是否属于域相关问题。
 * 通过 registry 动态查找 domain query adapter 的问题识别。
 */
export function isDomainRelevantQuestion(question: unknown): boolean {
  const text = String(question ?? "");
  const adapters = getQueryAdapters();
  return adapters.some((a) => a.isRelevantQuestion?.(text));
}

// ── 资源检测函数（公共 API，委托给 registry 的 resourceDetectionKeywords） ──

export function isSalesReportQuestion(question: string): boolean {
  const keywords = getResourceDetectionKeywords()["sales_reports"] ?? [];
  return keywords.some((word) => question.includes(word));
}

export function isOrderQuestion(question: string): boolean {
  const keywords = getResourceDetectionKeywords()["orders"] ?? [];
  return keywords.some((word) => question.includes(word));
}

export function isCustomerQuestion(question: unknown): boolean {
  const text = String(question ?? "");
  const keywords = getResourceDetectionKeywords()["customers"] ?? [];
  return keywords.some((word) => text.includes(word))
    || /(我|自己).{0,4}负责/.test(text);
}

export function isOrgQuestion(question: string): boolean {
  const keywords = getResourceDetectionKeywords()["employees"] ?? [];
  return keywords.some((word) => question.includes(word));
}

/**
 * @deprecated 使用 adapter.isRelevantQuestion() 替代。
 * 保留为兼容 shim，委托给 attendance domain 的 queryAdapter。
 */
export function isLeaveRecordQuestion(question: unknown): boolean {
  const text = String(question ?? "");
  const adapters = getQueryAdapters();
  const attendanceAdapter = adapters.find((a) => a.domain === "attendance");
  if (attendanceAdapter?.isRelevantQuestion) return attendanceAdapter.isRelevantQuestion(text);
  // fallback: 如果 attendance adapter 未注册，使用内联逻辑
  const hasLeave = /(请.*假|休假|年假|病假|事假|调休)/.test(text);
  const asksRecord = /(记录|历史|明细|列表|查询|查看|查一下|统计|几次|多少次|有哪些|都有谁)/.test(text);
  const asksPeople = /(同学|下属|下级|下辖|团队|组员|成员|谁|哪些人|哪几个人|哪位|哪些员工)/.test(text);
  return hasLeave && (asksRecord || asksPeople);
}

// ── 通用辅助函数（域无关） ──────────────────────────────────────────────────

function inferOperation(question: unknown): string {
  return /(多少|几个|几次|多少次|数量|总数|统计|有多少|多少人|几个人|几名|人数)/.test(String(question ?? "")) ? "aggregate" : "search";
}
