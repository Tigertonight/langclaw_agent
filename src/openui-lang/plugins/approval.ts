import type { JsonObject } from "../../types/agent-contracts.js";
import { approvalActions } from "../approval-actions.js";
import { button, card, readArray, row, text, toRecord } from "../builders.js";
import { businessSurface } from "../view-bridge.js";
import type { SurfacePlugin, SurfacePluginContext } from "../plugin-types.js";
import type { OpenUILangCompatComponent } from "../types.js";

export const approvalPlugin: SurfacePlugin<JsonObject[]> = {
  kind: "approval",
  extract: (ctx) => {
    const actions = extractPendingActions(ctx.record);
    return actions.length ? actions : null;
  },
  build: (actions, ctx) => ({
    surfaceId: `${ctx.surfacePrefix}_${ctx.runId}_approval`,
    root: "approval_root",
    data: {
      pending_actions: actions,
      steps: approvalFlowSteps(actions),
      ...businessSurface("approval_flow", "审批确认流程", { pending_actions: actions, steps: approvalFlowSteps(actions) }, approvalActions(actions))
    },
    components: approvalComponents(actions)
  })
};

export function extractPendingActions(record: Record<string, unknown>): JsonObject[] {
  const output = toRecord(record.output);
  const candidates = [
    ...normalizePendingActions(record.pending_actions),
    ...normalizePendingActions(toRecord(output)?.pending_actions),
    ...extractFromToolResults(record.tool_results),
    ...extractFromToolResults(toRecord(record.debug)?.tool_results),
    ...extractFromToolResults(toRecord(output)?.debug && toRecord(toRecord(output)?.debug)?.tool_results)
  ];
  return uniqueById(candidates);
}

function approvalFlowSteps(actions: JsonObject[]): JsonObject[] {
  return [
    { key: "created", label: "生成待确认动作", status: "done" },
    { key: "approval", label: actions.length ? "等待用户确认" : "无需确认", status: actions.length ? "current" : "done" },
    { key: "result", label: "执行并返回结果", status: "pending" }
  ];
}

export function approvalComponents(actions: JsonObject[]): OpenUILangCompatComponent[] {
  const children = actions.map((_, index) => `approval_${index}`);
  return [
    card("approval_root", ["approval_title", ...children]),
    text("approval_title", "### 待确认操作\n这些动作会修改业务数据，需要确认后执行。"),
    ...actions.flatMap((action, index) => {
      const id = String(action.id ?? "");
      const tool = String(action.tool ?? "");
      const call = toRecord(action.call);
      const callArgs = toRecord(call?.args);
      const callPreview = call ? `\n\n调用：${String(call.name ?? tool)}${callArgs ? `\n参数：${JSON.stringify(callArgs).slice(0, 260)}` : ""}` : "";
      const expiresAt = action.expires_at ? `\n\n过期时间：${String(action.expires_at)}` : "";
      return [
        card(`approval_${index}`, [`approval_${index}_text`, `approval_${index}_actions`]),
        text(`approval_${index}_text`, `**${tool}**\n\n动作 ID：${id}\n\n风险等级：${String(action.risk_level ?? "write")}\n\n${String(action.reason ?? "需要确认。")}${callPreview}${expiresAt}`),
        row(`approval_${index}_actions`, [`approval_${index}_confirm`, `approval_${index}_reject`]),
        button(`approval_${index}_confirm`, "确认执行", "runtime.pending_action.confirm", { pending_action_id: id }),
        button(`approval_${index}_reject`, "拒绝", "runtime.pending_action.reject", { pending_action_id: id })
      ];
    })
  ];
}

function normalizePendingActions(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) return [];
  return value.map(toRecord).filter((item): item is JsonObject => Boolean(item?.id));
}

function extractFromToolResults(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(toRecord)
    .filter((item): item is JsonObject => Boolean(item?.error === "confirmation_required" && toRecord(item.data)?.pending_action_id))
    .map((item) => {
      const data = toRecord(item.data) ?? {};
      return {
        id: data.pending_action_id,
        tool: data.tool ?? item.tool,
        risk_level: data.risk_level ?? "write",
        expires_at: data.expires_at,
        reason: item.message ?? "需要用户确认后才能执行。",
        call: data.call
      };
    });
}

function uniqueById(items: JsonObject[]): JsonObject[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = String(item.id ?? "");
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export type { SurfacePluginContext };
export { approvalActions };
