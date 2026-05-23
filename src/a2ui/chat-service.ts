import { A2UIActionRegistry, ActionError } from "./action-registry.js";
import { A2UICatalogService } from "./catalog-service.js";
import { A2UIEnvelopeStore, type PersistedEnvelope, type SessionEnvelopeRecord } from "./envelope-store.js";
import { IdempotencyCache } from "./idempotency-cache.js";
import { A2UIPipeLogService } from "./pipe-log-service.js";
import { A2UITranslatorService } from "./translator-service.js";
import type { A2UIEnvelope } from "./types.js";
import { resolveUserWorkspace } from "../runtime/workspace-context.js";
import { logEvent, sharedMetrics } from "../security/observability.js";
import type { ClientCapabilities } from "./adapter.js";
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
    private readonly pipeLogService = new A2UIPipeLogService(),
    private readonly actionRegistry = new A2UIActionRegistry(),
    private readonly envelopeStore = new A2UIEnvelopeStore(),
    private readonly idempotencyCache = new IdempotencyCache()
  ) {}

  getEnvelopeStore(): A2UIEnvelopeStore {
    return this.envelopeStore;
  }

  async resolveUser(userId: string): Promise<UserContext> {
    return await this.userContextResolver.resolve({ userId });
  }

  async appendEnvelope(input: {
    user: UserContext;
    sessionId: string;
    runId: string;
    traceId?: string;
    envelope: A2UIEnvelope;
  }): Promise<PersistedEnvelope> {
    const workspace = resolveUserWorkspace(input.user);
    return await this.envelopeStore.append(workspace, {
      sessionId: input.sessionId,
      runId: input.runId,
      traceId: input.traceId,
      envelope: input.envelope
    });
  }

  async historyLatest(userId: string, sessionId: string): Promise<SessionEnvelopeRecord | null> {
    const user = await this.userContextResolver.resolve({ userId });
    const workspace = resolveUserWorkspace(user);
    return await this.envelopeStore.latestRun(workspace, sessionId);
  }

  async historyRuns(userId: string, sessionId: string): Promise<SessionEnvelopeRecord[]> {
    const user = await this.userContextResolver.resolve({ userId });
    const workspace = resolveUserWorkspace(user);
    return await this.envelopeStore.listRuns(workspace, sessionId);
  }

  async historySince(userId: string, sessionId: string, runId: string, sinceSeq: number): Promise<PersistedEnvelope[]> {
    const user = await this.userContextResolver.resolve({ userId });
    const workspace = resolveUserWorkspace(user);
    return await this.envelopeStore.listEnvelopesSince(workspace, sessionId, runId, sinceSeq);
  }

  capabilities(): JsonObject {
    const base = this.catalogService.capabilities();
    const serverCapabilities = (base.server_capabilities && typeof base.server_capabilities === "object" && !Array.isArray(base.server_capabilities))
      ? base.server_capabilities as JsonObject
      : {};
    return {
      ...base,
      server_capabilities: {
        ...serverCapabilities,
        actions: this.actionRegistry.list()
      }
    };
  }

  registerAction(definition: Parameters<A2UIActionRegistry["register"]>[0]): void {
    this.actionRegistry.register(definition);
  }

  async decorateChatResult<T extends Record<string, unknown>>(result: T, options: { clientCapabilities?: ClientCapabilities } = {}): Promise<T & { a2ui: A2UIEnvelope[]; a2ui_pipe: JsonObject[] }> {
    const a2ui = await this.pipeLogService.withRetry("translate_agent_result", () => this.translatorService.translateAgentResult(result, { clientCapabilities: options.clientCapabilities }), 2);
    return {
      ...result,
      a2ui,
      a2ui_pipe: this.pipeLogService.recent(10)
    };
  }

  async handleAction(input: {
    userId: string;
    sessionId?: string;
    clientActionId?: string;
    action: JsonObject;
  }): Promise<JsonObject> {
    const name = typeof input.action.name === "string" ? input.action.name : "";
    const context = isJsonObject(input.action.context) ? input.action.context as JsonObject : {};
    if (!input.userId || !name) {
      return { ok: false, error: "bad_request", message: "user_id 和 action.name 必填。" };
    }
    if (!this.actionRegistry.has(name)) {
      return { ok: false, error: "unsupported_action", message: "不支持该 A2UI action。" };
    }
    if (input.clientActionId) {
      const cached = this.idempotencyCache.get(input.userId, input.clientActionId);
      if (cached) {
        sharedMetrics.inc("action_idempotent_replay_total", { action: name });
        logEvent("info", "action_idempotent_replay", { user_id: input.userId, client_action_id: input.clientActionId, action: name });
        return { ...cached, idempotent_replay: true };
      }
    }
    const user = await this.userContextResolver.resolve({ userId: input.userId });
    let resolved;
    try {
      resolved = await this.actionRegistry.resolve(name, context, { user, sessionId: input.sessionId });
    } catch (error) {
      if (error instanceof ActionError) {
        return { ok: false, error: error.code, message: error.message, status: error.status };
      }
      throw error;
    }
    const result = resolved.skip
      ? { ok: true, skipped: true, reason: resolved.skip.reason }
      : await this.pipeLogService.withRetry("execute_action", () => this.toolRegistry.execute(
        { name: resolved.toolName, args: resolved.args },
        this.actionRegistry.buildExecutionContext({ user, sessionId: input.sessionId }, resolved.confirmed)
      ), 2);
    const response: JsonObject = {
      ok: true,
      action: name,
      result: JSON.parse(JSON.stringify(result ?? null)),
      a2ui_pipe: this.pipeLogService.recent(10)
    };
    if (input.clientActionId) {
      this.idempotencyCache.put(input.userId, input.clientActionId, response);
    }
    return response;
  }

  pipeLog(): JsonObject[] {
    return this.pipeLogService.recent(50);
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
