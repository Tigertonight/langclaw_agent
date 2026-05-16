import { summarizeUser } from "../auth/users.js";
import { appendAuditEvent, appendConversationLog } from "../logs/logger.js";

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
import { createAgentStep, createSources, createToolSteps, splitForStreaming } from "../runtime/agent-events.js";
import { buildConversationContext, summarizeConversationContext } from "../runtime/conversation-context.js";
import { WorkflowRunner } from "../runtime/workflow-runner.js";
import { isAutonomousPlanning, isControlledExecution } from "../router/execution-class.js";
import { checkToolPermission } from "../auth/permissions.js";
import { INTENTS } from "./ports.js";
import { createDefaultSessionId } from "./session-store.js";
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
  sessionId?: string;
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
    get(sessionId: string): Promise<AgentSession>;
    save(session: AgentSession): Promise<void>;
  };
  scenarioRouter: unknown;
  userContextResolver: {
    resolve(input: { userId?: string; userContext?: Record<string, unknown>; wecomUserId?: string }): Promise<UserContext>;
  };
  skillRuntime?: {
    select(input: Record<string, unknown>): Promise<unknown> | unknown;
  } | null;
  enterpriseContextProvider?: {
    load(input: { user: UserContext }): Promise<unknown>;
    maybeWriteUserMemory(input: { user: UserContext; message: string }): Promise<unknown>;
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
}

interface FlowInput {
  user: UserContext;
  message: string;
  sessionId: string;
  session: AgentSession;
  route: Route | LegacyRoute;
  enterpriseContext?: unknown;
  conversationContext?: unknown;
  debug: boolean;
  startedAt: number;
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
  private readonly workflowRunner: WorkflowRunner;

  constructor({ llm, knowledgeBase, toolRegistry, primitiveRegistry, sessionStore, scenarioRouter, userContextResolver, skillRuntime, enterpriseContextProvider, intentRouter, intentQueryHandler, chitchatHandler, agenticHandler }: OrchestratorServices) {
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
    this.workflowRunner = new WorkflowRunner({
      scenarioRouter: scenarioRouter as ConstructorParameters<typeof WorkflowRunner>[0]["scenarioRouter"],
      applySessionPatch: (session, patch) => this.applySessionPatch(session as never, patch as unknown as Partial<AgentSession>)
    });
  }

  async run({ userId, userContext, wecomUserId, message, sessionId, debug = false }: RunInput) {
    const startedAt = Date.now();
    const user = await this.userContextResolver.resolve({ userId, userContext, wecomUserId });
    const enterpriseContext = await this.loadEnterpriseContext(user);
    const resolvedSessionId = sessionId ?? createDefaultSessionId(user.id);
    const session = await this.sessionStore.get(resolvedSessionId);
    const conversationContext = buildConversationContext({ session, currentMessage: message, enterpriseContext });

    if (this.workflowRunner.canResume(asWorkflowSession(session))) {
      const activeIntent = session.active_intent;
      if (this.workflowRunner.shouldContinueActive({ activeIntent, route: emptyWorkflowRoute(), message })) {
        const scenarioResult = await this.workflowRunner.runActive({ user, message, session: asWorkflowSession(session) });
        return this.finish({
          user,
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
          startedAt
        });
      }
      await this.workflowRunner.reset(asWorkflowSession(session));
    }

    if (!this.intentRouter) {
      return this.finishRouterError({ user, sessionId: resolvedSessionId, message, session, enterpriseContext, conversationContext, debug, startedAt, error: createRouterFailure("router_disabled", "Intent Router 未初始化。") });
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
        session_state: {
          active_intent_code: session?.active_intent_code,
          last_route: session?.last_route ?? null,
          last_query_route: session?.last_query_route ?? null,
          recent_messages: recentMessages,
          recent_routes: recentRoutes
        }
      });
    } catch (error) {
      return this.finishRouterError({ user, sessionId: resolvedSessionId, message, session, enterpriseContext, conversationContext, debug, startedAt, error });
    }
    if (session) session.recent_messages = pushRecentMessage(session, message, nowDate);
    if (isControlledExecution(routerResult)) {
      const controlledResult = await this.runControlledExecution({
        user, message, sessionId: resolvedSessionId, session, route: routerResult,
        enterpriseContext, conversationContext, debug, startedAt
      });
      if (controlledResult) return controlledResult;
    }
    if (isAutonomousPlanning(routerResult) && this.agenticHandler) {
      return this.runAgentic({ user, message, sessionId: resolvedSessionId, session, route: routerResult, enterpriseContext, conversationContext, debug, startedAt });
    }
    return this.finishRouterError({
      user, sessionId: resolvedSessionId, message, session, enterpriseContext, conversationContext, debug, startedAt,
      error: createRouterFailure("handler_unavailable", `Intent Router 已返回 ${routerResult.intent_code}，但当前没有可接管的 handler。`),
      route: routerResult
    });
  }

  async runStream({ userId, userContext, wecomUserId, message, sessionId, debug = false, onEvent }: RunStreamInput) {
    const startedAt = Date.now();
    const user = await this.userContextResolver.resolve({ userId, userContext, wecomUserId });
    const enterpriseContext = await this.loadEnterpriseContext(user);
    const resolvedSessionId = sessionId ?? createDefaultSessionId(user.id);
    const session = await this.sessionStore.get(resolvedSessionId);
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
          emit
        });
      }
      await this.workflowRunner.reset(asWorkflowSession(session));
      await pushStep(this.workflowRunner.createSwitchStep());
    }

    if (!this.intentRouter) {
      return this.finishRouterErrorStream({ user, sessionId: resolvedSessionId, message, session, enterpriseContext, conversationContext, debug, startedAt, emit, pushStep, visibleSteps, error: createRouterFailure("router_disabled", "Intent Router 未初始化。") });
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
        session_state: {
          active_intent_code: session?.active_intent_code,
          last_route: session?.last_route ?? null,
          last_query_route: session?.last_query_route ?? null,
          recent_messages: recentMessages,
          recent_routes: recentRoutes
        }
      });
    } catch (error) {
      return this.finishRouterErrorStream({ user, sessionId: resolvedSessionId, message, session, enterpriseContext, conversationContext, debug, startedAt, emit, pushStep, visibleSteps, error });
    }
    if (session) session.recent_messages = pushRecentMessage(session, message, nowDate);
    if (isControlledExecution(routerResult)) {
      const controlledResult = await this.runControlledExecutionStream({
        user, message, sessionId: resolvedSessionId, session, route: routerResult,
        enterpriseContext, conversationContext, debug, startedAt, emit, pushStep, visibleSteps
      });
      if (controlledResult) return controlledResult;
    }
    if (isAutonomousPlanning(routerResult) && this.agenticHandler) {
      return this.runAgenticStream({
        user, message, sessionId: resolvedSessionId, session, route: routerResult,
        enterpriseContext, conversationContext, debug, startedAt, emit, pushStep, visibleSteps
      });
    }
    return this.finishRouterErrorStream({
      user, sessionId: resolvedSessionId, message, session, enterpriseContext, conversationContext, debug, startedAt, emit, pushStep, visibleSteps,
      error: createRouterFailure("handler_unavailable", `Intent Router 已返回 ${routerResult.intent_code}，但当前没有可接管的 handler。`),
      route: routerResult
    });
  }

  async finishRouterError({ user, sessionId, message, session, enterpriseContext, conversationContext, debug, startedAt, error, route }: RouterErrorInput) {
    const errorRoute = createRouterErrorRoute(error, route);
    const answer = createRouterErrorAnswer(error);
    return this.finish({
      user,
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
      startedAt
    });
  }

  async finishRouterErrorStream({ user, sessionId, message, session, enterpriseContext, conversationContext, debug, startedAt, emit, pushStep, visibleSteps, error, route }: RouterErrorStreamInput) {
    const errorRoute = createRouterErrorRoute(error, route);
    const answer = createRouterErrorAnswer(error);
    await pushStep(createAgentStep("router_error", "路由未完成", answer, { status: "failed" }));
    await emit({ type: "route", route: errorRoute });
    return this.finishStream({
      user,
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
      emit
    });
  }

  async runControlledExecution({ user, message, sessionId, session, route, enterpriseContext, conversationContext, debug, startedAt }: FlowInput) {
    if (route.handler_type === "intent_query" && this.intentQueryHandler) {
      return this.runIntentQuery({ user, message, sessionId, session, route, enterpriseContext, conversationContext, debug, startedAt });
    }
    if (route.handler_type === "chitchat" && this.chitchatHandler) {
      return this.runChitchat({ user, message, sessionId, session, route, enterpriseContext, conversationContext, debug, startedAt });
    }
    if (route.handler_type === "knowledge_lookup") {
      return this.runKnowledgeLookup({ user, message, sessionId, session, route, enterpriseContext, conversationContext, debug, startedAt });
    }
    if (route.handler_type === "workflow" && this.workflowRunner.hasWorkflow(INTENTS.LEAVE_REQUEST)) {
      return this.runWorkflowFromIntentRouter({ user, message, sessionId, session, route, enterpriseContext, conversationContext, debug, startedAt });
    }
    return null;
  }

  async runControlledExecutionStream({ user, message, sessionId, session, route, enterpriseContext, conversationContext, debug, startedAt, emit, pushStep, visibleSteps }: StreamFlowInput) {
    await pushStep(createAgentStep("classify_intent", "识别任务类型", `Router 判定为 ${route.execution_class}/${route.handler_type}（${route.intent_code}, source=${route.source}）。`));
    await emit({ type: "route", route });

    if (route.handler_type === "intent_query" && this.intentQueryHandler) {
      const handlerResult = await this.intentQueryHandler.execute({
        user,
        message,
        intent_code: route.intent_code,
        params: route.params ?? {},
        route,
        session
      });
      const legacyRoute = {
        intent: "data_query",
        confidence: route.confidence === "high" ? 0.95 : route.confidence === "medium" ? 0.85 : 0.6,
        reason: route.reasoning ?? "Intent Router → controlled_execution/intent_query",
        intent_code: route.intent_code,
        router: "intent_router",
        router_source: route.source,
        params: route.params,
        execution_class: route.execution_class,
        handler_type: route.handler_type
      };
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
        emit
      });
    }

    if (route.handler_type === "chitchat" && this.chitchatHandler) {
      const handlerResult = await this.chitchatHandler.execute({ user, message });
      if (session) {
        session.last_route = { intent_code: route.intent_code, params: route.params ?? {}, ts: new Date().toISOString() };
      }
      const legacyRoute = {
        intent: "smalltalk",
        confidence: route.confidence === "high" ? 0.95 : route.confidence === "medium" ? 0.85 : 0.6,
        reason: route.reasoning ?? "Intent Router → controlled_execution/chitchat",
        intent_code: route.intent_code,
        router: "intent_router",
        router_source: route.source,
        execution_class: route.execution_class,
        handler_type: route.handler_type
      };
      await pushStep(createAgentStep("chitchat", "直接生成回答", "这是受控执行里的轻量交互，无需调用工具或检索知识库。"));
      return this.finishStream({
        user,
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
        emit
      });
    }

    if (route.handler_type === "knowledge_lookup") {
      return this.runKnowledgeLookupStream({ user, message, sessionId, session, route, enterpriseContext, conversationContext, debug, startedAt, emit, pushStep, visibleSteps });
    }

    if (route.handler_type === "workflow" && this.workflowRunner.hasWorkflow(INTENTS.LEAVE_REQUEST)) {
      return this.runWorkflowFromIntentRouterStream({ user, message, sessionId, session, route, enterpriseContext, conversationContext, debug, startedAt, emit, pushStep, visibleSteps });
    }

    return null;
  }

  async runKnowledgeLookup({ user, message, sessionId, session, route, enterpriseContext, conversationContext, debug, startedAt }: FlowInput) {
    const result = await this.executeKnowledgeLookup({ user, message, route, enterpriseContext, conversationContext });
    const legacyRoute = createLegacyKnowledgeRoute(route);
    const agentSteps = [
      createAgentStep("identify_user", "确认员工身份", `当前以 ${user.name}（${user.department} / ${user.role}）的身份处理请求。`),
      createAgentStep("classify_intent", "识别任务类型", `Router 判定为 ${route.execution_class}/${route.handler_type}（${route.intent_code}, source=${route.source}）。`),
      ...createToolSteps(result.toolPlan, result.toolResults),
      createAgentStep("observe_result", "观察结果", `知识库命中 ${result.docs.length} 个片段，正在组织回答。`)
    ];
    if (session) {
      session.last_route = { intent_code: route.intent_code, params: route.params ?? {}, ts: new Date().toISOString() };
    }
    return this.finish({
      user,
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
      startedAt
    });
  }

  async runKnowledgeLookupStream({ user, message, sessionId, session, route, enterpriseContext, conversationContext, debug, startedAt, emit, pushStep, visibleSteps }: StreamFlowInput) {
    await pushStep(createAgentStep("classify_intent", "识别任务类型", `Router 判定为 ${route.execution_class}/${route.handler_type}（${route.intent_code}, source=${route.source}）。`));
    await emit({ type: "route", route });
    const result = await this.executeKnowledgeLookup({ user, message, route, enterpriseContext, conversationContext });
    for (const step of createToolSteps(result.toolPlan, result.toolResults)) {
      await pushStep(step);
    }
    await pushStep(createAgentStep("observe_result", "观察结果", `知识库命中 ${result.docs.length} 个片段，正在组织回答。`));
    if (session) {
      session.last_route = { intent_code: route.intent_code, params: route.params ?? {}, ts: new Date().toISOString() };
    }
    return this.finishStream({
      user,
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
      emit
    });
  }

  async executeKnowledgeLookup({ user, message, route, enterpriseContext, conversationContext }: Pick<FlowInput, "user" | "message" | "route" | "enterpriseContext" | "conversationContext">): Promise<KnowledgeLookupResult> {
    const query = typeof route.params?.query === "string" && route.params.query.trim() ? route.params.query.trim() : message;
    const call = { name: "retrieve_knowledge", args: { query, topK: 5 } };
    const permission = await checkToolPermission(user, call);
    const toolResult = normalizeToolResult(permission.allow
      ? await this.toolRegistry.execute(call, { user })
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

  async runWorkflowFromIntentRouter({ user, message, sessionId, session, route, enterpriseContext, conversationContext, debug, startedAt }: FlowInput) {
    const scenarioResult = await this.workflowRunner.runNew({ route: { ...route, intent: INTENTS.LEAVE_REQUEST } as Route, user, message, session: asWorkflowSession(session) });
    const legacyRoute = createLegacyWorkflowRoute(route);
    return this.finish({
      user,
      sessionId,
      message,
      route: legacyRoute,
      docs: [],
      toolPlan: { calls: [] },
      toolResults: normalizeToolResults(scenarioResult.toolResults),
      answer: String(scenarioResult.answer ?? ""),
      scenarioDebug: scenarioResult.debug,
      agentSteps: [
        createAgentStep("identify_user", "确认员工身份", `当前以 ${user.name}（${user.department} / ${user.role}）的身份处理请求。`),
        createAgentStep("classify_intent", "识别任务类型", `Router 判定为 ${route.execution_class}/${route.handler_type}（${route.intent_code}, source=${route.source}）。`),
        this.workflowRunner.createEnterStep()
      ],
      enterpriseContext,
      conversationContext,
      skills: [],
      session,
      debug,
      startedAt
    });
  }

  async runWorkflowFromIntentRouterStream({ user, message, sessionId, session, route, enterpriseContext, conversationContext, debug, startedAt, emit, pushStep, visibleSteps }: StreamFlowInput) {
    await pushStep(createAgentStep("classify_intent", "识别任务类型", `Router 判定为 ${route.execution_class}/${route.handler_type}（${route.intent_code}, source=${route.source}）。`));
    await emit({ type: "route", route });
    const scenarioResult = await this.workflowRunner.runNew({ route: { ...route, intent: INTENTS.LEAVE_REQUEST } as Route, user, message, session: asWorkflowSession(session) });
    await pushStep(this.workflowRunner.createEnterStep());
    return this.finishStream({
      user,
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
      emit
    });
  }

  async runIntentQuery({ user, message, sessionId, session, route, enterpriseContext, conversationContext, debug, startedAt }: FlowInput) {
    const handlerResult = await this.intentQueryHandler.execute({
      user,
      message,
      intent_code: route.intent_code,
      params: route.params ?? {},
      route,
      session
    });
    // 保留 legacy intent 字符串，兼容下游历史字段。
    const legacyRoute = {
      intent: "data_query",
      confidence: route.confidence === "high" ? 0.95 : route.confidence === "medium" ? 0.85 : 0.6,
      reason: route.reasoning ?? "Intent Router → intent_query",
      intent_code: route.intent_code,
      router: "intent_router",
      router_source: route.source,
      params: route.params,
      execution_class: route.execution_class,
      handler_type: route.handler_type
    };
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
      createAgentStep("identify_user", "确认员工身份", `当前以 ${user.name}（${user.department} / ${user.role}）的身份处理请求。`),
      createAgentStep("classify_intent", "识别任务类型", `Router 判定为 ${route.intent_code}（confidence=${route.confidence}, source=${route.source}）。`),
      createAgentStep("intent_query", "执行结构化查询", `命中 ${route.intent_code}，已调用 ${handlerResult.toolPlan.calls.map((call) => call.name).join(",")}，返回 ${handlerResult.debug.row_count} 条记录。`)
    ];
    return this.finish({
      user,
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
      startedAt
    });
  }

  async runChitchat({ user, message, sessionId, session, route, enterpriseContext, conversationContext, debug, startedAt }: FlowInput) {
    const handlerResult = await this.chitchatHandler.execute({ user, message });
    if (session) {
      session.last_route = { intent_code: route.intent_code, params: route.params ?? {}, ts: new Date().toISOString() };
      // 寒暄不更新 last_query_route，下一轮"那华南呢"还能继承上次的查询
    }
    const legacyRoute = {
      intent: "smalltalk",
      confidence: route.confidence === "high" ? 0.95 : route.confidence === "medium" ? 0.85 : 0.6,
      reason: route.reasoning ?? "Intent Router → chitchat",
      intent_code: route.intent_code,
      router: "intent_router",
      router_source: route.source,
      execution_class: route.execution_class,
      handler_type: route.handler_type
    };
    const agentSteps = [
      createAgentStep("identify_user", "确认员工身份", `当前以 ${user.name}（${user.department} / ${user.role}）的身份处理请求。`),
      createAgentStep("classify_intent", "识别任务类型", `Router 判定为 ${route.intent_code}（chitchat, source=${route.source}）。`),
      createAgentStep("chitchat", "直接生成回答", "无需调用工具或检索知识库。")
    ];
    return this.finish({
      user,
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
      startedAt
    });
  }

  async runAgentic({ user, message, sessionId, session, route, enterpriseContext, conversationContext, debug, startedAt }: FlowInput) {
    const handlerResult = normalizeAgenticResult(await this.agenticHandler.execute({ user, message, route, session }));
    if (session) {
      // agentic 走完不更新 last_query_route——它可能跨多个 intent，没有单一"这一次的查询"
      session.last_route = { intent_code: route.intent_code, params: route.params ?? {}, ts: new Date().toISOString() };
    }
    const legacyRoute = {
      intent: "data_query",
      confidence: route.confidence === "high" ? 0.95 : route.confidence === "medium" ? 0.85 : 0.6,
      reason: route.reasoning ?? "Intent Router → agentic",
      intent_code: route.intent_code,
      router: "intent_router",
      router_source: route.source,
      execution_class: route.execution_class,
      handler_type: route.handler_type,
      params: route.params
    };
    const traces = Array.isArray(handlerResult.debug?.traces) ? handlerResult.debug.traces as Array<Record<string, unknown>> : [];
    const agentSteps = [
      createAgentStep("identify_user", "确认员工身份", `当前以 ${user.name}（${user.department} / ${user.role}）的身份处理请求。`),
      createAgentStep("classify_intent", "识别任务类型", `Router 判定为 agentic（${route.intent_code}, source=${route.source}）。`),
      createAgentStep("agentic", "跨意图规划", `执行 ${traces.length} 步：${traces.map((t) => t.tool ?? t.type).join(" → ")}`)
    ];
    return this.finish({
      user,
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
      agenticDebug: handlerResult.debug
    });
  }

  // 流式版本的 agentic：与 runAgentic 等价，但把 handler 内部的三流事件实时推到 SSE，
  // 同时也保留 pushStep 的兼容流（旧 chat-page.js 是按 pushStep 渲染的）。
  async runAgenticStream({ user, message, sessionId, session, route, enterpriseContext, conversationContext, debug, startedAt, emit, pushStep, visibleSteps }: StreamFlowInput) {
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

    const handlerResult = normalizeAgenticResult(await this.agenticHandler.execute({ user, message, route, session, onEmit }));
    if (session) {
      session.last_route = { intent_code: route.intent_code, params: route.params ?? {}, ts: new Date().toISOString() };
    }
    const legacyRoute = {
      intent: "data_query",
      confidence: route.confidence === "high" ? 0.95 : route.confidence === "medium" ? 0.85 : 0.6,
      reason: route.reasoning ?? "Intent Router → agentic",
      intent_code: route.intent_code,
      router: "intent_router",
      router_source: route.source,
      execution_class: route.execution_class,
      handler_type: route.handler_type,
      params: route.params
    };

    return this.finishStream({
      user,
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

  async loadEnterpriseContext(user: UserContext): Promise<unknown> {
    if (!this.enterpriseContextProvider) return null;
    return this.enterpriseContextProvider.load({ user });
  }

  async applySessionPatch(session: AgentSession, patch: Partial<AgentSession> | null | undefined): Promise<void> {
    if (!patch) return;
    Object.assign(session, patch);
    await this.sessionStore.save(session);
    await appendAuditEvent({
      type: "session.updated",
      session_id: session.id,
      active_intent: session.active_intent,
      active_skill: session.active_skill,
      status: session.status,
      scenario: session.scenario
    });
  }

  async finish({ user, sessionId, message, route, docs, toolPlan, toolResults, answer, artifacts = [], scenarioDebug, agentSteps = [], agentState, enterpriseContext, conversationContext, skills = [], selectedSkill, session, debug, startedAt, agenticDebug }: FinishInput) {
    const memoryUpdate = await this.maybeWriteUserMemory({ user, message });
    const effectiveSelectedSkill = selectedSkill ?? inferSelectedSkillFromRoute(route);
    const output: Record<string, unknown> = {
      session_id: sessionId,
      answer,
      sources: createSources(docs as never),
      artifacts
    };

    const scenarioRecord = scenarioDebug && typeof scenarioDebug === "object" ? scenarioDebug as Record<string, unknown> : {};
    const rawDebugInfo = {
      user: summarizeUser(user),
      intent: route.intent,
      route,
      selected_skill: effectiveSelectedSkill?.id ?? null,
      selected_tools: toolPlan.calls.map((call) => call.name),
      available_tools: this.toolRegistry.list({
        user,
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
      memory_update: memoryUpdate,
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
      answer,
      artifacts,
      debug: rawDebugInfo,
      sources: output.sources
    } as never);

    if (session) {
      await this.appendSessionHistory(session, {
        message,
        answer,
        metadata: createTurnMetadata({ route, selectedSkill: effectiveSelectedSkill, toolPlan, toolResults, answer })
      });
    }

    if (debug) {
      output.debug = debugInfo;
    }

    return output;
  }

  async finishStream({
    user,
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
    emit,
    agenticDebug,
    answerAlreadyStreamed = false
  }: FinishStreamInput) {
    if (!answerAlreadyStreamed) {
      for (const token of splitForStreaming(answer)) {
        await emit({ type: "delta", text: token });
        await new Promise((resolve) => setTimeout(resolve, 24));
      }
    }

    const output = await this.finish({
      user,
      sessionId,
      message,
      route,
      docs,
      toolPlan,
      toolResults,
      answer,
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
      agenticDebug
    });

    await emit({ type: "done", ...output });
    return output;
  }

  async appendSessionHistory(session: AgentSession, { message, answer, metadata }: { message: string; answer: string; metadata?: JsonObject }): Promise<void> {
    session.history = appendSessionHistory(session.history, { message, answer, metadata });
    await this.sessionStore.save(session);
  }

  async maybeWriteUserMemory({ user, message }: { user: UserContext; message: string }) {
    if (!this.enterpriseContextProvider) return null;
    return this.enterpriseContextProvider.maybeWriteUserMemory({ user, message });
  }
}

function asWorkflowSession(session: AgentSession): WorkflowSessionLike {
  return session as never;
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

function createLegacyKnowledgeRoute(route: Route | LegacyRoute): LegacyRoute {
  return {
    intent: INTENTS.KNOWLEDGE_QA,
    confidence: route.confidence === "high" ? 0.95 : route.confidence === "medium" ? 0.85 : 0.6,
    reason: route.reasoning ?? "Intent Router → controlled_execution/knowledge_lookup",
    intent_code: route.intent_code,
    router: "intent_router",
    router_source: route.source,
    execution_class: route.execution_class,
    handler_type: route.handler_type,
    params: route.params
  };
}

function createLegacyWorkflowRoute(route: Route | LegacyRoute): LegacyRoute {
  return {
    intent: INTENTS.LEAVE_REQUEST,
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
  if (intentCode === "knowledge.policy_qa") return { id: "knowledge-qa" };
  if (intentCode === "attendance.leave_query") return { id: "leave-records" };
  if (intentCode?.startsWith?.("dealer.") || intentCode === "business.query") return { id: "business-query" };
  return null;
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
      metrics: data.metrics
    };
  });
}

function summarizeSampleRows(resource: unknown, rows: unknown = []): Array<Record<string, unknown>> {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 3).map((row) => pickDebugRowFields(resource, row));
}

function pickDebugRowFields(resource: unknown, row: unknown): Record<string, unknown> {
  const record = row && typeof row === "object" ? row as Record<string, unknown> : {};
  const fieldMap: Record<string, string[]> = {
    employees: ["userid", "name", "department_name", "position", "role"],
    leave_requests: ["id", "applicant_user_id", "applicant_name", "leave_type", "leave_duration", "start_time", "end_time", "status", "reason"],
    customers: ["id", "name", "owner_user_id", "department", "tier", "deal_status", "annual_revenue"],
    orders: ["id", "customer_name", "status", "amount", "created_at", "expected_delivery"],
    sales_reports: ["department", "period", "revenue", "pipeline"],
    dealer_stores: ["id", "name", "city", "region", "store_type", "capacity", "status"],
    dealer_vehicles: ["vin", "store_name", "series", "model", "status", "stock_age_days", "stock_warning_level", "landing_cost"],
    dealer_inbounds: ["id", "store_name", "order_type", "series", "model", "customer_name", "status", "expected_arrival_date"],
    dealer_quotas: ["id", "store_name", "month", "series", "model", "quota_total", "bound_inbound_count", "available_quota"],
    dealer_leads: ["id", "customer_name", "source", "store_name", "owner_name", "interested_series", "intention_level", "status", "followup_count", "visit_count"],
    dealer_sales_orders: ["id", "store_name", "customer_name", "owner_name", "vin", "series", "order_status", "payment_status", "delivery_status", "final_price", "gross_profit"],
    dealer_finance: ["id", "resource_type", "store_name", "direction", "category", "amount", "balance_after", "status"],
    dealer_repair_orders: ["id", "store_name", "customer_name", "vin", "order_type", "status", "receivable_amount", "warranty_claim_id"],
    dealer_warranty_claims: ["id", "repair_order_id", "store_name", "customer_name", "vin", "fault_category", "claim_status", "claimed_amount", "approved_amount"],
    dealer_metrics: ["store_name", "category", "metric", "value", "unit", "severity", "summary", "recommendation", "related_resource", "related_ids"]
  };
  const key = String(resource ?? "");
  const fields = fieldMap[key] ?? Object.keys(record).slice(0, 8);
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

function summarizeHistoryText(text: unknown, maxLength = 500): string {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}
