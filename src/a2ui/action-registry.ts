import { PendingActionStore } from "../runtime/pending-action-store.js";
import { resolveUserWorkspace } from "../runtime/workspace-context.js";
import type { JsonObject, ToolExecutionContext, UserContext } from "../types/agent-contracts.js";

export interface ActionAuthContext {
  user: UserContext;
  sessionId?: string;
}

export interface ActionExecuteResult {
  toolName: string;
  args: JsonObject;
  confirmed?: boolean;
  /** skip=true 时不实际调用 toolRegistry.execute，直接返回 reason */
  skip?: { reason: string };
}

export interface ActionDefinition {
  name: string;
  /** 校验 + 标准化 context；返回 ActionExecuteResult 或抛 ActionError */
  validate: (context: JsonObject, auth: ActionAuthContext) => Promise<ActionExecuteResult>;
}

export class ActionError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 = 400, public readonly code = "bad_request") {
    super(message);
  }
}

/**
 * Action 注册表：把 a2UI client 触发的 action 映射到内部 tool 调用。
 * 默认实现包含 4 个 action（pending_action.confirm/reject、task.resume.select/ignore），
 * 业务方可以 register() 自定义 action 不需要改 chat-service。
 */
export class A2UIActionRegistry {
  private readonly actions = new Map<string, ActionDefinition>();

  constructor(private readonly pendingActionStore = new PendingActionStore()) {
    this.installDefaults();
  }

  register(definition: ActionDefinition): void {
    this.actions.set(definition.name, definition);
  }

  has(name: string): boolean {
    return this.actions.has(name);
  }

  list(): string[] {
    return [...this.actions.keys()];
  }

  async resolve(name: string, context: JsonObject, auth: ActionAuthContext): Promise<ActionExecuteResult> {
    const definition = this.actions.get(name);
    if (!definition) throw new ActionError(`unsupported action: ${name}`, 400, "unsupported_action");
    return await definition.validate(context, auth);
  }

  /** 让 toolRegistry.execute 拿到的 ToolExecutionContext 能反映本 action 的鉴权身份 */
  buildExecutionContext(auth: ActionAuthContext, confirmed?: boolean): ToolExecutionContext {
    return {
      user: auth.user,
      session_id: auth.sessionId,
      confirmed
    };
  }

  private installDefaults(): void {
    this.register({
      name: "runtime.pending_action.confirm",
      validate: (ctx, auth) => this.validatePendingAction(ctx, auth, true)
    });
    this.register({
      name: "runtime.pending_action.reject",
      validate: (ctx, auth) => this.validatePendingAction(ctx, auth, false)
    });
    this.register({
      name: "task.resume.select",
      validate: async (ctx) => {
        const taskId = readString(ctx.task_id);
        if (!taskId) throw new ActionError("task_id required", 400);
        return {
          toolName: "task.claim",
          args: {
            id: taskId,
            task_list_id: readString(ctx.task_list_id) || undefined,
            owner: "agent"
          }
        };
      }
    });
    this.register({
      name: "task.resume.ignore",
      validate: async () => ({
        toolName: "",
        args: {},
        skip: { reason: "task_resume_ignored" }
      })
    });
  }

  private async validatePendingAction(ctx: JsonObject, auth: ActionAuthContext, confirm: boolean): Promise<ActionExecuteResult> {
    const id = readString(ctx.pending_action_id);
    if (!id) throw new ActionError("pending_action_id required", 400);
    const workspace = resolveUserWorkspace(auth.user);
    const action = await this.pendingActionStore.get(workspace, id);
    if (!action) throw new ActionError("pending action not found", 404, "not_found");
    if (action.user_id !== auth.user.id) {
      throw new ActionError("pending action does not belong to current user", 403, "forbidden");
    }
    if (auth.sessionId && action.session_id && action.session_id !== auth.sessionId) {
      throw new ActionError("pending action does not belong to current session", 403, "forbidden");
    }
    if (action.status !== "pending") {
      throw new ActionError(`pending action already ${action.status}`, 400, "already_resolved");
    }
    if (Date.parse(action.expires_at) <= Date.now()) {
      throw new ActionError("pending action expired", 400, "expired");
    }
    return {
      toolName: confirm ? "runtime.pending_action.confirm" : "runtime.pending_action.reject",
      args: { id },
      confirmed: confirm
    };
  }
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
