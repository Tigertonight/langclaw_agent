/**
 * Attendance 域 leave-request Surface 插件。
 * 从 src/a2ui/plugins/leave-request.ts 迁移而来。
 */

import { businessSurface } from "../../../a2ui/openui-bridge.js";
import { card, list, readArray, readArrayLike, readPath, text, toRecord } from "../../../a2ui/builders/components.js";
import { LeaveScenarioSchema } from "../schemas.js";
import { approvalActions } from "../../../a2ui/plugins/approval.js";
import type { SurfacePlugin } from "../../../a2ui/plugins/types.js";
import type { A2UIComponentInstance } from "../../../a2ui/types.js";
import type { JsonObject } from "../../../types/agent-contracts.js";

export const leaveRequestPlugin: SurfacePlugin<JsonObject> = {
  kind: "leave_request_form",
  extract: (ctx) => extractLeaveRequestForm(ctx.record),
  build: (data, ctx) => ({
    surfaceId: `${ctx.surfacePrefix}_${ctx.runId}_leave_request_form`,
    root: "leave_request_root",
    data: {
      ...data,
      ...businessSurface("leave_request_form", "请假申请", data, leaveRequestActions(data))
    },
    components: leaveRequestComponents(data)
  })
};

function leaveRequestActions(input: JsonObject): JsonObject[] {
  return readArray(input.pending_actions).length ? approvalActions(readArray(input.pending_actions)) : [];
}

function leaveRequestComponents(data: JsonObject): A2UIComponentInstance[] {
  const slots = toRecord(data.slots) ?? {};
  return [
    card("leave_request_root", ["leave_request_title", "leave_request_slots", "leave_request_status"]),
    text("leave_request_title", "### 请假申请"),
    list("leave_request_slots", ["leave_slot_type", "leave_slot_start", "leave_slot_end", "leave_slot_reason"]),
    text("leave_slot_type", `请假类型：${String(slots.leave_type ?? "待补充")}`),
    text("leave_slot_start", `开始时间：${String(slots.start_time ?? "待补充")}`),
    text("leave_slot_end", `结束时间：${String(slots.end_time ?? "待补充")}`),
    text("leave_slot_reason", `请假事由：${String(slots.reason ?? "待补充")}`),
    text("leave_request_status", `状态：${String(data.step ?? "collecting")}；缺失：${readArrayLike(data.missing_slots).join("、") || "无"}`)
  ];
}

function extractLeaveRequestForm(record: Record<string, unknown>): JsonObject | null {
  const answer = String(readPath(record, ["answer"]) ?? readPath(record, ["output", "answer"]) ?? "");
  const message = String(readPath(record, ["user_message"]) ?? readPath(record, ["output", "user_message"]) ?? "");

  const scenarioRaw = readPath(record, ["debug", "scenario"]) ?? readPath(record, ["output", "debug", "scenario"]);
  const scenarioParsed = LeaveScenarioSchema.safeParse(scenarioRaw);
  const scenario = scenarioParsed.success ? scenarioParsed.data : null;

  const isKnowledgeIntent = /(制度|政策|规则|手册|标准|流程|怎么算|是什么|什么意思|了解一下|问下|介绍下)/.test(message);
  const hasLeaveActionVerb = /(请假|休假|申请假|提交假|取消假|续假|销假|要请|想请|想休|要休|帮我请|帮.{0,2}请|帮我申请|想申请|要申请|请[^?？\n]{0,4}假|休[^?？\n]{0,4}假|调休)/.test(message);
  const hasLeaveContext = /(请假|休假|年假|病假|事假|调休|销假)/.test(`${message}\n${answer}`);
  const isLeaveScenario = scenario?.scenario === "leave_request" || (!isKnowledgeIntent && hasLeaveActionVerb && hasLeaveContext);
  if (!isLeaveScenario) return null;

  const structuredSlots = scenario?.slots ?? {};
  const textualSlots = {
    ...extractLeaveSlotsFromText(answer),
    ...extractLeaveSlotsFromText(message)
  };
  const slots: JsonObject = {
    leave_type: structuredSlots.leave_type ?? textualSlots.leave_type,
    start_time: structuredSlots.start_time ?? textualSlots.start_time,
    end_time: structuredSlots.end_time ?? textualSlots.end_time,
    reason: structuredSlots.reason ?? textualSlots.reason
  };

  const missing = scenario?.missing_slots?.length
    ? scenario.missing_slots
    : inferMissingLeaveSlots(slots);

  const step = scenario?.step ?? (
    missing.length ? "collecting"
      : /确认是否提交/.test(answer) ? "awaiting_confirmation"
      : /已提交/.test(answer) ? "completed"
      : "collecting"
  );

  return {
    step,
    slots,
    missing_slots: missing,
    completion: Math.round(((4 - missing.length) / 4) * 100)
  };
}

function extractLeaveSlotsFromText(input: string): { leave_type?: string; start_time?: string; end_time?: string; reason?: string } {
  const slots: { leave_type?: string; start_time?: string; end_time?: string; reason?: string } = {};
  const type = input.match(/(?:类型|请假类型)[：:]\s*([^\n，,]+)/)?.[1] ?? input.match(/(年假|病假|事假|调休)/)?.[1];
  const start = input.match(/(?:开始|开始时间)[：:]\s*([^\n，,]+)/)?.[1];
  const end = input.match(/(?:结束|结束时间)[：:]\s*([^\n，,]+)/)?.[1] ?? input.match(/(?:请假时长|leave_duration)[：:]\s*([^\n，,]+)/)?.[1];
  const reason = input.match(/(?:事由|请假事由|理由|reason)[：:]\s*([^\n]+)/)?.[1] ?? input.match(/(?:因为|原因是|事由是)([^\n]+)/)?.[1];
  if (type) slots.leave_type = type.trim();
  if (start) slots.start_time = start.trim();
  if (end) slots.end_time = end.trim();
  if (reason) slots.reason = reason.trim();
  return slots;
}

function inferMissingLeaveSlots(slots: JsonObject): string[] {
  return ["leave_type", "start_time", "end_time", "reason"].filter((key) => !slots[key]);
}
