/**
 * Attendance 业务域确定性路由规则。
 *
 * 从 src/router/deterministic-rule-registry.ts 迁出的 attendance 专属规则。
 */

import type { DeterministicRuleDefinition } from "../types.js";
import type { JsonValue } from "../../types/agent-contracts.js";

// ─── Extractors ──────────────────────────────────────────────────────────────

function extractLeaveType(text: string): string | null {
  if (/年假/.test(text)) return "年假";
  if (/病假/.test(text)) return "病假";
  if (/事假|家里有事/.test(text)) return "事假";
  if (/调休/.test(text)) return "调休";
  return null;
}

function extractLeaveStartTime(text: string): string | null {
  if (/后天/.test(text)) return "后天";
  if (/明天/.test(text)) return "明天";
  if (/今天|下午|上午/.test(text)) return "今天";
  return null;
}

function extractLeaveReason(text: string): string | null {
  const reasonMatch = text.match(/因为(.+)$/);
  if (reasonMatch?.[1]) return reasonMatch[1].trim();
  if (/家里有事/.test(text)) return "家里有事";
  if (/身体不舒服|不舒服/.test(text)) return "身体不舒服";
  return null;
}

function extractLeaveQueryScope(text: string): string | null {
  if (/我|我的|本人/.test(text)) return "self";
  if (/下面|下属|下级|团队|组员|同学/.test(text)) return "team";
  if (/全公司|整个公司|公司/.test(text)) return "company";
  return null;
}

function extractLeaveDepartment(text: string): string | null {
  if (/销售部/.test(text)) return "销售部";
  if (/人事部|人力资源|行政人事/.test(text)) return "人事部";
  return null;
}

function extractLeaveQueryTimeRange(text: string): string | null {
  if (/近三个月|最近三个月|过去三个月/.test(text)) return "近三个月";
  if (/近一个月|最近一个月|过去一个月|最近/.test(text)) return "近一个月";
  if (/本月|这个月/.test(text)) return "本月";
  return null;
}

function looksLikeLeaveRequest(text: string): boolean {
  if (/(请假记录|请假历史|请假情况|请假次数|谁请假|最近请假|查.*请假|看.*请假)/.test(text)) return false;
  return /(想请假|我要请|我想请|帮我请|帮我申请.*假|申请.*假|请个假|休假|走个假勤|请.*年假|请.*病假|请.*事假|请.*调休)/.test(text);
}

// ─── Rules ───────────────────────────────────────────────────────────────────

export const ATTENDANCE_DETERMINISTIC_RULES: DeterministicRuleDefinition[] = [
  {
    id: "attendance.leave_request",
    intentCode: "workflow.leave_request",
    priority: 5,
    match: ({ message }) => {
      const text = message;
      if (!looksLikeLeaveRequest(text)) return null;
      return {
        intentCode: "workflow.leave_request",
        params: {
          leave_type: extractLeaveType(text),
          start_time: extractLeaveStartTime(text),
          end_time: null,
          reason: extractLeaveReason(text),
        },
        reasoning: "命中请假申请高确定性本地预路由。",
      };
    },
  },
  {
    id: "attendance.leave_query",
    intentCode: "attendance.leave_query",
    priority: 10,
    match: ({ message }) => {
      const text = message;
      if (!/(请假记录|请假历史|请假情况|请假次数|休假记录|休假历史|休假情况|谁请假|最近请假|查.*请假|看.*请假)/.test(text)) return null;
      return {
        intentCode: "attendance.leave_query",
        params: {
          scope: extractLeaveQueryScope(text),
          department: extractLeaveDepartment(text),
          leave_type: extractLeaveType(text),
          time_range: extractLeaveQueryTimeRange(text) ?? "近三个月",
          status: null,
          limit: null,
        },
        reasoning: "命中请假记录查询高确定性本地预路由。",
      };
    },
  },
];

/**
 * Attendance 域 extractors（供 manifest deterministic_rules 引用）。
 */
export const ATTENDANCE_EXTRACTORS: Record<string, (text: string) => JsonValue | undefined> = {
  leave_scope: extractLeaveQueryScope,
  leave_department: extractLeaveDepartment,
  leave_type: extractLeaveType,
  leave_time_range: (text) => extractLeaveQueryTimeRange(text) ?? "近三个月",
};
