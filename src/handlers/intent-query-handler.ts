/**
 * IntentQueryHandler：一次性结构化查询执行器。
 *
 *   1. 根据 manifest 拿 tool_binding（PoC 仅支持 dealer.query.inventory）
 *   2. 把 Router 抽好的 params 直接映射成 filters，绝不再做硬编码字面量过滤
 *   3. 调一次 tool（query_business_data），拿到 rows
 *   4. 用 LLM（或模板）把 rows 总结为自然语言 answer
 */
import type {
  IntentManifest,
  IntentQueryResult,
  IntentRegistry,
  IntentToolBinding,
  JsonObject,
  JsonValue,
  QueryFilter,
  QuerySort,
  Route,
  ToolCall,
  ToolExecutionContext,
  ToolResult,
  UserContext
} from "../types/agent-contracts.js";
import type { QueryAdapterRegistry } from "../domains/query-adapter-registry.js";
import type { FilterTransformFn, PermissionRuleFn } from "../domains/types.js";
import { getFieldLabelFromRegistry } from "../domains/runtime-registry.js";
import { translateTimeRangeToIso, formatLocalDate, extractMonthToken } from "../domains/shared/time-utils.js";

interface AnswerLLM {
  generateAnswer?: (input: Record<string, unknown>) => Promise<{ answer?: string }>;
  answerApiKey?: string;
}

type DataRecord = Record<string, ReturnType<typeof JSON.parse>>;
type DisplayColumn = { field: string; label: string };
type MetricFormatter = (value: unknown) => string;

interface QueryToolRegistry {
  execute(call: ToolCall, context?: ToolExecutionContext): Promise<unknown>;
}

interface IntentQueryHandlerOptions {
  llm?: AnswerLLM;
  toolRegistry: QueryToolRegistry;
  registry: IntentRegistry;
  queryAdapterRegistry?: QueryAdapterRegistry;
  /** 外部注入的 filter transform 注册表（来自 DomainRegistry.allFilterTransforms） */
  filterTransformRegistry?: Record<string, FilterTransformFn>;
  /** 外部注入的权限规则列表（来自 DomainRegistry.allPermissionRules） */
  permissionRules?: PermissionRuleFn[];
  /** 外部注入的字段标签（来自 DomainRegistry.allFieldLabels） */
  fieldLabels?: Record<string, string>;
  /** 外部注入的资源配置（来自 DomainRegistry.allResources），供展示层查找 displayColumns */
  resourceConfigs?: Record<string, import("../resources/types.js").ResourceConfig>;
}

interface IntentQueryExecuteInput {
  user?: UserContext;
  workspace?: unknown;
  message?: string;
  intent_code?: string;
  params?: JsonObject;
  route?: Route;
  session?: Record<string, unknown>;
}

interface AggregateInput {
  user?: UserContext;
  workspace?: unknown;
  message?: string;
  manifest: IntentManifest;
  params: JsonObject;
  binding: IntentToolBinding;
  defaultsApplied?: JsonObject[];
}

interface DefaultsInput {
  manifest: IntentManifest;
  params?: JsonObject;
  user?: UserContext;
  message?: string;
}

interface FiltersInput extends DefaultsInput {
  intent_code: string;
  resource: string;
}

interface SortInput {
  intent_code: string;
  resource: string;
  params?: JsonObject;
  message?: string;
}

interface PermissionResult {
  ok: boolean;
  code?: string;
  message?: string;
}

interface SummarizeInput {
  user?: UserContext;
  message?: string;
  rows: JsonObject[];
  intent_code: string;
  resource: string;
}

interface SummarizeAggregateInput {
  user?: UserContext;
  message?: string;
  intent_code: string;
  resource: string;
  metric: string;
  metricDef: JsonObject;
  groupBy?: string | null;
  toolResult?: ToolResult;
  deterministicAnswer: string;
}

interface MappingContext {
  message?: string;
  user?: UserContext;
}

export class IntentQueryHandler {
  private readonly llm?: AnswerLLM;
  private readonly toolRegistry: QueryToolRegistry;
  private readonly registry: IntentRegistry;
  private readonly queryAdapterRegistry?: QueryAdapterRegistry;
  private readonly filterTransformRegistry: Record<string, FilterTransformFn>;
  private readonly permissionRules: PermissionRuleFn[];
  private readonly fieldLabels: Record<string, string>;
  private readonly resourceConfigs: Record<string, import("../resources/types.js").ResourceConfig>;

  constructor({ llm, toolRegistry, registry, queryAdapterRegistry, filterTransformRegistry, permissionRules, fieldLabels, resourceConfigs }: IntentQueryHandlerOptions) {
    this.llm = llm;
    this.toolRegistry = toolRegistry;
    this.registry = registry;
    this.queryAdapterRegistry = queryAdapterRegistry;
    this.filterTransformRegistry = filterTransformRegistry ?? {};
    this.permissionRules = permissionRules ?? [];
    this.fieldLabels = fieldLabels ?? {};
    this.resourceConfigs = resourceConfigs ?? {};
  }

  async execute({ user, workspace, message, intent_code, params = {}, route: _route, session: _session }: IntentQueryExecuteInput = {}): Promise<IntentQueryResult> {
    const manifest = this.registry.getCode(intent_code);
    if (!manifest) {
      throw new Error(`IntentQueryHandler: 未知 intent_code ${intent_code}`);
    }
    if (manifest.handler_type !== "intent_query") {
      throw new Error(`IntentQueryHandler: handler_type 不匹配，manifest=${manifest.handler_type}`);
    }
    const binding = manifest.tool_binding ?? {};
    if (!binding.tool_name || !binding.resource) {
      throw new Error(`IntentQueryHandler: ${intent_code} 缺 tool_binding`);
    }

    const permCheck = this.checkPermissions({ manifest, user });
    if (!permCheck.ok) {
      return {
        answer: permCheck.message,
        table: { rows: [], fields: [] },
        debug: { intent_code, params, denied: permCheck.code },
        toolPlan: { calls: [] },
        toolResults: []
      };
    }

    const { params: effectiveParams, defaultsApplied } = this.applyDefaults({ manifest, params, user, message });
    params = effectiveParams;

    if (binding.operation === "aggregate") {
      return this.executeAggregate({ user, workspace, message, manifest, params, binding, defaultsApplied });
    }

    const filters = this.buildFilters({ manifest, intent_code, resource: binding.resource, params, message, user });
    const sort = this.buildSort({ intent_code, resource: binding.resource, params, message });
    const toolCall = {
      name: binding.tool_name,
      args: {
        resource: binding.resource,
        operation: "search",
        filters,
        ...(sort.length ? { sort } : {}),
        limit: 50
      }
    };
    const toolPlan = { calls: [toolCall] };

    const toolResult = normalizeToolResult(await this.toolRegistry.execute(toolCall, { user, workspace }));
    const toolResults = [toolResult];

    const rows = toolResult?.data?.rows ?? [];
    let answer;
    if (toolResult?.ok === false) {
      answer = `查询未成功：${toolResult?.message ?? toolResult?.error ?? "未知错误"}。`;
    } else if (rows.length === 0) {
      answer = "没有查到符合条件的记录。";
    } else {
      answer = await this.summarize({ user, message, rows, intent_code, resource: binding.resource });
    }
    if (defaultsApplied?.length) {
      answer = appendDefaultNotes(answer, defaultsApplied);
    }
    // QueryAdapter postProcessAnswer 委托
    if (this.queryAdapterRegistry) {
      answer = this.queryAdapterRegistry.postProcessAnswer({
        answer,
        rows,
        toolResult,
        params,
        route: {
          intent: "data_query",
          intent_code,
          handler_type: "intent_query",
          execution_class: "controlled_execution",
          params,
          confidence: "high",
        },
        manifest,
        user,
        message,
      });
    }

    const debug = {
      intent_code,
      params,
      filters,
      tool_call: toolCall,
      row_count: rows.length,
      defaults_applied: defaultsApplied ?? []
    };
    return {
      answer,
      table: { rows, fields: toolResult?.data?.fields ?? [] },
      debug,
      toolPlan,
      toolResults
    };
  }

  async executeAggregate({ user, workspace, message, manifest, params, binding, defaultsApplied = [] }: AggregateInput): Promise<IntentQueryResult> {
    const intent_code = manifest.intent_code;
    const metric = typeof params?.metric === "string" ? params.metric : null;
    const groupBy = typeof params?.group_by === "string" ? params.group_by : null;
    const definitions = manifest.metric_definitions ?? {};
    const def = metric ? definitions[metric] : null;
    if (!def) {
      return {
        answer: `没有理解要算的指标，请明确『总额/数量/平均/最高/最低/占比』之类。可选指标：${Object.keys(definitions).join("、") || "（manifest 未定义）"}。`,
        table: { rows: [], fields: [] },
        debug: { intent_code, params, error: "unknown_metric" },
        toolPlan: { calls: [] },
        toolResults: []
      };
    }

    const baseFilters = this.buildFilters({ manifest, intent_code, resource: binding.resource, params, message, user });
    const filterAddon = Array.isArray(def.filter_addon) ? def.filter_addon as QueryFilter[] : [];
    const filters = [...baseFilters, ...filterAddon];

    const toolCall = {
      name: binding.tool_name,
      args: {
        resource: binding.resource,
        operation: "aggregate",
        filters,
        aggregations: def.aggregations ?? [],
        derived: def.derived ?? [],
        ...(typeof groupBy === "string" && groupBy.trim() ? { group_by: groupBy.trim() } : {})
      }
    };
    const toolPlan = { calls: [toolCall] };
    const toolResult = normalizeToolResult(await this.toolRegistry.execute(toolCall, { user, workspace }));
    const toolResults = [toolResult];

    let answer;
    if (toolResult?.ok === false) {
      answer = `查询未成功：${toolResult?.message ?? toolResult?.error ?? "未知错误"}。`;
    } else {
      const deterministicAnswer = formatAggregateAnswer({
        metric,
        metricDef: def,
        groupBy: toolCall.args.group_by ?? null,
        toolData: toolResult?.data,
        params,
        fieldLabels: this.fieldLabels,
      });
      answer = await this.summarizeAggregate({
        user,
        message,
        intent_code,
        resource: binding.resource,
        metric,
        metricDef: def,
        groupBy: toolCall.args.group_by ?? null,
        toolResult,
        deterministicAnswer
      });
    }
    if (defaultsApplied?.length) {
      answer = appendDefaultNotes(answer, defaultsApplied);
    }

    const debug = {
      intent_code,
      params,
      filters,
      tool_call: toolCall,
      operation: "aggregate",
      defaults_applied: defaultsApplied ?? []
    };
    return {
      answer,
      table: { rows: [], fields: [] },
      debug,
      toolPlan,
      toolResults
    };
  }

  applyDefaults({ manifest, params, user, message }: DefaultsInput): { params: JsonObject; defaultsApplied: JsonObject[] } {
    const next = { ...(params ?? {}) };
    const applied: JsonObject[] = [];

    // QueryAdapter 委托（DomainPack 声明的 applyDefaults）
    if (this.queryAdapterRegistry) {
      const intent_code = manifest?.intent_code ?? "";
      const resource = manifest?.tool_binding?.resource ?? "";
      const adapterResult = this.queryAdapterRegistry.applyDefaults({
        intentCode: intent_code,
        resource,
        params: next,
        manifest,
        message: String(message ?? ""),
        user,
      });
      if (adapterResult?.params) {
        // 合并 adapter 返回的 params 变更
        for (const [key, value] of Object.entries(adapterResult.params)) {
          if (value !== undefined && value !== null && next[key] !== value) {
            const reason = `默认${getFieldLabelFromRegistry(key) ?? key}`;
            applied.push({ field: key, value: String(value), reason });
            next[key] = value;
          }
        }
      }
    }

    return { params: next, defaultsApplied: applied };
  }

  buildFilters({ manifest, intent_code, resource, params, message, user }: FiltersInput): QueryFilter[] {
    // 1. manifest 声明式 filter_mapping 优先
    const mapped = this.buildMappedFilters({ manifest, params, message, user });
    if (mapped) return mapped;

    // 2. QueryAdapter 委托（DomainPack 声明的业务特例）
    if (this.queryAdapterRegistry) {
      const adapterFilters = this.queryAdapterRegistry.buildFilters({
        intentCode: intent_code,
        resource,
        params: params ?? {},
        manifest,
        message: String(message ?? ""),
        user,
      });
      if (adapterFilters) return adapterFilters;
    }

    // 3. 空回退（所有业务逻辑已迁移到 DomainQueryAdapter）
    return [];
  }

  buildMappedFilters({ manifest, params, message, user }: DefaultsInput): QueryFilter[] | null {
    const mapping = manifest?.filter_mapping;
    if (!mapping || typeof mapping !== "object") return null;

    const filters: QueryFilter[] = [];
    for (const [paramName, ruleOrRules] of Object.entries(mapping)) {
      const rules = Array.isArray(ruleOrRules) ? ruleOrRules : [ruleOrRules];
      for (const rule of rules) {
        if (!rule || typeof rule !== "object") continue;
        const raw = valueForMapping({ paramName, params, message, user, rule });
        const filter = buildFilterFromRule({ raw, rule, params, message, user, filterTransformRegistry: this.filterTransformRegistry });
        if (Array.isArray(filter)) filters.push(...filter);
        else if (filter) filters.push(filter);
      }
    }
    return filters;
  }

  buildSort({ intent_code, resource, params: _params, message: _message }: SortInput): QuerySort[] {
    // QueryAdapter 委托
    if (this.queryAdapterRegistry) {
      const adapterSort = this.queryAdapterRegistry.buildSort({
        intentCode: intent_code,
        resource,
        params: _params ?? {},
        manifest: this.registry.getCode(intent_code) ?? ({} as IntentManifest),
        message: String(_message ?? ""),
      });
      if (adapterSort) return adapterSort;
    }
    // 空回退（所有业务排序已迁移到 DomainQueryAdapter）
    return [];
  }

  checkPermissions({ manifest, user }: { manifest: IntentManifest; user?: UserContext }): PermissionResult {
    const required = manifest.required_permissions ?? [];
    if (!required.length) return { ok: true };
    if (!user) {
      return { ok: false, code: "no_user", message: "无法识别当前用户身份。" };
    }
    const userPerms = new Set(user.permissions ?? []);
    const resource = manifest.tool_binding?.resource;

    // 委托 domain 注册的权限规则（来自 DomainPack.permissionRules）
    for (const rule of this.permissionRules) {
      const result = rule({ resource, user, userPermissions: userPerms, manifest });
      if (result?.ok) return { ok: true };
    }

    const missing = required.filter((perm) => !userPerms.has(perm));
    if (missing.length === 0) return { ok: true };
    return {
      ok: false,
      code: "missing_permission",
      message: `你没有权限查看该数据（缺少：${missing.join("、")}）。`
    };
  }

  async summarize({ user, message, rows, intent_code, resource }: SummarizeInput): Promise<string> {
    const fl = this.fieldLabels;
    const rc = this.resourceConfigs;
    if (rows.length === 1 && isSimpleSingleRowQuestion(message)) {
      return formatRowsTemplate({ rows, total: rows.length, resource, fieldLabels: fl, resourceConfigs: rc });
    }
    if (canUseAnswerLLM(this.llm)) {
      try {
        const result = await this.llm.generateAnswer({
          user: summarizeUserForAnswer(user),
          question: message,
          route: { intent: "data_query", intent_code, handler_type: "intent_query" },
          docs: [],
          toolResults: [{
            ok: true,
            tool: "query_business_data",
            data: {
              resource,
              operation: "search",
              rows,
              total: rows.length,
              fields: inferDisplayFields(resource, rows, rc),
              answer_preference: createSearchAnswerPreference({ message, resource, rows, resourceConfigs: rc })
            }
          }]
        });
        if (result?.answer && acceptSearchAnswer(result.answer, { rows })) return result.answer;
      } catch {
        // 走模板兜底
      }
    }
    return formatRowsTemplate({ rows, total: rows.length, resource, fieldLabels: fl, resourceConfigs: rc });
  }

  async summarizeAggregate({ user, message, intent_code, resource, metric, metricDef, groupBy, toolResult, deterministicAnswer }: SummarizeAggregateInput): Promise<string> {
    if (!canUseAnswerLLM(this.llm)) return deterministicAnswer;
    try {
      const result = await this.llm.generateAnswer({
        user: summarizeUserForAnswer(user),
        question: message,
        route: { intent: "data_query", intent_code, handler_type: "intent_query", params: { metric, group_by: groupBy } },
        docs: [],
        toolResults: [{
          ok: true,
          tool: "query_business_data",
          data: {
            ...(toolResult?.data ?? {}),
            resource,
            operation: "aggregate",
            deterministic_answer: deterministicAnswer,
            metric,
            metric_definition: metricDef?.definition,
            answer_preference: {
              format: groupBy ? "natural_grouped_metric" : "natural_metric_answer",
              rules: [
                "先直接回答用户问的指标，不要使用“查询结果显示”这类套话。",
                "必须保留 deterministic_answer 中的指标值、记录数和统计口径，但不要提 deterministic_answer 这个词。",
                "可以把口径放在末尾，用“口径上...”或“这里按...”自然说明。",
                "不能新增任何未在 aggregates/groups 中出现的数据。",
                groupBy ? "如果有多组结果，可以用一张简短 Markdown 表格。" : "单一统计不要生成表格。"
              ]
            }
          }
        }]
      });
      if (result?.answer && aggregateAnswerPreservesMetric(result.answer, toolResult?.data)) return result.answer;
    } catch {
      // 走确定性聚合答案兜底
    }
    return deterministicAnswer;
  }
}

/**
 * @param {unknown} llm
 * @returns {llm is { generateAnswer: (input: import("../types/agent-contracts.js").JsonObject) => Promise<{ answer?: string }>, answerApiKey?: string }}
 */
function canUseAnswerLLM(llm: unknown): llm is AnswerLLM & { generateAnswer: AnswerLLM["generateAnswer"] } {
  if (!llm || typeof llm !== "object") return false;
  const candidate = llm as { generateAnswer?: unknown; answerApiKey?: string };
  if (typeof candidate.generateAnswer !== "function") return false;
  return Boolean(
    candidate.answerApiKey ||
    process.env.LLM_ANSWER_API_KEY ||
    process.env.LLM_API_KEY ||
    process.env.OPENAI_API_KEY
  );
}

function normalizeToolResult(value: unknown): ToolResult {
  if (value && typeof value === "object") return value as ToolResult;
  return { ok: true, data: { value: value as JsonValue } };
}

function summarizeUserForAnswer(user?: UserContext): JsonObject {
  return user ? {
    id: user.id,
    name: user.name,
    role: user.role,
    department: user.department
  } : { name: "员工" };
}

function isSimpleSingleRowQuestion(message: unknown): boolean {
  const text = String(message ?? "");
  if (/(分析|原因|为什么|总结|简报|报告|复盘|建议|行动|归因|怎么看|解读|对比|趋势)/.test(text)) return false;
  return /(是否|有没有|吗|是不是|查一下|看一下|详情|状态)/.test(text);
}

function createSearchAnswerPreference({ message, resource, rows, resourceConfigs }: { message?: string; resource: string; rows: DataRecord[]; resourceConfigs?: Record<string, import("../resources/types.js").ResourceConfig> }): JsonObject {
  return {
    format: rows.length > 1 ? "natural_markdown_table" : "natural_single_record",
    display_fields: inferDisplayFields(resource, rows, resourceConfigs),
    rules: [
      "像一个业务同事一样组织回答：先给一句自然结论，再展开必要明细。",
      "不要说 rows、字段、工具结果、查询结果这些工程词。",
      "只根据 rows 组织回答，不得新增、推断或改写 rows 中没有的事实。",
      rows.length > 1
        ? "多条明细默认输出 Markdown 表格，表格前给一句短摘要。"
        : "单条明细用短段落或小表格，保持简洁。",
      "如果用户问名单、哪些人、有哪些、明细、清单、最近记录，必须覆盖 rows 中每一条记录。",
      "状态、枚举、ID、金额、日期时间等字段值必须原样保留；不要把 submitted/approved 等状态自行翻译成另一种业务状态，也不要在没有字典映射时解释它们的审批含义。",
      "如果 rows 超过页面可读范围，可以展示关键列，但不能遗漏人名/对象名和核心状态。",
      "如果要解释范围或默认条件，用一句自然语言轻描淡写说明，不要使用“自动套用”。"
    ],
    user_question: String(message ?? "")
  };
}

function acceptSearchAnswer(answer: unknown, { rows }: { rows: DataRecord[] }): boolean {
  const text = String(answer ?? "").trim();
  if (!text) return false;
  if (rows.length <= 1) return true;
  // 多行明细必须保持可扫描的表格形态；否则回退到确定性 Markdown 表格。
  return /\|.+\|[\s\S]*\|[\s:-]+\|/.test(text);
}

function appendDefaultNotes(answer: string, defaultsApplied: DataRecord[] = []): string {
  const notes = defaultsApplied
    .map((d) => defaultNoteText(d))
    .filter(Boolean);
  if (!notes.length) return answer;
  return `${answer}\n\n${notes.join("\n")}`;
}

function defaultNoteText(item: DataRecord): string {
  if (!item) return "";
  const label = getFieldLabelFromRegistry(String(item.field ?? "")) ?? String(item.field ?? "");
  return `这里按你的默认${label}「${item.value}」来看的。`;
}

// translateTimeRangeToIso / formatLocalDate / extractMonthToken 已统一到 src/domains/shared/time-utils.ts

/**
 * @param {{
 *   paramName: string,
 *   params?: import("../types/agent-contracts.js").JsonObject,
 *   message?: string,
 *   user?: import("../types/agent-contracts.js").UserContext,
 *   rule: import("../types/agent-contracts.js").JsonObject
 * }} input
 */
function valueForMapping({ paramName, params, message, user, rule }: {
  paramName: string;
  params?: JsonObject;
  message?: string;
  user?: UserContext;
  rule: JsonObject;
}): unknown {
  if (rule.source === "message") return params?.[paramName] ?? String(message ?? "");
  if (rule.source === "user_id") return user?.id ?? null;
  if (rule.source === "default_store") return user?.default_store ?? null;
  return params?.[paramName];
}

/**
 * @param {{
 *   raw: unknown,
 *   rule: import("../types/agent-contracts.js").JsonObject,
 *   params?: import("../types/agent-contracts.js").JsonObject,
 *   message?: string,
 *   user?: import("../types/agent-contracts.js").UserContext
 * }} input
 */
function buildFilterFromRule({ raw, rule, params: _params, message, user, filterTransformRegistry }: {
  raw: unknown;
  rule: JsonObject;
  params?: JsonObject;
  message?: string;
  user?: UserContext;
  filterTransformRegistry?: Record<string, FilterTransformFn>;
}): QueryFilter | QueryFilter[] | null {
  let value = raw;
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string") value = value.trim();
  if (value === "") return null;

  const transformed = applyMappingTransform(value, rule, { message, user }, filterTransformRegistry);
  if (transformed === null || transformed === undefined || transformed === "") return null;
  if (Array.isArray(transformed)) {
    if (!transformed.length) return null;
    if (transformed.every(isQueryFilter)) return transformed as QueryFilter[];
    return { field: String(rule.field ?? ""), op: String(rule.op ?? "in"), value: transformed as JsonValue[] };
  }
  if (isQueryFilter(transformed)) {
    return transformed;
  }

  return {
    field: String(rule.field ?? ""),
    op: String(rule.op ?? "eq"),
    value: transformed as JsonValue
  };
}

/**
 * @param {unknown} value
 * @param {import("../types/agent-contracts.js").JsonObject} rule
 * @param {{ message?: string, user?: import("../types/agent-contracts.js").UserContext }} [context]
 */
function applyMappingTransform(
  value: unknown,
  rule: JsonObject,
  { message, user }: MappingContext = {},
  filterTransformRegistry?: Record<string, FilterTransformFn>,
): JsonValue | QueryFilter | QueryFilter[] | null {
  const transformName = typeof rule.transform === "string" ? rule.transform : null;

  // 1. 优先查 domain 注册的 filterTransform
  if (transformName && filterTransformRegistry?.[transformName]) {
    return filterTransformRegistry[transformName](value, { message, user, rule });
  }

  // 2. 通用 transform（不属于特定业务域）
  if (transformName === "time_range_to_iso") {
    return translateTimeRangeToIso(String(value ?? ""));
  }
  if (transformName === "month_token_or_time_range") {
    const text = String(value ?? message ?? "");
    const monthToken = extractMonthToken(text);
    if (monthToken) return monthToken;
    const sinceIso = translateTimeRangeToIso(text);
    if (!sinceIso) return null;
    return [
      { field: String(rule.field ?? ""), op: "gte", value: sinceIso },
      { field: String(rule.field ?? ""), op: "lte", value: formatLocalDate(new Date()) }
    ];
  }

  // 3. negative_patterns 通用逻辑
  if (rule.negative_patterns && Array.isArray(rule.negative_patterns)) {
    const text = String(value ?? "");
    const negativePatterns = rule.negative_patterns.filter(isJsonObject);
    for (const item of negativePatterns) {
      if (typeof item.pattern === "string" && new RegExp(item.pattern).test(text)) {
        return { field: String(rule.field ?? ""), op: String(item.op ?? "neq"), value: item.value };
      }
    }
  }
  return isJsonValue(value) ? value : String(value ?? "");
}

function isQueryFilter(value: unknown): value is QueryFilter {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && typeof (value as { field?: unknown }).field === "string";
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (["string", "number", "boolean"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!isJsonObject(value)) return false;
  return Object.values(value).every((item) => item === undefined || isJsonValue(item));
}


function formatAggregateAnswer({ metric, metricDef, groupBy, toolData, params: _params, fieldLabels }: {
  metric: string;
  metricDef?: DataRecord;
  groupBy?: string | null;
  toolData?: DataRecord;
  params?: JsonObject;
  fieldLabels?: Record<string, string>;
}): string {
  const definition = metricDef?.definition ?? metric;
  const fmt = (value: unknown) => formatMetricValue(metric, value);
  const lines: string[] = [];

  if (groupBy && Array.isArray(toolData?.groups)) {
    const groups = toolData.groups;
    if (groups.length === 0) {
      lines.push("没有查到符合条件的记录。");
    } else {
      // 选用作为"主指标"的那个 as：取 metric_definitions 里第一个非 _ 开头的 derived，否则第一个 aggregations 的 as
      const primaryAs = pickPrimaryAs(metricDef, metric);
      lines.push(createGroupedMetricIntro({ metric, groupBy, total: toolData?.total, fieldLabels }));
      lines.push("");
      lines.push(formatGroupedMetricTable({ groups, groupBy, primaryAs, metric, formatValue: fmt, fieldLabels }));
    }
  } else {
    const aggregates = toolData?.aggregates ?? {};
    const primaryAs = pickPrimaryAs(metricDef, metric);
    const value = aggregates[primaryAs];
    if (value === null || value === undefined) {
      lines.push(`没有查到符合条件的记录，无法计算${labelOfMetric(metric, fieldLabels)}。`);
    } else {
      lines.push(`${labelOfMetric(metric, fieldLabels)}是 **${fmt(value)}**。`);
      if (Number(toolData?.total ?? 0) > 0) lines.push(`这次统计覆盖 ${toolData.total} 条记录。`);
    }
  }

  lines.push(`口径上：${definition}`);
  return lines.join("\n");
}

function createGroupedMetricIntro({ metric, groupBy, total, fieldLabels }: { metric: string; groupBy: string; total?: unknown; fieldLabels?: Record<string, string> }): string {
  if (metric === "order_count" && groupBy === "order_status") {
    return `最近订单按${labelOfField(groupBy, fieldLabels)}看，主要是下面这些状态。`;
  }
  const totalText = Number(total ?? 0) > 0 ? `（共 ${total} 条记录）` : "";
  return `${labelOfMetric(metric, fieldLabels)}按${labelOfField(groupBy, fieldLabels)}分布如下${totalText}。`;
}

function formatGroupedMetricTable({ groups, groupBy, primaryAs, metric, formatValue, fieldLabels }: {
  groups: DataRecord[];
  groupBy: string;
  primaryAs: string;
  metric: string;
  formatValue: MetricFormatter;
  fieldLabels?: Record<string, string>;
}): string {
  const metricLabel = labelOfMetric(metric, fieldLabels);
  const rows = [
    `| ${labelOfField(groupBy, fieldLabels)} | ${metricLabel} | 记录数 |`,
    "| --- | --- | --- |"
  ];
  for (const g of groups) {
    const groupValue = Object.values(g.group ?? {})[0] ?? "(空)";
    const value = g.aggregates?.[primaryAs];
    rows.push(`| ${escapeMarkdownCell(groupValue)} | ${escapeMarkdownCell(formatValue(value))} | ${g.row_count ?? "-"} |`);
  }
  return rows.join("\n");
}

function pickPrimaryAs(metricDef: DataRecord | undefined, metric: string): string {
  // 主指标优先用 derived 里最后一个非内部（不以 _ 开头）的 as
  const derived = metricDef?.derived ?? [];
  for (let i = derived.length - 1; i >= 0; i -= 1) {
    if (derived[i].as && !derived[i].as.startsWith("_")) return derived[i].as;
  }
  const aggregations = metricDef?.aggregations ?? [];
  for (let i = 0; i < aggregations.length; i += 1) {
    if (aggregations[i].as && !aggregations[i].as.startsWith("_")) return aggregations[i].as;
  }
  return metric;
}

/**
 * 查找 metric 的中文标签。优先从 domain 注册的 fieldLabels 查找，找不到走本地 fallback。
 */
function labelOfMetric(metric: string, fieldLabels?: Record<string, string>): string {
  if (fieldLabels?.[metric]) return fieldLabels[metric];
  return metric;
}

/**
 * 查找 field 的中文标签。优先从 domain 注册的 fieldLabels 查找，找不到走本地 fallback。
 */
function labelOfField(field: unknown, fieldLabels?: Record<string, string>): string {
  const key = String(field ?? "");
  if (fieldLabels?.[key]) return fieldLabels[key];
  return key;
}

function formatMetricValue(metric: string, value: unknown): string {
  if (value === null || value === undefined) return "暂无数据";
  if (typeof value !== "number") return String(value);
  // 百分比/率：保留 2 位小数
  if (/_pct|rate|margin/.test(metric)) return `${value.toFixed(2)}%`;
  // 计数类：整数
  if (/count/.test(metric)) return Math.round(value).toString();
  // 金额：千分位
  if (Math.abs(value) >= 1000) return value.toLocaleString("zh-CN");
  return value.toString();
}

function formatRowsTemplate({ rows, total, resource, fieldLabels, resourceConfigs }: { rows: DataRecord[]; total: number; resource: string; fieldLabels?: Record<string, string>; resourceConfigs?: Record<string, import("../resources/types.js").ResourceConfig> }): string {
  const head = rows.slice(0, 8);
  const table = formatRowsTable({ rows: head, resource, resourceConfigs });
  if (table) return `最近有 ${total} 条相关记录：\n\n${table}`;
  const lines = head.map((row) => formatRowByResource(row, resource, fieldLabels, resourceConfigs));
  return `最近有 ${total} 条相关记录：\n${lines.join("\n")}`;
}

function formatRowsTable({ rows, resource, resourceConfigs }: { rows: DataRecord[]; resource: string; resourceConfigs?: Record<string, import("../resources/types.js").ResourceConfig> }): string {
  if (!rows.length) return "";
  const columns = getDisplayColumns(resource, rows, resourceConfigs);
  if (!columns.length) return "";
  const header = `| ${columns.map((column) => column.label).join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${columns.map((column) => escapeMarkdownCell(formatCellValue(row[column.field]))).join(" | ")} |`);
  return [header, divider, ...body].join("\n");
}

function inferDisplayFields(resource: string, rows: DataRecord[], resourceConfigs?: Record<string, import("../resources/types.js").ResourceConfig>): string[] {
  return getDisplayColumns(resource, rows, resourceConfigs).map((column: DisplayColumn) => column.field);
}

/**
 * 获取资源的展示列。优先从 ResourceConfig.displayColumns 查找，找不到走自动推断。
 */
function getDisplayColumns(resource: string, rows: DataRecord[] = [], resourceConfigs?: Record<string, import("../resources/types.js").ResourceConfig>): DisplayColumn[] {
  // 优先从 domain 注册的 ResourceConfig.displayColumns 查找
  const config = resourceConfigs?.[resource];
  if (config?.displayColumns?.length) {
    return config.displayColumns
      .filter(([field]) => rows.some((row) => row?.[field] !== undefined && row?.[field] !== null && row?.[field] !== ""))
      .map(([field, label]) => ({ field, label }));
  }

  // 自动推断：取前 6 个字段
  return Object.keys(rows[0] ?? {})
    .slice(0, 6)
    .map((field) => ({ field, label: field }));
}

function formatCellValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "-";
  if (Array.isArray(value)) return value.join("、");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function escapeMarkdownCell(value: unknown): string {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function aggregateAnswerPreservesMetric(answer: unknown, data: DataRecord | undefined): boolean {
  const text = String(answer ?? "");
  const values: unknown[] = [];
  for (const value of Object.values(data?.aggregates ?? {})) {
    if (value !== null && value !== undefined) values.push(value);
  }
  for (const group of data?.groups ?? []) {
    for (const value of Object.values(group?.aggregates ?? {})) {
      if (value !== null && value !== undefined) values.push(value);
    }
  }
  if (!values.length) return true;
  return values.some((value) => answerContainsNumber(text, value));
}

function answerContainsNumber(text: string, value: unknown): boolean {
  if (typeof value !== "number") return text.includes(String(value));
  const raw = String(value);
  const rounded = String(Math.round(value));
  const fixed2 = Number.isInteger(value) ? raw : value.toFixed(2);
  const localized = value.toLocaleString("zh-CN");
  return [raw, rounded, fixed2, localized].some((candidate) => candidate && text.includes(candidate));
}

function formatRowByResource(row: DataRecord, resource: string, fieldLabels?: Record<string, string>, resourceConfigs?: Record<string, import("../resources/types.js").ResourceConfig>): string {
  // 优先使用 ResourceConfig.rowTemplate（声明式，来自 DomainPack）
  const rowTemplate = resourceConfigs?.[resource]?.rowTemplate;
  if (rowTemplate) {
    return rowTemplate(row as Record<string, unknown>, fieldLabels);
  }
  // 兜底：JSON 截断
  return `- ${JSON.stringify(row).slice(0, 200)}`;
}
