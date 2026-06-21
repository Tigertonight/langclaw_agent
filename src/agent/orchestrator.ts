import { summarizeUser } from "../auth/users.js";
import { appendAuditEvent, appendConversationLog } from "../logs/logger.js";
import { composeReportFromRegistry, getRuntimeRegistry, inferSkillFromRegistry, getIntentForIntentCode } from "../domains/runtime-registry.js";

const RECENT_MESSAGES_LIMIT = 5;
const RECENT_ROUTES_LIMIT = 3;
const RECENT_TTL_MS = 30 * 60 * 1000; // 30 分钟

interface RecentItem {
  ts?: string;
  [key: string]: JsonValue | undefined;
}

function pruneByTtl(list: unknown, now: number): RecentItem[] {
  if (!Array.isArray(list)) return [];
  return list.filter((item) => {
    const record = item && typeof item === "object" ? item as RecentItem : {};
    const ts = Date.parse(record.ts ?? "");
    return Number.isFinite(ts) && now - ts <= RECENT_TTL_MS;
  }) as RecentItem[];
}

function pushRecentMessage(session: AgentSession | undefined, message: string, now: Date): RecentItem[] {
  const list = pruneByTtl(session?.recent_messages, now.getTime());
  list.push({ message, ts: now.toISOString() });
  return list.slice(-RECENT_MESSAGES_LIMIT);
}

function pushRecentRoute(session: AgentSession | undefined, route: Route | LegacyRoute, now: Date): RecentItem[] {
  const list = pruneByTtl(session?.recent_routes, now.getTime());
  list.push({ intent_code: route.intent_code, params: route.params ?? {}, ts: now.toISOString() });
  return list.slice(-RECENT_ROUTES_LIMIT);
}
import { createAgentStep, createIdentifyUserStep, createSources, createToolSteps, splitForStreaming } from "../runtime/agent-events.js";
import { buildConversationContext, summarizeConversationContext } from "../runtime/conversation-context.js";
import { WorkflowRunner } from "../runtime/workflow-runner.js";
import { resolveUserWorkspace, type WorkspaceContext } from "../runtime/workspace-context.js";
import { RuntimeHooks } from "../runtime/hooks.js";
import { TranscriptStore } from "../transcript/transcript-store.js";
import type { EvolutionRuntime } from "../evolution/runtime.js";
import { isAutonomousPlanning, isControlledExecution } from "../router/execution-class.js";
import { checkToolPermission } from "../auth/permissions.js";
import { INTENTS } from "./ports.js";
import { createDefaultSessionId } from "./session-store.js";
import { decideOpenUILangEligibility, isOpenUILangDelegateToolResult } from "../openui-lang/index.js";
import { normalizeSelectedDomain } from "../domains/domain-isolation.js";
import type { AgentSession, SessionHistoryItem } from "./session-store.js";
import type { AgentStep } from "../runtime/agent-events.js";
import type { JsonObject, JsonValue, Route, ToolCall, ToolPlan, ToolResult, UserContext } from "../types/agent-contracts.js";

type EmitFn = (event: Record<string, unknown>) => Promise<void> | void;
type OrchestratorStep = Record<string, unknown>;
type PushStepFn = (step: OrchestratorStep) => Promise<void> | void;
type WorkflowSessionLike = Parameters<WorkflowRunner["canResume"]>[0];
type WorkflowRouteLike = Parameters<WorkflowRunner["shouldContinueActive"]>[0]["route"];

interface RunInput {
  userId?: string;
  userContext?: Record<string, unknown>;
  wecomUserId?: string;
  message: string;
  domainId?: string;
  sessionId?: string;
  runId?: string;
  debug?: boolean;
}

interface RunStreamInput extends RunInput {
  onEvent?: EmitFn;
}

interface OrchestratorServices {
  llm: {
    generateAnswer(input: Record<string, unknown>): Promise<{ answer: string; artifacts?: JsonValue[] }>;
  };
  knowledgeBase?: unknown;
  toolRegistry: {
    execute(call: ToolCall, context?: Record<string, unknown>): Promise<unknown>;
    list(input?: Record<string, unknown>): Array<{ name: string }>;
  };
  primitiveRegistry?: {
    list(input?: Record<string, unknown>): Array<{ name: string }>;
  };
  sessionStore: {
    get(sessionId: string, workspace: WorkspaceContext): Promise<AgentSession>;
    save(session: AgentSession, workspace: WorkspaceContext): Promise<void>;
    clear?(sessionId: string, workspace: WorkspaceContext): Promise<void>;
  };
  scenarioRouter: unknown;
  userContextResolver: {
    resolve(input: { userId?: string; userContext?: Record<string, unknown>; wecomUserId?: string }): Promise<UserContext>;
  };
  skillRuntime?: {
    select(input: Record<string, unknown>): Promise<unknown> | unknown;
  } | null;
  enterpriseContextProvider?: {
    load(input: { user: UserContext; workspace: WorkspaceContext; message?: string; sessionId?: string }): Promise<unknown>;
  } | null;
  intentRouter?: {
    route(input: Record<string, unknown>): Promise<Route>;
  } | null;
  intentQueryHandler?: {
    execute(input: Record<string, unknown>): Promise<{
      answer: string;
      table?: { rows?: JsonObject[] };
      debug?: Record<string, unknown>;
      toolPlan: ToolPlan;
      toolResults: ToolResult[];
    }>;
  } | null;
  chitchatHandler?: {
    execute(input: Record<string, unknown>): Promise<{ answer: string }>;
  } | null;
  agenticHandler?: {
    execute(input: Record<string, unknown>): Promise<unknown>;
  } | null;
  evolutionRuntime?: EvolutionRuntime | null;
  transcriptStore?: TranscriptStore;
  hooks?: RuntimeHooks;
}

interface FlowInput {
  user: UserContext;
  workspace: WorkspaceContext;
  message: string;
  sessionId: string;
  session: AgentSession;
  route: Route | LegacyRoute;
  enterpriseContext?: unknown;
  conversationContext?: unknown;
  debug: boolean;
  startedAt: number;
  runId?: string;
  selectedDomain?: string;
}

interface StreamFlowInput extends FlowInput {
  emit: EmitFn;
  pushStep: PushStepFn;
  visibleSteps: OrchestratorStep[];
}

interface RouterErrorInput extends Omit<FlowInput, "route"> {
  error: unknown;
  route?: Route | LegacyRoute;
}

interface RouterErrorStreamInput extends Omit<StreamFlowInput, "route"> {
  error: unknown;
  route?: Route | LegacyRoute;
}

interface KnowledgeLookupResult {
  docs: Array<Record<string, unknown>>;
  toolPlan: ToolPlan;
  toolResults: ToolResult[];
  answer: string;
  artifacts: JsonValue[];
}

interface LegacyRoute extends JsonObject {
  intent?: string | null;
  confidence?: number | string;
  reason?: JsonValue;
  intent_code?: string;
  router?: string;
  router_source?: string;
  execution_class?: string;
  handler_type?: string;
  source?: string;
  params?: JsonObject;
}

interface FinishInput {
  user: UserContext;
  workspace: WorkspaceContext;
  sessionId: string;
  message: string;
  route: LegacyRoute | Route;
  docs: Array<Record<string, unknown>>;
  toolPlan: ToolPlan;
  toolResults: ToolResult[];
  answer: string;
  artifacts?: JsonValue[];
  scenarioDebug?: unknown;
  agentSteps?: OrchestratorStep[];
  agentState?: Record<string, unknown>;
  enterpriseContext?: unknown;
  conversationContext?: unknown;
  skills?: Array<Record<string, unknown>>;
  selectedSkill?: Record<string, unknown> | null;
  session?: AgentSession;
  debug: boolean;
  startedAt: number;
  runId?: string;
  agenticDebug?: Record<string, unknown>;
}

interface FinishStreamInput extends FinishInput {
  emit: EmitFn;
  answerAlreadyStreamed?: boolean;
}

export class SimpleWorkflowOrchestrator {
  private readonly llm: OrchestratorServices["llm"];
  private readonly knowledgeBase?: unknown;
  private readonly toolRegistry: OrchestratorServices["toolRegistry"];
  private readonly primitiveRegistry?: OrchestratorServices["primitiveRegistry"];
  private readonly sessionStore: OrchestratorServices["sessionStore"];
  private readonly scenarioRouter: OrchestratorServices["scenarioRouter"];
  private readonly userContextResolver: OrchestratorServices["userContextResolver"];
  private readonly skillRuntime: OrchestratorServices["skillRuntime"];
  private readonly enterpriseContextProvider: OrchestratorServices["enterpriseContextProvider"];
  private readonly intentRouter: OrchestratorServices["intentRouter"];
  private readonly intentQueryHandler: OrchestratorServices["intentQueryHandler"];
  private readonly chitchatHandler: OrchestratorServices["chitchatHandler"];
  private readonly agenticHandler: OrchestratorServices["agenticHandler"];
  private readonly evolutionRuntime: OrchestratorServices["evolutionRuntime"];
  private readonly transcriptStore: TranscriptStore;
  private readonly hooks: RuntimeHooks;
  private readonly workflowRunner: WorkflowRunner;

  constructor({ llm, knowledgeBase, toolRegistry, primitiveRegistry, sessionStore, scenarioRouter, userContextResolver, skillRuntime, enterpriseContextProvider, intentRouter, intentQueryHandler, chitchatHandler, agenticHandler, evolutionRuntime, transcriptStore, hooks }: OrchestratorServices) {
    this.llm = llm;
    this.knowledgeBase = knowledgeBase;
    this.toolRegistry = toolRegistry;
    this.primitiveRegistry = primitiveRegistry;
    this.sessionStore = sessionStore;
    this.scenarioRouter = scenarioRouter;
    this.userContextResolver = userContextResolver;
    this.skillRuntime = skillRuntime;
    this.enterpriseContextProvider = enterpriseContextProvider;
    this.intentRouter = intentRouter ?? null;
    this.intentQueryHandler = intentQueryHandler ?? null;
    this.chitchatHandler = chitchatHandler ?? null;
    this.agenticHandler = agenticHandler ?? null;
    this.evolutionRuntime = evolutionRuntime ?? null;
    this.transcriptStore = transcriptStore ?? new TranscriptStore();
    this.hooks = hooks ?? new RuntimeHooks();
    this.workflowRunner = new WorkflowRunner({
      scenarioRouter: scenarioRouter as ConstructorParameters<typeof WorkflowRunner>[0]["scenarioRouter"],
      applySessionPatch: (session, patch) => this.applySessionPatch(session as never, patch as unknown as Partial<AgentSession>)
    });
  }

  async run({ userId, userContext, wecomUserId, message, domainId, sessionId, runId, debug = false }: RunInput) {
    const startedAt = Date.now();
    const resolvedRunId = runId ?? createRunId();
    const user = await this.userContextResolver.resolve({ userId, userContext, wecomUserId });
    const workspace = resolveUserWorkspace(user);
    const selectedDomain = normalizeSelectedDomain(domainId ?? userContext?.domain_id ?? userContext?.selected_domain) ?? undefined;
    await this.hooks.emit("turn_start", { user_id: user.id, session_id: sessionId ?? createDefaultSessionId(user.id), run_id: resolvedRunId, message });
    const resolvedSessionId = sessionId ?? createDefaultSessionId(user.id);
    const enterpriseContext = await this.loadEnterpriseContext(user, workspace, message, resolvedSessionId);
    const session = await this.sessionStore.get(resolvedSessionId, workspace);
    applySessionDomainBoundary(session, selectedDomain);
    session.owner_user_id = user.id;
    const conversationContext = buildConversationContext({ session, currentMessage: message, enterpriseContext });

    if (this.workflowRunner.canResume(asWorkflowSession(session))) {
      const activeIntent = session.active_intent;
      if (this.workflowRunner.shouldContinueActive({ activeIntent, route: emptyWorkflowRoute(), message })) {
        const scenarioResult = await this.workflowRunner.runActive({ user, message, session: asWorkflowSession(session) });
        return this.finish({
          user,
          workspace,
          sessionId: resolvedSessionId,
          message,
          route: { intent: activeIntent, confidence: 1, reason: "继续当前多轮业务场景" },
          docs: [],
          toolPlan: { calls: [] },
          toolResults: normalizeToolResults(scenarioResult.toolResults),
          answer: String(scenarioResult.answer ?? ""),
          scenarioDebug: scenarioResult.debug,
          agentSteps: [this.workflowRunner.createResumeStep()],
          enterpriseContext,
          conversationContext,
          skills: [],
          session,
          debug,
          startedAt,
          runId: resolvedRunId
        });
      }
      await this.workflowRunner.reset(asWorkflowSession(session));
    }

    if (!this.intentRouter) {
      return this.finishRouterError({ user, workspace, sessionId: resolvedSessionId, message, session, enterpriseContext, conversationContext, debug, startedAt, runId: resolvedRunId, error: createRouterFailure("router_disabled", "Intent Router 未初始化。") });
    }

    const nowDate = new Date();
    const recentMessages = pruneByTtl(session?.recent_messages, nowDate.getTime());
    const recentRoutes = pruneByTtl(session?.recent_routes, nowDate.getTime());
    let routerResult;
    try {
      routerResult = await this.intentRouter.route({
        message,
        now: nowDate.toISOString(),
        user_context: { user_id: user.id, name: user.name, department: user.department, role: user.role, permissions: user.permissions },
        selected_domain: selectedDomain,
        session_state: {
          active_intent_code: session?.active_intent_code,
          last_route: session?.last_route ?? null,
          last_query_route: session?.last_query_route ?? null,
          recent_messages: recentMessages,
          recent_routes: recentRoutes
        }
      });
    } catch (error) {
      return this.finishRouterError({ user, workspace, sessionId: resolvedSessionId, message, session, enterpriseContext, conversationContext, debug, startedAt, runId: resolvedRunId, error });
    }
    await this.hooks.emit("route_decision", {
      user_id: user.id,
      session_id: resolvedSessionId,
      run_id: resolvedRunId,
      message,
      route: normalizeJsonValue(routerResult)
    });
    if (session) session.recent_messages = pushRecentMessage(session, message, nowDate);
    if (isControlledExecution(routerResult)) {
      const controlledResult = await this.runControlledExecution({
        user, workspace, message, sessionId: resolvedSessionId, session, route: routerResult,
        enterpriseContext, conversationContext, debug, startedAt, runId: resolvedRunId, selectedDomain
      });
      if (controlledResult) return controlledResult;
    }
    if (isAutonomousPlanning(routerResult) && this.agenticHandler) {
      return this.runAgentic({ user, workspace, message, sessionId: resolvedSessionId, session, route: routerResult, enterpriseContext, conversationContext, debug, startedAt, runId: resolvedRunId, selectedDomain });
    }
    return this.finishRouterError({
      user, workspace, sessionId: resolvedSessionId, message, session, enterpriseContext, conversationContext, debug, startedAt, runId: resolvedRunId,
      error: createRouterFailure("handler_unavailable", `Intent Router 已返回 ${routerResult.intent_code}，但当前没有可接管的 handler。`),
      route: routerResult
    });
  }

  async runStream({ userId, userContext, wecomUserId, message, domainId, sessionId, runId, debug = false, onEvent }: RunStreamInput) {
    const startedAt = Date.now();
    const resolvedRunId = runId ?? createRunId();
    const user = await this.userContextResolver.resolve({ userId, userContext, wecomUserId });
    const workspace = resolveUserWorkspace(user);
    const selectedDomain = normalizeSelectedDomain(domainId ?? userContext?.domain_id ?? userContext?.selected_domain) ?? undefined;
    await this.hooks.emit("turn_start", { user_id: user.id, session_id: sessionId ?? createDefaultSessionId(user.id), run_id: resolvedRunId, message });
    const resolvedSessionId = sessionId ?? createDefaultSessionId(user.id);
    const enterpriseContext = await this.loadEnterpriseContext(user, workspace, message, resolvedSessionId);
    const session = await this.sessionStore.get(resolvedSessionId, workspace);
    applySessionDomainBoundary(session, selectedDomain);
    session.owner_user_id = user.id;
    const conversationContext = buildConversationContext({ session, currentMessage: message, enterpriseContext });

    const emit = async (event: Record<string, unknown>) => onEvent?.(event);
    const visibleSteps: OrchestratorStep[] = [];
    let thinkingText = "";
    const pushStep = async (step: OrchestratorStep) => {
      visibleSteps.push(step);
      const line = `${visibleSteps.length}. ${step.title}：${step.detail}`;
      thinkingText = visibleSteps.map((item, index) => `${index + 1}. ${item.title}：${item.detail}`).join("\n");
      await emit({ type: "thinking", text: thinkingText, delta: line + "\n", step });
    };

    await pushStep(createAgentStep("classify_intent", "理解你的问题", "正在判断问题类型和需要的上下文。", { status: "running" }));

    if (this.workflowRunner.canResume(asWorkflowSession(session))) {
      const activeIntent = session.active_intent;
      if (this.workflowRunner.shouldContinueActive({ activeIntent, route: emptyWorkflowRoute(), message })) {
        const scenarioResult = await this.workflowRunner.runActive({ user, message, session: asWorkflowSession(session) });
        await pushStep(this.workflowRunner.createResumeStep());
        return this.finishStream({
          user,
          workspace,
          sessionId: resolvedSessionId,
          message,
          route: { intent: activeIntent, confidence: 1, reason: "继续当前多轮业务场景" },
          docs: [],
          toolPlan: { calls: [] },
          toolResults: normalizeToolResults(scenarioResult.toolResults),
          answer: String(scenarioResult.answer ?? ""),
          scenarioDebug: scenarioResult.debug,
          agentSteps: visibleSteps,
          enterpriseContext,
          skills: [],
          session,
          debug,
          startedAt,
          runId: resolvedRunId,
          emit
        });
      }
      await this.workflowRunner.reset(asWorkflowSession(session));
      await pushStep(this.workflowRunner.createSwitchStep());
    }

    if (!this.intentRouter) {
      return this.finishRouterErrorStream({ user, workspace, sessionId: resolvedSessionId, message, session, enterpriseContext, conversationContext, debug, startedAt, runId: resolvedRunId, emit, pushStep, visibleSteps, error: createRouterFailure("router_disabled", "Intent Router 未初始化。") });
    }

    const nowDate = new Date();
    const recentMessages = pruneByTtl(session?.recent_messages, nowDate.getTime());
    const recentRoutes = pruneByTtl(session?.recent_routes, nowDate.getTime());
    let routerResult;
    try {
      routerResult = await this.intentRouter.route({
        message,
        now: nowDate.toISOString(),
        user_context: { user_id: user.id, name: user.name, department: user.department, role: user.role, permissions: user.permissions },
        selected_domain: selectedDomain,
        session_state: {
          active_intent_code: session?.active_intent_code,
          last_route: session?.last_route ?? null,
          last_query_route: session?.last_query_route ?? null,
          recent_messages: recentMessages,
          recent_routes: recentRoutes
        }
      });
    } catch (error) {
      return this.finishRouterErrorStream({ user, workspace, sessionId: resolvedSessionId, message, session, enterpriseContext, conversationContext, debug, startedAt, runId: resolvedRunId, emit, pushStep, visibleSteps, error });
    }
    await this.hooks.emit("route_decision", {
      user_id: user.id,
      session_id: resolvedSessionId,
      run_id: resolvedRunId,
      message,
      route: normalizeJsonValue(routerResult)
    });
    if (session) session.recent_messages = pushRecentMessage(session, message, nowDate);
    if (isControlledExecution(routerResult)) {
      const controlledResult = await this.runControlledExecutionStream({
        user, workspace, message, sessionId: resolvedSessionId, session, route: routerResult,
        enterpriseContext, conversationContext, debug, startedAt, runId: resolvedRunId, selectedDomain, emit, pushStep, visibleSteps
      });
      if (controlledResult) return controlledResult;
    }
    if (isAutonomousPlanning(routerResult) && this.agenticHandler) {
      return this.runAgenticStream({
        user, workspace, message, sessionId: resolvedSessionId, session, route: routerResult,
        enterpriseContext, conversationContext, debug, startedAt, runId: resolvedRunId, selectedDomain, emit, pushStep, visibleSteps
      });
    }
    return this.finishRouterErrorStream({
      user, workspace, sessionId: resolvedSessionId, message, session, enterpriseContext, conversationContext, debug, startedAt, runId: resolvedRunId, emit, pushStep, visibleSteps,
      error: createRouterFailure("handler_unavailable", `Intent Router 已返回 ${routerResult.intent_code}，但当前没有可接管的 handler。`),
      route: routerResult
    });
  }

  async finishRouterError({ user, workspace, sessionId, message, session, enterpriseContext, conversationContext, debug, startedAt, runId, error, route }: RouterErrorInput) {
    const errorRoute = createRouterErrorRoute(error, route);
    const answer = createRouterErrorAnswer(error);
    return this.finish({
      user,
      workspace,
      sessionId,
      message,
      route: errorRoute,
      docs: [],
      toolPlan: { calls: [] },
      toolResults: [],
      answer,
      agentSteps: [createAgentStep("router_error", "路由未完成", answer, { status: "failed" })],
      enterpriseContext,
      conversationContext,
      skills: [],
      session,
      debug,
      startedAt,
      runId
    });
  }

  async finishRouterErrorStream({ user, workspace, sessionId, message, session, enterpriseContext, conversationContext, debug, startedAt, runId, emit, pushStep, visibleSteps, error, route }: RouterErrorStreamInput) {
    const errorRoute = createRouterErrorRoute(error, route);
    const answer = createRouterErrorAnswer(error);
    await pushStep(createAgentStep("router_error", "路由未完成", answer, { status: "failed" }));
    await emit({ type: "route", route: errorRoute });
    return this.finishStream({
      user,
      workspace,
      sessionId,
      message,
      route: errorRoute,
      docs: [],
      toolPlan: { calls: [] },
      toolResults: [],
      answer,
      agentSteps: visibleSteps,
      enterpriseContext,
      conversationContext,
      skills: [],
      session,
      debug,
      startedAt,
      runId,
      emit
    });
  }

  async runControlledExecution({ user, workspace, message, sessionId, session, route, enterpriseContext, conversationContext, debug, startedAt, runId, selectedDomain }: FlowInput) {
    if (route.handler_type === "intent_query" && this.intentQueryHandler) {
      return this.runIntentQuery({ user, workspace, message, sessionId, session, route, enterpriseContext, conversationContext, debug, startedAt, runId, selectedDomain });
    }
    if (route.handler_type === "chitchat" && this.chitchatHandler) {
      return this.runChitchat({ user, workspace, message, sessionId, session, route, enterpriseContext, conversationContext, debug, startedAt, runId });
    }
    if (route.handler_type === "knowledge_lookup") {
      return this.runKnowledgeLookup({ user, workspace, message, sessionId, session, route, enterpriseContext, conversationContext, debug, startedAt, runId, selectedDomain });
    }
    if (route.handler_type === "workflow") {
      const workflowIntent = resolveWorkflowIntent(route);
      if (workflowIntent && this.workflowRunner.hasWorkflow(workflowIntent)) {
        const enrichedRoute = { ...route, intent: workflowIntent };
        return this.runWorkflowFromIntentRouter({ user, workspace, message, sessionId, session, route: enrichedRoute, enterpriseContext, conversationContext, debug, startedAt, runId, selectedDomain });
      }
    }
    return null;
  }

  async runControlledExecutionStream({ user, workspace, message, sessionId, session, route, enterpriseContext, conversationContext, debug, startedAt, runId, selectedDomain, emit, pushStep, visibleSteps }: StreamFlowInput) {
    await pushStep(createAgentStep("classify_intent", "识别任务类型", `Router 判定为 ${route.execution_class}/${route.handler_type}（${route.intent_code}, source=${route.source}）。`));
    await emit({ type: "route", route });

    if (route.handler_type === "intent_query" && this.intentQueryHandler) {
      const handlerResult = await this.intentQueryHandler.execute({
        user,
        workspace,
        message,
        intent_code: route.intent_code,
        params: route.params ?? {},
        route,
        session,
        selectedDomain
      });
      const legacyRoute = buildLegacyRoute(route, {
        reason: route.reasoning ?? "Intent Router → controlled_execution/intent_query"
      });
      if (session) {
        const nowDate = new Date();
        const snapshot = { intent_code: route.intent_code, params: route.params ?? {}, ts: nowDate.toISOString() };
        session.last_task = { intent_code: route.intent_code, params: route.params ?? {} };
        session.active_intent_code = route.intent_code;
        session.last_route = snapshot;
        session.last_query_route = snapshot;
        session.recent_routes = pushRecentRoute(session, route, nowDate);
      }
      if (handlerResult.debug?.denied) {
        await pushStep(createAgentStep("permission_denied", "权限已拦截", handlerResult.answer, { status: "failed" }));
        return this.finishStream({
          user,
          workspace,
          sessionId,
          message,
          route: legacyRoute,
          docs: [],
          toolPlan: handlerResult.toolPlan,
          toolResults: handlerResult.toolResults,
          answer: handlerResult.answer,
          artifacts: [],
          agentSteps: visibleSteps,
          enterpriseContext,
          conversationContext,
          skills: [],
          session,
          debug,
          startedAt,
          runId,
          emit
        });
      }
      const rowCount = handlerResult.debug?.row_count ?? handlerResult.table?.rows?.length ?? 0;
      await pushStep(createAgentStep("intent_query", "执行结构化查询", `命中 ${route.intent_code}，已生成确定性查询计划。`));
      for (const step of createToolSteps(handlerResult.toolPlan, handlerResult.toolResults)) {
        await pushStep(step);
      }
      await pushStep(createAgentStep("observe_result", "观察结果", `结构化查询返回 ${rowCount} 条记录，正在组织回答。`));
      return this.finishStream({
        user,
        workspace,
        sessionId,
        message,
        route: legacyRoute,
        docs: [],
        toolPlan: handlerResult.toolPlan,
        toolResults: handlerResult.toolResults,
        answer: handlerResult.answer,
        artifacts: [],
        agentSteps: visibleSteps,
        enterpriseContext,
        conversationContext,
        skills: [],
        session,
        debug,
        startedAt,
        runId,
        emit
      });
    }

    if (route.handler_type === "chitchat" && this.chitchatHandler) {
      const handlerResult = await this.chitchatHandler.execute({ user, message });
      if (session) {
        session.last_route = { intent_code: route.intent_code, params: route.params ?? {}, ts: new Date().toISOString() };
      }
      const legacyRoute = buildLegacyRoute(route, {
        reason: route.reasoning ?? "Intent Router → controlled_execution/chitchat",
        includeParams: false
      });
      await pushStep(createAgentStep("chitchat", "直接生成回答", "这是受控执行里的轻量交互，无需调用工具或检索知识库。"));
      return this.finishStream({
        user,
        workspace,
        sessionId,
        message,
        route: legacyRoute,
        docs: [],
        toolPlan: { calls: [] },
        toolResults: [],
        answer: handlerResult.answer,
        artifacts: [],
        agentSteps: visibleSteps,
        enterpriseContext,
        conversationContext,
        skills: [],
        session,
        debug,
        startedAt,
        runId,
        emit
      });
    }

    if (route.handler_type === "knowledge_lookup") {
      return this.runKnowledgeLookupStream({ user, workspace, message, sessionId, session, route, enterpriseContext, conversationContext, debug, startedAt, runId, selectedDomain, emit, pushStep, visibleSteps });
    }

    if (route.handler_type === "workflow") {
      const workflowIntent = resolveWorkflowIntent(route);
      if (workflowIntent && this.workflowRunner.hasWorkflow(workflowIntent)) {
        const enrichedRoute = { ...route, intent: workflowIntent };
        return this.runWorkflowFromIntentRouterStream({ user, workspace, message, sessionId, session, route: enrichedRoute, enterpriseContext, conversationContext, debug, startedAt, runId, selectedDomain, emit, pushStep, visibleSteps });
      }
    }

    return null;
  }

  async runKnowledgeLookup({ user, workspace, message, sessionId, session, route, enterpriseContext, conversationContext, debug, startedAt, runId, selectedDomain }: FlowInput) {
    const result = await this.executeKnowledgeLookup({ user, workspace, message, sessionId, runId, route, enterpriseContext, conversationContext, selectedDomain });
    const legacyRoute = createLegacyKnowledgeRoute(route);
    const agentSteps = [
      createIdentifyUserStep(user),
      createAgentStep("classify_intent", "识别任务类型", `Router 判定为 ${route.execution_class}/${route.handler_type}（${route.intent_code}, source=${route.source}）。`),
      ...createToolSteps(result.toolPlan, result.toolResults),
      createAgentStep("observe_result", "观察结果", `知识库命中 ${result.docs.length} 个片段，正在组织回答。`)
    ];
    if (session) {
      session.last_route = { intent_code: route.intent_code, params: route.params ?? {}, ts: new Date().toISOString() };
    }
    return this.finish({
      user,
      workspace,
      sessionId,
      message,
      route: legacyRoute,
      docs: result.docs,
      toolPlan: result.toolPlan,
      toolResults: result.toolResults,
      answer: result.answer,
      artifacts: result.artifacts,
      agentSteps,
      enterpriseContext,
      conversationContext,
      skills: [],
      session,
      debug,
      startedAt,
      runId
    });
  }

  async runKnowledgeLookupStream({ user, workspace, message, sessionId, session, route, enterpriseContext, conversationContext, debug, startedAt, runId, selectedDomain, emit, pushStep, visibleSteps }: StreamFlowInput) {
    await pushStep(createAgentStep("classify_intent", "识别任务类型", `Router 判定为 ${route.execution_class}/${route.handler_type}（${route.intent_code}, source=${route.source}）。`));
    await emit({ type: "route", route });
    const result = await this.executeKnowledgeLookup({ user, workspace, message, sessionId, runId, route, enterpriseContext, conversationContext, selectedDomain });
    for (const step of createToolSteps(result.toolPlan, result.toolResults)) {
      await pushStep(step);
    }
    await pushStep(createAgentStep("observe_result", "观察结果", `知识库命中 ${result.docs.length} 个片段，正在组织回答。`));
    if (session) {
      session.last_route = { intent_code: route.intent_code, params: route.params ?? {}, ts: new Date().toISOString() };
    }
    return this.finishStream({
      user,
      workspace,
      sessionId,
      message,
      route: createLegacyKnowledgeRoute(route),
      docs: result.docs,
      toolPlan: result.toolPlan,
      toolResults: result.toolResults,
      answer: result.answer,
      artifacts: result.artifacts,
      agentSteps: visibleSteps,
      enterpriseContext,
      conversationContext,
      skills: [],
      session,
      debug,
      startedAt,
      runId,
      emit
    });
  }

  async executeKnowledgeLookup({ user, workspace, message, sessionId, runId, route, enterpriseContext, conversationContext, selectedDomain }: Pick<FlowInput, "user" | "workspace" | "message" | "sessionId" | "runId" | "route" | "enterpriseContext" | "conversationContext" | "selectedDomain">): Promise<KnowledgeLookupResult> {
    const query = typeof route.params?.query === "string" && route.params.query.trim() ? route.params.query.trim() : message;
    const call = { name: "retrieve_knowledge", args: { query, topK: 5 } };
    const permission = await checkToolPermission(user, call);
    const toolResult = normalizeToolResult(permission.allow
      ? await this.toolRegistry.execute(call, { user, workspace, session_id: sessionId, run_id: runId, selected_domain: selectedDomain })
      : { ok: false, tool: call.name, error: "permission_denied", code: permission.code, message: permission.message }
    );
    const toolResults = [toolResult];
    const docs = toolResult.ok && Array.isArray(toolResult.data?.docs) ? toolResult.data.docs as Array<Record<string, unknown>> : [];
    const generated = await this.llm.generateAnswer({
      user,
      question: message,
      route: createLegacyKnowledgeRoute(route),
      docs,
      toolResults,
      enterpriseContext,
      conversationContext
    });
    return {
      docs,
      toolPlan: { calls: [call] },
      toolResults,
      answer: generated.answer,
      artifacts: generated.artifacts ?? []
    };
  }

  async runWorkflowFromIntentRouter({ user, workspace, message, sessionId, session, route, enterpriseContext, conversationContext, debug, startedAt, runId }: FlowInput) {
    const scenarioResult = await this.workflowRunner.runNew({ route: route as Route, user, message, session: asWorkflowSession(session) });
    const legacyRoute = createLegacyWorkflowRoute(route);
    return this.finish({
      user,
      workspace,
      sessionId,
      message,
      route: legacyRoute,
      docs: [],
      toolPlan: { calls: [] },
      toolResults: normalizeToolResults(scenarioResult.toolResults),
      answer: String(scenarioResult.answer ?? ""),
      scenarioDebug: scenarioResult.debug,
      agentSteps: [
        createIdentifyUserStep(user),
        createAgentStep("classify_intent", "识别任务类型", `Router 判定为 ${route.execution_class}/${route.handler_type}（${route.intent_code}, source=${route.source}）。`),
        this.workflowRunner.createEnterStep()
      ],
      enterpriseContext,
      conversationContext,
      skills: [],
      session,
      debug,
      startedAt,
      runId
    });
  }

  async runWorkflowFromIntentRouterStream({ user, workspace, message, sessionId, session, route, enterpriseContext, conversationContext, debug, startedAt, runId, emit, pushStep, visibleSteps }: StreamFlowInput) {
    await pushStep(createAgentStep("classify_intent", "识别任务类型", `Router 判定为 ${route.execution_class}/${route.handler_type}（${route.intent_code}, source=${route.source}）。`));
    await emit({ type: "route", route });
    const scenarioResult = await this.workflowRunner.runNew({ route: route as Route, user, message, session: asWorkflowSession(session) });
    await pushStep(this.workflowRunner.createEnterStep());
    return this.finishStream({
      user,
      workspace,
      sessionId,
      message,
      route: createLegacyWorkflowRoute(route),
      docs: [],
      toolPlan: { calls: [] },
      toolResults: normalizeToolResults(scenarioResult.toolResults),
      answer: String(scenarioResult.answer ?? ""),
      scenarioDebug: scenarioResult.debug,
      agentSteps: visibleSteps,
      enterpriseContext,
      conversationContext,
      skills: [],
      session,
      debug,
      startedAt,
      runId,
      emit
    });
  }

  async runIntentQuery({ user, workspace, message, sessionId, session, route, enterpriseContext, conversationContext, debug, startedAt, runId, selectedDomain }: FlowInput) {
    const handlerResult = await this.intentQueryHandler.execute({
      user,
      workspace,
      message,
      intent_code: route.intent_code,
      params: route.params ?? {},
      route,
      session,
      selectedDomain
    });
    // 保留 legacy intent 字符串，兼容下游历史字段。
    const legacyRoute = buildLegacyRoute(route, {
      reason: route.reasoning ?? "Intent Router → intent_query"
    });
    if (session) {
      const nowDate = new Date();
      const snapshot = { intent_code: route.intent_code, params: route.params ?? {}, ts: nowDate.toISOString() };
      session.last_task = { intent_code: route.intent_code, params: route.params ?? {} };
      session.active_intent_code = route.intent_code;
      session.last_route = snapshot;
      session.last_query_route = snapshot;
      session.recent_routes = pushRecentRoute(session, route, nowDate);
    }
    const agentSteps = [
      createIdentifyUserStep(user),
      createAgentStep("classify_intent", "识别任务类型", `Router 判定为 ${route.intent_code}（confidence=${route.confidence}, source=${route.source}）。`),
      createAgentStep("intent_query", "执行结构化查询", `命中 ${route.intent_code}，已调用 ${handlerResult.toolPlan.calls.map((call) => call.name).join(",")}，返回 ${handlerResult.debug.row_count} 条记录。`)
    ];
    return this.finish({
      user,
      workspace,
      sessionId,
      message,
      route: legacyRoute,
      docs: [],
      toolPlan: handlerResult.toolPlan,
      toolResults: handlerResult.toolResults,
      answer: handlerResult.answer,
      artifacts: [],
      agentSteps,
      enterpriseContext,
      conversationContext,
      skills: [],
      session,
      debug,
      startedAt,
      runId
    });
  }

  async runChitchat({ user, workspace, message, sessionId, session, route, enterpriseContext, conversationContext, debug, startedAt, runId }: FlowInput) {
    const handlerResult = await this.chitchatHandler.execute({ user, message });
    if (session) {
      session.last_route = { intent_code: route.intent_code, params: route.params ?? {}, ts: new Date().toISOString() };
      // 寒暄不更新 last_query_route，下一轮"那华南呢"还能继承上次的查询
    }
    const legacyRoute = buildLegacyRoute(route, {
      reason: route.reasoning ?? "Intent Router → chitchat",
      includeParams: false
    });
    const agentSteps = [
      createIdentifyUserStep(user),
      createAgentStep("classify_intent", "识别任务类型", `Router 判定为 ${route.intent_code}（chitchat, source=${route.source}）。`),
      createAgentStep("chitchat", "直接生成回答", "无需调用工具或检索知识库。")
    ];
    return this.finish({
      user,
      workspace,
      sessionId,
      message,
      route: legacyRoute,
      docs: [],
      toolPlan: { calls: [] },
      toolResults: [],
      answer: handlerResult.answer,
      artifacts: [],
      agentSteps,
      enterpriseContext,
      conversationContext,
      skills: [],
      session,
      debug,
      startedAt,
      runId
    });
  }

  async runAgentic({ user, workspace, message, sessionId, session, route, enterpriseContext, conversationContext, debug, startedAt, runId, selectedDomain }: FlowInput) {
    const handlerResult = normalizeAgenticResult(await this.agenticHandler.execute({ user, workspace, message, route, session, selectedDomain }));
    if (session) {
      // agentic 走完不更新 last_query_route——它可能跨多个 intent，没有单一"这一次的查询"
      session.last_route = { intent_code: route.intent_code, params: route.params ?? {}, ts: new Date().toISOString() };
    }
    const legacyRoute = buildLegacyRoute(route, {
      reason: route.reasoning ?? "Intent Router → agentic"
    });
    const traces = Array.isArray(handlerResult.debug?.traces) ? handlerResult.debug.traces as Array<Record<string, unknown>> : [];
    const agentSteps = [
      createIdentifyUserStep(user),
      createAgentStep("classify_intent", "识别任务类型", `Router 判定为 agentic（${route.intent_code}, source=${route.source}）。`),
      createAgentStep("agentic", "跨意图规划", `执行 ${traces.length} 步：${traces.map((t) => t.tool ?? t.type).join(" → ")}`)
    ];
    return this.finish({
      user,
      workspace,
      sessionId,
      message,
      route: legacyRoute,
      docs: [],
      toolPlan: handlerResult.toolPlan ?? { calls: [] },
      toolResults: handlerResult.toolResults ?? [],
      answer: handlerResult.answer,
      artifacts: [],
      agentSteps,
      enterpriseContext,
      conversationContext,
      skills: [],
      session,
      debug,
      startedAt,
      runId,
      agenticDebug: handlerResult.debug
    });
  }

  // 流式版本的 agentic：与 runAgentic 等价，但把 handler 内部的三流事件实时推到 SSE，
  // 同时也保留 pushStep 的兼容流（旧 chat-page.js 是按 pushStep 渲染的）。
  async runAgenticStream({ user, workspace, message, sessionId, session, route, enterpriseContext, conversationContext, debug, startedAt, runId, selectedDomain, emit, pushStep, visibleSteps }: StreamFlowInput) {
    await pushStep(createAgentStep("classify_intent", "识别任务类型", `Router 判定为 agentic（${route.intent_code}, source=${route.source}）。`));
    await emit({ type: "route", route });

    // 把 handler 三流事件透传给前端：
    //   - tool 流的 tool_call 事件 -> SSE 'agentic_tool'（带 tool/args/observation_summary）
    //   - lifecycle 的 decided/answered 等 -> 同时也走 pushStep 兼容旧 UI
    const onEmit = async (ev: Record<string, unknown>) => {
      await emit({ type: "agentic_event", event: ev });
      if (ev.kind === "agentic_tool" && ev.type === "tool_call") {
        await pushStep(createAgentStep("execute_tool", "调用工具", `调用 ${String(ev.tool ?? "")}`, {
          tool: String(ev.tool ?? ""),
          args: normalizeJsonValue(ev.args),
          observation_summary: normalizeJsonValue(ev.observation_summary)
        }));
      }
    };

    const handlerResult = normalizeAgenticResult(await this.agenticHandler.execute({ user, workspace, message, route, session, selectedDomain, onEmit }));
    if (session) {
      session.last_route = { intent_code: route.intent_code, params: route.params ?? {}, ts: new Date().toISOString() };
    }
    const legacyRoute = buildLegacyRoute(route, {
      reason: route.reasoning ?? "Intent Router → agentic"
    });

    return this.finishStream({
      user,
      workspace,
      sessionId,
      message,
      route: legacyRoute,
      docs: [],
      toolPlan: handlerResult.toolPlan ?? { calls: [] },
      toolResults: handlerResult.toolResults ?? [],
      answer: handlerResult.answer,
      artifacts: [],
      agentSteps: visibleSteps,
      enterpriseContext,
      conversationContext,
      skills: [],
      session,
      debug,
      startedAt,
      runId,
      emit,
      agenticDebug: handlerResult.debug
    });
  }

  async selectSkill({ session, route, message, user }: { session?: AgentSession; route?: Route | LegacyRoute; message?: string; user?: UserContext }) {
    if (!this.skillRuntime) {
      return {
        selectedSkill: null,
        skills: [],
        mode: "open_loop",
        reason: "未配置 skill runtime，回退到通用 Agent Loop。"
      };
    }
    return this.skillRuntime.select({ session, route, message, user });
  }

  async loadEnterpriseContext(user: UserContext, workspace: WorkspaceContext, message?: string, sessionId?: string): Promise<unknown> {
    if (!this.enterpriseContextProvider) return null;
    return this.enterpriseContextProvider.load({ user, workspace, message, sessionId });
  }

  async applySessionPatch(session: AgentSession, patch: Partial<AgentSession> | null | undefined): Promise<void> {
    if (!patch) return;
    Object.assign(session, patch);
    const workspace = resolveUserWorkspace(String(session.owner_user_id ?? session.id.split(":")[0] ?? "anonymous"));
    await this.sessionStore.save(session, workspace);
    await appendAuditEvent({
      type: "session.updated",
      session_id: session.id,
      active_intent: session.active_intent,
      active_skill: session.active_skill,
      status: session.status,
      scenario: session.scenario
    });
  }

  async finish({ user, workspace, sessionId, message, route, docs, toolPlan, toolResults, answer, artifacts = [], scenarioDebug, agentSteps = [], agentState, enterpriseContext, conversationContext, skills = [], selectedSkill, session, debug, startedAt, runId, agenticDebug }: FinishInput) {
    const effectiveSelectedSkill = selectedSkill ?? inferSelectedSkillFromRoute(route);
    const selectedDomain = typeof session?.domain_id === "string" ? session.domain_id : undefined;
    const openuiDelegated = hasOpenUILangDelegateResult(toolResults);
    const composed = composeReportFromRegistry({ question: message, route, toolResults: toolResults.filter((result) => result.ok) });
    const finalAnswer = openuiDelegated ? "" : sanitizeCloudVisibleAnswer(composed?.answer ?? answer, route, toolResults);
    const openuiLangDecision = createOpenUILangDecision({ message, answer: finalAnswer, toolResults });
    const output: Record<string, unknown> = {
      session_id: sessionId,
      run_id: runId,
      answer: finalAnswer,
      sources: createSources(docs as never),
      pending_actions: extractPendingActions(toolResults),
      artifacts,
      _openui_lang_context: normalizeJsonValue({
        selected_domain: selectedDomain,
        route,
        tool_calls: toolPlan.calls,
        tool_results: toolResults,
        openui_lang_decision: openuiLangDecision,
        agent_steps: agentSteps,
        agent_state: agentState
      })
    };

    const scenarioRecord = scenarioDebug && typeof scenarioDebug === "object" ? scenarioDebug as Record<string, unknown> : {};
    const rawDebugInfo = {
      user: summarizeUser(user),
      selected_domain: selectedDomain,
      intent: route.intent,
      route,
      selected_skill: effectiveSelectedSkill?.id ?? null,
      openui_lang_delegated: openuiDelegated,
      openui_lang_decision: openuiLangDecision,
      selected_tools: toolPlan.calls.map((call) => call.name),
      available_tools: this.toolRegistry.list({
        user,
        workspace,
        intent: route.intent,
        scenario: scenarioRecord.scenario,
        step: scenarioRecord.step
      }).map((tool) => tool.name),
      available_primitives: this.primitiveRegistry?.list({ user, route }).map((primitive) => primitive.name) ?? [],
      loaded_skills: skills.map((skill) => ({
        name: skill.name,
        path: skill.path,
        description: skill.description
      })),
      enterprise_context: summarizeEnterpriseContext(enterpriseContext),
      conversation_context: summarizeConversationContext(conversationContext as never),
      history_used: getSessionHistory(session).map((item) => ({
        role: item.role,
        text: item.text
      })),
      tool_calls: toolPlan.calls,
      tool_results: toolResults,
      agent_steps: agentSteps,
      agent_state: agentState,
      scenario: scenarioDebug,
      latency_ms: Date.now() - startedAt,
      // 仅 agentic 分支会有；包含 streams（lifecycle/assistant/tool）+ flat traces
      agentic: agenticDebug ?? null
    };
    const debugInfo = createCompactDebugInfo(rawDebugInfo);

    await appendConversationLog({
      user_id: user.id,
      session_id: sessionId,
      message,
      answer: finalAnswer,
      artifacts,
      debug: rawDebugInfo,
      sources: output.sources
    } as never);

    await this.hooks.emit("turn_end", {
      user: normalizeJsonValue(user),
      user_id: user.id,
      session_id: sessionId,
      run_id: runId,
      message,
      answer: finalAnswer,
      answer_preview: finalAnswer.slice(0, 600),
      route: normalizeJsonValue(route),
      tool_calls: normalizeJsonValue(toolPlan.calls),
      tool_results: normalizeJsonValue(toolResults),
      tool_count: toolPlan.calls.length,
      agent_steps: normalizeJsonValue(agentSteps),
      enterprise_context: normalizeJsonValue(enterpriseContext),
      conversation_context: normalizeJsonValue(conversationContext)
    });

    if (session) {
      await this.appendSessionHistory(session, {
        workspace,
        message,
        answer: finalAnswer,
        metadata: createTurnMetadata({ route, selectedSkill: effectiveSelectedSkill, toolPlan, toolResults, answer: finalAnswer })
      });
    }

    if (debug) {
      output.debug = debugInfo;
    }

    return output;
  }

  async finishStream({
    user,
    workspace,
    sessionId,
    message,
    route,
    docs,
    toolPlan,
    toolResults,
    answer,
    artifacts = [],
    scenarioDebug,
    agentSteps = [],
    agentState,
    enterpriseContext,
    conversationContext,
    skills = [],
    selectedSkill,
    session,
    debug,
    startedAt,
    runId,
    emit,
    agenticDebug,
    answerAlreadyStreamed = false
  }: FinishStreamInput) {
    const composed = composeReportFromRegistry({ question: message, route, toolResults: toolResults.filter((result) => result.ok) });
    const finalAnswer = hasOpenUILangDelegateResult(toolResults) ? "" : sanitizeCloudVisibleAnswer(composed?.answer ?? answer, route, toolResults);
    if (!answerAlreadyStreamed) {
      for (const token of splitForStreaming(finalAnswer)) {
        await emit({ type: "delta", text: token });
        await new Promise((resolve) => setTimeout(resolve, 24));
      }
    }

    const output = await this.finish({
      user,
      workspace,
      sessionId,
      message,
      route,
      docs,
      toolPlan,
      toolResults,
      answer: finalAnswer,
      artifacts,
      scenarioDebug,
      agentSteps,
      agentState,
      enterpriseContext,
      conversationContext,
      skills,
      selectedSkill,
      session,
      debug,
      startedAt,
      runId,
      agenticDebug
    });

    await emit({ type: "done", ...output });
    return output;
  }

  async appendSessionHistory(session: AgentSession, { workspace, message, answer, metadata }: { workspace: WorkspaceContext; message: string; answer: string; metadata?: JsonObject }): Promise<void> {
    session.history = appendSessionHistory(session.history, { message, answer, metadata });
    await this.sessionStore.save(session, workspace);
  }

  scheduleEvolution(input: {
    user: UserContext;
    workspace: WorkspaceContext;
    sessionId: string;
    message: string;
    answer: string;
    route: LegacyRoute | Route;
    toolPlan: ToolPlan;
    toolResults: ToolResult[];
    enterpriseContext?: unknown;
    conversationContext?: unknown;
    agentSteps?: OrchestratorStep[];
  }): void {
    if (!this.evolutionRuntime) return;
    this.evolutionRuntime.collectTurn({
      trigger: "agent_finish",
      user: input.user,
      workspace: input.workspace,
      sessionId: input.sessionId,
      message: input.message,
      answer: input.answer,
      route: input.route,
      toolPlan: input.toolPlan,
      toolResults: input.toolResults,
      enterpriseContext: input.enterpriseContext,
      conversationContext: input.conversationContext,
      agentSteps: input.agentSteps
    });
  }
}

function asWorkflowSession(session: AgentSession): WorkflowSessionLike {
  return session as never;
}

/**
 * 从 Route 推导 workflow intent 名称。
 * IntentRouter 返回的 Route 可能没有 intent 字段（RouterLLMResult 不含 intent），
 * 需要从 intent_code 反查或推导。
 * 例如 intent_code="workflow.leave_request" → intent="leave_request"。
 */
function resolveWorkflowIntent(route: Route | LegacyRoute): string | null {
  // 1. 已有 intent 字段，直接使用
  if (route.intent) return route.intent;
  // 2. 通过 registry 反查 intentMappings（DomainPack.intentMappings 的反向映射）
  if (route.intent_code) {
    const fromRegistry = getIntentForIntentCode(route.intent_code);
    if (fromRegistry) return fromRegistry;
  }
  // 3. 从 intent_code 推导：去掉 "workflow." 前缀
  if (route.intent_code?.startsWith("workflow.")) {
    return route.intent_code.slice("workflow.".length);
  }
  return null;
}

function emptyWorkflowRoute(): WorkflowRouteLike {
  return {
    intent: null,
    intent_code: "workflow.active",
    execution_class: "controlled_execution",
    handler_type: "workflow",
    params: {},
    confidence: "medium"
  } as WorkflowRouteLike;
}

function normalizeToolResult(value: unknown): ToolResult {
  if (value && typeof value === "object") return value as ToolResult;
  return { ok: true, data: { value: value as JsonValue } };
}

function normalizeToolResults(value: unknown): ToolResult[] {
  return Array.isArray(value) ? value.map(normalizeToolResult) : [];
}

function hasOpenUILangDelegateResult(toolResults: ToolResult[]): boolean {
  return toolResults.some((result) => isOpenUILangDelegateToolResult(result));
}

function normalizeToolPlan(value: unknown): ToolPlan {
  if (value && typeof value === "object" && Array.isArray((value as { calls?: unknown }).calls)) {
    return value as ToolPlan;
  }
  return { calls: [] };
}

function normalizeAgenticResult(value: unknown): { answer: string; toolPlan: ToolPlan; toolResults: ToolResult[]; debug?: Record<string, unknown> } {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    answer: String(record.answer ?? ""),
    toolPlan: normalizeToolPlan(record.toolPlan),
    toolResults: normalizeToolResults(record.toolResults),
    debug: record.debug && typeof record.debug === "object" ? record.debug as Record<string, unknown> : undefined
  };
}

function normalizeJsonValue(value: unknown): JsonValue {
  if (value === null) return null;
  if (["string", "number", "boolean"].includes(typeof value)) return value as JsonValue;
  if (Array.isArray(value)) return value.map(normalizeJsonValue);
  if (value && typeof value === "object") {
    const out: JsonObject = {};
    for (const [key, item] of Object.entries(value)) out[key] = normalizeJsonValue(item);
    return out;
  }
  return null;
}

function summarizeEnterpriseContext(context: unknown): Record<string, unknown> | null {
  if (!context) return null;
  const record = context as Record<string, unknown>;
  const admin = Array.isArray(record.admin) ? record.admin as Array<Record<string, unknown>> : [];
  const orgMemory = record.org_memory && typeof record.org_memory === "object" ? record.org_memory as { items?: unknown[] } : {};
  const userMemory = record.user_memory && typeof record.user_memory === "object" ? record.user_memory as { items?: unknown[] } : {};
  return {
    runtime: record.runtime ?? null,
    admin_files: admin.map((item) => item.name),
    org_memory_items: orgMemory.items?.length ?? 0,
    user_memory_items: userMemory.items?.length ?? 0,
    policy: record.policy
  };
}

/**
 * Map handler_type to a legacy "coarse intent" string, used only for the
 * legacy `route.intent` field that downstream history fields still expect.
 * 引擎层只在 handler_type 上做映射，不在调用点散落 INTENTS.* 常量。
 */
function legacyIntentForHandlerType(handlerType?: string): string {
  if (handlerType === "chitchat") return INTENTS.SMALLTALK;
  if (handlerType === "knowledge_lookup") return INTENTS.KNOWLEDGE_QA;
  return INTENTS.DATA_QUERY;
}

interface BuildLegacyRouteOptions {
  reason?: JsonValue;
  includeParams?: boolean;
}

function buildLegacyRoute(route: Route | LegacyRoute, { reason, includeParams = true }: BuildLegacyRouteOptions = {}): LegacyRoute {
  const reasoning = (route as Route).reasoning;
  const result: LegacyRoute = {
    intent: legacyIntentForHandlerType(route.handler_type),
    confidence: route.confidence === "high" ? 0.95 : route.confidence === "medium" ? 0.85 : 0.6,
    reason: reason ?? reasoning ?? `Intent Router → ${route.handler_type ?? "unknown"}`,
    intent_code: route.intent_code,
    router: "intent_router",
    router_source: route.source,
    execution_class: route.execution_class,
    handler_type: route.handler_type
  };
  if (includeParams) result.params = route.params;
  return result;
}

function createLegacyKnowledgeRoute(route: Route | LegacyRoute): LegacyRoute {
  return buildLegacyRoute(route, {
    reason: (route as Route).reasoning ?? "Intent Router → controlled_execution/knowledge_lookup"
  });
}

function createLegacyWorkflowRoute(route: Route | LegacyRoute): LegacyRoute {
  return {
    intent: route.intent ?? route.intent_code?.split(".")[0] ?? "workflow",
    confidence: route.confidence === "high" ? 0.95 : route.confidence === "medium" ? 0.85 : 0.6,
    reason: route.reasoning ?? "Intent Router → controlled_execution/workflow",
    intent_code: route.intent_code,
    router: "intent_router",
    router_source: route.source,
    execution_class: route.execution_class,
    handler_type: route.handler_type,
    params: route.params
  };
}

function inferSelectedSkillFromRoute(route: Route | LegacyRoute | null | undefined): { id: string } | null {
  const intentCode = route?.intent_code;
  if (!intentCode) return null;
  // 核心 intent code → skill 映射
  if (intentCode === "knowledge.policy_qa") return { id: "knowledge-qa" };
  // 域特定映射：通过 registry 动态查找
  return inferSkillFromRegistry(intentCode);
}

function createCompactDebugInfo(debug: Record<string, unknown>): Record<string, unknown> {
  const enterpriseContext = debug.enterprise_context && typeof debug.enterprise_context === "object" ? debug.enterprise_context as Record<string, unknown> : {};
  const loadedSkills = Array.isArray(debug.loaded_skills) ? debug.loaded_skills as Array<Record<string, unknown>> : [];
  return {
    user: debug.user,
    runtime: enterpriseContext.runtime ?? null,
    conversation: debug.conversation_context,
    route: summarizeRoute(debug.route),
    selected_skill: debug.selected_skill,
    selected_tools: unique(debug.selected_tools),
    loaded_skills: loadedSkills.map((skill) => skill.name),
    tool_calls: summarizeToolCalls(debug.tool_calls),
    tool_results: summarizeToolResults(debug.tool_results),
    steps: summarizeSteps(debug.agent_steps),
    state: summarizeState(debug.agent_state),
    scenario: debug.scenario ? summarizeScenario(debug.scenario) : undefined,
    latency_ms: debug.latency_ms
  };
}

function summarizeRoute(route: unknown): Record<string, unknown> | null {
  if (!route) return null;
  const record = route as Record<string, unknown>;
  return {
    intent: record.intent,
    intent_code: record.intent_code,
    confidence: record.confidence,
    router: record.router ?? record.classifier,
    reason: record.reason,
    execution_class: record.execution_class,
    handler_type: record.handler_type,
    router_source: record.router_source,
    params: record.params
  };
}

function summarizeToolCalls(calls: ToolCall[] | unknown = []): Array<Record<string, unknown>> {
  const list = Array.isArray(calls) ? calls as ToolCall[] : [];
  return list.map((call) => ({
    name: call.name,
    resource: call.args?.resource,
    operation: call.args?.operation ?? "search",
    filters: normalizeDebugFilters(call.args?.filters),
    fields: call.args?.fields,
    sort: normalizeDebugSort(call.args?.sort),
    limit: call.args?.limit
  }));
}

function summarizeToolResults(results: ToolResult[] | unknown = []): Array<Record<string, unknown>> {
  const list = Array.isArray(results) ? results as ToolResult[] : [];
  return list.map((result) => {
    if (!result.ok) {
      return {
        ok: false,
        tool: result.tool,
        error: result.error,
        message: result.message
      };
    }
    const data = result.data ?? {};
    return {
      ok: true,
      tool: result.tool,
      resource: data.resource,
      operation: data.operation,
      total: data.total,
      row_count: data.rows?.length ?? 0,
      sample_rows: summarizeSampleRows(data.resource, data.rows),
      rows: summarizeSampleRows(data.resource, data.rows),
      groups: Array.isArray(data.groups) ? data.groups.slice(0, 50) : undefined,
      aggregates: data.aggregates,
      metrics: data.metrics,
      charts: data.charts,
      insights: data.insights,
      sources: data.sources,
      structured: data.structured
    };
  });
}

function extractPendingActions(results: ToolResult[] | unknown = []): Array<Record<string, unknown>> {
  const list = Array.isArray(results) ? results as ToolResult[] : [];
  return list
    .filter((result) => result.error === "confirmation_required" && result.data?.pending_action_id)
    .map((result) => ({
      id: result.data?.pending_action_id,
      tool: result.data?.tool ?? result.tool,
      risk_level: result.data?.risk_level ?? "write",
      expires_at: result.data?.expires_at,
      reason: result.message ?? "需要用户确认后才能执行。",
      call: result.data?.call
    }));
}

function summarizeSampleRows(resource: unknown, rows: unknown = []): Array<Record<string, unknown>> {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 3).map((row) => pickDebugRowFields(resource, row));
}

function pickDebugRowFields(resource: unknown, row: unknown): Record<string, unknown> {
  const record = row && typeof row === "object" ? row as Record<string, unknown> : {};
  const key = String(resource ?? "");
  // 优先从 registry 查找 debugFields，否则取前 8 个字段
  const registry = getRuntimeRegistry();
  const debugFields = registry?.allResources[key]?.debugFields;
  const fields = debugFields ?? Object.keys(record).slice(0, 8);
  return Object.fromEntries(fields.filter((field) => record[field] !== undefined).map((field) => [field, record[field]]));
}

function summarizeSteps(steps: unknown = []): Array<Record<string, unknown>> {
  const list = Array.isArray(steps) ? steps as Array<Record<string, unknown>> : [];
  return list.map((step) => ({
    phase: step.phase,
    title: step.title,
    detail: step.detail,
    status: step.status
  }));
}

function summarizeState(state: unknown): Record<string, unknown> | null {
  if (!state) return null;
  const record = state as Record<string, unknown>;
  const knownFacts = Array.isArray(record.known_facts) ? record.known_facts as Array<Record<string, unknown>> : [];
  const decisions = Array.isArray(record.decisions) ? record.decisions as Array<Record<string, unknown>> : [];
  return {
    goal: record.goal,
    task_mode: record.task_mode ?? record.task_type,
    status: record.status,
    round: record.round,
    iteration: record.iteration,
    plan: record.plan,
    current_step: record.current_step,
    stop_reason: record.stop_reason,
    required_facts: record.required_facts,
    known_fact_keys: knownFacts.map((fact) => fact.key).filter(Boolean),
    missing_facts: record.missing_facts,
    next_action: record.next_action,
    decisions: decisions.map((decision) => ({
      iteration: decision.iteration,
      source: decision.source,
      fallback_reason: decision.fallback_reason,
      action: decision.action
    })),
    blockers: record.blockers
  };
}

function summarizeScenario(scenario: unknown): Record<string, unknown> {
  const record = scenario && typeof scenario === "object" ? scenario as Record<string, unknown> : {};
  return {
    scenario: record.scenario,
    step: record.step,
    missing_slots: record.missing_slots,
    available_tools: record.available_tools
  };
}

function normalizeDebugFilters(filters: unknown = []): Array<Record<string, unknown>> {
  if (!Array.isArray(filters)) return [];
  return (filters as Array<Record<string, unknown>>).map((filter) => ({
    field: filter.field,
    op: filter.op ?? filter.operator,
    value: filter.value
  }));
}

function normalizeDebugSort(sort: unknown = []): Array<Record<string, unknown>> {
  if (!Array.isArray(sort)) return [];
  return (sort as Array<Record<string, unknown>>).map((item) => ({
    field: item.field,
    direction: item.direction ?? item.order ?? "desc"
  }));
}

function unique(items: unknown = []): unknown[] {
  const list = Array.isArray(items) ? items : [];
  return [...new Set(list.filter(Boolean))];
}

function createRouterFailure(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

function createRouterErrorRoute(error: unknown, originalRoute?: Route | LegacyRoute): LegacyRoute {
  const err = error as Partial<Error & { code: string }>;
  return {
    intent: "router_error",
    intent_code: originalRoute?.intent_code ?? "router.error",
    confidence: originalRoute?.confidence ?? "none",
    reason: err.message ?? "Intent Router 未能给出有效路由。",
    router: "intent_router",
    router_source: "error",
    execution_class: "router_error",
    handler_type: "router_error",
    params: originalRoute?.params ?? {},
    error_code: err.code ?? "router_error"
  };
}

function createRouterErrorAnswer(error: unknown): string {
  const err = error as Partial<Error & { code: string }>;
  const code = err.code ?? "router_error";
  if (code === "router_disabled") return "Intent Router 当前未初始化，已停止处理。本项目不再回退旧路由或 local 路由。";
  if (code === "router_unavailable") return "Intent Router 当前不可用，已停止处理。本项目不再回退旧路由或 local 路由。";
  if (code === "unknown_intent_code") return "Intent Router 返回了未注册的意图，已停止处理。请先在 intent manifest 中注册该意图。";
  if (code === "handler_unavailable") return "Intent Router 已完成判断，但当前没有可接管的 handler，已停止处理。";
  return `Intent Router 未能完成路由，已停止处理：${err.message ?? "unknown error"}`;
}

function getSessionHistory(session: AgentSession | undefined, limit = 8): SessionHistoryItem[] {
  return Array.isArray(session?.history) ? session.history.slice(-limit) : [];
}

function appendSessionHistory(history: SessionHistoryItem[] | undefined, { message, answer, metadata }: { message: string; answer: string; metadata?: JsonObject }, maxItems = 12): SessionHistoryItem[] {
  const next = Array.isArray(history) ? history.slice() : [];
  const at = new Date().toISOString();
  const turnId = `turn-${Date.now()}`;
  next.push({ id: `${turnId}-user`, role: "user", text: summarizeHistoryText(message), at, metadata });
  next.push({ id: `${turnId}-assistant`, role: "assistant", text: summarizeHistoryText(answer), at, metadata });
  return next.slice(-maxItems);
}

function createTurnMetadata({ route, selectedSkill, toolPlan, toolResults, answer }: { route: Route | LegacyRoute; selectedSkill?: { id?: string } | Record<string, unknown> | null; toolPlan?: ToolPlan; toolResults?: ToolResult[]; answer: string }): JsonObject {
  const routeRecord = route as Record<string, unknown>;
  return {
    route: normalizeJsonValue(route ? {
      intent: route.intent,
      intent_code: route.intent_code,
      confidence: route.confidence,
      reason: routeRecord.reason,
      execution_class: route.execution_class,
      handler_type: route.handler_type
    } : null),
    selected_skill: normalizeJsonValue(selectedSkill?.id ?? null),
    tool_calls: normalizeJsonValue((toolPlan?.calls ?? []).map((call) => ({
      name: call.name,
      args: call.args
    }))),
    tool_results: normalizeJsonValue(summarizeToolResults(toolResults)),
    answer_summary: summarizeHistoryText(answer, 240)
  };
}

function createOpenUILangDecision({ message, answer, toolResults }: { message: string; answer: string; toolResults: ToolResult[] }): JsonObject {
  const rows = firstStructuredRows(toolResults);
  return normalizeJsonValue(decideOpenUILangEligibility({ message, answer, rows })) as JsonObject;
}

function sanitizeCloudVisibleAnswer(answer: string, route: Route | LegacyRoute, toolResults: ToolResult[]): string {
  if (!isCloudTurn(route, toolResults)) return answer;
  return answer
    .replace(/\bseverity\s*=\s*high\b/gi, "高严重度风险")
    .replace(/\bdelay_hours\s*>\s*0\b/gi, "已延期阻塞项")
    .replace(/\barr_at_risk_cny\b/g, "续约风险金额")
    .replace(/\bowner_user_id\b/g, "负责人")
    .replace(/\bowner_team\b/g, "负责团队")
    .replace(/\bmetric_id\b/g, "指标")
    .replace(/\bsource_type\b/g, "来源类型")
    .replace(/\bcloud_operating_metrics\b/g, "经营指标")
    .replace(/\bcloud_risk_signals\b/g, "风险信号")
    .replace(/\bcloud_workflow_tasks\b/g, "流程任务")
    .replace(/\bcloud_renewal_opportunities\b/g, "续约机会")
    .replace(/\bcloud_source_refs\b/g, "来源引用")
    .replace(/\bnet_budget\b/g, "可用预算")
    .replace(/\bbudget\b/g, "预算")
    .replace(/\bstorage_cdn_cost\b/g, "存储和分发预估成本")
    .replace(/\bdiscount\b/g, "合同折扣")
    .replace(/\bprice_per_1k_tokens\b/g, "千 token 价格")
    .replace(/\btoken_per_second\b/g, "每秒 token 消耗")
    .replace(/\beffective_ratio\b/g, "有效产出比例")
    .replace(/\bafp_quota\b/g, "AFP 套餐额度")
    .replace(/\bextra_budget\b/g, "追加预算")
    .replace(/\boverage_price\b/g, "超额单价")
    .replace(/\bsafety_buffer\b/g, "安全缓冲")
    .replace(/\bturn_afp\b/g, "每轮 AFP 消耗")
    .replace(/\bretry\b/g, "重试损耗")
    .replace(/\bmoderation\b/g, "内容安全审核损耗")
    .replace(/\bsafety\b/g, "安全余量")
    .replace(/\bsku_agent_plan_medium\b/g, "Agent Plan Medium 套餐");
}

function isCloudTurn(route: Route | LegacyRoute, toolResults: ToolResult[]): boolean {
  const intentCode = String(route.intent_code ?? "");
  if (intentCode.startsWith("cloud.")) return true;
  return toolResults.some((result) => {
    const tool = String(result.tool ?? "");
    const resource = String((result as JsonObject).resource ?? readPath(result, ["data", "resource"]) ?? "");
    return tool.includes("cloud_") || tool.includes("cloud.") || resource.startsWith("cloud_");
  });
}

function firstStructuredRows(toolResults: ToolResult[]): JsonObject[] {
  for (const result of toolResults) {
    const rows = readRowsFromToolResult(result);
    if (rows.length) return rows;
  }
  return [];
}

function readRowsFromToolResult(value: unknown): JsonObject[] {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  for (const key of ["rows", "sample_rows"]) {
    const rows = readJsonObjectArray(record[key]);
    if (rows.length) return rows;
  }
  const data = record.data && typeof record.data === "object" && !Array.isArray(record.data) ? record.data as Record<string, unknown> : {};
  for (const key of ["rows", "sample_rows", "items"]) {
    const rows = readJsonObjectArray(data[key]);
    if (rows.length) return rows;
  }
  return [];
}

function readJsonObjectArray(value: unknown): JsonObject[] {
  return Array.isArray(value)
    ? value.filter((item): item is JsonObject => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function readPath(value: unknown, path: string[]): unknown {
  let cursor: unknown = value;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

function applySessionDomainBoundary(session: AgentSession, selectedDomain?: string): void {
  if (!selectedDomain) return;
  const previous = typeof session.domain_id === "string" ? session.domain_id : null;
  if (previous && previous !== selectedDomain) {
    delete session.active_intent_code;
    delete session.last_route;
    delete session.last_query_route;
    delete session.recent_routes;
    delete session.recent_messages;
  }
  session.domain_id = selectedDomain;
}

function summarizeHistoryText(text: unknown, maxLength = 500): string {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function createRunId(): string {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
