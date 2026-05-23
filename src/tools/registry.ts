import { checkToolPermission } from "../auth/permissions.js";
import { PendingActionStore } from "../runtime/pending-action-store.js";
import { RuntimeHooks } from "../runtime/hooks.js";
import { resolveUserWorkspace, type WorkspaceContext } from "../runtime/workspace-context.js";
import { ToolPolicyStore, isRetriableErrorCode, type ToolPolicy } from "./tool-policy.js";
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
  private readonly policyStore: ToolPolicyStore;

  constructor(tools: ToolDefinition[], { hooks, pendingActionStore = new PendingActionStore(), policyStore }: { hooks?: RuntimeHooks; pendingActionStore?: PendingActionStore; policyStore?: ToolPolicyStore } = {}) {
    this.tools = new Map(tools.map((tool) => [tool.name, tool]));
    this.hooks = hooks;
    this.pendingActionStore = pendingActionStore;
    this.policyStore = policyStore ?? new ToolPolicyStore();
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
        isError: true,
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
        isError: true,
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
        isError: true,
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
        isError: true,
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
    const policy = this.policyStore.resolve(call.name, typeof tool.metadata?.timeout_ms === "number" ? tool.metadata.timeout_ms : undefined);
    return this.executeWithRetry(call, context, tool, policy);
  }

  private async executeWithRetry(call: ToolCall, context: ToolExecutionContext | undefined, tool: ToolDefinition, policy: ToolPolicy): Promise<ToolResult | unknown> {
    const upstream = context?.signal;
    let lastFailure: ToolResult | null = null;
    const maxAttempts = Math.max(1, policy.retries + 1);
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (upstream?.aborted) {
        const aborted: ToolResult = { ok: false, isError: true, tool: call.name, error: "execution_failed", code: "aborted", message: "调用方已取消。" };
        await this.emitGovernance(call, context, tool, "execution_failed", aborted.message, aborted.code, undefined, 0, attempt);
        return aborted;
      }
      const controller = new AbortController();
      const onUpstreamAbort = () => controller.abort(upstream?.reason);
      if (upstream) upstream.addEventListener("abort", onUpstreamAbort, { once: true });
      const childContext: ToolExecutionContext = { ...(context ?? {}), signal: controller.signal };
      const startedAt = Date.now();
      try {
        const result = await runWithTimeout(tool.execute(call.args ?? {}, childContext), policy.timeoutMs, call.name, controller);
        await this.emitGovernance(call, context, tool, "completed", undefined, undefined, undefined, Date.now() - startedAt, attempt);
        return result;
      } catch (error) {
        const folded = buildToolErrorResult(call.name, error);
        const isLastAttempt = attempt === maxAttempts - 1;
        const retriable = isRetriableErrorCode(folded.code) && !upstream?.aborted;
        await this.emitGovernance(call, context, tool, "execution_failed", folded.message, folded.code, undefined, Date.now() - startedAt, attempt);
        lastFailure = folded;
        if (isLastAttempt || !retriable) return folded;
        await sleep(policy.retryBackoffMs * Math.pow(2, attempt), upstream);
      } finally {
        if (upstream) upstream.removeEventListener("abort", onUpstreamAbort);
      }
    }
    return lastFailure ?? { ok: false, isError: true, tool: call.name, error: "execution_failed", code: "internal_error", message: "tool retry loop exited without result" } satisfies ToolResult;
  }

  private async emitGovernance(call: ToolCall, context: ToolExecutionContext | undefined, tool: ToolDefinition, decision: string, message?: string, code?: string, pendingActionId?: string, latencyMs?: number, attempt?: number): Promise<void> {
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
      latency_ms: typeof latencyMs === "number" ? latencyMs : undefined,
      attempt: typeof attempt === "number" ? attempt : undefined,
      at: new Date().toISOString(),
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

/**
 * 把工具运行时异常折叠成 ToolResult(isError=true)，让 LLM 在 transcript 里
 * 直接读到失败信号，自己决定继续/换路。永远不要把异常 throw 出主循环。
 */
export function buildToolErrorResult(toolName: string, error: unknown): ToolResult {
  const { code, message } = classifyToolError(error);
  return {
    ok: false,
    isError: true,
    tool: toolName,
    error: "execution_failed",
    code,
    message
  };
}

/**
 * 退避用 sleep。如果 upstream signal 中途 abort，立刻 resolve（不抛错），
 * 让上层的 abort 检查自然地落到下一轮 isLastAttempt 判断里。
 */
function sleep(ms: number, upstream?: AbortSignal | null): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (upstream) upstream.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => { clearTimeout(timer); resolve(); };
    if (upstream) upstream.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * 给一个 promise 套硬超时。超时后抛 TimeoutError，让上层 try/catch 折叠成
 * ToolResult(isError=true, code="timeout")。原 promise 不会被取消（JS 没有
 * 通用的 cancel），只是结果被丢弃——工具实现应自带 AbortController 才能真停掉。
 */
function runWithTimeout<T>(promise: Promise<T> | T, timeoutMs: number, toolName: string, controller?: AbortController): Promise<T> {
  if (timeoutMs <= 0) return Promise.resolve(promise);
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`tool "${toolName}" timed out after ${timeoutMs}ms`);
      err.name = "TimeoutError";
      // 让监听 signal 的工具实现感知到取消，释放底层 fetch/db 等资源
      controller?.abort(err);
      reject(err);
    }, timeoutMs);
    Promise.resolve(promise)
      .then((value) => { clearTimeout(timer); resolve(value); })
      .catch((error) => { clearTimeout(timer); reject(error); });
  });
}

function classifyToolError(error: unknown): { code: string; message: string } {
  if (error instanceof Error) {
    const name = error.name || "Error";
    let code: string;
    if (name === "AbortError" || /aborted|canceled|cancelled/i.test(error.message)) {
      code = "aborted";
    } else if (name === "TimeoutError" || /timeout|timed out/i.test(error.message)) {
      code = "timeout";
    } else if (/permission|forbidden|unauthor/i.test(error.message)) {
      code = "permission";
    } else if (/network|fetch|ECONN|ENOTFOUND|ETIMEDOUT/i.test(error.message)) {
      code = "network";
    } else {
      code = "internal_error";
    }
    return { code, message: error.message || String(error) };
  }
  if (typeof error === "string") {
    return { code: "internal_error", message: error };
  }
  return { code: "internal_error", message: "工具执行抛出未知异常。" };
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
