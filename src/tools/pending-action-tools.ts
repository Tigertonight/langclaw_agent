import { PendingActionStore } from "../runtime/pending-action-store.js";
import { resolveUserWorkspace, type WorkspaceContext } from "../runtime/workspace-context.js";
import type { JsonObject, ToolDefinition, ToolExecutionContext, ToolResult } from "../types/agent-contracts.js";

interface ToolRegistryLike {
  execute(call: { name: string; args?: JsonObject }, context?: ToolExecutionContext): Promise<unknown>;
}

export function createPendingActionTools({
  pendingActionStore = new PendingActionStore(),
  toolRegistry
}: {
  pendingActionStore?: PendingActionStore;
  toolRegistry: ToolRegistryLike;
}): ToolDefinition[] {
  return [
    {
      name: "runtime.pending_action.list",
      description: "List pending tool actions that are waiting for user approval in the current workspace.",
      metadata: { required_permissions: [], risk_level: "read", expose_to_agentic: true },
      schema: { type: "object", properties: {} },
      async execute(_args, context) {
        const workspace = getWorkspace(context);
        const actions = await pendingActionStore.list(workspace);
        return { ok: true, tool: "runtime.pending_action.list", data: { actions: actions.map(summarizeAction) } };
      }
    },
    {
      name: "runtime.pending_action.reject",
      description: "Reject a pending tool action.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const action = await pendingActionStore.mark(workspace, String(args?.id ?? ""), "rejected");
        return { ok: Boolean(action), tool: "runtime.pending_action.reject", data: { action: action ? summarizeAction(action) : null } };
      }
    },
    {
      name: "runtime.pending_action.confirm",
      description: "Approve and execute a pending tool action using the original tool call payload.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: false, requires_confirmation: true },
      schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const action = await pendingActionStore.get(workspace, String(args?.id ?? ""));
        if (!action || action.status !== "pending") {
          return { ok: false, tool: "runtime.pending_action.confirm", error: "pending_action_not_found", message: "没有找到可确认的待执行动作。" };
        }
        if (Date.parse(action.expires_at) <= Date.now()) {
          await pendingActionStore.mark(workspace, action.id, "expired");
          return { ok: false, tool: "runtime.pending_action.confirm", error: "pending_action_expired", message: "这个待执行动作已经过期，请重新发起。" };
        }
        const result = await toolRegistry.execute(action.call, {
          ...context,
          confirmed: true,
          workspace,
          session_id: context?.session_id ?? action.session_id
        }) as ToolResult;
        await pendingActionStore.mark(workspace, action.id, result?.ok === false ? "pending" : "approved");
        return {
          ok: result?.ok !== false,
          tool: "runtime.pending_action.confirm",
          data: {
            action: summarizeAction(action),
            result: JSON.parse(JSON.stringify(result ?? null))
          }
        };
      }
    }
  ];
}

function getWorkspace(context: ToolExecutionContext = {}): WorkspaceContext {
  const workspace = context.workspace;
  if (workspace && typeof workspace === "object" && !Array.isArray(workspace) && typeof (workspace as { root?: unknown }).root === "string") {
    return workspace as WorkspaceContext;
  }
  return resolveUserWorkspace(context.user?.id ?? "anonymous");
}

function summarizeAction(action: JsonObject): JsonObject {
  return {
    id: action.id,
    status: action.status,
    tool: action.tool,
    risk_level: action.risk_level,
    reason: action.reason,
    created_at: action.created_at,
    expires_at: action.expires_at,
    call: action.call
  };
}
