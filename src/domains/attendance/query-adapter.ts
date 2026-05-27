/**
 * AttendanceQueryAdapter：考勤域的查询适配器。
 *
 * 处理 attendance.leave_query 的 buildFilters / buildSort 逻辑，
 * 从 IntentQueryHandler.buildFilters() 中迁移而来。
 *
 * 同时提供 isRelevantQuestion / parseQuery 用于 query-parser 的 NLP 启发式，
 * 替代原先硬编码在 query-parser.ts 中的 isLeaveRecordQuestion / parseLeaveRecordQuery。
 */

import type {
  DomainQueryAdapter,
  QueryAdapterInput,
  FiltersInput,
  SortInput,
} from "../types.js";
import type { QueryFilter, QueryIR, QuerySort } from "../../types/agent-contracts.js";
import { translateTimeRangeToIso, extractMonthToken } from "../shared/time-utils.js";
import { createQueryIR } from "../../query/query-ir.js";

/**
 * 从用户消息中推断请假类型。
 */
function inferLeaveType(text: string): string | null {
  if (/年假/.test(text)) return "年假";
  if (/病假/.test(text)) return "病假";
  if (/事假/.test(text)) return "事假";
  if (/调休/.test(text)) return "调休";
  return null;
}

/**
 * 判断用户问题是否属于请假记录查询。
 * 从 query-parser.ts 的 isLeaveRecordQuestion 迁移而来。
 */
function isLeaveRecordQuestion(question: string): boolean {
  const hasLeave = /(请.*假|休假|年假|病假|事假|调休)/.test(question);
  const asksRecord = /(记录|历史|明细|列表|查询|查看|查一下|统计|几次|多少次|有哪些|都有谁)/.test(question);
  const asksPeople = /(同学|下属|下级|下辖|团队|组员|成员|谁|哪些人|哪几个人|哪位|哪些员工)/.test(question);
  return hasLeave && (asksRecord || asksPeople);
}

function inferOperation(question: string): string {
  return /(多少|几个|几次|多少次|数量|总数|统计|有多少|多少人|几个人|几名|人数)/.test(question) ? "aggregate" : "search";
}

function extractRecentStartDate(question: string): string | null {
  const monthsMatch = question.match(/最近\s*([一二两三四五六七八九十\d]+)\s*个?月/);
  if (!monthsMatch) return null;
  const months = parseChineseNumber(monthsMatch[1]);
  if (!months) return null;
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return formatDate(date);
}

function parseChineseNumber(token: string): number | null {
  const map: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  if (/^\d+$/.test(token)) return Number(token);
  if (token === "十") return 10;
  if (token.includes("十")) {
    const [left, right] = token.split("十");
    return (left ? map[left] ?? 0 : 1) * 10 + (right ? map[right] ?? 0 : 0);
  }
  return map[token] ?? null;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function extractLocalMonthToken(question: string): string | null {
  const explicit = question.match(/(\d{4}-\d{2})/);
  if (explicit) return explicit[1];
  const month = question.match(/(\d{1,2})月/);
  if (!month) return null;
  return `2026-${String(month[1]).padStart(2, "0")}`;
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

export const attendanceQueryAdapter: DomainQueryAdapter = {
  domain: "attendance",

  supports(input: QueryAdapterInput): boolean {
    return input.intentCode === "attendance.leave_query" && input.resource === "leave_requests";
  },

  isRelevantQuestion(question: string): boolean {
    return isLeaveRecordQuestion(question);
  },

  /**
   * 从 NLP 启发式解析请假查询。
   * 用于 conversation-context 的 inferTaskFromText 和 query-parser 的 parseBusinessQuery。
   */
  inferTask(question: string): { intent_code: string; selected_skill: string; target: string; operation: string } | null {
    if (!isLeaveRecordQuestion(question)) return null;
    return {
      intent_code: "attendance.leave_query",
      selected_skill: "leave-records",
      target: "leave_requests",
      operation: "search",
    };
  },

  /**
   * 解析请假记录查询为 QueryIR。
   * 从 query-parser.ts 的 parseLeaveRecordQuery 迁移而来。
   */
  parseQuery({ question, operation }: { question: string; operation: string; forcedTarget?: string }): QueryIR | null {
    if (!isLeaveRecordQuestion(question)) return null;

    const filters: QueryFilter[] = [];
    const selfScope = /(我|我的|本人)/.test(question);
    const teamScope = /(同学|下属|下级|下辖|团队|组员|成员)/.test(question) && !selfScope;
    const companyScope = /(全公司|整个公司|公司全员|所有员工|全部员工|谁|哪些人|哪几个人|哪位|哪些员工)/.test(question) && !selfScope;

    if (companyScope) {
      filters.push({ field: "applicant_user_id", op: "in", value: "__ALL_ORG_USERS__" });
    } else if (teamScope) {
      filters.push({ field: "applicant_user_id", op: "in", value: "__CURRENT_USER_REPORTS__" });
    } else {
      filters.push({ field: "applicant_user_id", op: "eq", value: "__CURRENT_USER__" });
    }

    if (question.includes("年假")) filters.push({ field: "leave_type", op: "eq", value: "年假" });
    if (question.includes("病假")) filters.push({ field: "leave_type", op: "eq", value: "病假" });
    if (question.includes("事假")) filters.push({ field: "leave_type", op: "eq", value: "事假" });
    if (question.includes("调休")) filters.push({ field: "leave_type", op: "eq", value: "调休" });

    const monthToken = extractLocalMonthToken(question);
    if (monthToken) {
      filters.push({ field: "start_time", op: "contains", value: monthToken });
    } else {
      const recentStart = extractRecentStartDate(question);
      if (recentStart) {
        filters.push({ field: "start_time", op: "gte", value: recentStart });
        filters.push({ field: "start_time", op: "lte", value: formatDate(new Date()) });
      }
    }

    return createQueryIR({
      domain: "attendance",
      target: "leave_requests",
      operation,
      filters,
      metrics: operation === "aggregate" ? [{ type: "count", field: "id", as: "leave_request_count" }] : [],
      sort: [{ field: "start_time", direction: "desc" }],
      limit: 20,
      reason: companyScope ? "用户查询组织范围内的请假记录。"
        : teamScope ? "用户查询汇报链员工的请假记录。" : "用户查询本人请假记录。"
    });
  },

  buildFilters(input: FiltersInput): QueryFilter[] {
    const { params, message, user } = input;
    const filters: QueryFilter[] = [];
    const { scope, applicant_name, leave_type, time_range, status } = params ?? {};
    const text = String(message ?? "");

    // ── 范围过滤 ──
    const selfScope = scope === "self" || /(我|我的|本人)/.test(text);
    const companyScope = scope === "company" || /(全公司|整个公司|公司全员|所有员工|全部员工|公司最近)/.test(text);
    const teamScope = scope === "team" || /(同学|下属|下级|下辖|团队|组员|成员)/.test(text);
    const peopleScope = /(谁|哪些人|哪几个人|哪位|哪些员工)/.test(text);

    if (applicant_name && typeof applicant_name === "string" && applicant_name.trim()) {
      filters.push({ field: "applicant_name", op: "contains", value: applicant_name.trim() });
    } else if ((companyScope || peopleScope) && user?.permissions?.includes("org:read")) {
      filters.push({ field: "applicant_user_id", op: "in", value: "__ALL_ORG_USERS__" });
    } else if (teamScope && user?.permissions?.includes("org:read")) {
      filters.push({ field: "applicant_user_id", op: "in", value: "__CURRENT_USER_REPORTS__" });
    } else if (selfScope) {
      filters.push({ field: "applicant_user_id", op: "eq", value: "__CURRENT_USER__" });
    } else if (user?.permissions?.includes("org:read")) {
      filters.push({ field: "applicant_user_id", op: "in", value: "__ALL_ORG_USERS__" });
    } else {
      filters.push({ field: "applicant_user_id", op: "eq", value: "__CURRENT_USER__" });
    }

    // ── 请假类型 ──
    const inferredType = inferLeaveType(text);
    if (leave_type && typeof leave_type === "string" && leave_type.trim()) {
      filters.push({ field: "leave_type", op: "eq", value: leave_type.trim() });
    } else if (inferredType) {
      filters.push({ field: "leave_type", op: "eq", value: inferredType });
    }

    // ── 状态 ──
    const inferredStatus = typeof status === "string" && status.trim() ? status.trim() : null;
    if (inferredStatus) filters.push({ field: "status", op: "eq", value: inferredStatus });

    // ── 时间范围 ──
    const monthToken = extractMonthToken(text);
    if (monthToken) {
      filters.push({ field: "start_time", op: "contains", value: monthToken });
    } else {
      const sinceIso = translateTimeRangeToIso(String(time_range || text));
      if (sinceIso) {
        filters.push({ field: "start_time", op: "gte", value: sinceIso });
      }
    }

    return filters;
  },

  buildSort(_input: SortInput): QuerySort[] {
    return [{ field: "start_time", direction: "desc" }];
  },
};
