import { composeReportFromRegistry } from "../domains/runtime-registry.js";
import { inferIntentCode } from "../agent/intent-codes.js";
import { INTENTS } from "../agent/ports.js";
import { readableResourceNameFromRegistry, getRuntimeRegistry, isDomainDataQueryIntent, isAnyDomainDataQuestion, inferAnalysisIntentFromRegistry, getClassificationKeywords, getClassificationPatterns, getLocalPolicyQuestionPatterns, getLocalPlannerHeuristics, getKnowledgeRetrievalKeywords, getDangerousQuestionKeywords, getKnowledgeChunkHeadingHints, getImportantSentenceKeywords, applyFollowUpPlannersFromRegistry, probeKnownEntityFromRegistry, getDataLookupHints } from "../domains/runtime-registry.js";
import { compileBusinessQueryIR } from "../query/query-compiler.js";
import {
  isBusinessDataQuestion,
  planDomainMultiQuery,
  parseBusinessQuery
} from "../query/query-parser.js";
import type { JsonObject, QueryIR, Route, ToolCall, ToolResult, UserContext } from "../types/agent-contracts.js";

// 引擎内置的通用注入/越权防御词；业务专属词由各域通过 dangerousQuestionKeywords 贡献。
const ENGINE_DANGEROUS_KEYWORDS = ["忽略", "绕过", "导出所有"];

function isDangerousQuestion(question: string): boolean {
  const text = String(question ?? "");
  if (ENGINE_DANGEROUS_KEYWORDS.some((word) => text.includes(word))) return true;
  return getDangerousQuestionKeywords().some((word) => text.includes(word));
}

/** 动态获取 data_query 关键词：全部从 registry 获取 */
function getDataKeywords(): string[] {
  return getClassificationKeywords()[INTENTS.DATA_QUERY] ?? [];
}

/** 动态获取 knowledge_qa 关键词：全部从 registry 获取 */
function getKBKeywords(): string[] {
  return getClassificationKeywords()[INTENTS.KNOWLEDGE_QA] ?? [];
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
    const workflowIntent = matchWorkflowIntent(question);
    const asksDomainData = isAnyDomainDataQuestion(question);
    const risky = isDangerousQuestion(question);
    const policyMatch = matchLocalPolicyQuestion(question);

    if (/^(你好|hi|hello|在吗)/i.test(question.trim())) {
      return { intent: INTENTS.SMALLTALK, confidence: 0.95, reason: "问候类问题" };
    }
    if (policyMatch) {
      return { intent: INTENTS.KNOWLEDGE_QA, confidence: 0.88, reason: policyMatch.reason ?? "询问域特定制度或办理规则" };
    }
    if (asksDomainData) {
      return { intent: INTENTS.DATA_QUERY, confidence: 0.9, reason: "查询域特定数据记录" };
    }
    if (hasKb && !hasExplicitDataLookup(question)) {
      return { intent: INTENTS.KNOWLEDGE_QA, confidence: 0.86, reason: "涉及制度、流程或知识库内容" };
    }
    if (workflowIntent) {
      return { intent: workflowIntent, confidence: 0.9, reason: "命中域特定 workflow 分类模式" };
    }
    if (risky && !hasData && !hasKb) {
      return { intent: INTENTS.UNSUPPORTED, confidence: 0.85, reason: "可能涉及敏感或越权请求" };
    }
    if (hasCompute && !hasKb) {
      return { intent: INTENTS.DATA_QUERY, confidence: 0.88, reason: "需要使用受限计算沙箱完成确定性运算" };
    }
    if (hasData && hasKb) {
      return { intent: INTENTS.MIXED, confidence: 0.82, reason: "同时涉及业务数据和知识库内容" };
    }
    if (hasData) {
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

    for (const heuristic of getLocalPlannerHeuristics()) {
      if (heuristic.matches(question)) {
        return heuristic.buildPlan(question);
      }
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
    if (await probeKnownEntityFromRegistry(question)) return { calls: [] };
    const calls = applyFollowUpPlannersFromRegistry(question, previousCalls);
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

/**
 * 通过 registry 查找匹配的本地策略问题模式。
 * 替代硬编码的 isLeavePolicyQuestion。
 */
function matchLocalPolicyQuestion(question: string): { reason?: string } | null {
  for (const pattern of getLocalPolicyQuestionPatterns()) {
    if (pattern.matches(question)) return { reason: pattern.reason };
  }
  return null;
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


function shouldRetrieveKnowledge({ question, route }: { question?: string; route?: Partial<Route> & { intent_code?: string } }): boolean {
  if (isDomainDataQueryIntent(route?.intent_code)) return false;
  if (route?.intent === INTENTS.KNOWLEDGE_QA) return true;
  if (route?.intent !== INTENTS.MIXED) return false;
  const text = String(question ?? "");
  const keywords = getKnowledgeRetrievalKeywords();
  return keywords.some((kw) => text.includes(kw));
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

// 引擎通用查询动词（不带业务色彩）；业务专属信号词由域通过 dataLookupHints 贡献。
const GENERIC_DATA_LOOKUP_VERBS = ["查", "查询", "看一下", "看看", "统计", "多少", "几个", "列表", "有哪些", "都有谁", "状态", "报表"];

function hasExplicitDataLookup(question: unknown): boolean {
  const text = String(question ?? "");
  if (GENERIC_DATA_LOOKUP_VERBS.some((word) => text.includes(word))) return true;
  return getDataLookupHints().some((word) => text.includes(word));
}

/**
 * 扫描 registry 中所有 classifierIntents，返回第一个命中本地分类规则的 intent name。
 * 未命中返回 null。命中关键词或正则均算命中。
 */
function matchWorkflowIntent(question: string): string | null {
  const intents = getRuntimeRegistry()?.allClassifierIntents ?? {};
  const keywords = getClassificationKeywords();
  const patterns = getClassificationPatterns();
  for (const intent of Object.keys(intents)) {
    if (intent === INTENTS.DATA_QUERY || intent === INTENTS.KNOWLEDGE_QA) continue;
    const hits = keywords[intent] ?? [];
    const regs = patterns[intent] ?? [];
    if (hits.some((word) => question.includes(word))) return intent;
    if (regs.some((re) => re.test(question))) return intent;
  }
  return null;
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
  const fieldLabels = readFieldLabels(data, resourceConfig);
  const lines = [`查询到 ${rows.length} 条${label}：`];
  for (const row of rows) {
    const fields = Object.entries(row)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => `${fieldLabels[k] ?? k}：${formatReadableValue(v)}`)
      .join("，");
    lines.push(`- ${fields}`);
  }
  return lines.join("\n");
}

function readFieldLabels(data: DataRecord, resourceConfig?: { displayColumns?: Array<[string, string]>; schema?: Record<string, unknown> }): Record<string, string> {
  const labels: Record<string, string> = {};
  const displayLabels = data.display_field_labels;
  if (displayLabels && typeof displayLabels === "object" && !Array.isArray(displayLabels)) {
    Object.assign(labels, displayLabels as Record<string, string>);
  }
  for (const item of (data.field_metadata ?? []) as DataRecord[]) {
    if (item.key && item.label) labels[String(item.key)] = String(item.label);
  }
  for (const [field, label] of resourceConfig?.displayColumns ?? []) {
    labels[field] = label;
  }
  return labels;
}

function formatReadableValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(formatReadableValue).join("、");
  if (value && typeof value === "object") return JSON.stringify(value);
  if (value === true) return "是";
  if (value === false) return "否";
  return String(value);
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

function summarizeChunk(text: string, question: string): string {
  const sentences = text
    .split(/[。！？\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (question.includes("标准")) {
    return `${sentences.slice(0, 3).join("。")}。`;
  }

  const keywords = getImportantSentenceKeywords();
  const important = sentences.find((sentence) => {
    return keywords.some((word) => question.includes(word) && sentence.includes(word));
  });
  return important ? `${important}。` : `${sentences.slice(0, 2).join("。")}。`;
}

function chooseAnswerChunk(docs: Array<{ text?: string; metadata?: { heading?: string } }>, question: string): { text?: string; metadata?: { heading?: string } } | undefined {
  for (const hint of getKnowledgeChunkHeadingHints()) {
    if (!question.includes(hint.questionKeyword)) continue;
    const matched = docs.find((doc) => hint.matchHeadings.some((heading) => String(doc.metadata?.heading ?? "").includes(heading)));
    if (matched) return matched;
  }
  return docs[0];
}
