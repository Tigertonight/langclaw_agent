import { checkToolPermission } from "../auth/permissions.js";
import { PendingActionStore } from "../runtime/pending-action-store.js";
import { RuntimeHooks } from "../runtime/hooks.js";
import { resolveUserWorkspace, type WorkspaceContext } from "../runtime/workspace-context.js";
import { logEvent, sharedMetrics } from "../security/observability.js";
import {
  formatConfirmationRequired,
  formatExecuteFailed,
  formatInvalidInputMessage,
  formatToolUnavailable,
  formatUnknownTool
} from "./tool-error-formatter.js";
import type { ZodTypeAny } from "zod";
import type {
  JsonObject,
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

const DEFAULT_TOOL_TIMEOUT_MS = readPositiveNumberEnv("TOOL_EXECUTE_TIMEOUT_MS", 30_000);

function readPositiveNumberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export class ToolRegistry {
  private readonly tools: Map<string, ToolDefinition>;
  private readonly hooks?: RuntimeHooks;
  private readonly pendingActionStore: PendingActionStore;
  private readonly defaultTimeoutMs: number;

  constructor(tools: ToolDefinition[], { hooks, pendingActionStore = new PendingActionStore(), defaultTimeoutMs }: { hooks?: RuntimeHooks; pendingActionStore?: PendingActionStore; defaultTimeoutMs?: number } = {}) {
    this.tools = new Map(tools.map((tool) => [tool.name, tool]));
    this.hooks = hooks;
    this.pendingActionStore = pendingActionStore;
    this.defaultTimeoutMs = defaultTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
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
        message: formatUnknownTool(call.name)
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
      const unavailableMsg = formatToolUnavailable(call.name);
      await this.emitGovernance(call, context, tool, "tool_unavailable", unavailableMsg);
      return {
        ok: false,
        tool: call.name,
        error: "tool_unavailable",
        message: unavailableMsg
      } satisfies ToolResult;
    }

    if (tool.metadata?.requires_confirmation === true && context?.confirmed !== true) {
      const pendingAction = await this.createPendingAction(call, context, tool);
      const confirmMsg = formatConfirmationRequired(call.name);
      await this.emitGovernance(call, context, tool, "confirmation_required", confirmMsg, undefined, pendingAction?.id);
      return {
        ok: false,
        tool: call.name,
        error: "confirmation_required",
        message: confirmMsg,
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

    const inputArgs = call.args ?? {};
    const validatedArgs = this.validateInput(tool, inputArgs);
    if (validatedArgs.invalid === true) {
      await this.emitGovernance(call, context, tool, "invalid_input", validatedArgs.message);
      return {
        ok: false,
        tool: call.name,
        error: "invalid_input",
        message: validatedArgs.message,
        data: { issues: validatedArgs.issues } as JsonObject
      } satisfies ToolResult;
    }

    const timeoutMs = typeof tool.metadata?.timeout_ms === "number" && tool.metadata.timeout_ms > 0
      ? tool.metadata.timeout_ms
      : this.defaultTimeoutMs;
    const abortController = new AbortController();
    const parentSignal = context?.signal;
    const onParentAbort = (): void => abortController.abort(parentSignal?.reason);
    if (parentSignal) {
      if (parentSignal.aborted) abortController.abort(parentSignal.reason);
      else parentSignal.addEventListener("abort", onParentAbort, { once: true });
    }
    const timer = setTimeout(() => abortController.abort(new Error("tool_execute_timeout")), timeoutMs);

    let result: unknown;
    try {
      const childContext: ToolExecutionContext = { ...(context ?? {}), signal: abortController.signal };
      const execPromise = Promise.resolve(tool.execute(validatedArgs.value, childContext));
      const abortPromise = new Promise<never>((_, reject) => {
        abortController.signal.addEventListener("abort", () => {
          const reason = abortController.signal.reason;
          reject(reason instanceof Error ? reason : new Error(typeof reason === "string" ? reason : "tool_aborted"));
        }, { once: true });
      });
      result = await Promise.race([execPromise, abortPromise]);
    } catch (error) {
      const isTimeout = error instanceof Error && error.message === "tool_execute_timeout";
      if (isTimeout) {
        sharedMetrics.inc("tool_execute_timeout", { tool: call.name });
        logEvent("warn", "tool_execute_timeout", {
          tool: call.name,
          user_id: context?.user?.id,
          timeout_ms: timeoutMs
        });
      } else {
        sharedMetrics.inc("tool_execute_failed", { tool: call.name });
        logEvent("error", "tool_execute_failed", {
          tool: call.name,
          user_id: context?.user?.id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      const rawMessage = isTimeout
        ? `工具执行超时（${timeoutMs}ms）`
        : (error instanceof Error ? error.message : "tool execution failed");
      return {
        ok: false,
        tool: call.name,
        error: isTimeout ? "execute_timeout" : "execute_failed",
        message: isTimeout ? rawMessage : formatExecuteFailed(call.name, rawMessage)
      } satisfies ToolResult;
    } finally {
      clearTimeout(timer);
      if (parentSignal) parentSignal.removeEventListener("abort", onParentAbort);
    }

    this.validateOutput(tool, result);
    return result;
  }

  private validateInput(tool: ToolDefinition, args: JsonObject): { invalid: false; value: JsonObject } | { invalid: true; message: string; issues: JsonObject[] } {
    const schema = tool.inputSchema as ZodTypeAny | undefined;
    if (!schema || typeof (schema as { safeParse?: unknown }).safeParse !== "function") {
      return { invalid: false, value: args };
    }
    const parsed = schema.safeParse(args);
    if (parsed.success) return { invalid: false, value: parsed.data as JsonObject };
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      code: issue.code,
      message: issue.message
    })) as JsonObject[];
    sharedMetrics.inc("tool_input_invalid", { tool: tool.name });
    logEvent("warn", "tool_input_invalid", { tool: tool.name, issues });
    const rawIssues = parsed.error.issues.map((issue) => ({
      ...issue,
      path: issue.path
    })) as unknown as JsonObject[];
    return {
      invalid: true,
      message: formatInvalidInputMessage(tool.name, rawIssues),
      issues
    };
  }

  private validateOutput(tool: ToolDefinition, result: unknown): void {
    const schema = tool.outputSchema as ZodTypeAny | undefined;
    if (!schema || typeof (schema as { safeParse?: unknown }).safeParse !== "function") return;
    const parsed = schema.safeParse(result);
    if (parsed.success) return;
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      code: issue.code,
      message: issue.message
    }));
    sharedMetrics.inc("tool_output_invalid", { tool: tool.name });
    logEvent("warn", "tool_output_invalid", { tool: tool.name, issues });
    // 不阻断 —— 仅观测，避免一上线就把所有现有 tool 全锁死
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
      reason: formatConfirmationRequired(call.name)
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
