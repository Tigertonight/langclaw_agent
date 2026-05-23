import { A2UIChatService } from "./chat-service.js";
import { parseA2UIActionRequest, parseA2UIChatRequest, type A2UIActionRequestDto, type A2UIChatRequestDto, type A2UISseEventDto } from "./dto.js";
import { A2UIIncrementalEnvelopeParser } from "./incremental-envelope-parser.js";
import { A2UIStreamingTranslator } from "./streaming-translator.js";
import type { PersistedEnvelope } from "./envelope-store.js";
import type { A2UIEnvelope } from "./types.js";
import { newTraceId } from "../security/observability.js";
import type { JsonObject, UserContext } from "../types/agent-contracts.js";

interface QueryEngineLike {
  submitMessage(input: {
    userId: string;
    userContext?: JsonObject;
    wecomUserId?: string;
    message: string;
    sessionId?: string;
    debug?: boolean;
  }): Promise<Record<string, unknown>>;
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

export interface StreamOptions {
  /** SSE Last-Event-ID resume：仅重放 seq > sinceSeq 的 envelope，不再触发新 agent run。 */
  sinceSeq?: number;
  /** 显式 traceId（外部已分配）。 */
  traceId?: string;
  /** 多租户 surfaceId 前缀，对应 token 解析出的 tenant_id。 */
  namespace?: string;
}

export class A2UIChatController {
  constructor(
    private readonly queryEngine: QueryEngineLike,
    private readonly streamAgent: StreamAgentLike,
    private readonly chatService: A2UIChatService
  ) {}

  capabilities(): JsonObject {
    return this.chatService.capabilities();
  }

  async chat(body: Record<string, unknown>): Promise<JsonObject> {
    const dto = parseA2UIChatRequest(body);
    const result = await this.queryEngine.submitMessage(toQueryInput(dto));
    return await this.chatService.decorateChatResult(result, {
      clientCapabilities: dto.client_capabilities,
      includeRuntime: dto.debug === true
    }) as JsonObject;
  }

  async action(body: Record<string, unknown>): Promise<JsonObject> {
    const dto = parseA2UIActionRequest(body);
    return await this.chatService.handleAction(toActionInput(dto));
  }

  async stream(
    body: Record<string, unknown>,
    emit: (event: A2UISseEventDto, sseId?: string) => void | Promise<void>,
    options: StreamOptions = {}
  ): Promise<void> {
    const dto = parseA2UIChatRequest(body);
    const traceId = options.traceId ?? newTraceId();
    const sessionId = dto.session_id ?? `sess_${Date.now()}`;
    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    if (typeof options.sinceSeq === "number" && dto.session_id) {
      await this.replayHistory(dto.user_id, sessionId, options.sinceSeq, emit, traceId);
      return;
    }

    const user = await this.chatService.resolveUser(dto.user_id);
    const parser = new A2UIIncrementalEnvelopeParser();
    const translator = new A2UIStreamingTranslator(parser, async (envelope) => {
      await this.persistAndEmit(user, sessionId, runId, traceId, envelope, emit);
    }, {
      surfacePrefix: options.namespace ? `${options.namespace}_agent` : "agent",
      runId,
      clientCapabilities: dto.client_capabilities,
      includeRuntime: dto.debug === true
    });

    await emit({ type: "a2ui_run_started", run_id: runId, session_id: sessionId, trace_id: traceId } as unknown as A2UISseEventDto);

    // 流式 done 事件不带 user_message / trace / debug.route，a2UI 插件触发条件靠这些。
    // 在流过程里把 route 事件存下来，done 时合进 record 里再喂 buildA2UIResponse。
    let lastRoute: JsonObject | null = null;

    await this.streamAgent.runStream({
      ...toQueryInput(dto),
      onEvent: async (event) => {
        if (event.type === "route") {
          const route = (event as { route?: unknown }).route;
          if (route && typeof route === "object" && !Array.isArray(route)) lastRoute = route as JsonObject;
        }
        if (event.type === "agentic_event") {
          const inner = (event as JsonObject).event as Record<string, unknown> | undefined;
          if (inner) await translator.onAgenticEvent(inner);
          await emit({ ...event, trace_id: traceId } as A2UISseEventDto);
          return;
        }
        if (event.type === "done") {
          const enriched: Record<string, unknown> = {
            ...event,
            user_message: (event as { user_message?: unknown }).user_message ?? dto.message,
            run_id: runId,
            session_id: sessionId,
            // runtime 插件读 record.debug.route 或 record.trace.route_summary，注入 lastRoute 让流式也能出 runtime surface
            debug: { ...(event as { debug?: JsonObject }).debug, route: lastRoute ?? (event as { debug?: { route?: unknown } }).debug?.route ?? null }
          };
          await translator.finalize(enriched);
          const decorated = await this.chatService.decorateChatResult(enriched, {
            clientCapabilities: dto.client_capabilities,
            includeRuntime: dto.debug === true
          });
          await emit({ ...decorated, trace_id: traceId, session_id: sessionId, run_id: runId } as A2UISseEventDto);
          return;
        }
        await emit({ ...event, trace_id: traceId } as A2UISseEventDto);
      }
    });
  }

  async history(input: { userId: string; sessionId: string; runId?: string; sinceSeq?: number }): Promise<JsonObject> {
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
    envelope: A2UIEnvelope,
    emit: (event: A2UISseEventDto, sseId?: string) => void | Promise<void>
  ): Promise<PersistedEnvelope> {
    const persisted = await this.chatService.appendEnvelope({
      user, sessionId, runId, traceId, envelope
    });
    const sseId = `${runId}:${persisted.seq}`;
    await emit({
      type: "a2ui_envelope",
      seq: persisted.seq,
      run_id: runId,
      session_id: sessionId,
      trace_id: traceId,
      ts: persisted.ts,
      envelope
    } as unknown as A2UISseEventDto, sseId);
    return persisted;
  }

  private async replayHistory(
    userId: string,
    sessionId: string,
    sinceSeq: number,
    emit: (event: A2UISseEventDto, sseId?: string) => void | Promise<void>,
    traceId: string
  ): Promise<void> {
    const latest = await this.chatService.historyLatest(userId, sessionId);
    if (!latest) {
      await emit({ type: "a2ui_replay_empty", trace_id: traceId } as unknown as A2UISseEventDto);
      return;
    }
    const items = latest.envelopes.filter((item) => item.seq > sinceSeq);
    for (const item of items) {
      await emit({
        type: "a2ui_envelope",
        seq: item.seq,
        run_id: latest.run_id,
        session_id: latest.session_id,
        trace_id: latest.trace_id ?? traceId,
        ts: item.ts,
        envelope: item.envelope,
        replayed: true
      } as unknown as A2UISseEventDto, `${latest.run_id}:${item.seq}`);
    }
    await emit({
      type: "a2ui_replay_done",
      run_id: latest.run_id,
      session_id: latest.session_id,
      last_seq: latest.envelopes[latest.envelopes.length - 1]?.seq ?? sinceSeq,
      trace_id: traceId
    } as unknown as A2UISseEventDto);
  }
}

function toQueryInput(dto: A2UIChatRequestDto) {
  return {
    userId: dto.user_id,
    userContext: dto.user_context,
    wecomUserId: dto.wecom_userid,
    message: dto.message,
    sessionId: dto.session_id,
    debug: dto.debug === true
  };
}

function toActionInput(dto: A2UIActionRequestDto) {
  return {
    userId: dto.user_id,
    sessionId: dto.session_id,
    clientActionId: dto.client_action_id,
    action: dto.action
  };
}
