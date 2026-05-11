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
      answer = await this.summarize({ message, rows, intent_code });
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
    return filters;
  }

  async summarize({ message, rows, intent_code }) {
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
            data: { resource: "dealer_vehicles", rows: sample, total: rows.length }
          }]
        });
        if (result?.answer) return result.answer;
      } catch {
        // 走模板兜底
      }
    }
    return formatRowsTemplate({ rows, total: rows.length });
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

function formatRowsTemplate({ rows, total }) {
  const head = rows.slice(0, 8);
  const lines = head.map((row) => {
    const store = row.store_name ?? "(未知门店)";
    const series = row.series ?? "";
    const model = row.model ?? "";
    const stockAge = row.stock_age_days != null ? `库龄 ${row.stock_age_days} 天` : "";
    const warning = row.stock_warning_level ? `预警 ${row.stock_warning_level}` : "";
    return `- ${store} ${series} ${model}（${[stockAge, warning].filter(Boolean).join("，")}）`;
  });
  return `为您查到 ${total} 条记录：\n${lines.join("\n")}`;
}
