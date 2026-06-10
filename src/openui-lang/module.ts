import { ActionError, OpenUILangActionRegistry } from "./action-registry.js";
import { OpenUILangCatalogService } from "./catalog-service.js";
import { OpenUILangEnvelopeStore, type PersistedEnvelope } from "./envelope-store.js";
import { OpenUILangHistoryStore } from "./history-store.js";
import { OpenUILangIdempotencyCache } from "./idempotency-cache.js";
import { legacyEnvelopeToOpenUILangEvent, legacyEnvelopesToOpenUILangDocument } from "./legacy-adapter.js";
import { parseOpenUILangActionRequest, parseOpenUILangChatRequest, type OpenUILangActionRequestDto, type OpenUILangChatRequestDto, type OpenUILangSseEventDto } from "./dto.js";
import { OpenUILangPipeLogService } from "./pipe-log-service.js";
import { OpenUILangIncrementalEnvelopeParser, OpenUILangStreamingTranslator } from "./streaming.js";
import { buildOpenUILangLegacyEnvelopes } from "./response.js";
import type { OpenUILangClientCapabilities, OpenUILangCompatEnvelope, OpenUILangDocument } from "./types.js";
import { resolveUserWorkspace } from "../runtime/workspace-context.js";
import { newTraceId } from "../security/observability.js";
import type { JsonObject, ToolExecutionContext, UserContext } from "../types/agent-contracts.js";

interface QueryEngineLike {
  submitMessage(input: {
    userId: string;
    userContext?: JsonObject;
    wecomUserId?: string;
    message: string;
    sessionId?: string;
    debug?: boolean;
    attachmentIds?: string[];
  }): Promise<Record<string, unknown>>;
  submitStream?(input: {
    userId: string;
    userContext?: JsonObject;
    wecomUserId?: string;
    message: string;
    sessionId?: string;
    debug?: boolean;
    attachmentIds?: string[];
    onEvent?: (event: JsonObject) => Promise<void> | void;
  }): Promise<unknown>;
}

interface StreamAgentLike {
  runStream(input: {
    userId: string;
    userContext?: JsonObject;
    wecomUserId?: string;
    message: string;
    sessionId?: string;
    debug?: boolean;
    onEvent?: (event: JsonObject) => Promise<void> | void;
  }): Promise<unknown>;
}

interface ToolRegistryLike {
  execute(call: { name: string; args?: JsonObject }, context?: ToolExecutionContext): Promise<unknown>;
}

interface UserContextResolverLike {
  resolve(input: { userId?: string; userContext?: Record<string, unknown>; wecomUserId?: string }): Promise<UserContext>;
}

export interface OpenUILangStreamOptions {
  sinceSeq?: number;
  traceId?: string;
  namespace?: string;
  eventProtocol?: "openui" | "legacy";
}

export class OpenUILangChatService {
  private readonly historyStore: OpenUILangHistoryStore;

  constructor(
    private readonly toolRegistry: ToolRegistryLike,
    private readonly userContextResolver: UserContextResolverLike,
    private readonly catalogService = new OpenUILangCatalogService(),
    private readonly pipeLogService = new OpenUILangPipeLogService(),
    private readonly actionRegistry = new OpenUILangActionRegistry(),
    private readonly envelopeStore = new OpenUILangEnvelopeStore(),
    private readonly idempotencyCache = new OpenUILangIdempotencyCache()
  ) {
    this.historyStore = new OpenUILangHistoryStore(this.envelopeStore);
  }

  getEnvelopeStore(): OpenUILangEnvelopeStore {
    return this.envelopeStore;
  }

  getHistoryStore(): OpenUILangHistoryStore {
    return this.historyStore;
  }

  async resolveUser(userId: string): Promise<UserContext> {
    return await this.userContextResolver.resolve({ userId });
  }

  async appendEnvelope(input: {
    user: UserContext;
    sessionId: string;
    runId: string;
    traceId?: string;
    envelope: OpenUILangCompatEnvelope;
  }): Promise<PersistedEnvelope> {
    const workspace = resolveUserWorkspace(input.user);
    return await this.envelopeStore.append(workspace, {
      sessionId: input.sessionId,
      runId: input.runId,
      traceId: input.traceId,
      envelope: input.envelope
    });
  }

  async historyLatest(userId: string, sessionId: string) {
    const user = await this.userContextResolver.resolve({ userId });
    const workspace = resolveUserWorkspace(user);
    return await this.envelopeStore.latestRun(workspace, sessionId);
  }

  async historyRuns(userId: string, sessionId: string) {
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
    const serverCapabilities = base.server_capabilities && typeof base.server_capabilities === "object" && !Array.isArray(base.server_capabilities)
      ? base.server_capabilities as JsonObject
      : {};
    return toOpenUILangCapabilities({
      ...base,
      server_capabilities: {
        ...serverCapabilities,
        actions: this.actionRegistry.list()
      }
    });
  }

  registerAction(definition: Parameters<OpenUILangActionRegistry["register"]>[0]): void {
    this.actionRegistry.register(definition);
  }

  async decorateChatResult<T extends Record<string, unknown>>(
    result: T,
    options: { clientCapabilities?: OpenUILangClientCapabilities; includeRuntime?: boolean } = {}
  ): Promise<T & { openui: OpenUILangDocument; openui_compat: OpenUILangCompatEnvelope[]; a2ui: OpenUILangCompatEnvelope[]; openui_pipe: JsonObject[]; a2ui_pipe: JsonObject[] }> {
    const parser = new OpenUILangIncrementalEnvelopeParser();
    const legacy = await this.pipeLogService.withRetry("translate_agent_result", () => parser.parse(buildOpenUILangLegacyEnvelopes({
      result,
      clientCapabilities: options.clientCapabilities,
      includeRuntime: options.includeRuntime === true
    })), 2);
    const pipe = this.pipeLogService.recent(10);
    return {
      ...result,
      openui: legacyEnvelopesToOpenUILangDocument(legacy),
      openui_compat: legacy,
      a2ui: legacy,
      openui_pipe: pipe,
      a2ui_pipe: pipe
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
      return { ok: false, error: "unsupported_action", message: "不支持该 OpenUI action。" };
    }
    if (input.clientActionId) {
      const cached = this.idempotencyCache.get(input.userId, input.clientActionId);
      if (cached) return { ...cached, idempotent_replay: true };
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
    const pipe = this.pipeLogService.recent(10);
    const response: JsonObject = {
      ok: true,
      action: name,
      result: JSON.parse(JSON.stringify(result ?? null)),
      openui_pipe: pipe,
      a2ui_pipe: pipe
    };
    if (input.clientActionId) this.idempotencyCache.put(input.userId, input.clientActionId, response);
    return response;
  }
}

export class OpenUILangChatController {
  constructor(
    private readonly queryEngine: QueryEngineLike,
    private readonly streamAgent: StreamAgentLike,
    private readonly chatService: OpenUILangChatService
  ) {}

  capabilities(): JsonObject {
    return toOpenUILangCapabilities(this.chatService.capabilities());
  }

  async chat(body: Record<string, unknown>): Promise<JsonObject> {
    const dto = parseOpenUILangChatRequest(body);
    const result = await this.queryEngine.submitMessage(toQueryInput(dto));
    const decorated = await this.chatService.decorateChatResult(withOpenUILangContext(result), {
      clientCapabilities: dto.client_capabilities,
      includeRuntime: dto.debug === true
    });
    return toOpenUIPrimaryPayload(toPublicOpenUILangResult(decorated, dto.debug === true));
  }

  async chatLegacy(body: Record<string, unknown>): Promise<JsonObject> {
    const dto = parseOpenUILangChatRequest(body);
    const result = await this.queryEngine.submitMessage(toQueryInput(dto));
    const decorated = await this.chatService.decorateChatResult(withOpenUILangContext(result), {
      clientCapabilities: dto.client_capabilities,
      includeRuntime: dto.debug === true
    });
    return toPublicOpenUILangResult(decorated, dto.debug === true);
  }

  async action(body: Record<string, unknown>): Promise<JsonObject> {
    const dto = parseOpenUILangActionRequest(body);
    return await this.chatService.handleAction(toActionInput(dto));
  }

  async stream(
    body: Record<string, unknown>,
    emit: (event: OpenUILangSseEventDto, sseId?: string) => void | Promise<void>,
    options: OpenUILangStreamOptions = {}
  ): Promise<void> {
    const protocol = options.eventProtocol ?? "openui";
    const dto = parseOpenUILangChatRequest(body);
    const traceId = options.traceId ?? newTraceId();
    const sessionId = dto.session_id ?? `sess_${Date.now()}`;
    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const eventNames = openUIEventNames(protocol);

    if (typeof options.sinceSeq === "number" && dto.session_id) {
      await this.replayHistory(dto.user_id, sessionId, options.sinceSeq, emit, traceId, eventNames);
      return;
    }

    const user = await this.chatService.resolveUser(dto.user_id);
    const parser = new OpenUILangIncrementalEnvelopeParser();
    const translator = new OpenUILangStreamingTranslator(parser, async (openuiEvent, document, envelope) => {
      await this.persistAndEmit(user, sessionId, runId, traceId, envelope, openuiEvent, document, emit, eventNames);
    }, {
      surfacePrefix: options.namespace ? `${options.namespace}_agent` : "agent",
      runId,
      clientCapabilities: dto.client_capabilities,
      includeRuntime: dto.debug === true
    });

    await emit({ type: eventNames.runStarted, run_id: runId, session_id: sessionId, trace_id: traceId, protocol: "openui-lang/1.0" } as OpenUILangSseEventDto);

    let lastRoute: JsonObject | null = null;
    const onEvent = async (event: JsonObject) => {
      if (event.type === "route") {
        const route = (event as { route?: unknown }).route;
        if (route && typeof route === "object" && !Array.isArray(route)) lastRoute = route as JsonObject;
      }
      if (event.type === "agentic_event") {
        const inner = (event as JsonObject).event as Record<string, unknown> | undefined;
        if (inner) await translator.onAgenticEvent(inner);
        await emit({ ...event, trace_id: traceId } as OpenUILangSseEventDto);
        return;
      }
      if (event.type === "done") {
        const enriched = withOpenUILangContext({
          ...event,
          user_message: (event as { user_message?: unknown }).user_message ?? dto.message,
          run_id: runId,
          session_id: sessionId,
          debug: { ...(event as { debug?: JsonObject }).debug, route: lastRoute ?? (event as { debug?: { route?: unknown } }).debug?.route ?? null }
        });
        await translator.finalize(enriched);
        const decorated = await this.chatService.decorateChatResult(enriched, {
          clientCapabilities: dto.client_capabilities,
          includeRuntime: dto.debug === true
        });
        const publicDone = toPublicOpenUILangResult(decorated, dto.debug === true);
        const done = protocol === "legacy" ? publicDone : toOpenUIPrimaryPayload(publicDone);
        await emit({ ...done, trace_id: traceId, session_id: sessionId, run_id: runId } as OpenUILangSseEventDto);
        return;
      }
      await emit({ ...event, trace_id: traceId } as OpenUILangSseEventDto);
    };

    if (typeof this.queryEngine.submitStream === "function") {
      await this.queryEngine.submitStream({
        ...toQueryInput(dto),
        sessionId,
        onEvent
      });
    } else {
      await this.streamAgent.runStream({
        ...toQueryInput(dto),
        sessionId,
        onEvent
      });
    }
  }

  async streamOpenUI(
    body: Record<string, unknown>,
    emit: (event: OpenUILangSseEventDto, sseId?: string) => void | Promise<void>,
    options: OpenUILangStreamOptions = {}
  ): Promise<void> {
    return await this.stream(body, emit, { ...options, eventProtocol: "openui" });
  }

  async streamLegacy(
    body: Record<string, unknown>,
    emit: (event: OpenUILangSseEventDto, sseId?: string) => void | Promise<void>,
    options: OpenUILangStreamOptions = {}
  ): Promise<void> {
    return await this.stream(body, emit, { ...options, eventProtocol: "legacy" });
  }

  async history(
    input: { userId: string; sessionId: string; runId?: string; sinceSeq?: number },
    options: { eventProtocol?: "openui" | "legacy" } = {}
  ): Promise<JsonObject> {
    const legacy = await this.legacyHistory(input);
    return options.eventProtocol === "legacy" ? legacy : toOpenUIHistoryPayload(legacy);
  }

  private async legacyHistory(input: { userId: string; sessionId: string; runId?: string; sinceSeq?: number }): Promise<JsonObject> {
    if (input.runId && typeof input.sinceSeq === "number") {
      const items = await this.chatService.historySince(input.userId, input.sessionId, input.runId, input.sinceSeq);
      return { ok: true, run_id: input.runId, envelopes: items as unknown as JsonObject[] };
    }
    const latest = await this.chatService.historyLatest(input.userId, input.sessionId);
    if (!latest) return { ok: true, run_id: null, envelopes: [] };
    return {
      ok: true,
      session_id: latest.session_id,
      run_id: latest.run_id,
      trace_id: latest.trace_id,
      updated_at: latest.updated_at,
      envelopes: latest.envelopes as unknown as JsonObject[]
    };
  }

  private async persistAndEmit(
    user: UserContext,
    sessionId: string,
    runId: string,
    traceId: string,
    envelope: OpenUILangCompatEnvelope,
    openuiEvent: JsonObject,
    document: OpenUILangDocument,
    emit: (event: OpenUILangSseEventDto, sseId?: string) => void | Promise<void>,
    eventNames: OpenUIEventNames
  ): Promise<PersistedEnvelope> {
    const persisted = await this.chatService.appendEnvelope({
      user, sessionId, runId, traceId, envelope
    });
    const sseId = `${runId}:${persisted.seq}`;
    await emit({
      type: eventNames.envelope,
      seq: persisted.seq,
      run_id: runId,
      session_id: sessionId,
      trace_id: traceId,
      ts: persisted.ts,
      protocol: "openui-lang/1.0",
      openui_event: openuiEvent,
      openui: document,
      envelope
    } as OpenUILangSseEventDto, sseId);
    return persisted;
  }

  private async replayHistory(
    userId: string,
    sessionId: string,
    sinceSeq: number,
    emit: (event: OpenUILangSseEventDto, sseId?: string) => void | Promise<void>,
    traceId: string,
    eventNames: OpenUIEventNames
  ): Promise<void> {
    const latest = await this.chatService.historyLatest(userId, sessionId);
    if (!latest) {
      await emit({ type: eventNames.replayEmpty, trace_id: traceId, protocol: "openui-lang/1.0" } as OpenUILangSseEventDto);
      return;
    }
    const items = latest.envelopes.filter((item) => item.seq > sinceSeq);
    for (const item of items) {
      const openuiEvent = legacyEnvelopeToOpenUILangEvent(item.envelope);
      await emit({
        type: eventNames.envelope,
        seq: item.seq,
        run_id: latest.run_id,
        session_id: latest.session_id,
        trace_id: latest.trace_id ?? traceId,
        ts: item.ts,
        protocol: "openui-lang/1.0",
        openui_event: openuiEvent,
        envelope: item.envelope,
        replayed: true
      } as OpenUILangSseEventDto, `${latest.run_id}:${item.seq}`);
    }
    await emit({
      type: eventNames.replayDone,
      run_id: latest.run_id,
      session_id: latest.session_id,
      last_seq: latest.envelopes[latest.envelopes.length - 1]?.seq ?? sinceSeq,
      trace_id: traceId,
      protocol: "openui-lang/1.0"
    } as OpenUILangSseEventDto);
  }
}

function toOpenUIPrimaryPayload<T extends JsonObject>(payload: T): T {
  const record = { ...payload } as JsonObject;
  const legacy = readLegacyEnvelopes(record.openui) ?? readLegacyEnvelopes(record.a2ui);
  if (legacy) {
    record.openui = legacyEnvelopesToOpenUILangDocument(legacy);
    record.openui_compat = legacy;
  }
  const envelope = readLegacyEnvelope(record.envelope);
  if (envelope) {
    const event = legacyEnvelopeToOpenUILangEvent(envelope);
    if (event) record.openui_event = event;
  }
  delete record.a2ui;
  delete record.a2ui_pipe;
  return record as T;
}

function toOpenUIHistoryPayload<T extends JsonObject>(payload: T): T {
  const record = { ...payload } as JsonObject;
  const persistedItems = readPersistedEnvelopes(record.envelopes);
  if (!persistedItems) return record as T;
  const legacy = persistedItems.map((item) => item.envelope);
  record.protocol = "openui-lang/1.0";
  record.events = persistedItems.map((item) => {
    const event = legacyEnvelopeToOpenUILangEvent(item.envelope);
    return {
      seq: item.seq,
      ts: item.ts,
      protocol: "openui-lang/1.0",
      type: "openui_envelope",
      openui_event: event,
      envelope: item.envelope
    };
  });
  record.openui = legacyEnvelopesToOpenUILangDocument(legacy);
  record.openui_compat = persistedItems.map((item) => ({ seq: item.seq, ts: item.ts, envelope: item.envelope }));
  delete record.envelopes;
  return record as T;
}

interface OpenUIEventNames {
  runStarted: "openui_run_started" | "a2ui_run_started";
  envelope: "openui_envelope" | "a2ui_envelope";
  replayEmpty: "openui_replay_empty" | "a2ui_replay_empty";
  replayDone: "openui_replay_done" | "a2ui_replay_done";
}

function openUIEventNames(protocol: OpenUILangStreamOptions["eventProtocol"]): OpenUIEventNames {
  if (protocol === "openui") {
    return {
      runStarted: "openui_run_started",
      envelope: "openui_envelope",
      replayEmpty: "openui_replay_empty",
      replayDone: "openui_replay_done"
    };
  }
  return {
    runStarted: "a2ui_run_started",
    envelope: "a2ui_envelope",
    replayEmpty: "a2ui_replay_empty",
    replayDone: "a2ui_replay_done"
  };
}

function toQueryInput(dto: OpenUILangChatRequestDto) {
  return {
    userId: dto.user_id,
    userContext: dto.user_context,
    wecomUserId: dto.wecom_userid,
    message: dto.message,
    sessionId: dto.session_id,
    debug: dto.debug === true,
    attachmentIds: dto.attachment_ids
  };
}

function toActionInput(dto: OpenUILangActionRequestDto) {
  return {
    userId: dto.user_id,
    sessionId: dto.session_id,
    clientActionId: dto.client_action_id,
    action: dto.action
  };
}

function withOpenUILangContext<T extends Record<string, unknown>>(record: T): T {
  const output = toJsonObject(record.output);
  const context = toJsonObject(record._openui_lang_context)
    ?? toJsonObject(record._a2ui_context)
    ?? toJsonObject(output?._openui_lang_context)
    ?? toJsonObject(output?._a2ui_context);
  if (!context) return record;
  const debug = toJsonObject(record.debug) ?? {};
  return {
    ...record,
    debug: {
      ...context,
      ...debug,
      route: debug.route ?? context.route ?? null,
      tool_results: context.tool_results ?? debug.tool_results ?? []
    }
  };
}

function stripOpenUILangContext(record: Record<string, unknown>): JsonObject {
  const { _openui_lang_context: _openuiInternal, _a2ui_context: _a2uiInternal, ...publicRecord } = record;
  return publicRecord as JsonObject;
}

function toPublicOpenUILangResult(record: Record<string, unknown>, includeDebug: boolean): JsonObject {
  const publicRecord = stripOpenUILangContext(record);
  if (!includeDebug) delete publicRecord.debug;
  return publicRecord;
}

function toJsonObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readLegacyEnvelopes(value: unknown): OpenUILangCompatEnvelope[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter(readLegacyEnvelope) as OpenUILangCompatEnvelope[];
}

function readLegacyEnvelope(value: unknown): OpenUILangCompatEnvelope | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as { version?: unknown };
  return record.version === "v0.9" ? value as OpenUILangCompatEnvelope : null;
}

function readPersistedEnvelopes(value: unknown): PersistedEnvelope[] | null {
  if (!Array.isArray(value)) return null;
  const items: PersistedEnvelope[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as { seq?: unknown; ts?: unknown; envelope?: unknown };
    const envelope = readLegacyEnvelope(record.envelope);
    if (typeof record.seq !== "number" || typeof record.ts !== "string" || !envelope) continue;
    items.push({ seq: record.seq, ts: record.ts, envelope });
  }
  return items;
}

function toOpenUILangCapabilities(payload: JsonObject): JsonObject {
  const serverCapabilities = payload.server_capabilities && typeof payload.server_capabilities === "object" && !Array.isArray(payload.server_capabilities)
    ? { ...payload.server_capabilities as JsonObject }
    : {};
  const actions = Array.isArray(serverCapabilities.actions)
    ? serverCapabilities.actions.filter((action) => typeof action !== "string" || !action.startsWith("a2ui."))
    : serverCapabilities.actions;
  const legacyCatalogIds = Array.isArray(serverCapabilities.supportedCatalogIds)
    ? serverCapabilities.supportedCatalogIds
    : [];
  return {
    ...payload,
    version: "openui-lang/1.0",
    compatibility_version: payload.version,
    catalog_version: "openui-lang/1.0",
    server_capabilities: {
      ...serverCapabilities,
      supportedCatalogIds: ["openui.lang.catalog.basic/1.0"],
      compatibilityCatalogIds: legacyCatalogIds,
      actions
    }
  };
}

export interface OpenUILangModule {
  chatService: OpenUILangChatService;
  chatController: OpenUILangChatController;
}

export function createOpenUILangModule({
  queryEngine,
  streamAgent,
  toolRegistry,
  userContextResolver
}: {
  queryEngine: QueryEngineLike;
  streamAgent: StreamAgentLike;
  toolRegistry: ToolRegistryLike;
  userContextResolver: UserContextResolverLike;
}): OpenUILangModule {
  const chatService = new OpenUILangChatService(toolRegistry, userContextResolver);
  return {
    chatService,
    chatController: new OpenUILangChatController(queryEngine, streamAgent, chatService)
  };
}
