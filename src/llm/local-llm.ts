import { loadJson } from "../data/load-json.js";
import { composeReportFromRegistry } from "../domains/runtime-registry.js";
import { inferIntentCode } from "../agent/intent-codes.js";
import { INTENTS } from "../agent/ports.js";
import { readableResourceNameFromRegistry, getRuntimeRegistry, isDomainDataQueryIntent, isAnyDomainDataQuestion, inferAnalysisIntentFromRegistry, getClassificationKeywords, getClassificationPatterns, getResourceDataPath } from "../domains/runtime-registry.js";
import { compileBusinessQueryIR } from "../query/query-compiler.js";
import {
  isBusinessDataQuestion,
  planDomainMultiQuery,
  parseBusinessQuery
} from "../query/query-parser.js";
import type { JsonObject, QueryIR, Route, ToolCall, ToolResult, UserContext } from "../types/agent-contracts.js";

// 安全关键词（域无关）
const DANGEROUS_KEYWORDS = ["忽略", "绕过", "导出所有", "全部客户", "所有客户", "工资", "身份证", "银行卡"];

/** 动态获取 data_query 关键词：全部从 registry 获取 */
function getDataKeywords(): string[] {
  return getClassificationKeywords()["data_query"] ?? [];
}

/** 动态获取 knowledge_qa 关键词：全部从 registry 获取 */
function getKBKeywords(): string[] {
  return getClassificationKeywords()["knowledge_qa"] ?? [];
}

/** 动态获取 leave_request 关键词：全部从 registry 获取 */
function getLeaveKeywords(): string[] {
  return getClassificationKeywords()["leave_request"] ?? [];
}

interface ConversationContext {
  continuation?: { is_likely_continuation?: boolean };
  last_task?: { intent?: string; intent_code?: string; target?: string };
  [key: string]: unknown;
}

interface LocalToolResult extends Record<string, unknown> {
  ok?: boolean;
  tool?: string;
  error?: string;
  message?: string;
  data?: Record<string, unknown>;
}

type DataRecord = Record<string, ReturnType<typeof JSON.parse>>;

interface LLMInput {
  user?: UserContext;
  question?: string;
  history?: Array<Record<string, unknown>>;
  route?: Partial<Route> & { query_ir?: QueryIR; intent?: string };
  conversationContext?: ConversationContext;
  docs?: Array<{ text?: string; metadata?: { title?: string; heading?: string } }>;
  toolResults?: LocalToolResult[];
  enterpriseContext?: Record<string, unknown>;
  agentState?: Record<string, unknown>;
  state?: Record<string, unknown>;
  previousCalls?: ToolCall[];
  queryIR?: QueryIR;
}

export interface ToolPlanResult {
  calls: ToolCall[];
  ir?: unknown;
  reason?: string;
  clarification?: string;
}

interface StreamCallbacks {
  onToken?: (token: string) => Promise<void> | void;
}

export class LocalLLMClient {

  async recognizeIntent({ user, question = "", history = [], conversationContext }: LLMInput) {
    const route = await this.classifyIntent({ user, question, history, conversationContext });
    const queryIR: QueryIR | null = null;
    return {
      ...route,
      intent_code: conversationContext?.continuation?.is_likely_continuation && conversationContext?.last_task?.intent_code
        ? conversationContext.last_task.intent_code
        : inferIntentCode({ intent: route.intent, message: question }),
      query_ir: queryIR,
      router: "local"
    };
  }

  async classifyIntent({ question = "", history = [], conversationContext }: LLMInput) {
    if (conversationContext?.continuation?.is_likely_continuation && conversationContext?.last_task?.intent) {
      return {
        intent: conversationContext.last_task.intent,
        confidence: 0.88,
        reason: "当前消息是对上一轮任务的范围、时间或筛选条件补充。"
      };
    }
    const hasData = getDataKeywords().some((word) => question.includes(word)) || !!inferAnalysisIntentFromRegistry(question) || await isBusinessDataQuestion(question);
    const hasKb = getKBKeywords().some((word) => question.includes(word));
    const hasCompute = isComputeQuestion(question);
    const hasLeave = isLeaveIntent(question);
    const asksLeaveRecords = isAnyDomainDataQuestion(question);
    const risky = DANGEROUS_KEYWORDS.some((word) => question.includes(word));
    const asksLeavePolicy = isLeavePolicyQuestion(question);
    const hasOrgData = await isOrgDataQuestion(question);

    if (/^(你好|hi|hello|在吗)/i.test(question.trim())) {
      return { intent: INTENTS.SMALLTALK, confidence: 0.95, reason: "问候类问题" };
    }
    if (asksLeavePolicy) {
      return { intent: INTENTS.KNOWLEDGE_QA, confidence: 0.88, reason: "询问域特定制度或办理规则" };
    }
    if (asksLeaveRecords) {
      return { intent: INTENTS.DATA_QUERY, confidence: 0.9, reason: "查询域特定数据记录" };
    }
    if (hasKb && !hasExplicitDataLookup(question)) {
      return { intent: INTENTS.KNOWLEDGE_QA, confidence: 0.86, reason: "涉及制度、流程或知识库内容" };
    }
    if (hasLeave) {
      // 域特定 workflow intent（如 "leave_request"），由 DomainPack.classificationPatterns 声明
      return { intent: "leave_request", confidence: 0.9, reason: "命中域特定 workflow 分类模式" };
    }
    if (risky && !hasData && !hasKb) {
      return { intent: INTENTS.UNSUPPORTED, confidence: 0.85, reason: "可能涉及敏感或越权请求" };
    }
    if (hasCompute && !hasKb) {
      return { intent: INTENTS.DATA_QUERY, confidence: 0.88, reason: "需要使用受限计算沙箱完成确定性运算" };
    }
    if ((hasData || hasOrgData) && hasKb) {
      return { intent: INTENTS.MIXED, confidence: 0.82, reason: "同时涉及业务数据和知识库内容" };
    }
    if (hasData || hasOrgData) {
      return { intent: INTENTS.DATA_QUERY, confidence: 0.86, reason: "涉及业务数据或组织数据查询" };
    }
    if (hasKb) {
      return { intent: INTENTS.KNOWLEDGE_QA, confidence: 0.86, reason: "涉及制度、流程或知识库内容" };
    }
    return { intent: INTENTS.KNOWLEDGE_QA, confidence: 0.55, reason: "默认优先检索知识库" };
  }

  async planToolCalls({ user, question = "", history = [], route, conversationContext }: LLMInput): Promise<ToolPlanResult> {
    if (isComputeQuestion(question)) {
      return {
        calls: [{
          name: "safe_compute",
          args: buildSafeComputeArgs(question)
        }]
      };
    }

    if (isPersonalCustomerOverviewQuestion(question)) {
      return buildPersonalCustomerOverviewPlan();
    }

    if (shouldRetrieveKnowledge({ question, route })) {
      return buildKnowledgeRetrievalPlan(question);
    }

    const domainIRs = await planDomainMultiQuery({ question });
    if (domainIRs?.length > 1) {
      const plans = await Promise.all(domainIRs.map((queryIR) => compileBusinessQueryIR(queryIR, { question })));
      return {
        calls: plans.flatMap((plan) => plan.calls ?? []),
        ir: domainIRs
      };
    }
    const ir = route?.query_ir ?? await parseBusinessQuery({ user, question, history, conversationContext });
    if (!ir) return { calls: [] };
    return compileBusinessQueryIR(ir, { question });
  }

  async planToolCallsFromIR({ queryIR, question = "" }: LLMInput): Promise<ToolPlanResult> {
    if (!queryIR) return { calls: [] };
    return compileBusinessQueryIR(queryIR, { question });
  }

  async planFollowUpToolCalls({ question = "", previousCalls = [] }: LLMInput): Promise<ToolPlanResult> {
    const calls: ToolCall[] = [];
    const employeeName = await extractEmployeeName(question);
    if (employeeName) return { calls };

    const asksSubordinates = ["下属", "下级", "下辖", "下面", "团队", "同学"].some((word) => question.includes(word));
    const asksLeader = ["上级", "汇报", "直属", "领导", "主管"].some((word) => question.includes(word));

    if (asksLeader && !hasEmployeeSelfQuery(previousCalls)) {
      calls.push(buildEmployeeQueryCall({
        filters: [{ field: "userid", op: "eq", value: "__CURRENT_USER__" }],
        asksAggregate: false,
        limit: 1
      }));
    }

    if (asksSubordinates && !hasSubordinateQuery(previousCalls)) {
      calls.push(buildEmployeeQueryCall({
        filters: [{ field: "direct_leader", op: "contains", value: "__CURRENT_USER__" }],
        asksAggregate: false,
        limit: 50
      }));
    }

    return { calls };
  }

  async decideNextAction({ question = "", route, history = [], conversationContext, user, state, toolResults = [], previousCalls = [] }: LLMInput) {
    if (!previousCalls.length && !toolResults.length) {
      const plan = await this.planToolCalls({ user, question, history, route, conversationContext });
      if (plan.clarification && !plan.calls?.length) {
        return {
          decision_source: "local",
          thought_summary: "当前信息不足，需要先向用户追问。",
          reason: plan.clarification,
          action: {
            type: "ask_user",
            question: plan.clarification
          }
        };
      }
      if (plan.calls?.length) {
        return {
          decision_source: "local",
          thought_summary: "先调用工具获取回答所需的事实依据。",
          reason: plan.reason ?? "本地规划判断需要补充工具结果。",
          action: {
            type: "tool_call",
            tools: plan.calls
          },
          plan_update: plan.ir ? [`查询 ${Array.isArray(plan.ir) ? plan.ir.length : 1} 组结构化数据`] : undefined
        };
      }
    }

    const followUp = await this.planFollowUpToolCalls({ question, previousCalls, toolResults, route, agentState: state });
    if (followUp.calls?.length) {
      return {
        decision_source: "local",
        thought_summary: "观察上一轮结果后，仍需要补充查询。",
        reason: followUp.reason ?? "上一轮结果还不足以完整回答。",
        action: {
          type: "tool_call",
          tools: followUp.calls
        }
      };
    }

    return {
      decision_source: "local",
      thought_summary: "已有信息可以进入回答阶段。",
      reason: "没有发现新的必要工具动作。",
      action: {
        type: "answer"
      }
    };
  }

  async generateAnswer({ question = "", route = {}, docs = [], toolResults = [], agentState }: LLMInput) {
    if (route.intent === INTENTS.SMALLTALK) {
      return { answer: "你好，我可以帮你查询权限范围内的企业数据，也可以回答知识库里的制度和流程问题。" };
    }

    const denied = toolResults.find((result) => result.ok === false && result.error === "permission_denied");
    if (denied) {
      return { answer: denied.message };
    }

    const notFound = toolResults.find((result) => result.ok === false && result.error === "not_found");
    if (notFound && docs.length === 0) {
      return { answer: `${notFound.message}目前没有足够上下文继续判断。` };
    }

    const lines: string[] = [];
    const successfulTools = toolResults.filter((result) => result.ok);

    // 所有 tool-specific 答案模板统一由 registry 中注册的 reportComposers 处理
    const composedAnswer = composeReportFromRegistry({ question, route, toolResults: successfulTools as ToolResult[] });
    if (composedAnswer) {
      return composedAnswer;
    }

    // 仅处理通用工具结果（query_business_data / safe_compute）
    for (const result of successfulTools) {
      if (result.tool === "query_business_data") {
        lines.push(formatBusinessDataResult(result.data));
      }
      if (result.tool === "safe_compute") {
        lines.push(formatSafeComputeResult(result.data));
      }
    }

    if (docs.length > 0) {
      const best = chooseAnswerChunk(docs, question);
      const summary = summarizeChunk(best?.text ?? "", question);
      if (summary) lines.push(summary);
    }

    if (lines.length === 0) {
      return { answer: "我没有在可访问的数据或知识库中找到足够依据，暂时无法确认。" };
    }

    const sourceText = docs.length > 0
      ? `\n\n参考来源：${docs.map((doc) => `${doc.metadata.title} / ${doc.metadata.heading}`).join("；")}`
      : "";

    return { answer: `${lines.join("\n")}${sourceText}` };
  }

  async streamAnswer(input: LLMInput, { onToken }: StreamCallbacks = {}) {
    const result = await this.generateAnswer(input);
    for (const token of splitForStreaming(result.answer)) {
      await onToken?.(token);
      await new Promise((resolve) => setTimeout(resolve, 12));
    }
    return result;
  }
}

function isLeavePolicyQuestion(question: string): boolean {
  const hasLeave = isLeaveIntent(question);
  if (!hasLeave) return false;
  return ["怎么", "如何", "制度", "政策", "流程", "规则", "标准", "说明", "问下", "了解"].some((word) => question.includes(word));
}

function isComputeQuestion(question: unknown): boolean {
  const text = String(question ?? "");
  if (/(计算|算一下|求一下|运算|百分比|比例|平均|均值|总和|合计|四舍五入|保留\d+位|平方|开方|方差|标准差)/.test(text)) return true;
  return /(\d+(?:\.\d+)?)\s*[-+*/%^]\s*(\d+(?:\.\d+)?)/.test(text);
}

function buildSafeComputeArgs(question: unknown): JsonObject {
  const expression = extractMathExpression(question);
  if (expression) {
    return {
      mode: "expression",
      code: expression,
      timeout_ms: 1000
    };
  }

  return {
    mode: "script",
    code: [
      "const text = input.question;",
      "const numbers = String(text).match(/-?\\d+(?:\\.\\d+)?/g)?.map(Number) ?? [];",
      "result = { numbers, count: numbers.length, sum: numbers.reduce((a, b) => a + b, 0), average: numbers.length ? numbers.reduce((a, b) => a + b, 0) / numbers.length : null };"
    ].join("\n"),
    input: { question: String(question ?? "") },
    timeout_ms: 1000
  };
}

function isPersonalCustomerOverviewQuestion(question: unknown): boolean {
  const text = String(question ?? "");
  const mentionsOwnedCustomers = /(\u6211\u7684|\u540d\u4e0b|\u8d1f\u8d23|\u6211\u8d1f\u8d23).{0,10}\u5ba2\u6237/.test(text)
    || /\u5ba2\u6237.{0,10}(\u6211\u7684|\u540d\u4e0b|\u8d1f\u8d23|\u6211\u8d1f\u8d23)/.test(text);
  const asksForActionableReview = /(\u8ba2\u5355|\u8ddf\u8fdb|\u4f18\u5148|\u6700\u8fd1|\u60c5\u51b5|\u98ce\u9669|\u7eed\u7b7e|\u5f85\u8ddf\u8fdb|\u770b\u770b|\u68c0\u67e5|\u5206\u6790)/.test(text);
  return mentionsOwnedCustomers && asksForActionableReview;
}

function buildPersonalCustomerOverviewPlan(): ToolPlanResult {
  return {
    calls: [
      {
        name: "query_business_data",
        args: {
          resource: "customers",
          operation: "search",
          filters: [],
          metrics: [],
          fields: [
            "id",
            "name",
            "tier",
            "industry",
            "industry_category",
            "deal_status",
            "follow_status",
            "renewal_status",
            "annual_revenue",
            "last_contacted_at",
            "next_follow_up_at",
            "contract_expire_at"
          ],
          sort: [{ field: "next_follow_up_at", direction: "asc" }],
          limit: 20,
          display: {
            domain: "sales",
            target: "customers",
            operation: "search",
            reason: "\u5148\u67e5\u8be2\u5f53\u524d\u7528\u6237\u53ef\u8bbf\u95ee\u7684\u5ba2\u6237\uff0c\u518d\u7ed3\u5408\u8ba2\u5355\u5224\u65ad\u4f18\u5148\u8ddf\u8fdb\u9879\u3002"
          }
        }
      },
      {
        name: "query_business_data",
        args: {
          resource: "orders",
          operation: "search",
          filters: [],
          metrics: [],
          fields: [
            "id",
            "customer_id",
            "customer_name",
            "status",
            "amount",
            "created_at",
            "expected_delivery"
          ],
          sort: [{ field: "created_at", direction: "desc" }],
          limit: 20,
          display: {
            domain: "sales",
            target: "orders",
            operation: "search",
            reason: "\u7ee7\u7eed\u67e5\u8be2\u6388\u6743\u5ba2\u6237\u7684\u6700\u8fd1\u8ba2\u5355\uff0c\u7528\u4e8e\u52a8\u6001\u89c2\u5bdf\u548c\u56de\u7b54\u3002"
          }
        }
      }
    ],
    reason: "\u8fd9\u662f\u5ba2\u6237\u7ecf\u8425\u7c7b\u7efc\u5408\u95ee\u9898\uff0c\u5148\u67e5\u53ef\u8bbf\u95ee\u5ba2\u6237\u548c\u6700\u8fd1\u8ba2\u5355\uff0c\u518d\u8fdb\u884c\u89c2\u5bdf\u4e0e\u5f52\u7eb3\u3002"
  };
}

function shouldRetrieveKnowledge({ question, route }: { question?: string; route?: Partial<Route> & { intent_code?: string } }): boolean {
  if (isDomainDataQueryIntent(route?.intent_code)) return false;
  if (route?.intent === INTENTS.KNOWLEDGE_QA) return true;
  if (route?.intent !== INTENTS.MIXED) return false;
  return /(制度|政策|流程|标准|手册|报销|试用期|年假|病假|权限|审批|规则|依据|资料|文档)/.test(String(question ?? ""));
}

function buildKnowledgeRetrievalPlan(question: string): ToolPlanResult {
  return {
    calls: [{
      name: "retrieve_knowledge",
      args: {
        query: question,
        topK: 5
      }
    }],
    reason: "用户问题需要资料依据，调用知识检索 skill 获取可引用片段。"
  };
}

function extractMathExpression(question: unknown): string | null {
  const text = String(question ?? "")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/，/g, ",")
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/％/g, "%");
  const candidates = text.match(/[0-9+\-*/%^().,\s]+/g)
    ?.map((item) => item.trim())
    .filter((item) => /\d/.test(item) && /[-+*/%^]/.test(item)) ?? [];
  const candidate = candidates.sort((left, right) => right.length - left.length)[0];
  if (!candidate) return null;
  const safe = candidate.replace(/\^/g, "**");
  if (!/^[0-9+\-*/%().,\s*]+$/.test(safe)) return null;
  return safe;
}

function hasExplicitDataLookup(question: unknown): boolean {
  return /(查|查询|看一下|看看|统计|多少|几个|列表|有哪些|都有谁|状态|报表|pipeline|成交额|销售额|上级|下级|下属|负责人)/.test(String(question ?? ""));
}

async function isOrgDataQuestion(question: string): Promise<boolean> {
  const ir = await parseBusinessQuery({ user: { id: "local", role: "system", department: "" }, question, history: [] });
  return ir?.domain === "organization";
}

function isLeaveIntent(question: string): boolean {
  return getLeaveKeywords().some((word) => question.includes(word))
    || (getClassificationPatterns()["leave_request"] ?? []).some((re) => re.test(question));
}


function buildEmployeeQueryCall({ filters, asksAggregate, limit }: { filters: JsonObject[]; asksAggregate: boolean; limit: number }): ToolCall {
  return {
    name: "query_business_data",
    args: {
      resource: "employees",
      operation: asksAggregate ? "aggregate" : "search",
      filters,
      metrics: asksAggregate ? [{ type: "count", field: "userid", as: "employee_count" }] : [],
      fields: ["userid", "name", "department_name", "position", "role", "direct_leader", "reporting", "main_department", "department"],
      sort: [{ field: "main_department", direction: "asc" }, { field: "userid", direction: "asc" }],
      limit
    }
  };
}

function hasEmployeeSelfQuery(calls: ToolCall[]): boolean {
  return calls.some((call) => call.name === "query_business_data"
    && call.args?.resource === "employees"
    && (call.args?.filters as DataRecord[] | undefined)?.some((filter) => filter.field === "userid" && filter.value === "__CURRENT_USER__"));
}

function hasSubordinateQuery(calls: ToolCall[]): boolean {
  return calls.some((call) => call.name === "query_business_data"
    && call.args?.resource === "employees"
    && (call.args?.filters as DataRecord[] | undefined)?.some((filter) => filter.field === "direct_leader" && filter.value === "__CURRENT_USER__"));
}

function splitForStreaming(text: unknown): string[] {
  return String(text ?? "").match(/.{1,8}/gs) ?? [];
}

function formatBusinessDataResult(data: DataRecord): string {
  // 优先使用 registry 中注册的 resultFormatter（域特定格式化）
  const registry = getRuntimeRegistry();
  const resourceConfig = registry?.allResources[String(data.resource)];
  if (resourceConfig?.resultFormatter) {
    const formatted = resourceConfig.resultFormatter(data);
    if (formatted) return formatted;
  }

  // 聚合查询通用路径
  if (data.operation === "aggregate") {
    const metrics = (data.metrics ?? []) as DataRecord[];
    const count = metrics.find((item: DataRecord) => item.type === "count")?.value ?? data.total;
    return `查询结果：符合条件的${resourceName(data.resource)}共 ${count} 条。`;
  }

  const rows = (data.rows ?? []) as DataRecord[];
  if (rows.length === 0) {
    return `没有找到符合条件的${resourceName(data.resource)}。`;
  }

  // 通用域资源格式化：通过 registry 查找 rowTemplate
  if (resourceConfig?.rowTemplate) {
    const label = readableResourceNameFromRegistry(data.resource, "记录");
    const lines = [`查询到 ${rows.length} 条${label}：`];
    for (const row of rows) {
      lines.push(resourceConfig.rowTemplate(row));
    }
    return lines.join("\n");
  }

  // 最终 fallback：按字段名输出
  const label = readableResourceNameFromRegistry(data.resource, "记录");
  const lines = [`查询到 ${rows.length} 条${label}：`];
  for (const row of rows) {
    const fields = Object.entries(row)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => `${k}: ${v}`)
      .join("，");
    lines.push(`- ${fields}`);
  }
  return lines.join("\n");
}

function formatSafeComputeResult(data: DataRecord | undefined): string {
  const value = data?.value;
  const rendered = typeof value === "object"
    ? JSON.stringify(value, null, 2)
    : String(value);
  const sandbox = data?.sandbox;
  const suffix = sandbox
    ? `\n\n已在用户独立安全沙箱 ${sandbox.dir} 中完成，超时限制 ${sandbox.timeout_ms}ms，未开放 shell、网络和文件系统 API。`
    : "";
  return `计算结果：${rendered}${suffix}`;
}

function resourceName(resource: unknown): string {
  return readableResourceNameFromRegistry(resource, "记录");
}

async function extractEmployeeName(question: string): Promise<string | null> {
  const employees = await loadJson(getResourceDataPath("employees") ?? "data/wecom-users.json") as DataRecord[];
  return employees.find((employee) => question.includes(employee.name))?.name ?? null;
}


function summarizeChunk(text: string, question: string): string {
  const sentences = text
    .split(/[。！？\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (question.includes("标准")) {
    return `${sentences.slice(0, 3).join("。")}。`;
  }

  const important = sentences.find((sentence) => {
    return ["报销", "试用期", "年假", "审批", "权限", "订单", "客户", "敏感"].some(
      (word) => question.includes(word) && sentence.includes(word)
    );
  });
  return important ? `${important}。` : `${sentences.slice(0, 2).join("。")}。`;
}

function chooseAnswerChunk(docs: Array<{ text?: string; metadata?: { heading?: string } }>, question: string): { text?: string; metadata?: { heading?: string } } | undefined {
  const headingHints: Array<[string, string[]]> = [
    ["标准", ["标准", "住宿标准", "交通标准"]],
    ["时限", ["时限", "提交时限"]],
    ["审批", ["审批", "合同审批"]],
    ["试用期", ["试用期"]],
    ["年假", ["年假"]],
    ["权限", ["权限", "最小权限", "客户数据访问"]]
  ];

  for (const [keyword, headings] of headingHints) {
    if (!question.includes(keyword)) continue;
    const matched = docs.find((doc) => headings.some((heading) => String(doc.metadata?.heading ?? "").includes(heading)));
    if (matched) return matched;
  }

  return docs[0];
}
