import { PendingActionStore } from "../runtime/pending-action-store.js";
import { resolveUserWorkspace } from "../runtime/workspace-context.js";
import type { JsonObject, ToolExecutionContext, UserContext } from "../types/agent-contracts.js";

export const OPENUI_FORM_SUBMIT_ACTION = "openui.form.submit";
export const LEGACY_A2UI_FORM_SUBMIT_ACTION = "a2ui.form.submit";

export interface ActionAuthContext {
  user: UserContext;
  sessionId?: string;
}

export interface ActionExecuteResult {
  toolName: string;
  args: JsonObject;
  confirmed?: boolean;
  skip?: { reason: string };
}

export interface ActionDefinition {
  name: string;
  validate: (context: JsonObject, auth: ActionAuthContext) => Promise<ActionExecuteResult>;
}

export class ActionError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 = 400, public readonly code = "bad_request") {
    super(message);
  }
}

/**
 * OpenUI Lang action registry.
 *
 * Maps renderer-originated OpenUI actions to internal tool calls. The client is
 * never allowed to name internal tools directly; every action must be registered
 * here and validated against user/session context first.
 */
export class OpenUILangActionRegistry {
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
    this.registerFormSubmit(OPENUI_FORM_SUBMIT_ACTION, "openui_form_submit_no_handler");
    this.registerFormSubmit(LEGACY_A2UI_FORM_SUBMIT_ACTION, "a2ui_form_submit_no_handler");
  }

  private registerFormSubmit(name: string, reason: string): void {
    this.register({
      name,
      validate: async (ctx) => ({
        toolName: "",
        args: { form: ctx },
        skip: { reason }
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
