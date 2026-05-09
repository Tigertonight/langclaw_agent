import { summarizeUser } from "../auth/users.js";
import { appendAuditEvent, appendConversationLog } from "../logs/logger.js";
import { createAgentStep, createSkillStep, createSources, splitForStreaming } from "../runtime/agent-events.js";
import { buildConversationContext, summarizeConversationContext } from "../runtime/conversation-context.js";
import { FreeAgentLoop } from "../runtime/free-agent-loop.js";
import { WorkflowRunner } from "../runtime/workflow-runner.js";
import { classifyIntentNode } from "./nodes.js";
import { createDefaultSessionId } from "./session-store.js";

export class SimpleWorkflowOrchestrator {
  constructor({ llm, knowledgeBase, toolRegistry, primitiveRegistry, sessionStore, scenarioRouter, userContextResolver, skillRuntime, enterpriseContextProvider }) {
    this.llm = llm;
    this.knowledgeBase = knowledgeBase;
    this.toolRegistry = toolRegistry;
    this.primitiveRegistry = primitiveRegistry;
    this.sessionStore = sessionStore;
    this.scenarioRouter = scenarioRouter;
    this.userContextResolver = userContextResolver;
    this.skillRuntime = skillRuntime;
    this.enterpriseContextProvider = enterpriseContextProvider;
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

    await pushStep(createAgentStep("identify_user", "确认员工身份", `当前以 ${user.name}（${user.department} / ${user.role}）的身份处理请求。`));
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

  async finish({ user, sessionId, message, route, docs, toolPlan, toolResults, answer, scenarioDebug, agentSteps = [], agentState, enterpriseContext, conversationContext, skills = [], selectedSkill, session, debug, startedAt }) {
    const memoryUpdate = await this.maybeWriteUserMemory({ user, message });
    const output = {
      session_id: sessionId,
      answer,
      sources: createSources(docs)
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
    reason: route.reason
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
    sales_reports: ["department", "period", "revenue", "pipeline"]
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
    status: state.status,
    round: state.round,
    required_facts: state.required_facts,
    known_fact_keys: state.known_facts?.map((fact) => fact.key).filter(Boolean) ?? [],
    missing_facts: state.missing_facts,
    next_action: state.next_action,
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
