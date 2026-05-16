import { inferDealerEvidenceFacts } from "../dealer/dealer-evidence.js";
import type { JsonObject, Route, SkillDefinition, ToolCall, ToolPlan, ToolResult, UserContext } from "../types/agent-contracts.js";
import type { KnowledgeSearchResult } from "../rag/local-knowledge-base.js";

interface AgentFact extends JsonObject {
  key: string;
  text: string;
}

interface AgentObservation extends JsonObject {
  type: string;
  summary: string;
  ok?: boolean;
  hits?: number;
  tool?: string;
}

interface AgentNextAction extends JsonObject {
  type: "ask_user" | "tool_call" | "answer";
  reason: string;
  tools?: string[];
}

export interface AgentState {
  goal: string;
  task_mode: string;
  route: Partial<Route>;
  user: JsonObject;
  history_count: number;
  skills: string[];
  enterprise_context: unknown;
  required_facts: string[];
  known_facts: AgentFact[];
  missing_facts: string[];
  observations: AgentObservation[];
  tool_calls: ToolCall[];
  tool_results: ToolResult[];
  round: number;
  max_rounds: number;
  status: string;
  next_action: AgentNextAction | null;
  blockers: string[];
}

interface CreateAgentStateInput {
  user: UserContext;
  message?: string;
  route: Partial<Route>;
  history?: unknown[];
  skills?: SkillDefinition[];
  enterpriseContext?: unknown;
}

export function createAgentState({ user, message, route, history = [], skills = [], enterpriseContext }: CreateAgentStateInput): AgentState {
  const goal = inferGoal(message, route);
  const taskMode = inferTaskMode(message, route);
  const requiredFacts = inferRequiredFacts(message, route);
  return {
    goal,
    task_mode: taskMode,
    route,
    user: {
      id: user.id,
      name: user.name,
      department: user.department,
      role: user.role
    },
    history_count: Array.isArray(history) ? history.length : 0,
    skills: skills.map((skill) => skill.name),
    enterprise_context: summarizeEnterpriseContext(enterpriseContext),
    required_facts: requiredFacts,
    known_facts: [],
    missing_facts: requiredFacts.slice(),
    observations: [],
    tool_calls: [],
    tool_results: [],
    round: 0,
    max_rounds: 3,
    status: "running",
    next_action: null,
    blockers: []
  };
}

export function recordKnowledgeObservation(state: AgentState, docs: KnowledgeSearchResult[]): AgentState {
  const hits = docs.length;
  const observation = hits === 0
    ? "知识库没有命中可直接引用的片段。"
    : `知识库命中 ${hits} 个片段，优先参考「${docs[0].metadata.title} / ${docs[0].metadata.heading}」。`;
  state.observations.push({
    type: "knowledge",
    summary: observation,
    hits
  });
  if (hits > 0) addKnownFact(state, "knowledge_context", observation);
  refreshMissingFacts(state);
  return state;
}

export function recordPlan(state: AgentState, toolPlan: ToolPlan & { clarification?: string }): AgentState {
  const calls = toolPlan.calls ?? [];
  if (toolPlan.clarification && calls.length === 0) {
    state.status = "need_user_input";
    state.next_action = {
      type: "ask_user",
      reason: toolPlan.clarification
    };
    state.blockers.push(toolPlan.clarification);
    return state;
  }

  state.next_action = calls.length > 0
    ? {
      type: "tool_call",
      tools: calls.map((call) => call.name),
      reason: `需要调用 ${calls.length} 个工具补充事实。`
    }
    : {
      type: "answer",
      reason: "当前不需要调用业务工具。"
    };
  return state;
}

export function recordToolRound(state: AgentState, toolPlan: ToolPlan, toolResults: ToolResult[]): AgentState {
  state.round += 1;
  state.tool_calls.push(...(toolPlan.calls ?? []));
  state.tool_results.push(...toolResults);
  state.observations.push(...observeToolResults(toolResults));

  for (const result of toolResults) {
    if (!result.ok) {
      state.blockers.push(result.message || result.error || "工具调用失败。");
      continue;
    }
    for (const fact of extractFactsFromToolResult(result)) {
      addKnownFact(state, fact.key, fact.text);
    }
  }

  refreshMissingFacts(state);
  return state;
}

export function decideContinuation(state: AgentState, followUpPlan: ToolPlan): AgentState {
  const calls = followUpPlan.calls ?? [];
  if (state.status === "need_user_input") return state;
  if (calls.length > 0 && state.round < state.max_rounds) {
    state.status = "running";
    state.next_action = {
      type: "tool_call",
      tools: calls.map((call) => call.name),
      reason: "上一轮结果还不足以完整回答，继续补充查询。"
    };
    return state;
  }

  state.status = state.missing_facts.length > 0 && state.blockers.length > 0
    ? "blocked"
    : "ready_to_answer";
  state.next_action = {
    type: "answer",
    reason: state.status === "blocked"
      ? "存在无法继续补齐的信息，将基于已知事实说明原因。"
      : "已有事实足够组织回答。"
  };
  return state;
}

export function snapshotAgentState(state: AgentState): unknown {
  return {
    goal: state.goal,
    task_mode: state.task_mode,
    status: state.status,
    round: state.round,
    max_rounds: state.max_rounds,
    required_facts: state.required_facts,
    known_facts: state.known_facts,
    missing_facts: state.missing_facts,
    observations: state.observations,
    next_action: state.next_action,
    blockers: state.blockers,
    skills: state.skills,
    history_count: state.history_count,
    enterprise_context: state.enterprise_context
  };
}

function summarizeEnterpriseContext(context?: unknown): JsonObject | null {
  if (!isObject(context)) return null;
  const admin = Array.isArray(context.admin) ? context.admin.filter(isObject) : [];
  const orgMemory = isObject(context.org_memory) ? context.org_memory : {};
  const userMemory = isObject(context.user_memory) ? context.user_memory : {};
  const orgItems = Array.isArray(orgMemory.items) ? orgMemory.items : [];
  const userItems = Array.isArray(userMemory.items) ? userMemory.items.filter(isObject) : [];
  return {
    runtime: context.runtime ?? null,
    admin_files: admin.map((item) => item.name),
    org_memory_items: orgItems.length,
    user_memory_items: userItems.length,
    user_memory: userItems.map((item) => ({
      key: item.key,
      type: item.type,
      value: item.value
    }))
  };
}

function inferGoal(message: unknown, route: Partial<Route>): string {
  const text = String(message ?? "").trim();
  if (route.intent === "data_query") return `查询企业数据：${text}`;
  if (route.intent === "mixed") return `结合企业数据和知识库回答：${text}`;
  if (route.intent === "knowledge_qa") return `查询知识库：${text}`;
  return text || "处理用户请求";
}

export function inferTaskMode(message: unknown, route?: Partial<Route> | null): string {
  const text = String(message ?? "");
  if (/(报告|日报|周报|月报|材料|汇报稿|经营复盘|晨会)/.test(text)) return "report";
  if (/(看板|仪表盘|红黄绿|健康度|监控)/.test(text)) return "dashboard";
  if (/(计划|行动项|管理动作|下周|推进|落地|整改)/.test(text)) return "action_plan";
  if (/(分析|复盘|原因|风险|优先级|对比|承压|最该关注|为什么|诊断)/.test(text)) return "analysis";
  if (String(route?.intent_code ?? "").startsWith("dealer.") && route?.intent_code === "dealer.analysis_query") return "analysis";
  return "lookup";
}

function inferRequiredFacts(message: unknown, route: Partial<Route>): string[] {
  const text = String(message ?? "");
  const facts: string[] = [];
  if (["data_query", "mixed"].includes(route.intent)) {
    if (/(上级|汇报|直属|领导|主管)/.test(text)) facts.push("direct_leader");
    if (/(下属|下级|下辖|下面|团队|同学)/.test(text)) facts.push("direct_reports");
    if (/(组织|部门|岗位)/.test(text)) facts.push("org_profile");
    if (/(客户|名下|负责)/.test(text)) facts.push("customer_scope");
    if (/(多少|几个|数量|统计|有多少)/.test(text)) facts.push("aggregate_metric");
    if (/(状态|进展|交付|发货|订单)/.test(text)) facts.push("business_status");
  }
  facts.push(...inferDealerEvidenceFacts(String(message ?? ""), route));
  if (["knowledge_qa", "mixed"].includes(route.intent)) facts.push("knowledge_context");
  return [...new Set(facts)];
}

function observeToolResults(toolResults: ToolResult[]): AgentObservation[] {
  return toolResults.map((result) => {
    if (!result.ok) {
      return {
        type: "tool",
        ok: false,
        summary: result.message || result.error || "工具调用失败。",
        tool: result.tool
      };
    }
    return {
      type: "tool",
      ok: true,
      summary: summarizeToolResult(result),
      tool: result.tool
    };
  });
}

function extractFactsFromToolResult(result: ToolResult): AgentFact[] {
  if (result.tool === "retrieve_knowledge") {
    const docs = Array.isArray(result.data?.docs) ? result.data.docs as unknown[] : [];
    const hits = Number(result.data?.total ?? docs.length ?? 0);
    if (!hits) return [];
    const first = isObject(docs[0]) ? docs[0] : {};
    const metadata = isObject(first.metadata) ? first.metadata : {};
    const source = metadata.title && metadata.heading
      ? `${metadata.title} / ${metadata.heading}`
      : "可访问资料";
    return [{ key: "knowledge_context", text: `知识资料命中 ${hits} 个片段，优先参考「${source}」。` }];
  }
  if (result.tool !== "query_business_data") return [];
  const data = result.data ?? {};
  if (data.resource === "employees") return extractEmployeeFacts(data);
  if (data.resource === "departments") {
    return [{ key: "org_profile", text: `查询到 ${data.total ?? 0} 个组织节点。` }];
  }
  if (data.resource === "customers") {
    const key = data.operation === "aggregate" ? "aggregate_metric" : "customer_scope";
    return [{ key, text: summarizeBusinessData(data, "客户") }];
  }
  if (data.resource === "orders") {
    return [{ key: "business_status", text: summarizeBusinessData(data, "订单") }];
  }
  if (data.resource === "sales_reports") {
    return [{ key: "aggregate_metric", text: summarizeBusinessData(data, "销售报表") }];
  }
  if (data.resource === "leave_requests") {
    const key = data.operation === "aggregate" ? "aggregate_metric" : "business_status";
    const facts = [{ key, text: summarizeBusinessData(data, "请假记录") }];
    const query = isObject(data.query) ? data.query : {};
    if (isScopedToReports(query.filters)) {
      facts.push({ key: "direct_reports", text: "已按当前用户的下属范围查询请假记录。" });
    }
    return facts;
  }
  if (String(data.resource ?? "").startsWith("dealer_")) return extractDealerFacts(data);
  return [];
}

function extractDealerFacts(data: JsonObject): AgentFact[] {
  const keyMap = {
    dealer_metrics: "dealer_metrics",
    dealer_vehicles: "dealer_inventory_detail",
    dealer_leads: "dealer_lead_detail",
    dealer_sales_orders: "dealer_order_detail",
    dealer_finance: "dealer_finance_detail",
    dealer_repair_orders: "dealer_after_sales_detail",
    dealer_warranty_claims: "dealer_warranty_detail"
  };
  const key = keyMap[String(data.resource ?? "") as keyof typeof keyMap];
  if (!key) return [];
  return [{ key, text: summarizeBusinessData(data, readableResourceName(data.resource)) }];
}

function isScopedToReports(filters: unknown = []): boolean {
  if (!Array.isArray(filters)) return false;
  return filters.some((filter) => (
    isObject(filter)
    && filter.field === "applicant_user_id"
    && ["__CURRENT_USER_REPORTS__", "__CURRENT_USER_SUBORDINATES__"].includes(String(filter.value ?? ""))
  ));
}

function extractEmployeeFacts(data: JsonObject): AgentFact[] {
  const rows = Array.isArray(data.rows) ? data.rows.filter(isObject) : [];
  const facts: AgentFact[] = [];
  if (data.operation === "aggregate") {
    facts.push({ key: "aggregate_metric", text: summarizeBusinessData(data, "员工") });
  }
  if (rows.some((row) => {
    const reporting = isObject(row.reporting) ? row.reporting : {};
    const directLeaderProfiles = Array.isArray(row.direct_leader_profiles) ? row.direct_leader_profiles : [];
    return directLeaderProfiles.length > 0 || reporting.manager_profile || reporting.store_manager_profile;
  })) {
    facts.push({ key: "direct_leader", text: "已查询到直属上级或汇报关系信息。" });
  }
  const query = isObject(data.query) ? data.query : {};
  const queryFilters = Array.isArray(query.filters) ? query.filters.filter(isObject) : [];
  if (rows.length > 1 || queryFilters.some((filter) => filter.field === "direct_leader")) {
    facts.push({ key: "direct_reports", text: `已查询到 ${rows.length} 名下级或相关员工。` });
  }
  if (rows.some((row) => row.department_name || row.position || row.main_department)) {
    facts.push({ key: "org_profile", text: "已查询到员工所属组织、岗位或部门信息。" });
  }
  return facts;
}

function summarizeToolResult(result: ToolResult): string {
  if (result.tool === "query_business_data") {
    return summarizeBusinessData(result.data ?? {}, readableResourceName(result.data?.resource));
  }
  return `${result.tool} 已返回结果。`;
}

function summarizeBusinessData(data: JsonObject, label: string): string {
  if (data.operation === "aggregate") {
    return `${label}统计完成，匹配 ${data.total ?? 0} 条记录。`;
  }
  const rows = Array.isArray(data.rows) ? data.rows : [];
  return `${label}查询完成，匹配 ${data.total ?? 0} 条记录，返回 ${rows.length} 条。`;
}

function readableResourceName(resource: unknown): string {
  if (resource === "employees") return "员工";
  if (resource === "departments") return "组织";
  if (resource === "customers") return "客户";
  if (resource === "orders") return "订单";
  if (resource === "sales_reports") return "销售报表";
  if (resource === "leave_requests") return "请假记录";
  if (resource === "dealer_stores") return "经销商门店";
  if (resource === "dealer_vehicles") return "整车库存";
  if (resource === "dealer_inbounds") return "在途订单";
  if (resource === "dealer_quotas") return "配额记录";
  if (resource === "dealer_leads") return "销售线索";
  if (resource === "dealer_sales_orders") return "销售订单";
  if (resource === "dealer_finance") return "财务流水";
  if (resource === "dealer_repair_orders") return "售后工单";
  if (resource === "dealer_warranty_claims") return "三包索赔";
  if (resource === "dealer_metrics") return "经营指标";
  return "业务数据";
}

function addKnownFact(state: AgentState, key: string, text: string): void {
  if (!state.known_facts.some((fact) => fact.key === key && fact.text === text)) {
    state.known_facts.push({ key, text });
  }
}

function refreshMissingFacts(state: AgentState): void {
  const known = new Set(state.known_facts.map((fact) => fact.key));
  state.missing_facts = state.required_facts.filter((fact) => !known.has(fact));
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
