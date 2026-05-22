import { A2UICatalogService } from "./catalog-service.js";
import { A2UIPipeLogService } from "./pipe-log-service.js";
import { A2UITranslatorService } from "./translator-service.js";
import type { A2UIEnvelope } from "./types.js";
import type { JsonObject, ToolExecutionContext, UserContext } from "../types/agent-contracts.js";

interface ToolRegistryLike {
  execute(call: { name: string; args?: JsonObject }, context?: ToolExecutionContext): Promise<unknown>;
}

interface UserContextResolverLike {
  resolve(input: { userId?: string; userContext?: Record<string, unknown>; wecomUserId?: string }): Promise<UserContext>;
}

export class A2UIChatService {
  constructor(
    private readonly toolRegistry: ToolRegistryLike,
    private readonly userContextResolver: UserContextResolverLike,
    private readonly catalogService = new A2UICatalogService(),
    private readonly translatorService = new A2UITranslatorService(),
    private readonly pipeLogService = new A2UIPipeLogService()
  ) {}

  capabilities(): JsonObject {
    return this.catalogService.capabilities();
  }

  async decorateChatResult<T extends Record<string, unknown>>(result: T): Promise<T & { a2ui: A2UIEnvelope[]; a2ui_pipe: JsonObject[] }> {
    const a2ui = await this.pipeLogService.withRetry("translate_agent_result", () => this.translatorService.translateAgentResult(result), 2);
    return {
      ...result,
      a2ui,
      a2ui_pipe: this.pipeLogService.recent(10)
    };
  }

  async handleAction(input: {
    userId: string;
    sessionId?: string;
    action: JsonObject;
  }): Promise<JsonObject> {
    const name = typeof input.action.name === "string" ? input.action.name : "";
    const context = input.action.context && typeof input.action.context === "object" && !Array.isArray(input.action.context)
      ? input.action.context as JsonObject
      : {};
    if (!input.userId || !name) {
      return { ok: false, error: "bad_request", message: "user_id 和 action.name 必填。" };
    }
    const normalized = normalizeAction(name, context);
    if ("error" in normalized) return normalized.error;
    const user = await this.userContextResolver.resolve({ userId: input.userId });
    const result = normalized.skip
      ? { ok: true, skipped: true, reason: normalized.reason }
      : await this.pipeLogService.withRetry("execute_action", () => this.toolRegistry.execute(
        { name: normalized.toolName, args: normalized.args },
        {
          user,
          session_id: input.sessionId,
          confirmed: normalized.confirmed
        }
      ), 2);
    return {
      ok: true,
      action: name,
      result: JSON.parse(JSON.stringify(result ?? null)),
      a2ui_pipe: this.pipeLogService.recent(10)
    };
  }

  pipeLog(): JsonObject[] {
    return this.pipeLogService.recent(50);
  }
}

type NormalizedAction =
  | { ok: true; toolName: string; args: JsonObject; confirmed?: boolean; skip?: false }
  | { ok: true; skip: true; reason: string; toolName?: never; args?: never; confirmed?: never }
  | { ok: false; error: JsonObject };

function normalizeAction(name: string, context: JsonObject): NormalizedAction {
  if (name === "runtime.pending_action.confirm" || name === "runtime.pending_action.reject") {
    const pendingActionId = typeof context.pending_action_id === "string" ? context.pending_action_id : "";
    if (!pendingActionId) {
      return { ok: false, error: { ok: false, error: "bad_request", message: "pending_action_id 必填。" } };
    }
    return {
      ok: true,
      toolName: name,
      args: { id: pendingActionId },
      confirmed: name === "runtime.pending_action.confirm"
    };
  }
  if (name === "task.resume.select") {
    const taskId = typeof context.task_id === "string" ? context.task_id : "";
    if (!taskId) return { ok: false, error: { ok: false, error: "bad_request", message: "task_id 必填。" } };
    return {
      ok: true,
      toolName: "task.claim",
      args: {
        id: taskId,
        task_list_id: stringOrUndefined(context.task_list_id),
        owner: "agent"
      }
    };
  }
  if (name === "task.resume.ignore") {
    return { ok: true, skip: true, reason: "task_resume_ignored" };
  }
  return { ok: false, error: { ok: false, error: "unsupported_action", message: "不支持该 A2UI action。" } };
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
