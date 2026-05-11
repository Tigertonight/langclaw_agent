export function createAgentTaskState({ user, message, route, history = [], skills = [], enterpriseContext, maxIterations = 6 }) {
  const goal = inferGoal(message, route);
  return {
    goal,
    task_type: inferTaskType(message, route),
    status: "running",
    iteration: 0,
    round: 0,
    max_iterations: maxIterations,
    max_rounds: maxIterations,
    route,
    user: {
      id: user.id,
      name: user.name,
      department: user.department,
      role: user.role
    },
    constraints: [
      "只能使用已授权工具和工具返回结果回答。",
      "权限不足、数据为空或信息不足时必须如实说明。"
    ],
    plan: [],
    completed_steps: [],
    current_step: null,
    observations: [],
    artifacts: [],
    open_questions: [],
    risks: [],
    tool_calls: [],
    tool_results: [],
    decisions: [],
    required_facts: inferRequiredFacts(message, route),
    known_facts: [],
    missing_facts: inferRequiredFacts(message, route),
    next_action: null,
    stop_reason: null,
    blockers: [],
    skills: skills.map((skill) => skill.name),
    history_count: Array.isArray(history) ? history.length : 0,
    enterprise_context: summarizeEnterpriseContext(enterpriseContext)
  };
}

export function recordAgentDecision(state, decision) {
  state.iteration += 1;
  state.round = state.iteration;
  state.next_action = {
    type: decision.action?.type ?? "unknown",
    reason: decision.reason ?? decision.thought_summary ?? ""
  };
  if (Array.isArray(decision.plan_update) && decision.plan_update.length) {
    state.plan = decision.plan_update.map((item) => String(item)).filter(Boolean);
  }
  state.current_step = decision.current_step ?? decision.action?.type ?? null;
  state.decisions.push({
    iteration: state.iteration,
    thought_summary: decision.thought_summary,
    reason: decision.reason,
    source: decision.decision_source,
    fallback_reason: decision.fallback_reason,
    action: summarizeAction(decision.action)
  });
  return state;
}

export function recordAgentToolRound(state, calls = [], results = []) {
  state.tool_calls.push(...calls);
  state.tool_results.push(...results);
  state.completed_steps.push(...calls.map((call) => ({
    type: "tool_call",
    tool: call.name,
    resource: call.args?.resource,
    operation: call.args?.operation
  })));

  for (const result of results) {
    const observation = summarizeToolObservation(result);
    state.observations.push(observation);
    if (!result.ok) {
      state.blockers.push(result.message || result.error || "工具调用失败。");
      continue;
    }
    for (const fact of extractFacts(result)) {
      addKnownFact(state, fact.key, fact.text);
    }
  }

  refreshMissingFacts(state);
  return state;
}

export function recordAgentAskUser(state, question) {
  state.status = "need_user_input";
  state.open_questions.push(question);
  state.stop_reason = "need_user_input";
  return state;
}

export function recordAgentFinished(state, reason = "done") {
  state.status = "ready_to_answer";
  state.stop_reason = reason;
  return state;
}

export function recordAgentBlocked(state, reason) {
  state.status = "blocked";
  state.stop_reason = reason;
  if (reason) state.blockers.push(reason);
  return state;
}

export function snapshotAgentTaskState(state) {
  return {
    goal: state.goal,
    task_type: state.task_type,
    status: state.status,
    iteration: state.iteration,
    round: state.round,
    max_iterations: state.max_iterations,
    max_rounds: state.max_rounds,
    constraints: state.constraints,
    plan: state.plan,
    completed_steps: state.completed_steps,
    current_step: state.current_step,
    observations: state.observations,
    decisions: state.decisions,
    artifacts: state.artifacts,
    open_questions: state.open_questions,
    risks: state.risks,
    required_facts: state.required_facts,
    known_facts: state.known_facts,
    missing_facts: state.missing_facts,
    next_action: state.next_action,
    stop_reason: state.stop_reason,
    blockers: state.blockers,
    skills: state.skills,
    history_count: state.history_count,
    enterprise_context: state.enterprise_context
  };
}

function inferGoal(message, route) {
  const text = String(message ?? "").trim();
  if (route.intent === "data_query") return `查询企业数据：${text}`;
  if (route.intent === "mixed") return `结合企业数据和知识库回答：${text}`;
  if (route.intent === "knowledge_qa") return `查询知识库：${text}`;
  return text || "处理用户请求";
}

function inferTaskType(message, route) {
  const text = String(message ?? "");
  if (/(报告|日报|周报|月报|材料|汇报稿|经营复盘|晨会)/.test(text)) return "report";
  if (/(看板|仪表盘|红黄绿|健康度|监控)/.test(text)) return "dashboard";
  if (/(计划|行动项|管理动作|下周|推进|落地|整改)/.test(text)) return "action_plan";
  if (/(分析|复盘|原因|风险|优先级|对比|承压|最该关注|为什么|诊断)/.test(text)) return "analysis";
  if (String(route?.intent_code ?? "").startsWith("dealer.") && route?.intent_code === "dealer.analysis_query") return "analysis";
  return "lookup";
}

function inferRequiredFacts(message, route) {
  const text = String(message ?? "");
  const facts = [];
  if (["data_query", "mixed"].includes(route.intent)) {
    if (/(上级|汇报|直属|领导|主管)/.test(text)) facts.push("direct_leader");
    if (/(下属|下级|下辖|下面|团队|同学)/.test(text)) facts.push("direct_reports");
    if (/(组织|部门|岗位)/.test(text)) facts.push("org_profile");
    if (/(客户|名下|负责)/.test(text)) facts.push("customer_scope");
    if (/(多少|几个|数量|统计|有多少)/.test(text)) facts.push("aggregate_metric");
    if (/(状态|进展|交付|发货|订单)/.test(text)) facts.push("business_status");
  }
  if (String(route?.intent_code ?? "").startsWith("dealer.")) facts.push("dealer_metrics");
  if (["knowledge_qa", "mixed"].includes(route.intent)) facts.push("knowledge_context");
  return [...new Set(facts)];
}

function summarizeEnterpriseContext(context) {
  if (!context) return null;
  return {
    runtime: context.runtime ?? null,
    admin_files: context.admin?.map((item) => item.name) ?? [],
    org_memory_items: context.org_memory?.items?.length ?? 0,
    user_memory_items: context.user_memory?.items?.length ?? 0,
    user_memory: context.user_memory?.items?.map((item) => ({
      key: item.key,
      type: item.type,
      value: item.value
    })) ?? []
  };
}

function summarizeAction(action = {}) {
  return {
    type: action.type,
    tool: action.tool,
    tools: action.tools?.map((call) => call.name ?? call.tool).filter(Boolean),
    answer: action.answer ? String(action.answer).slice(0, 160) : undefined,
    question: action.question ? String(action.question).slice(0, 160) : undefined
  };
}

function summarizeToolObservation(result) {
  if (!result.ok) {
    return {
      type: "tool",
      ok: false,
      tool: result.tool,
      summary: result.message || result.error || "工具调用失败。"
    };
  }
  return {
    type: "tool",
    ok: true,
    tool: result.tool,
    summary: summarizeToolResult(result)
  };
}

function summarizeToolResult(result) {
  if (result.tool === "retrieve_knowledge") {
    const hits = result.data?.total ?? result.data?.docs?.length ?? 0;
    return `知识库命中 ${hits} 个片段。`;
  }
  if (result.tool !== "query_business_data") return "工具已返回结果。";
  const data = result.data ?? {};
  if (data.operation === "aggregate") return `查询到 ${data.total ?? 0} 条记录的统计结果。`;
  return `查询到 ${data.total ?? data.rows?.length ?? 0} 条${readableResourceName(data.resource)}数据。`;
}

function extractFacts(result) {
  if (result.tool === "retrieve_knowledge") {
    const hits = result.data?.total ?? result.data?.docs?.length ?? 0;
    if (!hits) return [];
    const first = result.data?.docs?.[0];
    const source = first?.metadata?.title && first?.metadata?.heading
      ? `${first.metadata.title} / ${first.metadata.heading}`
      : "可访问资料";
    return [{ key: "knowledge_context", text: `知识资料命中 ${hits} 个片段，优先参考「${source}」。` }];
  }
  if (result.tool !== "query_business_data") {
    if (result.tool === "safe_compute") return [{ key: "aggregate_metric", text: "安全计算工具已返回确定性结果。" }];
    return [];
  }
  const data = result.data ?? {};
  if (data.resource === "employees") return extractEmployeeFacts(data);
  if (data.resource === "departments") return [{ key: "org_profile", text: `查询到 ${data.total ?? 0} 个组织节点。` }];
  if (data.resource === "customers") return [{ key: data.operation === "aggregate" ? "aggregate_metric" : "customer_scope", text: summarizeBusinessData(data, "客户") }];
  if (data.resource === "orders") return [{ key: "business_status", text: summarizeBusinessData(data, "订单") }];
  if (data.resource === "sales_reports") return [{ key: "aggregate_metric", text: summarizeBusinessData(data, "销售报表") }];
  if (data.resource === "leave_requests") return [{ key: data.operation === "aggregate" ? "aggregate_metric" : "business_status", text: summarizeBusinessData(data, "请假记录") }];
  if (String(data.resource ?? "").startsWith("dealer_")) return [{ key: "dealer_metrics", text: summarizeBusinessData(data, readableResourceName(data.resource)) }];
  return [];
}

function extractEmployeeFacts(data) {
  const rows = data.rows ?? [];
  const facts = [];
  if (data.operation === "aggregate") {
    facts.push({ key: "aggregate_metric", text: summarizeBusinessData(data, "员工") });
  }
  if (rows.some((row) => row.direct_leader_profiles?.length || row.reporting?.manager_profile || row.reporting?.store_manager_profile)) {
    facts.push({ key: "direct_leader", text: "已查询到直属上级或汇报关系信息。" });
  }
  if (rows.length > 1 || data.query?.filters?.some((filter) => filter.field === "direct_leader")) {
    facts.push({ key: "direct_reports", text: `已查询到 ${rows.length} 名下级或相关员工。` });
  }
  if (rows.some((row) => row.department_name || row.department)) {
    facts.push({ key: "org_profile", text: "已查询到员工组织和岗位信息。" });
  }
  if (!facts.length) facts.push({ key: "org_profile", text: summarizeBusinessData(data, "员工") });
  return facts;
}

function addKnownFact(state, key, text) {
  if (!key || state.known_facts.some((fact) => fact.key === key && fact.text === text)) return;
  state.known_facts.push({ key, text });
}

function refreshMissingFacts(state) {
  const known = new Set(state.known_facts.map((fact) => fact.key));
  state.missing_facts = state.required_facts.filter((fact) => !known.has(fact));
}

function summarizeBusinessData(data, name) {
  if (data.operation === "aggregate") return `${name}统计匹配 ${data.total ?? 0} 条记录。`;
  return `${name}查询返回 ${data.rows?.length ?? 0} 条记录，匹配 ${data.total ?? data.rows?.length ?? 0} 条。`;
}

function readableResourceName(resource) {
  const names = {
    customers: "客户",
    orders: "订单",
    sales_reports: "销售报表",
    employees: "员工",
    departments: "组织",
    leave_requests: "请假记录",
    dealer_stores: "门店",
    dealer_vehicles: "整车库存",
    dealer_inbounds: "在途入库",
    dealer_quotas: "配额",
    dealer_leads: "销售线索",
    dealer_sales_orders: "销售订单",
    dealer_finance: "财务流水",
    dealer_repair_orders: "售后工单",
    dealer_warranty_claims: "三包索赔",
    dealer_metrics: "经营指标"
  };
  return names[resource] ?? "业务";
}
