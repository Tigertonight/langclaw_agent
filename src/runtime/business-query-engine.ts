import { createDefaultSessionId } from "../agent/session-store.js";
import { TranscriptStore } from "../transcript/transcript-store.js";
import type { JsonObject, JsonValue, UserContext } from "../types/agent-contracts.js";
import type { EvolutionTurnInput } from "../evolution/types.js";
import { ContextAssembler } from "./context-assembler.js";
import type { RuntimeHooks } from "./hooks.js";
import { resolveUserWorkspace, type WorkspaceContext } from "./workspace-context.js";

interface BusinessAgent {
  run(input: { userId?: string; userContext?: Record<string, unknown>; wecomUserId?: string; message: string; sessionId?: string; runId?: string; debug?: boolean }): Promise<unknown>;
}

interface StreamAgent {
  runStream(input: { userId?: string; userContext?: Record<string, unknown>; wecomUserId?: string; message: string; sessionId?: string; runId?: string; debug?: boolean; onEvent?: (event: JsonObject) => Promise<void> | void }): Promise<unknown>;
}

interface UserContextResolverLike {
  resolve(input: { userId?: string; userContext?: Record<string, unknown>; wecomUserId?: string }): Promise<UserContext>;
}

interface EnterpriseContextProviderLike {
  load(input: { user: UserContext; workspace: WorkspaceContext; message?: string; sessionId?: string }): Promise<unknown>;
}

interface EvolutionRuntimeLike {
  collectTurn(input: EvolutionTurnInput): void;
}

interface SessionStoreLike {
  get(sessionId: string, workspace: WorkspaceContext): Promise<Record<string, unknown>>;
}

export interface QueryEngineInput {
  userId?: string;
  userContext?: Record<string, unknown>;
  wecomUserId?: string;
  message: string;
  sessionId?: string;
  debug?: boolean;
}

export interface QueryEngineStreamInput extends QueryEngineInput {
  onEvent?: (event: JsonObject) => Promise<void> | void;
}

export interface QueryEngineResult extends JsonObject {
  session_id: string;
  run_id: string;
  answer: string;
  output: JsonValue;
  execution_plan?: JsonObject;
  trace: JsonObject;
  context_budget: JsonObject;
}

/**
 * BusinessQueryEngine — Phase 1 升级版
 *
 * 升级要点：
 * 1. submitMessage() 在调用 orchestrator 前后各写一次 transcript（turn_start / turn_end）
 * 2. submitMessage() 完成后调用 scheduleEvolution() 触发 Evolution 判断
 * 3. submitMessage() 完成后写 token 使用量追踪
 * 4. 新增 submitStream() 包装流式路径，让流式也通过 QueryEngine 管理生命周期
 * 5. loadSession() 从 sessionStore 读取当前会话快照（用于 buildContext 阶段）
 * 6. trackUsage() 统计本轮 token / chars 使用量
 *
 * Phase 0 的 orchestrator.finish() 里已通过 hooks.emit("turn_end") 写 transcript，
 * BusinessQueryEngine 这层只额外写 "turn_start" 和 "query_engine_summary" 两个事件，
 * 避免与 transcript-plugin 重复写 user_message / tool_call / assistant_answer。
 */
export class BusinessQueryEngine {
  private readonly agent: BusinessAgent;
  private readonly streamAgent?: StreamAgent;
  private readonly userContextResolver: UserContextResolverLike;
  private readonly enterpriseContextProvider: EnterpriseContextProviderLike;
  private readonly contextAssembler: ContextAssembler;
  private readonly hooks?: RuntimeHooks;
  private readonly transcriptStore: TranscriptStore;
  private readonly evolutionRuntime?: EvolutionRuntimeLike;
  private readonly sessionStore?: SessionStoreLike;

  constructor({
    agent,
    streamAgent,
    userContextResolver,
    enterpriseContextProvider,
    contextAssembler = new ContextAssembler(),
    hooks,
    transcriptStore = new TranscriptStore(),
    evolutionRuntime,
    sessionStore
  }: {
    agent: BusinessAgent;
    streamAgent?: StreamAgent;
    userContextResolver: UserContextResolverLike;
    enterpriseContextProvider: EnterpriseContextProviderLike;
    contextAssembler?: ContextAssembler;
    hooks?: RuntimeHooks;
    transcriptStore?: TranscriptStore;
    evolutionRuntime?: EvolutionRuntimeLike;
    sessionStore?: SessionStoreLike;
  }) {
    this.agent = agent;
    this.streamAgent = streamAgent;
    this.userContextResolver = userContextResolver;
    this.enterpriseContextProvider = enterpriseContextProvider;
    this.contextAssembler = contextAssembler;
    this.hooks = hooks;
    this.transcriptStore = transcriptStore;
    this.evolutionRuntime = evolutionRuntime;
    this.sessionStore = sessionStore;
  }

  /**
   * submitMessage() — 非流式入口
   *
   * 生命周期：
   *   resolve_user → load_session → ingest_enterprise_context → assemble_context
   *   → write transcript(turn_start) → run orchestrator → write transcript(query_engine_summary)
   *   → schedule_evolution → track_usage → return
   */
  async submitMessage(input: QueryEngineInput): Promise<QueryEngineResult> {
    const startedAt = Date.now();
    const runId = createRunId();

    // 1. 解析用户身份
    const user = await this.userContextResolver.resolve({
      userId: input.userId,
      userContext: input.userContext,
      wecomUserId: input.wecomUserId
    });
    const workspace = resolveUserWorkspace(user);
    const sessionId = input.sessionId ?? createDefaultSessionId(user.id);

    // 2. 加载当前会话快照（用于 context building 和 evolution）
    const session = await this.loadSession(sessionId, workspace);

    // 3. 加载企业上下文（memory / tasks / admin）
    let enterpriseContext: unknown = {};
    let ingestError: Error | null = null;
    try {
      enterpriseContext = await this.enterpriseContextProvider.load({
        user,
        workspace,
        message: input.message,
        sessionId
      });
    } catch (error) {
      ingestError = error instanceof Error ? error : new Error(String(error));
      console.warn(`[query-engine] enterpriseContextProvider.load failed for user=${user.id}: ${ingestError.message}`);
    }

    await this.hooks?.emit("context_ingest", {
      user_id: user.id,
      session_id: sessionId,
      run_id: runId,
      stage: "ingest",
      sources: summarizeIngestSources(enterpriseContext),
      error: ingestError ? { name: ingestError.name, message: ingestError.message } : null,
      degraded: ingestError !== null
    });

    // 4. 组装上下文并计算 token budget
    const assembled = this.contextAssembler.assemble({
      user,
      workspace,
      message: input.message,
      enterpriseContext
    });

    await this.hooks?.emit("context_assembly", {
      user_id: user.id,
      session_id: sessionId,
      run_id: runId,
      budget: assembled.budget,
      sections: assembled.sections.map((s) => ({
        name: s.name,
        chars: s.chars,
        priority: s.priority,
        stage: s.stage
      })),
      dropped: assembled.dropped,
      estimated_tokens: assembled.estimated_tokens,
      prompt_authority: assembled.prompt_authority,
      stages: assembled.stages
    });

    // 5. 写 turn_start transcript（QueryEngine 层面的生命周期标记）
    await this.appendTurnStart(workspace, sessionId, runId, input.message, session);

    // 6. 调用 orchestrator 执行本轮对话
    const output = await this.agent.run({
      userId: input.userId,
      userContext: input.userContext,
      wecomUserId: input.wecomUserId,
      message: input.message,
      sessionId,
      runId,
      debug: input.debug
    });

    const record = output && typeof output === "object" && !Array.isArray(output) ? output as Record<string, unknown> : {};
    const answer = String(record.answer ?? "");
    const latencyMs = Date.now() - startedAt;

    // 7. 写 query_engine_summary transcript（跨越 orchestrator 的 QueryEngine 层汇总）
    await this.appendQueryEngineSummary(workspace, sessionId, runId, {
      message: input.message,
      answer,
      latencyMs,
      contextBudget: assembled.budget,
      estimatedTokens: assembled.estimated_tokens,
      dropped: assembled.dropped
    });

    // 8. 追踪 usage
    this.trackUsage({
      userId: user.id,
      sessionId,
      runId,
      latencyMs,
      estimatedTokens: assembled.estimated_tokens,
      contextChars: Number(assembled.budget?.used_chars ?? 0)
    });

    // 9. 触发 Evolution 判断（异步，不阻塞返回）
    this.scheduleEvolution({
      user,
      workspace,
      sessionId,
      message: input.message,
      answer,
      route: extractRoute(record),
      toolPlan: extractToolPlan(record),
      toolResults: extractToolResults(record),
      enterpriseContext,
      agentSteps: extractAgentSteps(record)
    });

    return {
      session_id: String(record.session_id ?? sessionId),
      run_id: String(record.run_id ?? runId),
      user_message: input.message,
      answer,
      output: normalizeJson(output),
      context_budget: assembled.budget,
      execution_plan: buildExecutionPlan(record),
      trace: {
        engine: "business_query_engine",
        run_id: runId,
        user_id: user.id,
        workspace_user_id: workspace.user_id,
        latency_ms: latencyMs,
        estimated_tokens: assembled.estimated_tokens,
        context_sections: assembled.sections.map((s) => ({
          name: s.name,
          chars: s.chars,
          priority: s.priority
        })),
        context_dropped: assembled.dropped,
        task_retrieval: summarizeTaskRetrieval(enterpriseContext),
        source_attribution: summarizeSourceAttribution(record)
      }
    };
  }

  /**
   * submitStream() — 流式入口（Phase 1 新增）
   *
   * 将流式路径也通过 QueryEngine 管理生命周期：
   *   resolve_user → ingest_enterprise_context → assemble_context
   *   → write transcript(turn_start) → run streamAgent → track_usage → schedule_evolution
   *
   * 注：流式路径的 transcript 写入（user_message / tool_call / assistant_answer / turn_end）
   * 已由 orchestrator 通过 hooks.emit("turn_end") → transcript-plugin 处理，
   * QueryEngine 只额外写 turn_start 和 query_engine_summary。
   */
  async submitStream(input: QueryEngineStreamInput): Promise<unknown> {
    if (!this.streamAgent) {
      throw new Error("[query-engine] streamAgent 未配置，无法执行流式调用。");
    }

    const startedAt = Date.now();
    const runId = createRunId();

    const user = await this.userContextResolver.resolve({
      userId: input.userId,
      userContext: input.userContext,
      wecomUserId: input.wecomUserId
    });
    const workspace = resolveUserWorkspace(user);
    const sessionId = input.sessionId ?? createDefaultSessionId(user.id);
    const session = await this.loadSession(sessionId, workspace);

    let enterpriseContext: unknown = {};
    let ingestError: Error | null = null;
    try {
      enterpriseContext = await this.enterpriseContextProvider.load({
        user,
        workspace,
        message: input.message,
        sessionId
      });
    } catch (error) {
      ingestError = error instanceof Error ? error : new Error(String(error));
      console.warn(`[query-engine] stream enterpriseContextProvider.load failed for user=${user.id}: ${ingestError.message}`);
    }

    await this.hooks?.emit("context_ingest", {
      user_id: user.id,
      session_id: sessionId,
      run_id: runId,
      stage: "ingest",
      sources: summarizeIngestSources(enterpriseContext),
      error: ingestError ? { name: ingestError.name, message: ingestError.message } : null,
      degraded: ingestError !== null
    });

    const assembled = this.contextAssembler.assemble({
      user,
      workspace,
      message: input.message,
      enterpriseContext
    });

    await this.hooks?.emit("context_assembly", {
      user_id: user.id,
      session_id: sessionId,
      run_id: runId,
      budget: assembled.budget,
      sections: assembled.sections.map((s) => ({
        name: s.name,
        chars: s.chars,
        priority: s.priority,
        stage: s.stage
      })),
      dropped: assembled.dropped,
      estimated_tokens: assembled.estimated_tokens,
      prompt_authority: assembled.prompt_authority,
      stages: assembled.stages
    });

    await this.appendTurnStart(workspace, sessionId, runId, input.message, session);

    let lastAnswer = "";
    let lastRecord: Record<string, unknown> = {};

    const wrappedOnEvent = async (event: JsonObject) => {
      // 拦截 done 事件以获取 answer 用于 evolution
      if (event.type === "done") {
        const rec = event && typeof event === "object" && !Array.isArray(event) ? event as Record<string, unknown> : {};
        lastAnswer = String(rec.answer ?? "");
        lastRecord = rec;
      }
      await input.onEvent?.(event);
    };

    const output = await this.streamAgent.runStream({
      userId: input.userId,
      userContext: input.userContext,
      wecomUserId: input.wecomUserId,
      message: input.message,
      sessionId,
      runId,
      debug: input.debug,
      onEvent: wrappedOnEvent
    });

    const latencyMs = Date.now() - startedAt;

    await this.appendQueryEngineSummary(workspace, sessionId, runId, {
      message: input.message,
      answer: lastAnswer,
      latencyMs,
      contextBudget: assembled.budget,
      estimatedTokens: assembled.estimated_tokens,
      dropped: assembled.dropped
    });

    this.trackUsage({
      userId: user.id,
      sessionId,
      runId,
      latencyMs,
      estimatedTokens: assembled.estimated_tokens,
      contextChars: Number(assembled.budget?.used_chars ?? 0)
    });

    this.scheduleEvolution({
      user,
      workspace,
      sessionId,
      message: input.message,
      answer: lastAnswer,
      route: extractRoute(lastRecord),
      toolPlan: extractToolPlan(lastRecord),
      toolResults: extractToolResults(lastRecord),
      enterpriseContext,
      agentSteps: extractAgentSteps(lastRecord)
    });

    return output;
  }

  /**
   * loadSession() — 从 sessionStore 读取当前会话快照
   *
   * 供 buildContext 阶段和 evolution judge 使用。
   * 若 sessionStore 未配置则返回空的最小快照（不影响主流程）。
   */
  async loadSession(sessionId: string, workspace: WorkspaceContext): Promise<Record<string, unknown>> {
    if (!this.sessionStore) return { id: sessionId };
    try {
      return await this.sessionStore.get(sessionId, workspace) as Record<string, unknown>;
    } catch (error) {
      console.warn(`[query-engine] loadSession failed for session=${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
      return { id: sessionId };
    }
  }

  /**
   * scheduleEvolution() — 触发本轮的 Evolution 判断
   *
   * 通过 evolutionRuntime.collectTurn() 提交本轮 signal，
   * evolutionRuntime 内部通过 debounce 决定何时真正跑 LLM Judge。
   */
  scheduleEvolution(input: {
    user: UserContext;
    workspace: WorkspaceContext;
    sessionId: string;
    message: string;
    answer: string;
    route?: unknown;
    toolPlan?: unknown;
    toolResults?: unknown[];
    enterpriseContext?: unknown;
    agentSteps?: unknown[];
  }): void {
    if (!this.evolutionRuntime) return;
    try {
      const turnInput: EvolutionTurnInput = {
        trigger: "agent_finish",
        user: input.user,
        workspace: input.workspace,
        sessionId: input.sessionId,
        message: input.message,
        answer: input.answer,
        route: toRecord(input.route),
        toolPlan: { calls: [] },
        toolResults: [],
        enterpriseContext: input.enterpriseContext,
        agentSteps: (Array.isArray(input.agentSteps) ? input.agentSteps : []) as Array<Record<string, unknown>>
      };
      this.evolutionRuntime.collectTurn(turnInput);
    } catch (error) {
      console.warn(`[query-engine] scheduleEvolution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * trackUsage() — 记录本轮的资源使用量
   *
   * 当前是轻量日志记录，Phase 3 Token Budget 阶段会在这里挂接真正的 token 计量和预警。
   */
  trackUsage(input: {
    userId: string;
    sessionId: string;
    runId: string;
    latencyMs: number;
    estimatedTokens: number;
    contextChars: number;
  }): void {
    // Phase 3 会在这里挂接 token 计量器；当前只做日志。
    // 避免影响主对话，不 await，不抛错。
    this.hooks?.emit("query_engine_usage" as never, {
      user_id: input.userId,
      session_id: input.sessionId,
      run_id: input.runId,
      latency_ms: input.latencyMs,
      estimated_tokens: input.estimatedTokens,
      context_chars: input.contextChars
    } as JsonObject).catch(() => undefined);
  }

  // ---- 私有：transcript 写入 ----

  private async appendTurnStart(
    workspace: WorkspaceContext,
    sessionId: string,
    runId: string,
    message: string,
    session: Record<string, unknown>
  ): Promise<void> {
    try {
      await this.transcriptStore.append(workspace, sessionId, "turn_start", {
        run_id: runId,
        engine: "business_query_engine",
        message_preview: message.slice(0, 300),
        session_status: typeof session.status === "string" ? session.status : "unknown",
        session_active_intent: typeof session.active_intent === "string" ? session.active_intent : null
      });
    } catch (error) {
      console.warn(`[query-engine] appendTurnStart failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async appendQueryEngineSummary(
    workspace: WorkspaceContext,
    sessionId: string,
    runId: string,
    input: {
      message: string;
      answer: string;
      latencyMs: number;
      contextBudget: JsonObject;
      estimatedTokens: number;
      dropped: JsonObject[];
    }
  ): Promise<void> {
    try {
      await this.transcriptStore.append(workspace, sessionId, "turn_end", {
        run_id: runId,
        engine: "business_query_engine",
        message_preview: input.message.slice(0, 300),
        answer_preview: input.answer.slice(0, 600),
        latency_ms: input.latencyMs,
        estimated_tokens: input.estimatedTokens,
        context_budget: input.contextBudget,
        context_dropped_count: input.dropped.length
      });
    } catch (error) {
      console.warn(`[query-engine] appendQueryEngineSummary failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

// ---- 内部工具函数 ----

function createRunId(): string {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
}

function extractRoute(record: Record<string, unknown>): unknown {
  const debug = toRecord(record.debug);
  return debug.route ?? record.route ?? {};
}

function extractToolPlan(record: Record<string, unknown>): unknown {
  const debug = toRecord(record.debug);
  const calls = Array.isArray(debug.tool_calls) ? debug.tool_calls : [];
  return { calls };
}

function extractToolResults(record: Record<string, unknown>): unknown[] {
  const debug = toRecord(record.debug);
  return Array.isArray(debug.tool_results) ? debug.tool_results as unknown[] : [];
}

function extractAgentSteps(record: Record<string, unknown>): unknown[] {
  const debug = toRecord(record.debug);
  return Array.isArray(debug.agent_steps) ? debug.agent_steps as unknown[] : [];
}

function buildExecutionPlan(output: Record<string, unknown>): JsonObject {
  const debug = toRecord(output.debug);
  const route = toRecord(debug.route);
  const toolCalls = Array.isArray(debug.tool_calls) ? debug.tool_calls as Array<Record<string, unknown>> : [];
  const steps = Array.isArray(debug.steps) ? debug.steps as Array<Record<string, unknown>>
    : Array.isArray(debug.agent_steps) ? debug.agent_steps as Array<Record<string, unknown>> : [];
  return {
    objective: String(output.answer ?? "").slice(0, 160),
    route: {
      intent_code: stringifyOrNull(route.intent_code),
      execution_class: stringifyOrNull(route.execution_class),
      handler_type: stringifyOrNull(route.handler_type),
      confidence: stringifyOrNull(route.confidence)
    },
    tools: toolCalls.map((call) => ({
      name: stringifyOrNull(call.name),
      resource: stringifyOrNull(call.resource),
      operation: stringifyOrNull(call.operation)
    })),
    steps: steps.map((step) => ({
      phase: stringifyOrNull(step.phase ?? step.id ?? step.type),
      status: stringifyOrNull(step.status) ?? "completed",
      title: stringifyOrNull(step.title)
    })),
    requires_followup: /需要|请补充|确认|等待/.test(String(output.answer ?? ""))
  };
}

function stringifyOrNull(value: unknown): string | null {
  return value == null ? null : String(value);
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function summarizeTaskRetrieval(enterpriseContext: unknown): JsonObject {
  const enterprise = toRecord(enterpriseContext);
  const tasks = toRecord(enterprise.tasks);
  const relevant = Array.isArray(tasks.relevant) ? tasks.relevant as Array<Record<string, unknown>> : [];
  return {
    relevant_count: relevant.length,
    top: relevant.slice(0, 3).map((task) => ({
      id: stringifyOrNull(task.id),
      task_list_id: stringifyOrNull(task.task_list_id),
      subject: stringifyOrNull(task.subject),
      status: stringifyOrNull(task.status),
      priority: stringifyOrNull(task.priority),
      next_action: stringifyOrNull(task.next_action),
      updated_at: stringifyOrNull(task.updated_at),
      relevance: typeof task.relevance === "number" ? task.relevance : null,
      reason: stringifyOrNull(task.reason)
    }))
  };
}

function summarizeIngestSources(enterpriseContext: unknown): JsonObject {
  const record = toRecord(enterpriseContext);
  const summary: JsonObject = {};
  for (const [key, value] of Object.entries(record)) {
    summary[key] = describeIngestValue(value);
  }
  return summary;
}

function describeIngestValue(value: unknown): JsonObject {
  if (value === null || value === undefined) return { kind: "empty", chars: 0 };
  if (Array.isArray(value)) return { kind: "array", count: value.length, chars: JSON.stringify(value).length };
  if (typeof value === "object") return { kind: "object", keys: Object.keys(value as object).length, chars: JSON.stringify(value).length };
  if (typeof value === "string") return { kind: "string", chars: value.length };
  return { kind: typeof value, chars: String(value).length };
}

function summarizeSourceAttribution(output: Record<string, unknown>): JsonObject {
  const sources = Array.isArray(output.sources) ? output.sources as Array<Record<string, unknown>> : [];
  return {
    source_count: sources.length,
    sources: sources.slice(0, 5).map((source) => ({
      id: stringifyOrNull(source.id),
      source: stringifyOrNull(source.source),
      title: stringifyOrNull(source.title),
      heading: stringifyOrNull(source.heading),
      score: typeof source.score === "number" ? source.score : null
    }))
  };
}
