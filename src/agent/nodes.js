import { checkToolPermission } from "../auth/permissions.js";
import { loadJson } from "../data/load-json.js";
import { getDepartmentTreeIds, resolveEntities } from "../query/entity-resolver.js";
import { INTENTS } from "./ports.js";

export async function classifyIntentNode({ llm, user, message, history = [], enterpriseContext, conversationContext }) {
  return llm.classifyIntent({ user, question: message, history, enterpriseContext, conversationContext });
}

export async function retrieveKnowledgeNode({ knowledgeBase, user, message, route }) {
  if (String(route.intent_code ?? "").startsWith("dealer.")) {
    return [];
  }
  if (![INTENTS.KNOWLEDGE_QA, INTENTS.MIXED].includes(route.intent)) {
    return [];
  }
  return knowledgeBase.search(message, user, { topK: 5 });
}

export async function planToolCallsNode({ llm, toolRegistry, user, message, route, history = [], skills = [], selectedSkill, enterpriseContext, conversationContext }) {
  if (![INTENTS.DATA_QUERY, INTENTS.MIXED, INTENTS.KNOWLEDGE_QA].includes(route.intent)) {
    return { calls: [] };
  }
  const plan = await llm.planToolCalls({
    user,
    question: message,
    history,
    route,
    skills,
    selectedSkill,
    enterpriseContext,
    conversationContext,
    tools: listAgentTools(toolRegistry, { user, route })
  });
  return enforceSkillContracts(plan, { message, selectedSkill, enterpriseContext });
}

export async function planFollowUpToolCallsNode({ llm, toolRegistry, user, message, route, history = [], toolResults = [], previousCalls = [], agentState }) {
  if (![INTENTS.DATA_QUERY, INTENTS.MIXED, INTENTS.KNOWLEDGE_QA].includes(route.intent)) {
    return { calls: [] };
  }
  if (typeof llm.planFollowUpToolCalls !== "function") {
    return { calls: [] };
  }
  return llm.planFollowUpToolCalls({
    user,
    question: message,
    route,
    history,
    toolResults,
    previousCalls,
    agentState,
    tools: listAgentTools(toolRegistry, { user, route })
  });
}

function listAgentTools(toolRegistry, { user, route }) {
  const intents = route.intent === INTENTS.KNOWLEDGE_QA
    ? [INTENTS.KNOWLEDGE_QA, INTENTS.DATA_QUERY]
    : route.intent === INTENTS.MIXED
      ? [INTENTS.MIXED, INTENTS.DATA_QUERY, INTENTS.KNOWLEDGE_QA]
      : [route.intent];
  const byName = new Map();
  for (const intent of intents) {
    for (const tool of toolRegistry.list({ user, intent })) {
      byName.set(tool.name, tool);
    }
  }
  return [...byName.values()];
}

async function enforceSkillContracts(plan, { message, selectedSkill, enterpriseContext }) {
  if (!plan?.calls?.length) return plan;
  if (!isLeaveRecordsSkill(selectedSkill)) return plan;
  const department = await resolveDepartmentScope(message);
  if (!asksForTeamScope(message) && !asksForCompanyScope(message) && !department) return plan;

  return {
    ...plan,
    calls: plan.calls.map((call) => {
      if (call.name !== "query_business_data" || call.args?.resource !== "leave_requests") return call;
      let filters = asksForCompanyScope(message)
        ? enforceLeaveCompanyScope(call.args?.filters)
        : enforceLeaveTeamScope(call.args?.filters);
      if (department) filters = enforceLeaveDepartmentScope(filters, department);
      const boundedFilters = enforceRecentUpperBound(filters, { message, enterpriseContext });
      return {
        ...call,
        args: {
          ...call.args,
          filters: boundedFilters
        }
      };
    })
  };
}

function isLeaveRecordsSkill(skill) {
  return ["leave-records", "leave_records"].includes(skill?.id) || ["leave-records", "leave_records"].includes(skill?.name);
}

function asksForTeamScope(message) {
  return /(下面|下属|下级|下辖|团队|组员|成员|同学)/.test(String(message ?? "")) && !/(我自己|我本人|我的请假|本人请假)/.test(String(message ?? ""));
}

function asksForCompanyScope(message) {
  return /(全公司|整个公司|公司全员|所有员工|全部员工)/.test(String(message ?? ""));
}

async function resolveDepartmentScope(message) {
  const entities = await resolveEntities(String(message ?? ""));
  if (!entities.department) return null;
  return {
    ...entities.department,
    aliases: await resolveDepartmentAliases(entities.department)
  };
}

function enforceLeaveTeamScope(filters = []) {
  return enforceLeaveApplicantScope(filters, "__CURRENT_USER_REPORTS__");
}

function enforceLeaveCompanyScope(filters = []) {
  return enforceLeaveApplicantScope(filters, "__ALL_ORG_USERS__");
}

function enforceLeaveDepartmentScope(filters = [], department) {
  const normalized = Array.isArray(filters)
    ? filters.map((filter) => ({ ...filter, op: filter.op ?? filter.operator }))
    : [];
  const withoutSelfScope = normalized.filter((filter) => (
    !(filter.field === "applicant_user_id" && isRuntimeApplicantScope(filter.value))
  ));
  if (withoutSelfScope.some((filter) => filter.field === "department")) return withoutSelfScope;
  return [
    ...withoutSelfScope,
    { field: "department", op: "in", value: department.aliases ?? departmentAliases(department.name) }
  ];
}

function isRuntimeApplicantScope(value) {
  return [
    "__CURRENT_USER__",
    "__CURRENT_USER_REPORTS__",
    "__CURRENT_USER_SUBORDINATES__",
    "__ALL_ORG_USERS__"
  ].includes(value);
}

function departmentAliases(name) {
  const text = String(name ?? "");
  const aliases = new Set([text]);
  if (text.endsWith("部")) aliases.add(text.replace(/部$/, ""));
  if (text === "行政人事部") {
    aliases.add("人事部");
    aliases.add("人事");
    aliases.add("人力资源部");
    aliases.add("人力资源");
    aliases.add("HR部");
    aliases.add("HR");
  }
  return [...aliases].filter(Boolean);
}

async function resolveDepartmentAliases(department) {
  const aliases = new Set(departmentAliases(department.name));
  const shortName = String(department.name ?? "").replace(/部$/, "");

  const [departmentIds, departments, leaveRequests] = await Promise.all([
    getDepartmentTreeIds(department.id),
    loadJson("data/wecom-departments.json"),
    loadJson("data/leave-requests.json")
  ]);

  for (const item of departments) {
    if (!departmentIds.includes(Number(item.id))) continue;
    for (const alias of departmentAliases(item.name)) aliases.add(alias);
  }

  for (const request of leaveRequests) {
    const value = String(request.department ?? "");
    if (!value) continue;
    if (value.includes(shortName) || shortName.includes(value.replace(/部$/, ""))) aliases.add(value);
  }

  return [...aliases].filter(Boolean);
}

function enforceLeaveApplicantScope(filters = [], value) {
  const normalized = Array.isArray(filters)
    ? filters.map((filter) => ({ ...filter, op: filter.op ?? filter.operator }))
    : [];
  const existingIndex = normalized.findIndex((filter) => filter.field === "applicant_user_id");
  const scopeFilter = { field: "applicant_user_id", op: "in", value };
  if (existingIndex === -1) return [scopeFilter, ...normalized];
  return normalized.map((filter, index) => (index === existingIndex ? scopeFilter : filter));
}

function enforceRecentUpperBound(filters, { message, enterpriseContext }) {
  if (!/最近|近三个月|三个月/.test(String(message ?? ""))) return filters;
  if (filters.some((filter) => filter.field === "start_time" && filter.op === "lte")) return filters;
  const currentDate = formatRuntimeDate(enterpriseContext?.runtime?.current_date);
  if (!currentDate) return filters;
  return [...filters, { field: "start_time", op: "lte", value: currentDate }];
}

function formatRuntimeDate(value) {
  const text = String(value ?? "");
  if (!/^\d{8}$/.test(text)) return null;
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

export async function executeToolsNode({ toolRegistry, user, toolPlan }) {
  const toolResults = [];

  for (const call of toolPlan.calls) {
    const permission = await checkToolPermission(user, call);
    if (!permission.allow) {
      toolResults.push({
        ok: false,
        tool: call.name,
        error: "permission_denied",
        code: permission.code,
        message: permission.message
      });
      continue;
    }

    const result = await toolRegistry.execute(call, { user });
    toolResults.push(result);
  }

  return toolResults;
}

export async function generateAnswerNode({ llm, user, message, route, docs, toolResults, enterpriseContext, conversationContext }) {
  return llm.generateAnswer({
    user,
    question: message,
    route,
    docs,
    toolResults,
    enterpriseContext,
    conversationContext
  });
}
