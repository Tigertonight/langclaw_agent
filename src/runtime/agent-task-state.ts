import type { JsonObject, JsonValue, Route, SkillDefinition, ToolCall, ToolResult, UserContext } from "../types/agent-contracts.js";
import { readableResourceNameFromRegistry, getFactKeyFromRegistry, isAnalysisIntentCode, inferEvidenceFactsFromRegistry } from "../domains/runtime-registry.js";

interface AgentFact extends JsonObject {
  key: string;
  text: string;
}

interface AgentTaskState {
  goal: string;
  task_type: string;
  status: string;
  iteration: number;
  round: number;
  max_iterations: number;
  max_rounds: number;
  route: Partial<Route>;
  user: JsonObject;
  constraints: string[];
  plan: string[];
  completed_steps: JsonObject[];
  current_step: string | null;
  observations: JsonObject[];
  artifacts: JsonObject[];
  open_questions: string[];
  risks: string[];
  tool_calls: ToolCall[];
  tool_results: ToolResult[];
  decisions: JsonObject[];
  required_facts: string[];
  known_facts: AgentFact[];
  missing_facts: string[];
  next_action: JsonObject | null;
  stop_reason: string | null;
  blockers: string[];
  skills: string[];
  history_count: number;
  enterprise_context: JsonObject | null;
}

interface CreateAgentTaskStateInput {
  user: UserContext;
  message?: string;
  route: Partial<Route>;
  history?: unknown[];
  skills?: SkillDefinition[];
  enterpriseContext?: unknown;
  maxIterations?: number;
}

interface AgentDecision extends JsonObject {
  action?: JsonObject;
  reason?: string;
  thought_summary?: string;
  plan_update?: JsonValue[];
  current_step?: string;
  decision_source?: string;
  fallback_reason?: string;
}

export function createAgentTaskState({ user, message, route, history = [], skills = [], enterpriseContext, maxIterations = 6 }: CreateAgentTaskStateInput): AgentTaskState {
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

export function recordAgentDecision(state: AgentTaskState, decision: AgentDecision): AgentTaskState {
  state.iteration += 1;
  state.round = state.iteration;
  state.next_action = {
    type: decision.action?.type ?? "unknown",
    reason: decision.reason ?? decision.thought_summary ?? ""
  };
  if (Array.isArray(decision.plan_update) && decision.plan_update.length) {
    state.plan = decision.plan_update.map((item) => String(item)).filter(Boolean);
  }
  state.current_step = decision.current_step ?? (decision.action?.type ? String(decision.action.type) : null);
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

export function recordAgentToolRound(state: AgentTaskState, calls: ToolCall[] = [], results: ToolResult[] = []): AgentTaskState {
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

export function recordAgentAskUser(state: AgentTaskState, question: string): AgentTaskState {
  state.status = "need_user_input";
  state.open_questions.push(question);
  state.stop_reason = "need_user_input";
  return state;
}

export function recordAgentFinished(state: AgentTaskState, reason = "done"): AgentTaskState {
  state.status = "ready_to_answer";
  state.stop_reason = reason;
  return state;
}

export function recordAgentBlocked(state: AgentTaskState, reason: string): AgentTaskState {
  state.status = "blocked";
  state.stop_reason = reason;
  if (reason) state.blockers.push(reason);
  return state;
}

export function snapshotAgentTaskState(state: AgentTaskState): unknown {
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

function inferGoal(message: unknown, route: Partial<Route>): string {
  const text = String(message ?? "").trim();
  if (route.intent === "data_query") return `查询企业数据：${text}`;
  if (route.intent === "mixed") return `结合企业数据和知识库回答：${text}`;
  if (route.intent === "knowledge_qa") return `查询知识库：${text}`;
  return text || "处理用户请求";
}

function inferTaskType(message: unknown, route: Partial<Route>): string {
  const text = String(message ?? "");
  if (/(报告|日报|周报|月报|材料|汇报稿|经营复盘|晨会)/.test(text)) return "report";
  if (/(看板|仪表盘|红黄绿|健康度|监控)/.test(text)) return "dashboard";
  if (/(计划|行动项|管理动作|下周|推进|落地|整改)/.test(text)) return "action_plan";
  if (/(分析|复盘|原因|风险|优先级|对比|承压|最该关注|为什么|诊断)/.test(text)) return "analysis";
  if (isAnalysisIntentCode(route?.intent_code as string)) return "analysis";
  return "lookup";
}

function inferRequiredFacts(message: unknown, route: Partial<Route>): string[] {
  const text = String(message ?? "");
  // 通过 registry 动态推断所需的 evidence facts（各域在 evidenceInferenceFns 中声明）
  const facts = inferEvidenceFactsFromRegistry(text, route);
  // 通过 registry 查找 intent_code 对应的 fact key
  const intentCode = String(route?.intent_code ?? "");
  const factKeyForIntent = getFactKeyFromRegistry(intentCode);
  if (factKeyForIntent) facts.push(factKeyForIntent);
  if (["knowledge_qa", "mixed"].includes(route.intent)) facts.push("knowledge_context");
  return [...new Set(facts)];
}

function summarizeEnterpriseContext(context: unknown): JsonObject | null {
  if (!isObject(context)) return null;
  const admin = Array.isArray(context.admin) ? context.admin.filter(isObject) : [];
  const orgMemory = isObject(context.org_memory) ? context.org_memory : {};
  const userMemory = isObject(context.user_memory) ? context.user_memory : {};
  const orgItems = Array.isArray(orgMemory.items) ? orgMemory.items : [];
  const userItems = Array.isArray(userMemory.items) ? userMemory.items.filter(isObject) : [];
  return {
    runtime: context.runtime ?? null,
    admin_files: admin.map((item) => item.name).filter((name): name is JsonValue => name !== undefined),
    org_memory_items: orgItems.length,
    user_memory_items: userItems.length,
    user_memory: userItems.map((item) => ({
      key: item.key,
      type: item.type,
      value: item.value
    }))
  };
}

function summarizeAction(action: JsonObject = {}): JsonObject {
  const tools = Array.isArray(action.tools) ? action.tools.filter(isObject) : [];
  return {
    type: action.type,
    tool: action.tool,
    tools: tools.map((call) => call.name ?? call.tool).filter(Boolean),
    answer: action.answer ? String(action.answer).slice(0, 160) : undefined,
    question: action.question ? String(action.question).slice(0, 160) : undefined
  };
}

function summarizeToolObservation(result: ToolResult): JsonObject {
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

function summarizeToolResult(result: ToolResult): string {
  if (result.tool === "retrieve_knowledge") {
    const docs = Array.isArray(result.data?.docs) ? result.data.docs : [];
    const hits = result.data?.total ?? docs.length ?? 0;
    return `知识库命中 ${hits} 个片段。`;
  }
  if (result.tool !== "query_business_data") return "工具已返回结果。";
  const data = result.data ?? {};
  if (data.operation === "aggregate") return `查询到 ${data.total ?? 0} 条记录的统计结果。`;
  const rows = Array.isArray(data.rows) ? data.rows : [];
  return `查询到 ${data.total ?? rows.length ?? 0} 条${readableResourceNameFromRegistry(data.resource, "业务")}数据。`;
}

function extractFacts(result: ToolResult): AgentFact[] {
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
  if (result.tool !== "query_business_data") {
    if (result.tool === "safe_compute") return [{ key: "aggregate_metric", text: "安全计算工具已返回确定性结果。" }];
    return [];
  }
  const data = result.data ?? {};
  // employees 有特殊的多 fact 提取逻辑
  if (data.resource === "employees") return extractEmployeeFacts(data);
  // 通用域资源 fact 提取：通过 registry 的 factKeyMappings 查找 factKey
  const resourceStr = String(data.resource ?? "");
  const factKey = getFactKeyFromRegistry(resourceStr);
  if (factKey) {
    // aggregate 操作统一使用 aggregate_metric
    const effectiveKey = data.operation === "aggregate" ? "aggregate_metric" : factKey;
    return [{ key: effectiveKey, text: summarizeBusinessData(data, readableResourceNameFromRegistry(resourceStr, "业务数据")) }];
  }
  return [];
}

function extractEmployeeFacts(data: JsonObject): AgentFact[] {
  const rows = Array.isArray(data.rows) ? data.rows.filter(isObject) : [];
  const facts: AgentFact[] = [];
  if (data.operation === "aggregate") {
    facts.push({ key: "aggregate_metric", text: summarizeBusinessData(data, readableResourceNameFromRegistry("employees", "员工")) });
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
  if (rows.some((row) => row.department_name || row.department)) {
    facts.push({ key: "org_profile", text: "已查询到员工组织和岗位信息。" });
  }
  if (!facts.length) facts.push({ key: "org_profile", text: summarizeBusinessData(data, "员工") });
  return facts;
}

function addKnownFact(state: AgentTaskState, key: string, text: string): void {
  if (!key || state.known_facts.some((fact) => fact.key === key && fact.text === text)) return;
  state.known_facts.push({ key, text });
}

function refreshMissingFacts(state: AgentTaskState): void {
  const known = new Set(state.known_facts.map((fact) => fact.key));
  state.missing_facts = state.required_facts.filter((fact) => !known.has(fact));
}

function summarizeBusinessData(data: JsonObject, name: string): string {
  if (data.operation === "aggregate") return `${name}统计匹配 ${data.total ?? 0} 条记录。`;
  const rows = Array.isArray(data.rows) ? data.rows : [];
  return `${name}查询返回 ${rows.length} 条记录，匹配 ${data.total ?? rows.length ?? 0} 条。`;
}


function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
