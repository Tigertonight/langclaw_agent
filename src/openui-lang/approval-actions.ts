import type { JsonObject } from "../types/agent-contracts.js";

export function approvalActions(actions: JsonObject[]): JsonObject[] {
  return actions.flatMap((action) => {
    const id = String(action.id ?? "");
    if (!id) return [];
    return [
      { name: "runtime.pending_action.confirm", label: "确认执行", context: { pending_action_id: id } },
      { name: "runtime.pending_action.reject", label: "拒绝", context: { pending_action_id: id } }
    ];
  });
}
