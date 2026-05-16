import { checkToolPermission } from "../auth/permissions.js";
import { loadJson } from "../data/load-json.js";
import { getDepartmentTreeIds, resolveEntities } from "../query/entity-resolver.js";
import { INTENTS } from "./ports.js";
import type { KnowledgeSearchResult } from "../rag/local-knowledge-base.js";
import type { ToolDescription, ToolRegistry } from "../tools/registry.js";
import type {
  JsonObject,
  JsonValue,
  QueryFilter,
  Route,
  SkillDefinition,
  ToolCall,
  ToolPlan,
  ToolResult,
  UserContext
} from "../types/agent-contracts.js";

const TOOL_INTENTS = [INTENTS.DATA_QUERY, INTENTS.MIXED, INTENTS.KNOWLEDGE_QA] as string[];
const KNOWLEDGE_INTENTS = [INTENTS.KNOWLEDGE_QA, INTENTS.MIXED] as string[];

interface LlmNodeClient {
  classifyIntent?(input: Record<string, unknown>): Promise<Route>;
  planToolCalls(input: Record<string, unknown>): Promise<ToolPlan & { clarification?: string }>;
  planFollowUpToolCalls?(input: Record<string, unknown>): Promise<ToolPlan>;
  generateAnswer(input: Record<string, unknown>): Promise<{ answer?: string; artifacts?: JsonValue[] }>;
}

interface KnowledgeBase {
  search(message: string, user: UserContext, options: { topK: number }): Promise<KnowledgeSearchResult[]>;
}

interface DepartmentScope extends JsonObject {
  id?: JsonValue;
  name?: string;
  aliases?: string[];
}

interface DepartmentRecord extends JsonObject {
  id: string | number;
  name: string;
}

interface LeaveRequestRecord extends JsonObject {
  department?: string;
}

export async function classifyIntentNode({ llm, user, message, history = [], enterpriseContext, conversationContext }: {
  llm: Required<Pick<LlmNodeClient, "classifyIntent">>;
  user: UserContext;
  message: string;
  history?: unknown[];
  enterpriseContext?: unknown;
  conversationContext?: unknown;
}): Promise<Route> {
  return llm.classifyIntent({ user, question: message, history, enterpriseContext, conversationContext });
}

export async function retrieveKnowledgeNode({ knowledgeBase, user, message, route }: {
  knowledgeBase: KnowledgeBase;
  user: UserContext;
  message: string;
  route: Partial<Route>;
}): Promise<KnowledgeSearchResult[]> {
  if (String(route.intent_code ?? "").startsWith("dealer.")) {
    return [];
  }
  if (!KNOWLEDGE_INTENTS.includes(String(route.intent ?? ""))) {
    return [];
  }
  return knowledgeBase.search(message, user, { topK: 5 });
}

export async function planToolCallsNode({ llm, toolRegistry, user, message, route, history = [], skills = [], selectedSkill, enterpriseContext, conversationContext }: {
  llm: LlmNodeClient;
  toolRegistry: ToolRegistry;
  user: UserContext;
  message: string;
  route: Partial<Route>;
  history?: unknown[];
  skills?: SkillDefinition[];
  selectedSkill?: SkillDefinition | null;
  enterpriseContext?: unknown;
  conversationContext?: unknown;
}): Promise<ToolPlan & { clarification?: string }> {
  if (!TOOL_INTENTS.includes(String(route.intent ?? ""))) {
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

export async function planFollowUpToolCallsNode({ llm, toolRegistry, user, message, route, history = [], toolResults = [], previousCalls = [], agentState }: {
  llm: LlmNodeClient;
  toolRegistry: ToolRegistry;
  user: UserContext;
  message: string;
  route: Partial<Route>;
  history?: unknown[];
  toolResults?: ToolResult[];
  previousCalls?: ToolCall[];
  agentState?: unknown;
}): Promise<ToolPlan> {
  if (!TOOL_INTENTS.includes(String(route.intent ?? ""))) {
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

function listAgentTools(toolRegistry: ToolRegistry, { user, route }: { user: UserContext; route: Partial<Route> }): ToolDescription[] {
  const intents = route.intent === INTENTS.KNOWLEDGE_QA
    ? [INTENTS.KNOWLEDGE_QA, INTENTS.DATA_QUERY]
    : route.intent === INTENTS.MIXED
      ? [INTENTS.MIXED, INTENTS.DATA_QUERY, INTENTS.KNOWLEDGE_QA]
      : [route.intent];
  const byName = new Map<string, ToolDescription>();
  for (const intent of intents) {
    for (const tool of toolRegistry.list({ user, intent })) {
      byName.set(tool.name, tool);
    }
  }
  return [...byName.values()];
}

export async function enforceSkillContracts(
  plan: (ToolPlan & { clarification?: string }) | null | undefined,
  { message, selectedSkill, enterpriseContext }: { message: string; selectedSkill?: SkillDefinition | null; enterpriseContext?: unknown }
): Promise<ToolPlan & { clarification?: string }> {
  if (!plan?.calls?.length) return plan ?? { calls: [] };
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

function isLeaveRecordsSkill(skill?: SkillDefinition | null): boolean {
  return ["leave-records", "leave_records"].includes(skill?.id) || ["leave-records", "leave_records"].includes(skill?.name);
}

function asksForTeamScope(message: unknown): boolean {
  return /(下面|下属|下级|下辖|团队|组员|成员|同学)/.test(String(message ?? "")) && !/(我自己|我本人|我的请假|本人请假)/.test(String(message ?? ""));
}

function asksForCompanyScope(message: unknown): boolean {
  return /(全公司|整个公司|公司全员|所有员工|全部员工)/.test(String(message ?? ""));
}

async function resolveDepartmentScope(message: unknown): Promise<DepartmentScope | null> {
  const entities = await resolveEntities(String(message ?? ""));
  if (!entities.department) return null;
  const department: DepartmentScope = {
    id: entities.department.id,
    name: entities.department.name,
    aliases: await resolveDepartmentAliases({
      id: entities.department.id,
      name: entities.department.name
    })
  };
  return department;
}

function enforceLeaveTeamScope(filters: JsonValue | undefined = []): QueryFilter[] {
  return enforceLeaveApplicantScope(filters, "__CURRENT_USER_REPORTS__");
}

function enforceLeaveCompanyScope(filters: JsonValue | undefined = []): QueryFilter[] {
  return enforceLeaveApplicantScope(filters, "__ALL_ORG_USERS__");
}

function enforceLeaveDepartmentScope(filters: JsonValue | undefined = [], department: DepartmentScope): QueryFilter[] {
  const normalized: QueryFilter[] = Array.isArray(filters)
    ? filters.filter(isObject).map((filter) => ({ ...filter, field: String(filter.field ?? ""), op: String(filter.op ?? filter.operator ?? "eq") }))
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

function isRuntimeApplicantScope(value: unknown): boolean {
  return [
    "__CURRENT_USER__",
    "__CURRENT_USER_REPORTS__",
    "__CURRENT_USER_SUBORDINATES__",
    "__ALL_ORG_USERS__"
  ].includes(String(value));
}

function departmentAliases(name: unknown): string[] {
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

async function resolveDepartmentAliases(department: DepartmentScope): Promise<string[]> {
  const aliases = new Set(departmentAliases(department.name));
  const shortName = String(department.name ?? "").replace(/部$/, "");

  const [departmentIds, departments, leaveRequests] = await Promise.all([
    getDepartmentTreeIds(department.id),
    loadJson<DepartmentRecord[]>("data/wecom-departments.json"),
    loadJson<LeaveRequestRecord[]>("data/leave-requests.json")
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

function enforceLeaveApplicantScope(filters: JsonValue | undefined = [], value: string): QueryFilter[] {
  const normalized: QueryFilter[] = Array.isArray(filters)
    ? filters.filter(isObject).map((filter) => ({ ...filter, field: String(filter.field ?? ""), op: String(filter.op ?? filter.operator ?? "eq") }))
    : [];
  const existingIndex = normalized.findIndex((filter) => filter.field === "applicant_user_id");
  const scopeFilter: QueryFilter = { field: "applicant_user_id", op: "in", value };
  if (existingIndex === -1) return [scopeFilter, ...normalized];
  return normalized.map((filter, index) => (index === existingIndex ? scopeFilter : filter));
}

function enforceRecentUpperBound(filters: QueryFilter[], { message, enterpriseContext }: { message: unknown; enterpriseContext?: unknown }): QueryFilter[] {
  if (!/最近|近三个月|三个月/.test(String(message ?? ""))) return filters;
  if (filters.some((filter) => filter.field === "start_time" && filter.op === "lte")) return filters;
  const context = isObject(enterpriseContext) ? enterpriseContext : {};
  const runtime = isObject(context.runtime) ? context.runtime : {};
  const currentDate = formatRuntimeDate(runtime.current_date);
  if (!currentDate) return filters;
  return [...filters, { field: "start_time", op: "lte", value: currentDate }];
}

function formatRuntimeDate(value: unknown): string | null {
  const text = String(value ?? "");
  if (!/^\d{8}$/.test(text)) return null;
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

export async function executeToolsNode({ toolRegistry, user, toolPlan }: {
  toolRegistry: ToolRegistry;
  user: UserContext;
  toolPlan: ToolPlan;
}): Promise<ToolResult[]> {
  const toolResults: ToolResult[] = [];

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
    toolResults.push(result as ToolResult);
  }

  return toolResults;
}

export async function generateAnswerNode({ llm, user, message, route, docs, toolResults, enterpriseContext, conversationContext }: {
  llm: Pick<LlmNodeClient, "generateAnswer">;
  user: UserContext | JsonObject;
  message: string;
  route: Partial<Route>;
  docs: KnowledgeSearchResult[];
  toolResults: ToolResult[];
  enterpriseContext?: unknown;
  conversationContext?: unknown;
}): Promise<{ answer?: string; artifacts?: JsonValue[] }> {
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

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
