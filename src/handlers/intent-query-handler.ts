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
}

interface IntentQueryExecuteInput {
  user?: UserContext;
  message?: string;
  intent_code?: string;
  params?: JsonObject;
  route?: Route;
  session?: Record<string, unknown>;
}

interface AggregateInput {
  user?: UserContext;
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

  constructor({ llm, toolRegistry, registry }: IntentQueryHandlerOptions) {
    this.llm = llm;
    this.toolRegistry = toolRegistry;
    this.registry = registry;
  }

  async execute({ user, message, intent_code, params = {}, route: _route, session: _session }: IntentQueryExecuteInput = {}): Promise<IntentQueryResult> {
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
      return this.executeAggregate({ user, message, manifest, params, binding, defaultsApplied });
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

    const toolResult = normalizeToolResult(await this.toolRegistry.execute(toolCall, { user }));
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
    if (binding.resource === "dealer_metrics" && /库存/.test(message) && /线索/.test(message) && !/线索/.test(answer)) {
      answer = `${answer}\n\n线索维度也在本次优先级问题范围内；如需展开，可继续查看 lead 类经营指标。`;
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

  async executeAggregate({ user, message, manifest, params, binding, defaultsApplied = [] }: AggregateInput): Promise<IntentQueryResult> {
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
    const toolResult = normalizeToolResult(await this.toolRegistry.execute(toolCall, { user }));
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
        params
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
    const schema = manifest.params_schema ?? {};
    // store 默认值：用户在 users.json 里有 default_store，且当前 manifest 接受 store 字段、用户没显式提
    if (schema.store && (next.store == null || next.store === "") && user?.default_store && !shouldSkipDefaultStore({ params: next, message })) {
      next.store = user.default_store;
      applied.push({ field: "store", value: String(user.default_store), reason: "默认门店" });
    }
    return { params: next, defaultsApplied: applied };
  }

  buildFilters({ manifest, intent_code, resource, params, message, user }: FiltersInput): QueryFilter[] {
    const mapped = this.buildMappedFilters({ manifest, params, message, user });
    if (mapped) return mapped;

    const filters: QueryFilter[] = [];
    if (intent_code === "attendance.leave_query" && resource === "leave_requests") {
      const { scope, applicant_name, leave_type, time_range, status } = params ?? {};
      const text = String(message ?? "");
      const selfScope = scope === "self" || /(我|我的|本人)/.test(text);
      const companyScope = scope === "company" || /(全公司|整个公司|公司全员|所有员工|全部员工|公司最近)/.test(text);
      const teamScope = scope === "team" || /(同学|下属|下级|下辖|团队|组员|成员)/.test(text);
      const peopleScope = /(谁|哪些人|哪几个人|哪位|哪些员工)/.test(text);
      if (applicant_name && typeof applicant_name === "string" && applicant_name.trim()) {
        filters.push({ field: "applicant_name", op: "contains", value: applicant_name.trim() });
      } else if ((companyScope || peopleScope) && user?.permissions?.includes("org:read")) {
        filters.push({ field: "applicant_user_id", op: "in", value: "__ALL_ORG_USERS__" });
      } else if (teamScope && user?.permissions?.includes("org:read")) {
        filters.push({ field: "applicant_user_id", op: "in", value: "__CURRENT_USER_REPORTS__" });
      } else if (selfScope) {
        filters.push({ field: "applicant_user_id", op: "eq", value: "__CURRENT_USER__" });
      } else if (user?.permissions?.includes("org:read")) {
        filters.push({ field: "applicant_user_id", op: "in", value: "__ALL_ORG_USERS__" });
      } else {
        filters.push({ field: "applicant_user_id", op: "eq", value: "__CURRENT_USER__" });
      }
      const inferredType = inferLeaveType(text);
      if (leave_type && typeof leave_type === "string" && leave_type.trim()) {
        filters.push({ field: "leave_type", op: "eq", value: leave_type.trim() });
      } else if (inferredType) {
        filters.push({ field: "leave_type", op: "eq", value: inferredType });
      }
      const inferredStatus = typeof status === "string" && status.trim() ? status.trim() : null;
      if (inferredStatus) filters.push({ field: "status", op: "eq", value: inferredStatus });
      const monthToken = extractMonthToken(text);
      if (monthToken) {
        filters.push({ field: "start_time", op: "contains", value: monthToken });
      } else {
        const sinceIso = translateTimeRangeToIso(String(time_range || text));
        if (sinceIso) {
          filters.push({ field: "start_time", op: "gte", value: sinceIso });
        }
      }
    }
    if (intent_code === "dealer.query.inventory" && resource === "dealer_vehicles") {
      const { vehicle_model, store, time_range, warning_level } = params ?? {};
      if (vehicle_model && typeof vehicle_model === "string" && vehicle_model.trim()) {
        // 直接 contains 整个原文（如「汉EV」），由 model 字段命中即可
        filters.push({ field: "model", op: "contains", value: vehicle_model.trim() });
      }
      if (store && typeof store === "string" && store.trim()) {
        filters.push({ field: "store_name", op: "contains", value: store.trim() });
      }
      if (warning_level && typeof warning_level === "string" && warning_level.trim()) {
        filters.push({ field: "stock_warning_level", op: "eq", value: warning_level.trim() });
      }
      // 库存查询里 time_range 仅作为语义提示（用户在问"现在"的库存），
      // 不再硬过滤 inbound_date——库龄已由 stock_age_days 表达。
    }
    if (intent_code === "dealer.query.repair_orders" && resource === "dealer_repair_orders") {
      const { store, series, status, order_type, service_advisor, time_range, overdue_only } = params ?? {};
      if (store && typeof store === "string" && store.trim()) {
        filters.push({ field: "store_name", op: "contains", value: store.trim() });
      }
      if (series && typeof series === "string" && series.trim()) {
        filters.push({ field: "series", op: "contains", value: series.trim() });
      }
      if (status && typeof status === "string" && status.trim()) {
        filters.push({ field: "status", op: "eq", value: status.trim() });
      }
      if (order_type && typeof order_type === "string" && order_type.trim()) {
        filters.push({ field: "order_type", op: "contains", value: order_type.trim() });
      }
      if (service_advisor && typeof service_advisor === "string" && service_advisor.trim()) {
        filters.push({ field: "service_advisor_name", op: "contains", value: service_advisor.trim() });
      }
      const sinceIso = typeof time_range === "string" ? translateTimeRangeToIso(time_range) : null;
      if (sinceIso) {
        filters.push({ field: "appointment_at", op: "gte", value: sinceIso });
      }
      // 逾期 = promised_finish_at <= 今天 AND status != 已交付（query_business_data 没 lt，用 lte+today 近似，并合配 status 排除）
      if (overdue_only === true) {
        const today = new Date().toISOString().slice(0, 10);
        filters.push({ field: "promised_finish_at", op: "lte", value: today });
        filters.push({ field: "status", op: "neq", value: "已交付" });
      }
    }
    if (intent_code === "dealer.query.warranty_claims" && resource === "dealer_warranty_claims") {
      const { store, series, claim_status, fault_category, evidence_status, time_range, difference_min } = params ?? {};
      if (store && typeof store === "string" && store.trim()) {
        filters.push({ field: "store_name", op: "contains", value: store.trim() });
      }
      if (series && typeof series === "string" && series.trim()) {
        filters.push({ field: "series", op: "contains", value: series.trim() });
      }
      if (claim_status && typeof claim_status === "string" && claim_status.trim()) {
        filters.push({ field: "claim_status", op: "contains", value: claim_status.trim() });
      }
      if (fault_category && typeof fault_category === "string" && fault_category.trim()) {
        // 用户常说「三电故障/电池故障」，库里值是「三电/底盘」，去掉「故障」「故障类别」后缀以提高命中
        const cleaned = fault_category.trim().replace(/故障类别|故障$/u, "").trim() || fault_category.trim();
        filters.push({ field: "fault_category", op: "contains", value: cleaned });
      }
      if (evidence_status && typeof evidence_status === "string" && evidence_status.trim()) {
        filters.push({ field: "evidence_status", op: "contains", value: evidence_status.trim() });
      }
      if (typeof difference_min === "number" && Number.isFinite(difference_min)) {
        filters.push({ field: "difference_amount", op: "gte", value: difference_min });
      }
      const sinceIso = typeof time_range === "string" ? translateTimeRangeToIso(time_range) : null;
      if (sinceIso) {
        filters.push({ field: "submitted_at", op: "gte", value: sinceIso });
      }
    }
    if (intent_code === "dealer.query.sales_orders" && resource === "dealer_sales_orders") {
      const { store, series, model, owner, order_type, order_status, payment_status, delivery_status, time_range, price_min, price_max } = params ?? {};
      if (store && typeof store === "string" && store.trim()) {
        filters.push({ field: "store_name", op: "contains", value: store.trim() });
      }
      if (series && typeof series === "string" && series.trim()) {
        filters.push({ field: "series", op: "contains", value: series.trim() });
      }
      if (model && typeof model === "string" && model.trim()) {
        filters.push({ field: "model", op: "contains", value: model.trim() });
      }
      if (owner && typeof owner === "string" && owner.trim()) {
        filters.push({ field: "owner_name", op: "contains", value: owner.trim() });
      }
      if (order_type && typeof order_type === "string" && order_type.trim()) {
        filters.push({ field: "order_type", op: "eq", value: order_type.trim() });
      }
      if (order_status && typeof order_status === "string" && order_status.trim()) {
        // "未交付" → order_status != 已交付（用 neq 表达"非"语义）
        if (/未交付|没交付/.test(order_status)) {
          filters.push({ field: "order_status", op: "neq", value: "已交付" });
        } else {
          filters.push({ field: "order_status", op: "eq", value: order_status.trim() });
        }
      }
      if (payment_status && typeof payment_status === "string" && payment_status.trim()) {
        if (/未结清|未付清/.test(payment_status)) {
          filters.push({ field: "payment_status", op: "neq", value: "已结清" });
        } else {
          filters.push({ field: "payment_status", op: "eq", value: payment_status.trim() });
        }
      }
      if (delivery_status && typeof delivery_status === "string" && delivery_status.trim()) {
        if (/未交付|没交付/.test(delivery_status)) {
          filters.push({ field: "delivery_status", op: "neq", value: "已交付" });
        } else {
          filters.push({ field: "delivery_status", op: "eq", value: delivery_status.trim() });
        }
      }
      if (typeof price_min === "number" && Number.isFinite(price_min)) {
        filters.push({ field: "final_price", op: "gte", value: price_min });
      }
      if (typeof price_max === "number" && Number.isFinite(price_max)) {
        filters.push({ field: "final_price", op: "lte", value: price_max });
      }
      const sinceIso = typeof time_range === "string" ? translateTimeRangeToIso(time_range) : null;
      if (sinceIso) {
        filters.push({ field: "created_at", op: "gte", value: sinceIso });
      }
    }
    if (intent_code === "dealer.query.leads" && resource === "dealer_leads") {
      const { store, series, owner, intention_level, status, source, time_range } = params ?? {};
      if (store && typeof store === "string" && store.trim()) {
        filters.push({ field: "store_name", op: "contains", value: store.trim() });
      }
      if (series && typeof series === "string" && series.trim()) {
        filters.push({ field: "interested_series", op: "contains", value: series.trim() });
      }
      if (owner && typeof owner === "string" && owner.trim()) {
        filters.push({ field: "owner_name", op: "contains", value: owner.trim() });
      }
      if (intention_level && typeof intention_level === "string" && intention_level.trim()) {
        filters.push({ field: "intention_level", op: "eq", value: intention_level.trim() });
      }
      if (status && typeof status === "string" && status.trim()) {
        if (/未成交|没成交/.test(status)) {
          filters.push({ field: "status", op: "neq", value: "已成交" });
        } else {
          filters.push({ field: "status", op: "contains", value: status.trim() });
        }
      }
      if (source && typeof source === "string" && source.trim()) {
        filters.push({ field: "source", op: "contains", value: source.trim() });
      }
      const sinceIso = typeof time_range === "string" ? translateTimeRangeToIso(time_range) : null;
      if (sinceIso) {
        filters.push({ field: "created_at", op: "gte", value: sinceIso });
      }
    }
    if (intent_code === "dealer.query.finance" && resource === "dealer_finance") {
      const { resource_type, store, category, direction, status, time_range, amount_min, amount_max } = params ?? {};
      if (resource_type && typeof resource_type === "string" && resource_type.trim()) {
        filters.push({ field: "resource_type", op: "eq", value: resource_type.trim() });
      }
      if (store && typeof store === "string" && store.trim()) {
        filters.push({ field: "store_name", op: "contains", value: store.trim() });
      }
      if (category && typeof category === "string" && category.trim()) {
        filters.push({ field: "category", op: "contains", value: category.trim() });
      }
      if (direction && typeof direction === "string" && direction.trim()) {
        filters.push({ field: "direction", op: "eq", value: direction.trim() });
      }
      if (status && typeof status === "string" && status.trim()) {
        filters.push({ field: "status", op: "eq", value: status.trim() });
      }
      if (typeof amount_min === "number" && Number.isFinite(amount_min)) {
        filters.push({ field: "amount", op: "gte", value: amount_min });
      }
      if (typeof amount_max === "number" && Number.isFinite(amount_max)) {
        filters.push({ field: "amount", op: "lte", value: amount_max });
      }
      // time_range 翻译为 occurred_at 起始日期；财务查询和"发生时间"强相关
      const sinceIso = typeof time_range === "string" ? translateTimeRangeToIso(time_range) : null;
      if (sinceIso) {
        filters.push({ field: "occurred_at", op: "gte", value: sinceIso });
      }
    }
    return filters;
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
        const filter = buildFilterFromRule({ raw, rule, params, message, user });
        if (Array.isArray(filter)) filters.push(...filter);
        else if (filter) filters.push(filter);
      }
    }
    return filters;
  }

  buildSort({ intent_code, resource, params: _params, message: _message }: SortInput): QuerySort[] {
    if (intent_code === "attendance.leave_query" && resource === "leave_requests") {
      return [{ field: "start_time", direction: "desc" }];
    }
    return [];
  }

  checkPermissions({ manifest, user }: { manifest: IntentManifest; user?: UserContext }): PermissionResult {
    const required = manifest.required_permissions ?? [];
    if (!required.length) return { ok: true };
    if (!user) {
      return { ok: false, code: "no_user", message: "无法识别当前用户身份。" };
    }
    const userPerms = new Set(user.permissions ?? []);
    // 角色级别的隐式授权：和 src/auth/permissions.ts#canReadDealerResource 对齐。
    // 这里只做粗粒度放行（避免在 handler 层抢着拒绝），细粒度仍交给 ToolRegistry/authorizeToolCall。
    const resource = manifest.tool_binding?.resource;
    if (resource === "dealer_finance" && user.role === "store_general_manager") {
      return { ok: true };
    }
    if (["dealer_vehicles", "dealer_inbounds", "dealer_quotas", "dealer_stores"].includes(resource)
        && (userPerms.has("inventory:read") || userPerms.has("order:read") || userPerms.has("sales_report:read"))) {
      return { ok: true };
    }
    if (typeof resource === "string" && resource.startsWith("dealer_")
        && ["store_general_manager", "sales_manager"].includes(user.role)) {
      return { ok: true };
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
    if (rows.length === 1 && isSimpleSingleRowQuestion(message)) {
      return formatRowsTemplate({ rows, total: rows.length, resource });
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
              fields: inferDisplayFields(resource, rows),
              answer_preference: createSearchAnswerPreference({ message, resource, rows })
            }
          }]
        });
        if (result?.answer && acceptSearchAnswer(result.answer, { rows })) return result.answer;
      } catch {
        // 走模板兜底
      }
    }
    return formatRowsTemplate({ rows, total: rows.length, resource });
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

function createSearchAnswerPreference({ message, resource, rows }: { message?: string; resource: string; rows: DataRecord[] }): JsonObject {
  return {
    format: rows.length > 1 ? "natural_markdown_table" : "natural_single_record",
    display_fields: inferDisplayFields(resource, rows),
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
  if (item.field === "store") {
    return `这里按你的默认门店「${item.value}」来看的。`;
  }
  return `这里按 ${item.field}=${item.value} 来看的。`;
}

function shouldSkipDefaultStore({ params, message }: { params?: JsonObject; message?: string }): boolean {
  const text = String(message ?? "");
  if (params?.group_by === "store_name") return true;
  return /(各门店|所有门店|全部门店|全部门店|全店|全公司|整个|整体|体系|集团|区域|对比)/.test(text);
}

function translateTimeRangeToIso(text: unknown): string | null {
  const input = String(text ?? "");
  const now = new Date();
  if (/本月|这个月/.test(input)) {
    return formatLocalDate(new Date(now.getFullYear(), now.getMonth(), 1));
  }
  if (/上月|上个月/.test(input)) {
    return formatLocalDate(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  }
  if (/本周|这周/.test(input)) {
    const d = new Date(now);
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    return formatLocalDate(d);
  }
  if (/今天|今日/.test(input)) {
    return formatLocalDate(now);
  }
  if (/昨天|昨日/.test(input)) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return formatLocalDate(d);
  }
  if (/最近|近期|近来/.test(input)) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 1);
    return formatLocalDate(d);
  }
  if (/近一个月|最近一个月|过去一个月/.test(input)) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 1);
    return formatLocalDate(d);
  }
  if (/近三个月|最近三个月|过去三个月/.test(input)) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 3);
    return formatLocalDate(d);
  }
  if (/近半年|最近半年/.test(input)) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 6);
    return d.toISOString().slice(0, 10);
  }
  const quarterMatch = input.match(/Q([1-4])/i);
  if (quarterMatch) {
    const q = Number(quarterMatch[1]);
    const startMonth = (q - 1) * 3;
    return formatLocalDate(new Date(now.getFullYear(), startMonth, 1));
  }
  return null;
}

function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

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
function buildFilterFromRule({ raw, rule, params: _params, message, user }: {
  raw: unknown;
  rule: JsonObject;
  params?: JsonObject;
  message?: string;
  user?: UserContext;
}): QueryFilter | QueryFilter[] | null {
  let value = raw;
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string") value = value.trim();
  if (value === "") return null;

  const transformed = applyMappingTransform(value, rule, { message, user });
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
function applyMappingTransform(value: unknown, rule: JsonObject, { message, user }: MappingContext = {}): JsonValue | QueryFilter | QueryFilter[] | null {
  if (rule.transform === "time_range_to_iso") {
    return translateTimeRangeToIso(String(value ?? ""));
  }
  if (rule.transform === "month_token_or_time_range") {
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
  if (rule.transform === "leave_department_aliases") {
    const text = String(value ?? "").trim();
    if (/销售部/.test(text)) return ["展厅销售组", "华东销售部", "华南销售部"];
    if (/人事部|人力资源|行政人事/.test(text)) return ["人力资源部"];
    return text ? [text] : null;
  }
  if (rule.transform === "clean_fault_category") {
    return String(value ?? "").replace(/故障类别|故障$/u, "").trim();
  }
  if (rule.transform === "normalize_finance_direction") {
    const text = String(value ?? "").trim();
    if (/付款|支付|付了|扣款|抵扣|支出|支款/.test(text)) return "出账";
    if (/收款|到账|收到/.test(text)) return "收款";
    return text;
  }
  if (rule.transform === "infer_leave_type") {
    return inferLeaveType(String(value ?? message ?? ""));
  }
  if (rule.transform === "overdue_repair_filters") {
    if (value !== true) return null;
    const today = new Date().toISOString().slice(0, 10);
    return [
      { field: "promised_finish_at", op: "lte", value: today },
      { field: "status", op: "neq", value: "已交付" }
    ];
  }
  if (rule.transform === "leave_scope") {
    const text = String(message ?? "");
    const scope = String(value ?? "");
    const selfScope = scope === "self" || /(我|我的|本人)/.test(text);
    const companyScope = scope === "company" || /(全公司|整个公司|公司全员|所有员工|全部员工|公司最近)/.test(text);
    const teamScope = scope === "team" || /(同学|下属|下级|下辖|团队|组员|成员)/.test(text);
    const peopleScope = /(谁|哪些人|哪几个人|哪位|哪些员工)/.test(text);
    if ((companyScope || peopleScope) && user?.permissions?.includes("org:read")) {
      /** @type {import("../types/agent-contracts.js").QueryFilter[]} */
      const filters: QueryFilter[] = [{ field: "applicant_user_id", op: "in", value: "__ALL_ORG_USERS__" }];
      if (companyScope) {
        filters.push({ field: "department", op: "in", value: ["华东销售部", "华南销售部", "人力资源部"] });
      }
      return filters;
    }
    if (teamScope && user?.permissions?.includes("org:read")) {
      return { field: "applicant_user_id", op: "in", value: "__CURRENT_USER_REPORTS__" };
    }
    if (selfScope) return { field: "applicant_user_id", op: "eq", value: "__CURRENT_USER__" };
    if (user?.permissions?.includes("org:read")) {
      return { field: "applicant_user_id", op: "in", value: "__ALL_ORG_USERS__" };
    }
    return { field: "applicant_user_id", op: "eq", value: "__CURRENT_USER__" };
  }

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

function extractMonthToken(text: unknown): string | null {
  const input = String(text ?? "");
  if (/本月|这个月/.test(input)) return new Date().toISOString().slice(0, 7);
  const explicit = input.match(/(20\d{2})[-年/.](\d{1,2})/);
  if (explicit) return `${explicit[1]}-${String(Number(explicit[2])).padStart(2, "0")}`;
  const monthOnly = input.match(/(\d{1,2})月/);
  if (monthOnly) return `${new Date().getFullYear()}-${String(Number(monthOnly[1])).padStart(2, "0")}`;
  return null;
}

function inferLeaveType(text: unknown): string | null {
  const input = String(text ?? "");
  if (/年假/.test(input)) return "年假";
  if (/病假/.test(input)) return "病假";
  if (/事假/.test(input)) return "事假";
  if (/调休/.test(input)) return "调休";
  return null;
}

function formatAggregateAnswer({ metric, metricDef, groupBy, toolData, params: _params }: {
  metric: string;
  metricDef?: DataRecord;
  groupBy?: string | null;
  toolData?: DataRecord;
  params?: JsonObject;
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
      lines.push(createGroupedMetricIntro({ metric, groupBy, total: toolData?.total }));
      lines.push("");
      lines.push(formatGroupedMetricTable({ groups, groupBy, primaryAs, metric, formatValue: fmt }));
    }
  } else {
    const aggregates = toolData?.aggregates ?? {};
    const primaryAs = pickPrimaryAs(metricDef, metric);
    const value = aggregates[primaryAs];
    if (value === null || value === undefined) {
      lines.push(`没有查到符合条件的记录，无法计算${labelOfMetric(metric)}。`);
    } else {
      lines.push(`${labelOfMetric(metric)}是 **${fmt(value)}**。`);
      if (Number(toolData?.total ?? 0) > 0) lines.push(`这次统计覆盖 ${toolData.total} 条记录。`);
    }
  }

  lines.push(`口径上：${definition}`);
  return lines.join("\n");
}

function createGroupedMetricIntro({ metric, groupBy, total }: { metric: string; groupBy: string; total?: unknown }): string {
  if (metric === "order_count" && groupBy === "order_status") {
    return `最近订单按${labelOfField(groupBy)}看，主要是下面这些状态。`;
  }
  const totalText = Number(total ?? 0) > 0 ? `（共 ${total} 条记录）` : "";
  return `${labelOfMetric(metric)}按${labelOfField(groupBy)}分布如下${totalText}。`;
}

function formatGroupedMetricTable({ groups, groupBy, primaryAs, metric, formatValue }: {
  groups: DataRecord[];
  groupBy: string;
  primaryAs: string;
  metric: string;
  formatValue: MetricFormatter;
}): string {
  const metricLabel = labelOfMetric(metric);
  const rows = [
    `| ${labelOfField(groupBy)} | ${metricLabel} | 记录数 |`,
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

function labelOfMetric(metric: string): string {
  const map: Record<string, string> = {
    total_revenue: "总成交额",
    order_count: "订单数",
    avg_price: "平均成交价",
    total_profit: "总毛利",
    gross_margin: "毛利率(%)",
    max_price: "最高成交价",
    min_price: "最低成交价",
    total_amount: "总金额",
    unsettled_amount: "未结清金额",
    record_count: "记录数",
    avg_amount: "平均金额",
    total_receivable: "应收合计",
    avg_labor: "平均工时费",
    max_receivable: "最高应收",
    total_labor: "工时费合计",
    lead_count: "线索数",
    converted_count: "成交线索数",
    conversion_rate: "转化率(%)",
    lost_count: "战败线索数",
    avg_followup: "平均跟进次数"
  };
  return map[metric] ?? metric;
}

function labelOfField(field: unknown): string {
  const key = String(field ?? "");
  const map: Record<string, string> = {
    store_name: "门店",
    series: "车系",
    order_status: "订单状态",
    payment_status: "付款状态",
    delivery_status: "交付状态",
    owner_name: "销售顾问",
    order_type: "订单类型",
    resource_type: "款项类型",
    direction: "方向",
    category: "类别",
    status: "状态",
    intention_level: "意向等级",
    source: "来源",
    interested_series: "意向车系",
    service_advisor_name: "服务顾问",
    inventory: "库存",
    lead: "线索",
    sales: "销售",
    finance: "财务",
    after_sales: "售后",
    warranty: "三包"
  };
  return map[key] ?? key;
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

function formatRowsTemplate({ rows, total, resource }: { rows: DataRecord[]; total: number; resource: string }): string {
  const head = rows.slice(0, 8);
  const table = formatRowsTable({ rows: head, resource });
  if (table) return `最近有 ${total} 条相关记录：\n\n${table}`;
  const lines = head.map((row) => formatRowByResource(row, resource));
  return `最近有 ${total} 条相关记录：\n${lines.join("\n")}`;
}

function formatRowsTable({ rows, resource }: { rows: DataRecord[]; resource: string }): string {
  if (!rows.length) return "";
  const columns = getDisplayColumns(resource, rows);
  if (!columns.length) return "";
  const header = `| ${columns.map((column) => column.label).join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${columns.map((column) => escapeMarkdownCell(formatCellValue(row[column.field]))).join(" | ")} |`);
  return [header, divider, ...body].join("\n");
}

function inferDisplayFields(resource: string, rows: DataRecord[]): string[] {
  return getDisplayColumns(resource, rows).map((column: DisplayColumn) => column.field);
}

function getDisplayColumns(resource: string, rows: DataRecord[] = []): DisplayColumn[] {
  const presets: Record<string, Array<[string, string]>> = {
    leave_requests: [
      ["applicant_name", "员工"],
      ["leave_type", "类型"],
      ["leave_duration", "时长"],
      ["start_time", "开始时间"],
      ["end_time", "结束时间"],
      ["status", "状态"],
      ["reason", "事由"]
    ],
    dealer_vehicles: [
      ["store_name", "门店"],
      ["series", "车系"],
      ["model", "车型"],
      ["status", "状态"],
      ["stock_age_days", "库龄(天)"],
      ["stock_warning_level", "预警"]
    ],
    dealer_sales_orders: [
      ["store_name", "门店"],
      ["customer_name", "客户"],
      ["series", "车系"],
      ["model", "车型"],
      ["order_status", "订单状态"],
      ["payment_status", "收款状态"],
      ["delivery_status", "交付状态"],
      ["final_price", "成交价"]
    ],
    dealer_leads: [
      ["store_name", "门店"],
      ["customer_name", "客户"],
      ["source", "来源"],
      ["interested_series", "意向车系"],
      ["intention_level", "意向等级"],
      ["status", "状态"],
      ["followup_count", "跟进次数"]
    ]
  };
  const preset = presets[resource];
  if (preset) {
    return preset
      .filter(([field]) => rows.some((row) => row?.[field] !== undefined && row?.[field] !== null && row?.[field] !== ""))
      .map(([field, label]) => ({ field, label }));
  }
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

function formatRowByResource(row: DataRecord, resource: string): string {
  if (resource === "dealer_vehicles") {
    const stockAge = row.stock_age_days != null ? `库龄 ${row.stock_age_days} 天` : "";
    const warning = row.stock_warning_level ? `预警 ${row.stock_warning_level}` : "";
    return `- ${row.store_name ?? ""} ${row.series ?? ""} ${row.model ?? ""}（${[stockAge, warning].filter(Boolean).join("，")}）`;
  }
  if (resource === "dealer_finance") {
    return `- [${row.id ?? ""}] ${row.store_name ?? ""} ${row.category ?? ""} ${row.direction ?? ""} ${row.amount ?? ""}（${row.status ?? ""}，${row.occurred_at ?? ""}）`;
  }
  if (resource === "dealer_repair_orders") {
    return `- [${row.id ?? ""}] ${row.store_name ?? ""} ${row.series ?? ""} ${row.order_type ?? ""}（状态 ${row.status ?? ""}，承诺完工 ${row.promised_finish_at ?? ""}）`;
  }
  if (resource === "dealer_warranty_claims") {
    const diff = row.difference_amount != null ? `差额 ${row.difference_amount}` : "";
    return `- [${row.id ?? ""}] ${row.store_name ?? ""} ${row.series ?? ""} ${row.fault_category ?? ""}（${row.claim_status ?? ""}${diff ? "，" + diff : ""}，提交 ${row.submitted_at ?? ""}）`;
  }
  if (resource === "dealer_sales_orders") {
    return `- [${row.id ?? ""}] ${row.store_name ?? ""} ${row.customer_name ?? ""} ${row.series ?? ""} ${row.model ?? ""}（${row.order_status ?? ""}/${row.payment_status ?? ""}/${row.delivery_status ?? ""}，${row.final_price ?? ""}）`;
  }
  if (resource === "dealer_leads") {
    return `- [${row.id ?? ""}] ${row.store_name ?? ""} ${row.customer_name ?? ""} ${row.interested_series ?? ""}（意向 ${row.intention_level ?? ""}，状态 ${row.status ?? ""}，跟进 ${row.followup_count ?? 0} 次）`;
  }
  if (resource === "leave_requests") {
    return `- ${row.applicant_name ?? "未知员工"}：${row.leave_type ?? "请假"} ${row.leave_duration ?? ""}，${row.start_time ?? ""} 至 ${row.end_time ?? ""}（${row.status ?? "未知状态"}，${row.reason ?? "未填写事由"}）`;
  }
  if (resource === "dealer_metrics") {
    return `- ${row.store_name ?? ""} ${labelOfField(row.category)}/${row.metric ?? ""}：${row.value ?? ""}${row.unit ?? ""}（${row.severity ?? ""}） ${row.summary ?? ""} 建议：${row.recommendation ?? ""}`;
  }
  return `- ${JSON.stringify(row).slice(0, 200)}`;
}
