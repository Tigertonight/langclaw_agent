import { checkToolPermission } from "../auth/permissions.js";
import { PendingActionStore } from "../runtime/pending-action-store.js";
import { RuntimeHooks } from "../runtime/hooks.js";
import { resolveUserWorkspace, type WorkspaceContext } from "../runtime/workspace-context.js";
import type {
  ToolCall,
  ToolDefinition,
  ToolExecutionContext,
  ToolMetadata,
  ToolResult,
  UserContext
} from "../types/agent-contracts.js";

export interface ToolDescription {
  name: string;
  description: string;
  schema?: ToolDefinition["schema"];
  metadata?: ToolMetadata;
}

export class ToolRegistry {
  private readonly tools: Map<string, ToolDefinition>;
  private readonly hooks?: RuntimeHooks;
  private readonly pendingActionStore: PendingActionStore;

  constructor(tools: ToolDefinition[], { hooks, pendingActionStore = new PendingActionStore() }: { hooks?: RuntimeHooks; pendingActionStore?: PendingActionStore } = {}) {
    this.tools = new Map(tools.map((tool) => [tool.name, tool]));
    this.hooks = hooks;
    this.pendingActionStore = pendingActionStore;
  }

  list(context: ToolExecutionContext = {}): ToolDescription[] {
    return Array.from(this.tools.values())
      .filter((tool) => isToolAvailable(tool, context))
      .map(({ name, description, schema, metadata }) => ({
        name,
        description,
        schema,
        metadata
      }));
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  describe(name: string): ToolDescription | null {
    const tool = this.get(name);
    if (!tool) return null;
    const { description, schema, metadata } = tool;
    return { name, description, schema, metadata };
  }

  async execute(call: ToolCall, context?: ToolExecutionContext): Promise<ToolResult | unknown> {
    const tool = this.get(call.name);
    if (!tool) {
      return {
        ok: false,
        tool: call.name,
        error: "unknown_tool",
        message: `工具 ${call.name} 不存在。`
      } satisfies ToolResult;
    }

    const user: UserContext = context?.user ?? {
      id: "anonymous",
      role: "anonymous",
      permissions: [],
      accessible_customer_ids: []
    };
    const permission = await checkToolPermission(user, call);
    if (!permission.allow) {
      await this.emitGovernance(call, context, tool, "permission_denied", permission.message, permission.code);
      return {
        ok: false,
        tool: call.name,
        error: "permission_denied",
        code: permission.code,
        message: permission.message
      } satisfies ToolResult;
    }

    if (!isToolAvailable(tool, context)) {
      await this.emitGovernance(call, context, tool, "tool_unavailable", `工具 ${call.name} 当前上下文不可用。`);
      return {
        ok: false,
        tool: call.name,
        error: "tool_unavailable",
        message: `工具 ${call.name} 当前上下文不可用。`
      } satisfies ToolResult;
    }

    if (tool.metadata?.requires_confirmation === true && context?.confirmed !== true) {
      const pendingAction = await this.createPendingAction(call, context, tool);
      await this.emitGovernance(call, context, tool, "confirmation_required", `工具 ${call.name} 需要用户确认后才能执行。`, undefined, pendingAction?.id);
      return {
        ok: false,
        tool: call.name,
        error: "confirmation_required",
        message: `工具 ${call.name} 需要用户确认后才能执行。`,
        data: pendingAction ? {
          pending_action_id: pendingAction.id,
          tool: pendingAction.tool,
          risk_level: pendingAction.risk_level,
          expires_at: pendingAction.expires_at,
          call: pendingAction.call as never
        } : undefined
      } satisfies ToolResult;
    }

    await this.emitGovernance(call, context, tool, "allowed", "tool execution allowed");
    return tool.execute(call.args ?? {}, context);
  }

  private async emitGovernance(call: ToolCall, context: ToolExecutionContext | undefined, tool: ToolDefinition, decision: string, message?: string, code?: string, pendingActionId?: string): Promise<void> {
    const userId = context?.user?.id;
    if (!this.hooks || !userId) return;
    await this.hooks.emit("tool_result", {
      user_id: userId,
      session_id: typeof context?.session_id === "string" ? context.session_id : undefined,
      run_id: typeof context?.run_id === "string" ? context.run_id : undefined,
      tool: call.name,
      decision,
      code,
      message,
      pending_action_id: pendingActionId,
      risk_level: typeof tool.metadata?.risk_level === "string" ? tool.metadata.risk_level : "read",
      requires_confirmation: tool.metadata?.requires_confirmation === true
    });
  }

  private async createPendingAction(call: ToolCall, context: ToolExecutionContext | undefined, tool: ToolDefinition): Promise<{ id: string; tool: string; risk_level: string; expires_at: string; call: ToolCall } | null> {
    const userId = context?.user?.id;
    if (!userId) return null;
    const workspace = resolveContextWorkspace(context) ?? resolveUserWorkspace(userId);
    return this.pendingActionStore.create(workspace, {
      userId,
      sessionId: typeof context?.session_id === "string" ? context.session_id : undefined,
      call,
      riskLevel: typeof tool.metadata?.risk_level === "string" ? tool.metadata.risk_level : "write",
      reason: `工具 ${call.name} 需要用户确认后才能执行。`
    });
  }
}

function resolveContextWorkspace(context?: ToolExecutionContext): WorkspaceContext | null {
  const workspace = context?.workspace;
  return workspace && typeof workspace === "object" && !Array.isArray(workspace) && typeof (workspace as { root?: unknown }).root === "string"
    ? workspace as WorkspaceContext
    : null;
}

export function isToolAvailable(tool: ToolDefinition, context: ToolExecutionContext = {}): boolean {
  const metadata = tool.metadata ?? {};
  const user = context.user;
  const intent = context.intent;
  const scenario = context.scenario;
  const step = context.step;

  if (metadata.required_permissions?.length && user) {
    const userPermissions = new Set(user.permissions ?? []);
    if (!metadata.required_permissions.every((permission) => userPermissions.has(permission))) {
      return false;
    }
  }

  if (metadata.intents?.length && intent && !metadata.intents.includes(intent)) {
    return false;
  }

  if (metadata.scenarios?.length && scenario && !metadata.scenarios.includes(scenario)) {
    return false;
  }

  if (metadata.steps?.length && step && !metadata.steps.includes(step)) {
    return false;
  }

  if (metadata.scenarios?.length && !scenario) {
    return false;
  }

  return true;
}
