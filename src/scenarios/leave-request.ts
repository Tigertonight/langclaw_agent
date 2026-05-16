import { checkToolPermission } from "../auth/permissions.js";
import { appendAuditEvent } from "../logs/logger.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { JsonObject, ToolCall, ToolResult, UserContext } from "../types/agent-contracts.js";

const REQUIRED_SLOTS = ["leave_type", "start_time", "end_time", "reason"] as const;

interface LeaveSlots extends JsonObject {
  leave_type?: string;
  start_time?: string;
  end_time?: string;
  reason?: string;
  leave_duration?: string;
}
type LeaveScenarioStep = "collecting" | "awaiting_confirmation";

interface LeaveScenarioState extends JsonObject {
  slots: LeaveSlots;
  missing_slots: string[];
  step: LeaveScenarioStep;
}

interface LeaveScenarioSession {
  state?: Partial<LeaveScenarioState>;
}

interface LeaveScenarioRunInput {
  user: UserContext;
  message: string;
  session: LeaveScenarioSession;
}

interface LeaveScenarioResult {
  answer?: string;
  sessionPatch: JsonObject;
  toolResults?: ToolResult[];
  debug: JsonObject;
}

export class LeaveRequestScenario {
  private readonly intent = "leave_request";
  private readonly toolRegistry: ToolRegistry;

  constructor({ toolRegistry }: { toolRegistry: ToolRegistry }) {
    this.toolRegistry = toolRegistry;
  }

  async run({ user, message, session }: LeaveScenarioRunInput): Promise<LeaveScenarioResult> {
    const state = normalizeState(session.state);

    if (isCancel(message)) {
      return {
        answer: "已取消本次请假申请。",
        sessionPatch: resetPatch(),
        debug: { scenario: this.intent, step: "cancelled", slots: state.slots }
      };
    }

    if (state.step === "awaiting_confirmation") {
      if (isNegative(message)) {
        return {
          answer: "好的，我先不提交。你可以直接告诉我要修改的请假类型、时间或事由。",
          sessionPatch: {
            active_intent: this.intent,
            scenario: this.intent,
            status: "collecting",
            state: { ...state, step: "collecting" }
          },
          debug: { scenario: this.intent, step: "confirmation_rejected", slots: state.slots }
        };
      }

      if (isConfirm(message)) {
        return this.submit({ user, state });
      }
    }

    const extracted = compactSlots(extractLeaveSlots(message));
    const slots = compactSlots({ ...state.slots, ...extracted });
    const missingSlots = getMissingSlots(slots);

    if (missingSlots.length > 0) {
      const nextState = {
        slots,
        missing_slots: missingSlots,
        step: "collecting"
      };
      return {
        answer: askForMissingSlots(missingSlots, slots),
        sessionPatch: {
          active_intent: this.intent,
          scenario: this.intent,
          status: "collecting",
          state: nextState
        },
        debug: { scenario: this.intent, step: "collecting", slots, missing_slots: missingSlots }
      };
    }

    const nextState = {
      slots,
      missing_slots: [] as string[],
      step: "awaiting_confirmation"
    };
    const availableTools = this.toolRegistry.list({
      user,
      scenario: this.intent,
      step: nextState.step
    });

    return {
      answer: buildConfirmationMessage(slots),
      sessionPatch: {
        active_intent: this.intent,
        scenario: this.intent,
        status: "awaiting_confirmation",
        state: nextState
      },
      debug: {
        scenario: this.intent,
        step: "awaiting_confirmation",
        slots,
        available_tools: availableTools.map((tool) => tool.name)
      }
    };
  }

  async submit({ user, state }: { user: UserContext; state: LeaveScenarioState }): Promise<LeaveScenarioResult> {
    const availableTools = this.toolRegistry.list({
      user,
      scenario: this.intent,
      step: state.step
    });
    if (!availableTools.some((tool) => tool.name === "submit_leave_request")) {
      return {
        answer: "当前步骤不能提交请假申请，请先完成信息确认。",
        sessionPatch: {
          active_intent: this.intent,
          scenario: this.intent,
          status: "awaiting_confirmation",
          state
        },
        debug: {
          scenario: this.intent,
          step: "tool_not_available",
          slots: state.slots,
          available_tools: availableTools.map((tool) => tool.name)
        }
      };
    }

    const call: ToolCall = {
      name: "submit_leave_request",
      args: state.slots
    };
    const permission = await checkToolPermission(user, call);
    if (!permission.allow) {
      return {
        answer: permission.message,
        sessionPatch: resetPatch(),
        toolResults: [{
          ok: false,
          tool: call.name,
          error: "permission_denied",
          code: permission.code,
          message: permission.message
        }],
        debug: { scenario: this.intent, step: "permission_denied", slots: state.slots, available_tools: availableTools.map((tool) => tool.name) }
      };
    }

    const result = await this.toolRegistry.execute(call, { user }) as ToolResult;
    await appendAuditEvent({
      type: "tool.executed",
      tool: call.name,
      user_id: user.id,
      risk_level: String(this.toolRegistry.describe(call.name)?.metadata?.risk_level ?? ""),
      ok: result.ok === true
    });
    if (!result.ok) {
      return {
        answer: result.message ?? "请假申请提交失败。",
        sessionPatch: {
          active_intent: this.intent,
          scenario: this.intent,
          status: "awaiting_confirmation",
          state
        },
        toolResults: [result],
        debug: { scenario: this.intent, step: "submit_failed", slots: state.slots, available_tools: availableTools.map((tool) => tool.name) }
      };
    }

    return {
      answer: `请假申请已提交，申请编号 ${result.data?.id}。\n\n- 类型：${result.data?.leave_type}\n- 开始：${result.data?.start_time}\n- 结束：${result.data?.end_time}\n- 事由：${result.data?.reason}`,
      sessionPatch: resetPatch(),
      toolResults: [result],
      debug: { scenario: this.intent, step: "completed", slots: state.slots, available_tools: availableTools.map((tool) => tool.name) }
    };
  }
}

export function isLeaveRequestMessage(message: string): boolean {
  return /(请假|休假|年假|病假|事假|调休|请个假|请一下假|申请假|办假)/.test(message);
}

function normalizeState(state?: Partial<LeaveScenarioState>): LeaveScenarioState {
  return {
    slots: state?.slots ?? {},
    missing_slots: state?.missing_slots ?? [...REQUIRED_SLOTS],
    step: state?.step ?? "collecting"
  };
}

function extractLeaveSlots(message: string): LeaveSlots {
  const startTime = extractStartTime(message);
  const leaveDuration = extractLeaveDuration(message);
  return {
    leave_type: extractLeaveType(message),
    start_time: startTime,
    end_time: extractEndTime(message, startTime, leaveDuration),
    reason: extractReason(message),
    leave_duration: leaveDuration
  };
}

function extractLeaveType(message: string): string | null {
  const types = ["年假", "病假", "事假", "调休"];
  return types.find((type) => message.includes(type)) ?? null;
}

function extractStartTime(message: string): string | null {
  const explicit = message.match(/(\d{4}-\d{1,2}-\d{1,2})(?:\s*(上午|下午|晚上)?\s*(\d{1,2})点?)?/);
  if (explicit) return normalizeTimeMatch(explicit);
  const dotted = message.match(/(?<!\d)(\d{1,2})[./月](\d{1,2})(?:日|号)?(?:\s*(上午|下午|晚上)?\s*(\d{1,2})点?)?/);
  if (dotted) return normalizeMonthDayMatch(dotted);
  if (message.includes("前天")) return withDayPart(resolveRelativeDateLabel("前天"), message);
  if (message.includes("昨天")) return withDayPart(resolveRelativeDateLabel("昨天"), message);
  if (message.includes("后天")) return withDayPart("后天", message);
  if (message.includes("明天")) return withDayPart("明天", message);
  if (message.includes("今天")) return withDayPart("今天", message);
  return null;
}

function extractEndTime(message: string, startTime?: string | null, leaveDuration?: string | null): string | null {
  const range = message.match(/(?:到|至)(\d{4}-\d{1,2}-\d{1,2})?(?:\s*(上午|下午|晚上)?\s*(\d{1,2})点?)?/);
  if (range && (range[1] || range[3])) {
    const date = range[1] ?? extractRelativeDay(message) ?? "同日";
    const part = range[2] ?? "";
    const hour = range[3] ? `${range[3]}点` : "";
    return `${date}${part}${hour}`.trim();
  }

  if (leaveDuration && startTime) {
    return deriveEndTimeFromDuration(startTime, leaveDuration);
  }

  if (leaveDuration) return `开始后${leaveDuration}`;

  return null;
}

function extractReason(message: string): string | null {
  const reasonPatterns = [
    /(?:因为|原因是|事由是)(.+)$/,
    /(?:家里有事|身体不舒服|去医院|去看了医生|去看医生|看医生|个人事务|参加婚礼|照顾家人)/
  ];
  for (const pattern of reasonPatterns) {
    const match = message.match(pattern);
    if (match) return (match[1] ?? match[0]).trim();
  }
  return null;
}

function compactSlots(slots: LeaveSlots): LeaveSlots {
  return Object.fromEntries(Object.entries(slots).filter(([, value]) => value !== null && value !== undefined && value !== "")) as LeaveSlots;
}

function getMissingSlots(slots: LeaveSlots): string[] {
  return REQUIRED_SLOTS.filter((slot) => !slots[slot]);
}

function askForMissingSlots(missingSlots: string[], slots: LeaveSlots): string {
  const labels: Record<string, string> = {
    leave_type: "请假类型（年假、病假、事假或调休）",
    start_time: "开始时间",
    end_time: "结束时间或请假时长",
    reason: "请假事由"
  };
  const known = Object.entries(slots)
    .map(([key, value]) => `- ${slotLabel(key)}：${value}`)
    .join("\n");
  const missing = missingSlots.map((slot) => labels[slot]).join("、");
  return `${known ? `我已记录：\n${known}\n\n` : ""}还需要补充：${missing}。`;
}

function buildConfirmationMessage(slots: LeaveSlots): string {
  return `请确认是否提交这条请假申请：\n\n- 类型：${slots.leave_type}\n- 开始：${slots.start_time}\n- 结束：${slots.end_time}\n- 事由：${slots.reason}\n\n回复「确认」后我会提交；如果要修改，直接告诉我新的信息。`;
}

function resetPatch(): JsonObject {
  return {
    active_intent: null,
    active_skill: null,
    scenario: null,
    status: "idle",
    state: {}
  };
}

function isConfirm(message: string): boolean {
  return /^(确认|提交|确定|是的|可以)$/i.test(message.trim());
}

function isNegative(message: string): boolean {
  return /^(不|否|先不|不用|不要|修改)$/i.test(message.trim());
}

function isCancel(message: string): boolean {
  return /^(取消|退出|算了|停止|不请假了|先不请假了|不用请假了|不办了|先不办了)$/i.test(message.trim());
}

function slotLabel(key: string): string {
  return {
    leave_type: "请假类型",
    start_time: "开始时间",
    end_time: "结束时间",
    reason: "请假事由"
  }[key] ?? key;
}

function normalizeTimeMatch(match: RegExpMatchArray): string {
  const date = match[1];
  const part = match[2] ?? "";
  const hour = match[3] ? `${match[3]}点` : "";
  return `${date}${part}${hour}`.trim();
}

function withDayPart(day: string, message: string): string {
  const part = message.match(/(上午|下午|晚上)?\s*(\d{1,2})点?/);
  if (!part) return day;
  return `${day}${part[1] ?? ""}${part[2]}点`;
}

function extractRelativeDay(message: string): string | null {
  if (message.includes("前天")) return resolveRelativeDateLabel("前天");
  if (message.includes("昨天")) return resolveRelativeDateLabel("昨天");
  if (message.includes("后天")) return "后天";
  if (message.includes("明天")) return "明天";
  if (message.includes("今天")) return "今天";
  return null;
}

function extractLeaveDuration(message: string): string | null {
  const matched = String(message ?? "").match(/(半天|一天|两天|三天|四天|五天|[一二三四五六七八九十\d]+天|[一二三四五六七八九十\d]+小时)/);
  return matched?.[1] ?? null;
}

function normalizeMonthDayMatch(match: RegExpMatchArray): string {
  const year = new Date().getFullYear();
  const month = String(match[1]).padStart(2, "0");
  const day = String(match[2]).padStart(2, "0");
  const part = match[3] ?? "";
  const hour = match[4] ? `${match[4]}点` : "";
  return `${year}-${month}-${day}${part}${hour}`.trim();
}

function resolveRelativeDateLabel(label: string): string {
  const offset = {
    前天: -2,
    昨天: -1,
    今天: 0,
    明天: 1,
    后天: 2
  }[label];
  if (offset === undefined) return label;
  return formatDate(addDays(new Date(), offset));
}

function deriveEndTimeFromDuration(startTime: string, leaveDuration: string): string {
  const startDate = extractDateToken(startTime);
  if (!startDate) return `开始后${leaveDuration}`;
  if (leaveDuration === "半天") return `${startDate} 半天`;
  if (leaveDuration === "一天" || leaveDuration === "1天") return `${startDate} 全天`;

  const dayCount = parseChineseNumberDuration(leaveDuration, "天");
  if (dayCount) return `${formatDate(addDays(new Date(`${startDate}T00:00:00`), dayCount - 1))} 全天`;

  const hourCount = parseChineseNumberDuration(leaveDuration, "小时");
  if (hourCount) return `开始后${hourCount}小时`;

  return `开始后${leaveDuration}`;
}

function extractDateToken(text: string): string | null {
  return String(text ?? "").match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
}

function parseChineseNumberDuration(text: string, unit: string): number | null {
  const normalized = String(text ?? "").replace(unit, "");
  if (/^\d+$/.test(normalized)) return Number(normalized);
  const map: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10
  };
  return map[normalized] ?? null;
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
