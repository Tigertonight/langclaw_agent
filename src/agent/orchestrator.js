import { summarizeUser } from "../auth/users.js";
import { appendAuditEvent, appendConversationLog } from "../logs/logger.js";
import { createAgentStep, createSkillStep, createSources, splitForStreaming } from "../runtime/agent-events.js";
import { buildConversationContext, summarizeConversationContext } from "../runtime/conversation-context.js";
import { FreeAgentLoop } from "../runtime/free-agent-loop.js";
import { WorkflowRunner } from "../runtime/workflow-runner.js";
import { classifyIntentNode } from "./nodes.js";
import { createDefaultSessionId } from "./session-store.js";

export class SimpleWorkflowOrchestrator {
  constructor({ llm, knowledgeBase, toolRegistry, primitiveRegistry, sessionStore, scenarioRouter, userContextResolver, skillRuntime, enterpriseContextProvider, intentRouter, intentQueryHandler, chitchatHandler }) {
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
    this.freeAgentLoop = new FreeAgentLoop({ llm, knowledgeBase, toolRegistry });
    this.workflowRunner = new WorkflowRunner({
      scenarioRouter,
      applySessionPatch: (session, patch) => this.applySessionPatch(session, patch)
    });
  }

  async run({ userId, userContext, wecomUserId, message, sessionId, debug = false }) {
    const startedAt = Date.now();
    const user = await this.userContextResolver.resolve({ userId, userContext, wecomUserId });
    const enterpriseContext = await this.loadEnterpriseContext(user);
    const resolvedSessionId = sessionId ?? createDefaultSessionId(user.id);
    const session = await this.sessionStore.get(resolvedSessionId);
    const history = getSessionHistory(session);
    const conversationContext = buildConversationContext({ session, currentMessage: message, enterpriseContext });
    let route = null;

    // v2 Intent Router 入口（默认关闭，env INTENT_ROUTER_V2=on 启用）
    if (process.env.INTENT_ROUTER_V2 === "on" && this.intentRouter) {
      const routerResult = await this.intentRouter.route({
        message,
        now: new Date().toISOString(),
        user_context: { user_id: user.id, name: user.name, department: user.department, role: user.role, permissions: user.permissions },
        session_state: {
          active_intent_code: session?.active_intent_code,
          last_route: session?.last_route ?? null,
          last_query_route: session?.last_query_route ?? null
        }
      });
      // 工作流场景的续轮仍然走原路径，让 workflow runner 接管
      if (this.workflowRunner.canResume(session)) {
        // fall through to legacy path
      } else if (routerResult.handler_type === "intent_query" && this.intentQueryHandler) {
        return this.runIntentQuery({ user, message, sessionId: resolvedSessionId, session, route: routerResult, enterpriseContext, conversationContext, debug, startedAt });
      } else if (routerResult.handler_type === "chitchat" && this.chitchatHandler) {
        return this.runChitchat({ user, message, sessionId: resolvedSessionId, session, route: routerResult, enterpriseContext, conversationContext, debug, startedAt });
      }
      // workflow / agentic / 兜底走下方原有路径
    }

    if (this.workflowRunner.canResume(session)) {
      const activeIntent = session.active_intent;
      route = await classifyIntentNode({ llm: this.llm, user, message, history, enterpriseContext, conversationContext });
      if (this.workflowRunner.shouldContinueActive({ activeIntent, route, message })) {
        const scenarioResult = await this.workflowRunner.runActive({ user, message, session });
        return this.finish({
          user,
          sessionId: resolvedSessionId,
          message,
          route: { intent: activeIntent, confidence: 1, reason: "继续当前多轮业务场景" },
          docs: [],
          toolPlan: { calls: [] },
          toolResults: scenarioResult.toolResults ?? [],
          answer: scenarioResult.answer,
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
      await this.workflowRunner.reset(session);
    }

    route ??= await classifyIntentNode({ llm: this.llm, user, message, history, enterpriseContext, conversationContext });
    const selection = await this.selectSkill({ session, route, message, user });
    await this.applySessionPatch(session, this.skillRuntime?.createSessionPatch(selection));
    const skills = selection.skills;
    const agentSteps = [
      createAgentStep("identify_user", "确认员工身份", `当前以 ${user.name}（${user.department} / ${user.role}）的身份处理请求。`),
      createAgentStep("classify_intent", "识别任务类型", `判断为「${route.intent}」，原因：${route.reason}。`),
      createAgentStep("select_skill", "选择执行技能", selection.selectedSkill
        ? `已选择 skill「${selection.selectedSkill.name}」，执行模式为 ${selection.mode}。`
        : selection.reason),
      createSkillStep(skills)
    ];

    if (this.skillRuntime?.shouldUseWorkflow({ route, selection })) {
      const scenarioResult = await this.workflowRunner.runNew({ route, user, message, session });
      return this.finish({
        user,
        sessionId: resolvedSessionId,
        message,
        route,
        docs: [],
        toolPlan: { calls: [] },
        toolResults: scenarioResult.toolResults ?? [],
        answer: scenarioResult.answer,
        scenarioDebug: scenarioResult.debug,
        agentSteps: agentSteps.concat(this.workflowRunner.createEnterStep()),
        enterpriseContext,
        conversationContext,
        skills,
        selectedSkill: selection.selectedSkill,
        session,
        debug,
        startedAt
      });
    }

    const result = await this.freeAgentLoop.run({ user, message, route, history, skills, selectedSkill: selection.selectedSkill, enterpriseContext, conversationContext, agentSteps });
    return this.finish({
      user,
      sessionId: resolvedSessionId,
      message,
      route,
      docs: result.docs,
      toolPlan: result.toolPlan,
      toolResults: result.toolResults,
      answer: result.answer,
      artifacts: result.artifacts,
      agentSteps: result.agentSteps,
      agentState: result.agentState,
      enterpriseContext,
      conversationContext,
      skills,
      selectedSkill: selection.selectedSkill,
      session,
      debug,
      startedAt
    });
  }

  async runStream({ userId, userContext, wecomUserId, message, sessionId, debug = false, onEvent }) {
    const startedAt = Date.now();
    const user = await this.userContextResolver.resolve({ userId, userContext, wecomUserId });
    const enterpriseContext = await this.loadEnterpriseContext(user);
    const resolvedSessionId = sessionId ?? createDefaultSessionId(user.id);
    const session = await this.sessionStore.get(resolvedSessionId);
    const history = getSessionHistory(session);
    const conversationContext = buildConversationContext({ session, currentMessage: message, enterpriseContext });

    const emit = async (event) => onEvent?.(event);
    const visibleSteps = [];
    let thinkingText = "";
    const pushStep = async (step) => {
      visibleSteps.push(step);
      const line = `${visibleSteps.length}. ${step.title}：${step.detail}`;
      thinkingText = visibleSteps.map((item, index) => `${index + 1}. ${item.title}：${item.detail}`).join("\n");
      await emit({ type: "thinking", text: thinkingText, delta: line + "\n", step });
    };

    await pushStep(createAgentStep("classify_intent", "理解你的问题", "正在判断问题类型和需要的上下文。", { status: "running" }));
    let route = null;

    if (this.workflowRunner.canResume(session)) {
      const activeIntent = session.active_intent;
      route = await classifyIntentNode({ llm: this.llm, user, message, history, enterpriseContext, conversationContext });
      if (this.workflowRunner.shouldContinueActive({ activeIntent, route, message })) {
        const scenarioResult = await this.workflowRunner.runActive({ user, message, session });
        await pushStep(this.workflowRunner.createResumeStep());
        return this.finishStream({
          user,
          sessionId: resolvedSessionId,
          message,
          route: { intent: activeIntent, confidence: 1, reason: "继续当前多轮业务场景" },
          docs: [],
          toolPlan: { calls: [] },
          toolResults: scenarioResult.toolResults ?? [],
          answer: scenarioResult.answer,
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
      await this.workflowRunner.reset(session);
      await pushStep(this.workflowRunner.createSwitchStep());
    }

    route ??= await classifyIntentNode({ llm: this.llm, user, message, history, enterpriseContext, conversationContext });
    await pushStep(createAgentStep("classify_intent", "识别任务类型", `判断为「${route.intent}」，置信度 ${route.confidence}，原因：${route.reason}。`));
    await emit({ type: "route", route });

    const selection = await this.selectSkill({ session, route, message, user });
    await this.applySessionPatch(session, this.skillRuntime?.createSessionPatch(selection));
    const skills = selection.skills;
    await pushStep(createAgentStep("select_skill", "选择执行技能", selection.selectedSkill
      ? `已选择 skill「${selection.selectedSkill.name}」，执行模式为 ${selection.mode}。`
      : selection.reason));
    await pushStep(createSkillStep(skills));

    if (this.skillRuntime?.shouldUseWorkflow({ route, selection })) {
      const scenarioResult = await this.workflowRunner.runNew({ route, user, message, session });
      await pushStep(this.workflowRunner.createEnterStep());
      return this.finishStream({
        user,
        sessionId: resolvedSessionId,
        message,
        route,
        docs: [],
        toolPlan: { calls: [] },
        toolResults: scenarioResult.toolResults ?? [],
        answer: scenarioResult.answer,
        scenarioDebug: scenarioResult.debug,
        agentSteps: visibleSteps,
        enterpriseContext,
        skills,
        selectedSkill: selection.selectedSkill,
        session,
        debug,
        startedAt,
        emit
      });
    }

    const result = await this.freeAgentLoop.runStream({
      user,
      message,
      route,
      history,
      skills,
      selectedSkill: selection.selectedSkill,
      enterpriseContext,
      conversationContext,
      agentSteps: visibleSteps,
      emit,
      pushStep
    });

    return this.finishStream({
      user,
      sessionId: resolvedSessionId,
      message,
      route,
      docs: result.docs,
      toolPlan: result.toolPlan,
      toolResults: result.toolResults,
      answer: result.answer,
      artifacts: result.artifacts,
      agentSteps: visibleSteps,
      agentState: result.agentState,
      enterpriseContext,
      conversationContext,
      skills,
      selectedSkill: selection.selectedSkill,
      session,
      debug,
      startedAt,
      emit,
      answerAlreadyStreamed: result.answerAlreadyStreamed
    });
  }

  async runIntentQuery({ user, message, sessionId, session, route, enterpriseContext, conversationContext, debug, startedAt }) {
    const handlerResult = await this.intentQueryHandler.execute({
      user,
      message,
      intent_code: route.intent_code,
      params: route.params ?? {},
      route,
      session
    });
    // 用 v1 的 intent 字符串保留兼容
    const legacyRoute = {
      intent: "data_query",
      confidence: route.confidence === "high" ? 0.95 : route.confidence === "medium" ? 0.85 : 0.6,
      reason: route.reasoning ?? "v2 intent router → intent_query",
      intent_code: route.intent_code,
      router: "v2",
      router_source: route.source,
      params: route.params,
      handler_type: route.handler_type
    };
    if (session) {
      const ts = new Date().toISOString();
      const snapshot = { intent_code: route.intent_code, params: route.params ?? {}, ts };
      session.last_task = { intent_code: route.intent_code, params: route.params ?? {} };
      session.active_intent_code = route.intent_code;
      session.last_route = snapshot;
      session.last_query_route = snapshot;
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

  async runChitchat({ user, message, sessionId, session, route, enterpriseContext, conversationContext, debug, startedAt }) {
    const handlerResult = await this.chitchatHandler.execute({ user, message });
    if (session) {
      session.last_route = { intent_code: route.intent_code, params: route.params ?? {}, ts: new Date().toISOString() };
      // 寒暄不更新 last_query_route，下一轮"那华南呢"还能继承上次的查询
    }
    const legacyRoute = {
      intent: "smalltalk",
      confidence: route.confidence === "high" ? 0.95 : route.confidence === "medium" ? 0.85 : 0.6,
      reason: route.reasoning ?? "v2 intent router → chitchat",
      intent_code: route.intent_code,
      router: "v2",
      router_source: route.source,
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

  async selectSkill({ session, route, message, user }) {
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

  async loadEnterpriseContext(user) {
    if (!this.enterpriseContextProvider) return null;
    return this.enterpriseContextProvider.load({ user });
  }

  async applySessionPatch(session, patch) {
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

  async finish({ user, sessionId, message, route, docs, toolPlan, toolResults, answer, artifacts = [], scenarioDebug, agentSteps = [], agentState, enterpriseContext, conversationContext, skills = [], selectedSkill, session, debug, startedAt }) {
    const memoryUpdate = await this.maybeWriteUserMemory({ user, message });
    const output = {
      session_id: sessionId,
      answer,
      sources: createSources(docs),
      artifacts
    };

    const rawDebugInfo = {
      user: summarizeUser(user),
      intent: route.intent,
      route,
      selected_skill: selectedSkill?.id ?? null,
      selected_tools: toolPlan.calls.map((call) => call.name),
      available_tools: this.toolRegistry.list({
        user,
        intent: route.intent,
        scenario: scenarioDebug?.scenario,
        step: scenarioDebug?.step
      }).map((tool) => tool.name),
      available_primitives: this.primitiveRegistry?.list({ user, route }).map((primitive) => primitive.name) ?? [],
      loaded_skills: skills.map((skill) => ({
        name: skill.name,
        path: skill.path,
        description: skill.description
      })),
      enterprise_context: summarizeEnterpriseContext(enterpriseContext),
      conversation_context: summarizeConversationContext(conversationContext),
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
      latency_ms: Date.now() - startedAt
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
    });

    if (session) {
      await this.appendSessionHistory(session, {
        message,
        answer,
        metadata: createTurnMetadata({ route, selectedSkill, toolPlan, toolResults, answer })
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
    answerAlreadyStreamed = false
  }) {
    if (!answerAlreadyStreamed) {
      for (const token of splitForStreaming(answer)) {
        await emit({ type: "delta", text: token });
        await new Promise((resolve) => setTimeout(resolve, 12));
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
      startedAt
    });

    await emit({ type: "done", ...output });
    return output;
  }

  async appendSessionHistory(session, { message, answer, metadata }) {
    session.history = appendSessionHistory(session.history, { message, answer, metadata });
    await this.sessionStore.save(session);
  }

  async maybeWriteUserMemory({ user, message }) {
    if (!this.enterpriseContextProvider) return null;
    return this.enterpriseContextProvider.maybeWriteUserMemory({ user, message });
  }
}

function summarizeEnterpriseContext(context) {
  if (!context) return null;
  return {
    runtime: context.runtime ?? null,
    admin_files: context.admin?.map((item) => item.name) ?? [],
    org_memory_items: context.org_memory?.items?.length ?? 0,
    user_memory_items: context.user_memory?.items?.length ?? 0,
    policy: context.policy
  };
}

function createCompactDebugInfo(debug) {
  return {
    user: debug.user,
    runtime: debug.enterprise_context?.runtime ?? null,
    conversation: debug.conversation_context,
    route: summarizeRoute(debug.route),
    selected_skill: debug.selected_skill,
    selected_tools: unique(debug.selected_tools),
    loaded_skills: debug.loaded_skills?.map((skill) => skill.name) ?? [],
    tool_calls: summarizeToolCalls(debug.tool_calls),
    tool_results: summarizeToolResults(debug.tool_results),
    steps: summarizeSteps(debug.agent_steps),
    state: summarizeState(debug.agent_state),
    scenario: debug.scenario ? summarizeScenario(debug.scenario) : undefined,
    latency_ms: debug.latency_ms
  };
}

function summarizeRoute(route) {
  if (!route) return null;
  return {
    intent: route.intent,
    intent_code: route.intent_code,
    confidence: route.confidence,
    router: route.router ?? route.classifier,
    reason: route.reason,
    handler_type: route.handler_type,
    router_source: route.router_source,
    params: route.params
  };
}

function summarizeToolCalls(calls = []) {
  return calls.map((call) => ({
    name: call.name,
    resource: call.args?.resource,
    operation: call.args?.operation ?? "search",
    filters: normalizeDebugFilters(call.args?.filters),
    fields: call.args?.fields,
    sort: normalizeDebugSort(call.args?.sort),
    limit: call.args?.limit
  }));
}

function summarizeToolResults(results = []) {
  return results.map((result) => {
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

function summarizeSampleRows(resource, rows = []) {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 3).map((row) => pickDebugRowFields(resource, row));
}

function pickDebugRowFields(resource, row) {
  const fieldMap = {
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
  const fields = fieldMap[resource] ?? Object.keys(row).slice(0, 8);
  return Object.fromEntries(fields.filter((field) => row[field] !== undefined).map((field) => [field, row[field]]));
}

function summarizeSteps(steps = []) {
  return steps.map((step) => ({
    phase: step.phase,
    title: step.title,
    detail: step.detail,
    status: step.status
  }));
}

function summarizeState(state) {
  if (!state) return null;
  return {
    goal: state.goal,
    task_mode: state.task_mode ?? state.task_type,
    status: state.status,
    round: state.round,
    iteration: state.iteration,
    plan: state.plan,
    current_step: state.current_step,
    stop_reason: state.stop_reason,
    required_facts: state.required_facts,
    known_fact_keys: state.known_facts?.map((fact) => fact.key).filter(Boolean) ?? [],
    missing_facts: state.missing_facts,
    next_action: state.next_action,
    decisions: state.decisions?.map((decision) => ({
      iteration: decision.iteration,
      source: decision.source,
      fallback_reason: decision.fallback_reason,
      action: decision.action
    })),
    blockers: state.blockers
  };
}

function summarizeScenario(scenario) {
  return {
    scenario: scenario.scenario,
    step: scenario.step,
    missing_slots: scenario.missing_slots,
    available_tools: scenario.available_tools
  };
}

function normalizeDebugFilters(filters = []) {
  if (!Array.isArray(filters)) return [];
  return filters.map((filter) => ({
    field: filter.field,
    op: filter.op ?? filter.operator,
    value: filter.value
  }));
}

function normalizeDebugSort(sort = []) {
  if (!Array.isArray(sort)) return [];
  return sort.map((item) => ({
    field: item.field,
    direction: item.direction ?? item.order ?? "desc"
  }));
}

function unique(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function getSessionHistory(session, limit = 8) {
  return Array.isArray(session?.history) ? session.history.slice(-limit) : [];
}

function appendSessionHistory(history, { message, answer, metadata }, maxItems = 12) {
  const next = Array.isArray(history) ? history.slice() : [];
  const at = new Date().toISOString();
  const turnId = `turn-${Date.now()}`;
  next.push({ id: `${turnId}-user`, role: "user", text: summarizeHistoryText(message), at, metadata });
  next.push({ id: `${turnId}-assistant`, role: "assistant", text: summarizeHistoryText(answer), at, metadata });
  return next.slice(-maxItems);
}

function createTurnMetadata({ route, selectedSkill, toolPlan, toolResults, answer }) {
  return {
    route: route ? {
      intent: route.intent,
      intent_code: route.intent_code,
      confidence: route.confidence,
      reason: route.reason
    } : null,
    selected_skill: selectedSkill?.id ?? null,
    tool_calls: (toolPlan?.calls ?? []).map((call) => ({
      name: call.name,
      args: call.args
    })),
    tool_results: summarizeToolResults(toolResults),
    answer_summary: summarizeHistoryText(answer, 240)
  };
}

function summarizeHistoryText(text, maxLength = 500) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}
