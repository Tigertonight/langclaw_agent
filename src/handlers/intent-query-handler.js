/**
 * IntentQueryHandler：v2 一次性结构化查询执行器。
 *
 *   1. 根据 manifest 拿 tool_binding（PoC 仅支持 dealer.query.inventory）
 *   2. 把 Router 抽好的 params 直接映射成 filters，绝不再做硬编码字面量过滤
 *   3. 调一次 tool（query_business_data），拿到 rows
 *   4. 用 LLM（或模板）把 rows 总结为自然语言 answer
 */
export class IntentQueryHandler {
  constructor({ llm, toolRegistry, registry } = {}) {
    this.llm = llm;
    this.toolRegistry = toolRegistry;
    this.registry = registry;
  }

  async execute({ user, message, intent_code, params = {}, route, session } = {}) {
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

    if (binding.operation === "aggregate") {
      return this.executeAggregate({ user, message, manifest, params, binding });
    }

    const filters = this.buildFilters({ intent_code, resource: binding.resource, params });
    const toolCall = {
      name: binding.tool_name,
      args: {
        resource: binding.resource,
        operation: "search",
        filters,
        limit: 50
      }
    };
    const toolPlan = { calls: [toolCall] };

    const toolResult = await this.toolRegistry.execute(toolCall, { user });
    const toolResults = [toolResult];

    const rows = toolResult?.data?.rows ?? [];
    let answer;
    if (toolResult?.ok === false) {
      answer = `查询未成功：${toolResult?.message ?? toolResult?.error ?? "未知错误"}。`;
    } else if (rows.length === 0) {
      answer = "没有查到符合条件的记录。";
    } else {
      answer = await this.summarize({ message, rows, intent_code, resource: binding.resource });
    }

    const debug = {
      intent_code,
      params,
      filters,
      tool_call: toolCall,
      row_count: rows.length
    };
    return {
      answer,
      table: { rows, fields: toolResult?.data?.fields ?? [] },
      debug,
      toolPlan,
      toolResults
    };
  }

  async executeAggregate({ user, message, manifest, params, binding }) {
    const intent_code = manifest.intent_code;
    const metric = params?.metric;
    const groupBy = params?.group_by;
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

    const baseFilters = this.buildFilters({ intent_code, resource: binding.resource, params });
    const filterAddon = Array.isArray(def.filter_addon) ? def.filter_addon : [];
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
    const toolResult = await this.toolRegistry.execute(toolCall, { user });
    const toolResults = [toolResult];

    let answer;
    if (toolResult?.ok === false) {
      answer = `查询未成功：${toolResult?.message ?? toolResult?.error ?? "未知错误"}。`;
    } else {
      answer = formatAggregateAnswer({
        metric,
        metricDef: def,
        groupBy: toolCall.args.group_by ?? null,
        toolData: toolResult?.data,
        params
      });
    }

    const debug = {
      intent_code,
      params,
      filters,
      tool_call: toolCall,
      operation: "aggregate"
    };
    return {
      answer,
      table: { rows: [], fields: [] },
      debug,
      toolPlan,
      toolResults
    };
  }

  buildFilters({ intent_code, resource, params }) {
    const filters = [];
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

  checkPermissions({ manifest, user }) {
    const required = manifest.required_permissions ?? [];
    if (!required.length) return { ok: true };
    if (!user) {
      return { ok: false, code: "no_user", message: "无法识别当前用户身份。" };
    }
    const userPerms = new Set(user.permissions ?? []);
    // 角色级别的隐式授权：和 src/auth/permissions.js#canReadDealerResource 对齐。
    // 这里只做粗粒度放行（避免在 handler 层抢着拒绝），细粒度仍交给 ToolRegistry/authorizeToolCall。
    const resource = manifest.tool_binding?.resource;
    if (resource === "dealer_finance" && user.role === "store_general_manager") {
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

  async summarize({ message, rows, intent_code, resource }) {
    const sample = rows.slice(0, 10);
    if (this.llm && typeof this.llm.generateAnswer === "function" && (process.env.LLM_API_KEY || process.env.OPENAI_API_KEY)) {
      try {
        const result = await this.llm.generateAnswer({
          user: { name: "员工" },
          question: message,
          route: { intent: "data_query", intent_code },
          docs: [],
          toolResults: [{
            ok: true,
            tool: "query_business_data",
            data: { resource, rows: sample, total: rows.length }
          }]
        });
        if (result?.answer) return result.answer;
      } catch {
        // 走模板兜底
      }
    }
    return formatRowsTemplate({ rows, total: rows.length, resource });
  }
}

function translateTimeRangeToIso(text) {
  const now = new Date();
  if (/近一个月|最近一个月|本月|过去一个月/.test(text)) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  }
  if (/近三个月|最近三个月|过去三个月/.test(text)) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 3);
    return d.toISOString().slice(0, 10);
  }
  if (/近半年|最近半年/.test(text)) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 6);
    return d.toISOString().slice(0, 10);
  }
  const quarterMatch = text.match(/Q([1-4])/i);
  if (quarterMatch) {
    const q = Number(quarterMatch[1]);
    const startMonth = (q - 1) * 3;
    return new Date(now.getFullYear(), startMonth, 1).toISOString().slice(0, 10);
  }
  return null;
}

function formatAggregateAnswer({ metric, metricDef, groupBy, toolData, params }) {
  const definition = metricDef?.definition ?? metric;
  const fmt = (value) => formatMetricValue(metric, value);
  const lines = [];

  if (groupBy && Array.isArray(toolData?.groups)) {
    const groups = toolData.groups;
    if (groups.length === 0) {
      lines.push("没有查到符合条件的记录。");
    } else {
      // 选用作为"主指标"的那个 as：取 metric_definitions 里第一个非 _ 开头的 derived，否则第一个 aggregations 的 as
      const primaryAs = pickPrimaryAs(metricDef, metric);
      lines.push(`按 ${labelOfField(groupBy)} 分组的「${labelOfMetric(metric)}」：`);
      for (const g of groups) {
        const groupValue = Object.values(g.group ?? {})[0] ?? "(空)";
        const value = g.aggregates?.[primaryAs];
        lines.push(`- ${groupValue}：${fmt(value)}（${g.row_count} 条记录）`);
      }
    }
  } else {
    const aggregates = toolData?.aggregates ?? {};
    const primaryAs = pickPrimaryAs(metricDef, metric);
    const value = aggregates[primaryAs];
    if (value === null || value === undefined) {
      lines.push(`没有查到符合条件的记录，无法计算${labelOfMetric(metric)}。`);
    } else {
      lines.push(`${labelOfMetric(metric)}：**${fmt(value)}**（基于 ${toolData?.total ?? 0} 条记录）`);
    }
  }

  lines.push(`※ 口径：${definition}`);
  return lines.join("\n");
}

function pickPrimaryAs(metricDef, metric) {
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

function labelOfMetric(metric) {
  const map = {
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

function labelOfField(field) {
  const map = {
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
    service_advisor_name: "服务顾问"
  };
  return map[field] ?? field;
}

function formatMetricValue(metric, value) {
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

function formatRowsTemplate({ rows, total, resource }) {
  const head = rows.slice(0, 8);
  const lines = head.map((row) => formatRowByResource(row, resource));
  return `为您查到 ${total} 条记录：\n${lines.join("\n")}`;
}

function formatRowByResource(row, resource) {
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
  return `- ${JSON.stringify(row).slice(0, 200)}`;
}
