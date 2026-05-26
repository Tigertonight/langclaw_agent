/**
 * Core 通用域 DomainPack。
 *
 * 业务无关的通用能力：知识制度问答规则、/help 命令等。
 * 同时承载"核心业务"（组织架构、客户、订单、销售报表）的 intent 推断逻辑。
 */

import type { DomainPack, IntentCodeInferenceFn, DomainQueryAdapter, EvidenceInferenceDefinition, FactExtractorDefinition, ExtractedFact, FollowUpPlannerHeuristic, KnownEntityProbe } from "../types.js";
import type { JsonObject, ToolCall } from "../../types/agent-contracts.js";
import { loadJson } from "../../data/load-json.js";
import { getResourceDataPath } from "../runtime-registry.js";
import { CORE_RESOURCES, CORE_FIELD_LABELS } from "./resources.js";
import { CORE_COMMANDS } from "./commands.js";
import { CORE_DETERMINISTIC_RULES } from "./deterministic-rules.js";
import { CORE_QUERY_ADAPTER } from "./query-adapter.js";
import { CORE_REPORT_COMPOSERS } from "./report-composers.js";
import { CORE_TOOL_RESULT_SUMMARIZERS, CORE_TOOL_OBSERVATION_SANITIZERS } from "./tool-event-summarizers.js";
import { createTaskContinuityPlugin } from "../../tasks/task-continuity-plugin.js";
import { createSkillCuratorPlugin } from "../../evolution/skill-curator-plugin.js";
import { createMaintenanceSchedulerPlugin } from "../../runtime/maintenance-scheduler-plugin.js";

export const corePack: DomainPack = {
  id: "core",
  name: "核心通用域",
  version: "1.0.0",
  conflictPolicy: "error",
  description: "业务无关的通用能力，如知识制度问答、帮助命令等。",

  resources: CORE_RESOURCES,
  commands: CORE_COMMANDS,
  deterministicRules: CORE_DETERMINISTIC_RULES,
  intentDir: "data/domains/core/intent-codes",
  fieldLabels: {
    ...CORE_FIELD_LABELS,
    // ── fact name 标签（供 readableFactNameFromRegistry 查找） ──
    direct_leader: "直属上级",
    direct_reports: "直属下级",
    org_profile: "组织/岗位信息",
    customer_scope: "客户范围",
    aggregate_metric: "统计指标",
    business_status: "业务状态",
    knowledge_context: "知识库依据",
  },

  // ── intent code 映射（resource → intent_code） ──
  intentCodeMappings: {
    customers: "business.customer_query",
    orders: "business.order_query",
    sales_reports: "business.sales_report_query",
    employees: "org.employee_query",
    departments: "org.department_query",
  },

  // ── fact key 映射（resource → fact key，用于 extractFacts） ──
  factKeyMappings: {
    customers: "customer_scope",
    orders: "business_status",
    sales_reports: "aggregate_metric",
    employees: "org_profile",
    departments: "org_profile",
  },

  // ── 工具标签 ──
  toolLabels: {
    query_business_data: "业务数据查询",
    list_my_customers: "客户列表查询",
    query_customer: "客户详情查询",
    query_order: "订单查询",
    query_sales_report: "销售报表查询",
    retrieve_knowledge: "知识库检索",
    safe_compute: "安全计算",
  },

  // ── 查询 schema ──
  querySchemas: {
    customers: {
      entity: "customer",
      fields: ["id", "name", "owner_user_id", "department", "tier", "industry", "industry_category", "annual_revenue", "deal_status", "follow_status", "renewal_status", "last_contacted_at", "next_follow_up_at", "contract_expire_at"],
      defaultFields: ["id", "name", "tier", "industry", "industry_category", "deal_status", "follow_status", "renewal_status", "annual_revenue", "next_follow_up_at", "contract_expire_at"],
      defaultSort: [{ field: "next_follow_up_at", direction: "asc" }],
    },
    orders: {
      entity: "order",
      fields: ["id", "customer_id", "customer_name", "status", "amount", "created_at", "expected_delivery"],
      defaultFields: ["id", "customer_name", "status", "amount", "created_at", "expected_delivery"],
      defaultSort: [{ field: "created_at", direction: "desc" }],
    },
    sales_reports: {
      entity: "sales_report",
      fields: ["department", "period", "revenue", "pipeline", "top_customers"],
      defaultFields: ["department", "period", "revenue", "pipeline", "top_customers"],
      defaultSort: [],
    },
    employees: {
      entity: "employee",
      fields: ["userid", "name", "department_name", "position", "role", "direct_leader", "reporting", "main_department", "department"],
      defaultFields: ["userid", "name", "department_name", "position", "role", "direct_leader", "reporting", "main_department", "department"],
      defaultSort: [{ field: "main_department", direction: "asc" }, { field: "userid", direction: "asc" }],
    },
    departments: {
      entity: "department",
      fields: ["id", "name", "parentid", "leader_userid", "vertical_relation", "vertical_department", "relation"],
      defaultFields: ["id", "name", "parentid", "leader_userid", "vertical_relation", "vertical_department", "relation"],
      defaultSort: [{ field: "order", direction: "asc" }],
    },
  },

  // ── 资源检测关键词（供 query-parser 判断用户问题涉及哪个资源） ──
  resourceDetectionKeywords: {
    sales_reports: ["成交额", "销售额", "报表", "pipeline", "业绩"],
    orders: ["订单", "发货", "交付", "状态"],
    customers: ["客户", "等级", "行业", "签单", "续签", "跟进", "名下"],
    employees: ["组织", "组织架构", "部门", "部有", "上级", "下级", "下属", "下辖", "下面", "团队", "同学", "汇报", "直属", "领导", "主管", "岗位", "员工", "人员", "多少人", "负责人", "我们店", "门店"],
    departments: ["组织", "组织架构", "部门", "部有", "上级", "下级", "下属", "下辖", "下面", "团队", "同学", "汇报", "直属", "领导", "主管", "岗位", "员工", "人员", "多少人", "负责人", "我们店", "门店"],
  },

  // ── intent code 推断函数（从消息文本推断 intent_code） ──
  intentCodeInferenceFns: [
    ((message: string) => {
      if (/(组织|部门|上级|下级|下属|员工|人员|岗位|汇报|负责人|主管|领导|我们店|门店)/.test(message)) return "org.employee_query";
      return null;
    }) satisfies IntentCodeInferenceFn,
    ((message: string) => {
      if (/(订单|发货|交付)/.test(message)) return "business.order_query";
      return null;
    }) satisfies IntentCodeInferenceFn,
    ((message: string) => {
      if (/(销售额|成交额|报表|pipeline|业绩)/i.test(message)) return "business.sales_report_query";
      return null;
    }) satisfies IntentCodeInferenceFn,
    ((message: string) => {
      if (/(客户|签单|续签|跟进|行业)/.test(message)) return "business.customer_query";
      return null;
    }) satisfies IntentCodeInferenceFn,
  ],

  // ── 本地分类关键词（供 local-llm classifyIntent 使用） ──
  classificationKeywords: {
    data_query: ["客户", "订单", "成交额", "销售额", "报表", "pipeline", "合同金额", "发货", "交付", "状态", "进展", "列表", "名下", "负责", "多少", "几个", "数量", "签单", "续签", "跟进", "行业", "组织", "组织架构", "部门", "上级", "下级", "下属", "下辖", "下面", "团队", "同学", "汇报", "直属", "领导", "主管", "岗位"],
    knowledge_qa: ["制度", "政策", "流程", "标准", "手册", "报销", "试用期", "权限", "审批", "规则"],
  },

  // ── 路由提示词片段 ──
  routerPromptHints: [
    "knowledge_qa 表示询问制度/政策/流程/规则，例如：怎么请病假、年假制度是什么、报销标准是什么。",
    "查询组织架构、部门列表、员工所属部门、直属上级、下属、汇报关系，也属于 data_query，因为这些来自企业通讯录/组织数据。",
    "如果用户只是问制度、政策、流程、规则，走 knowledge.policy_qa，不要因为出现员工等词就生成组织查询。",
    "如果用户查询业务数据、组织架构、部门、员工、上级、下级、人数、名单，则输出对应 business/org intent_code。",
    "组织/员工/上下级/汇报关系属于 employees 或 departments，不属于知识库问答。",
  ],

  // ── 答案生成提示词片段 ──
  answerPromptHints: [
    "回答组织架构或人员关系时，优先使用姓名、岗位、部门，不要只把 userid 当作答案；userid 只能作为补充信息。",
  ],

  // ── 报告组装器（用于 generateAnswer 的 tool-specific 答案模板） ──
  reportComposers: CORE_REPORT_COMPOSERS,

  // ── Tool 结果文案/observation 形状（runtime/agent-events 用） ──
  toolResultSummarizers: CORE_TOOL_RESULT_SUMMARIZERS,
  toolObservationSanitizers: CORE_TOOL_OBSERVATION_SANITIZERS,

  // ── 作用域 sentinel（按当前用户作用域过滤的 filter value 占位符） ──
  scopeSentinels: ["__CURRENT_USER_REPORTS__", "__CURRENT_USER_SUBORDINATES__"],

  // ── Fact extractor（employees 资源的多 fact 派生） ──
  factExtractors: [
    {
      resource: "employees",
      extract({ data }) {
        const rows = Array.isArray(data.rows) ? (data.rows as JsonObject[]).filter(isObject) : [];
        const facts: ExtractedFact[] = [];
        if (data.operation === "aggregate") {
          facts.push({ key: "aggregate_metric", text: summarizeEmployeeData(data) });
        }
        const hasReportingProfile = rows.some((row) => {
          const reporting = isObject(row.reporting) ? row.reporting : {};
          const directLeaderProfiles = Array.isArray(row.direct_leader_profiles) ? row.direct_leader_profiles : [];
          return directLeaderProfiles.length > 0 || reporting.manager_profile || reporting.store_manager_profile;
        });
        if (hasReportingProfile) {
          facts.push({ key: "direct_leader", text: "已查询到直属上级或汇报关系信息。" });
        }
        const query = isObject(data.query) ? data.query : {};
        const queryFilters = Array.isArray(query.filters) ? (query.filters as JsonObject[]).filter(isObject) : [];
        if (rows.length > 1 || queryFilters.some((filter) => filter.field === "direct_leader")) {
          facts.push({ key: "direct_reports", text: `已查询到 ${rows.length} 名下级或相关员工。` });
        }
        const hasOrgProfile = rows.some((row) => row.department_name || row.position || row.main_department || row.department);
        if (hasOrgProfile) {
          facts.push({ key: "org_profile", text: "已查询到员工所属组织、岗位或部门信息。" });
        }
        if (!facts.length) {
          facts.push({ key: "org_profile", text: summarizeEmployeeData(data) });
        }
        return facts;
      },
    } satisfies FactExtractorDefinition,
  ],

  // ── 证据推断函数（用于 agent-task-state 的 inferRequiredFacts） ──
  evidenceInferenceFns: [
    {
      id: "core.evidence",
      inferFacts(message: string, route) {
        const facts: string[] = [];
        const intent = route?.intent ?? "";
        if (["data_query", "mixed"].includes(intent)) {
          if (/(上级|汇报|直属|领导|主管)/.test(message)) facts.push("direct_leader");
          if (/(下属|下级|下辖|下面|团队|同学)/.test(message)) facts.push("direct_reports");
          if (/(组织|部门|岗位)/.test(message)) facts.push("org_profile");
          if (/(客户|名下|负责)/.test(message)) facts.push("customer_scope");
          if (/(多少|几个|数量|统计|有多少)/.test(message)) facts.push("aggregate_metric");
          if (/(状态|进展|交付|发货|订单)/.test(message)) facts.push("business_status");
        }
        return facts;
      },
    } satisfies EvidenceInferenceDefinition,
  ],

  // ── 能力描述 ──
  capabilityDescriptions: ["查询业务数据", "查询组织架构", "解读公司制度"],

  // ── 独立任务关键词 ──
  standaloneTaskKeywords: ["客户", "订单", "成交额", "pipeline", "报表", "组织架构", "组织", "员工", "部门", "负责人", "主管", "领导", "知识库", "制度", "政策", "流程", "规则", "标准", "手册", "报销", "试用期"],

  // ── 数据查询描述关键词 ──
  dataQueryKeywords: ["客户数据", "订单数据", "销售报表", "组织架构", "员工信息"],

  // ── 权限规则 ──
  permissionRules: [
    (input) => {
      if (input.resource === "customers" && input.userPermissions.has("customer:read")) return { ok: true };
      if (input.resource === "orders" && input.userPermissions.has("order:read")) return { ok: true };
      if (input.resource === "sales_reports" && input.userPermissions.has("sales_report:read")) return { ok: true };
      if ((input.resource === "employees" || input.resource === "departments") && input.userPermissions.has("org:read")) return { ok: true };
      return null;
    },
  ],

  // ── 实体别名（用于 entity-resolver 部门名称匹配） ──
  entityAliases: {
    "行政人事部": ["行政部", "人事部", "HR部", "HR"],
    "市场与新媒体部": ["市场部", "新媒体部"],
    "前台接待": ["前台"],
  },
  entityAliasSuffixRules: [
    { suffix: "组", replacement: "" },
    { suffix: "部", replacement: "" },
  ],

  // ── 查询适配器（用于 conversation-context 的 inferTask 等） ──
  queryAdapters: [
    CORE_QUERY_ADAPTER,
    {
      domain: "core",
      supports: () => false,
      inferTask(question: string) {
        if (/(客户|订单|销售额|成交额|pipeline|报表)/i.test(question)) {
          return { intent_code: "business.query", selected_skill: "business-query", target: "", operation: "search" };
        }
        if (/(组织架构|部门|员工|下属|上级|汇报关系)/.test(question)) {
          return { intent_code: "org.employee_query", selected_skill: "business-query", target: "employees", operation: "search" };
        }
        return null;
      },
    } satisfies DomainQueryAdapter,
  ],

  // ── Runtime 插件声明 ──
  // 这些插件本质上是跨域共享的业务能力（任务连续性 / skill 治理 / 维护调度），
  // 而不是引擎通用能力（transcript/metrics/promptAuthority/evolution 仍由引擎内置）。
  // 由 EngineHost 在 init() 末尾按 priority 排序、按 id 去重后挂载。
  runtimePlugins: [
    { id: "core.task-continuity", priority: 110, plugin: createTaskContinuityPlugin() },
    { id: "core.skill-curator", priority: 120, plugin: createSkillCuratorPlugin() },
    { id: "core.maintenance-scheduler", priority: 130, plugin: createMaintenanceSchedulerPlugin() },
  ],

  // ── 本地 LLM 启发式：MIXED 意图下触发知识检索的关键词（通用知识库类） ──
  knowledgeRetrievalKeywords: [
    "制度", "政策", "流程", "标准", "手册",
    "权限", "审批", "规则", "依据", "资料", "文档",
  ],

  // ── 本地 LLM 启发式：通用敏感信息词（PII / 跨域权限词） ──
  dangerousQuestionKeywords: ["工资", "身份证", "银行卡"],

  // ── 本地 LLM 启发式：知识库重要句关键词（通用权限/敏感类） ──
  importantSentenceKeywords: ["权限", "敏感"],

  // ── 本地 LLM 启发式：知识库 chunk heading 命中规则（通用权限类） ──
  knowledgeChunkHeadingHints: [
    { questionKeyword: "权限", matchHeadings: ["权限", "最小权限", "客户数据访问"] },
  ],

  // ── 数据查找信号词（HR/组织域专属，用于 hasExplicitDataLookup 拼接） ──
  dataLookupHints: ["上级", "下级", "下属", "负责人", "成交额", "销售额", "pipeline"],

  // ── Follow-up planner 启发式：HR 上下级查询补充 ──
  followUpPlannerHeuristics: [
    {
      id: "core.org-followup",
      priority: 100,
      plan({ question, previousCalls }) {
        const calls: ToolCall[] = [];
        const asksLeader = ["上级", "汇报", "直属", "领导", "主管"].some((word) => question.includes(word));
        const asksSubordinates = ["下属", "下级", "下辖", "下面", "团队", "同学"].some((word) => question.includes(word));

        if (asksLeader && !hasEmployeeFilterCall(previousCalls, "userid", "__CURRENT_USER__")) {
          calls.push(buildEmployeeQueryCall({
            filters: [{ field: "userid", op: "eq", value: "__CURRENT_USER__" }],
            asksAggregate: false,
            limit: 1,
          }));
        }

        if (asksSubordinates && !hasEmployeeFilterCall(previousCalls, "direct_leader", "__CURRENT_USER__")) {
          calls.push(buildEmployeeQueryCall({
            filters: [{ field: "direct_leader", op: "contains", value: "__CURRENT_USER__" }],
            asksAggregate: false,
            limit: 50,
          }));
        }

        return calls;
      },
    } satisfies FollowUpPlannerHeuristic,
  ],

  // ── 已知命名实体探针：员工名 ──
  knownEntityProbes: [
    {
      id: "core.employee-name",
      async probe(question: string) {
        const path = getResourceDataPath("employees");
        if (!path) return false;
        const employees = await loadJson(path) as Array<{ name?: string }>;
        return employees.some((employee) => typeof employee.name === "string" && question.includes(employee.name));
      },
    } satisfies KnownEntityProbe,
  ],
};

interface BuildEmployeeQueryArgs {
  filters: JsonObject[];
  asksAggregate: boolean;
  limit: number;
}

function buildEmployeeQueryCall({ filters, asksAggregate, limit }: BuildEmployeeQueryArgs): ToolCall {
  return {
    name: "query_business_data",
    args: {
      resource: "employees",
      operation: asksAggregate ? "aggregate" : "search",
      filters,
      metrics: asksAggregate ? [{ type: "count", field: "userid", as: "employee_count" }] : [],
      fields: ["userid", "name", "department_name", "position", "role", "direct_leader", "reporting", "main_department", "department"],
      sort: [{ field: "main_department", direction: "asc" }, { field: "userid", direction: "asc" }],
      limit,
    },
  };
}

function hasEmployeeFilterCall(calls: ToolCall[], field: string, value: unknown): boolean {
  return calls.some((call) => call.name === "query_business_data"
    && call.args?.resource === "employees"
    && (call.args?.filters as Array<{ field?: string; value?: unknown }> | undefined)
      ?.some((filter) => filter.field === field && filter.value === value));
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function summarizeEmployeeData(data: JsonObject): string {
  if (data.operation === "aggregate") return `员工统计完成，匹配 ${data.total ?? 0} 条记录。`;
  const rows = Array.isArray(data.rows) ? data.rows : [];
  return `员工查询完成，匹配 ${data.total ?? 0} 条记录，返回 ${rows.length} 条。`;
}
