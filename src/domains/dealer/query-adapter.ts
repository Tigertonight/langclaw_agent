/**
 * DealerQueryAdapter：经销商域的查询适配器。
 *
 * 处理 dealer.query.* 系列 intent_code 的 buildFilters / applyDefaults / postProcessAnswer，
 * 从 IntentQueryHandler 硬编码分支迁移而来（M4b）。
 *
 * 覆盖的 intent_code / resource 组合：
 *   - dealer.query.inventory     → dealer_vehicles
 *   - dealer.query.repair_orders → dealer_repair_orders
 *   - dealer.query.warranty_claims → dealer_warranty_claims
 *   - dealer.query.sales_orders  → dealer_sales_orders
 *   - dealer.query.leads         → dealer_leads
 *   - dealer.query.finance       → dealer_finance
 *   - dealer.query.metrics       → dealer_metrics（仅 postProcessAnswer）
 *   - dealer.aggregate.*         → 各 dealer_* 资源（buildFilters 复用）
 */

import type {
  DomainQueryAdapter,
  QueryAdapterInput,
  DefaultsInput,
  DefaultsResult,
  FiltersInput,
  AnswerPostProcessInput,
} from "../types.js";
import type { QueryFilter, JsonObject, QueryIR } from "../../types/agent-contracts.js";
import { translateTimeRangeToIso } from "../shared/time-utils.js";
import { isDealerQuestion, isDealerAnalysisQuestion, parseDealerQuery, planDealerMultiQuery } from "./query-heuristics.js";

function shouldSkipDefaultStore({ params, message }: { params?: JsonObject; message?: string }): boolean {
  const text = String(message ?? "");
  if (params?.group_by === "store_name") return true;
  return /(各门店|所有门店|全部门店|全部门店|全店|全公司|整个|整体|体系|集团|区域|对比)/.test(text);
}

// ─── 支持的 intent_code → resource 映射 ──────────────────────────────────────

const DEALER_INTENT_RESOURCE_MAP: Record<string, string> = {
  "dealer.query.inventory": "dealer_vehicles",
  "dealer.query.repair_orders": "dealer_repair_orders",
  "dealer.query.warranty_claims": "dealer_warranty_claims",
  "dealer.query.sales_orders": "dealer_sales_orders",
  "dealer.query.leads": "dealer_leads",
  "dealer.query.finance": "dealer_finance",
  // aggregate 系列也走同样的 buildFilters
  "dealer.aggregate.sales_orders": "dealer_sales_orders",
  "dealer.aggregate.repair_orders": "dealer_repair_orders",
  "dealer.aggregate.leads": "dealer_leads",
  "dealer.aggregate.finance": "dealer_finance",
  // metrics 仅 postProcessAnswer
  "dealer.query.metrics": "dealer_metrics",
};

// ─── buildFilters 分支 ───────────────────────────────────────────────────────

function buildInventoryFilters(params: JsonObject): QueryFilter[] {
  const filters: QueryFilter[] = [];
  const { vehicle_model, store, warning_level } = params;
  if (vehicle_model && typeof vehicle_model === "string" && vehicle_model.trim()) {
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
  return filters;
}

function buildRepairOrdersFilters(params: JsonObject): QueryFilter[] {
  const filters: QueryFilter[] = [];
  const { store, series, status, order_type, service_advisor, time_range, overdue_only } = params;
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
  // 逾期 = promised_finish_at <= 今天 AND status != 已交付
  if (overdue_only === true) {
    const today = new Date().toISOString().slice(0, 10);
    filters.push({ field: "promised_finish_at", op: "lte", value: today });
    filters.push({ field: "status", op: "neq", value: "已交付" });
  }
  return filters;
}

function buildWarrantyClaimsFilters(params: JsonObject): QueryFilter[] {
  const filters: QueryFilter[] = [];
  const { store, series, claim_status, fault_category, evidence_status, time_range, difference_min } = params;
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
  return filters;
}

function buildSalesOrdersFilters(params: JsonObject): QueryFilter[] {
  const filters: QueryFilter[] = [];
  const { store, series, model, owner, order_type, order_status, payment_status, delivery_status, time_range, price_min, price_max } = params;
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
  return filters;
}

function buildLeadsFilters(params: JsonObject): QueryFilter[] {
  const filters: QueryFilter[] = [];
  const { store, series, owner, intention_level, status, source, time_range } = params;
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
  return filters;
}

function buildFinanceFilters(params: JsonObject): QueryFilter[] {
  const filters: QueryFilter[] = [];
  const { resource_type, store, category, direction, status, time_range, amount_min, amount_max } = params;
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
  return filters;
}

/** intent_code → buildFilters 分派表 */
const FILTERS_DISPATCH: Record<string, (params: JsonObject) => QueryFilter[]> = {
  "dealer.query.inventory": buildInventoryFilters,
  "dealer.query.repair_orders": buildRepairOrdersFilters,
  "dealer.query.warranty_claims": buildWarrantyClaimsFilters,
  "dealer.query.sales_orders": buildSalesOrdersFilters,
  "dealer.query.leads": buildLeadsFilters,
  "dealer.query.finance": buildFinanceFilters,
  // aggregate 系列复用同一 resource 的 buildFilters
  "dealer.aggregate.sales_orders": buildSalesOrdersFilters,
  "dealer.aggregate.repair_orders": buildRepairOrdersFilters,
  "dealer.aggregate.leads": buildLeadsFilters,
  "dealer.aggregate.finance": buildFinanceFilters,
};

// ─── Adapter ─────────────────────────────────────────────────────────────────

export const dealerQueryAdapter: DomainQueryAdapter = {
  domain: "dealer",

  supports(input: QueryAdapterInput): boolean {
    const key = input.intentCode;
    // 精确匹配 intent_code + resource
    if (DEALER_INTENT_RESOURCE_MAP[key] === input.resource) return true;
    // aggregate 系列的 resource 可能与 query 系列共享
    if (key in FILTERS_DISPATCH && input.resource.startsWith("dealer_")) return true;
    // dealer_metrics 仅 postProcessAnswer
    if (key === "dealer.query.metrics" && input.resource === "dealer_metrics") return true;
    return false;
  },

  applyDefaults(input: DefaultsInput): DefaultsResult | null {
    const { manifest, params, user, message } = input;
    const schema = manifest?.params_schema ?? {};
    const next = { ...(params ?? {}) };
    const applied: JsonObject[] = [];

    // store 默认值：用户在 users.json 里有 default_store，且当前 manifest 接受 store 字段、用户没显式提
    if (
      schema.store &&
      (next.store == null || next.store === "") &&
      user?.default_store &&
      !shouldSkipDefaultStore({ params: next, message })
    ) {
      next.store = user.default_store;
      applied.push({ field: "store", value: String(user.default_store), reason: "默认门店" });
    }

    if (!applied.length) return null;
    return { params: next, filters: undefined };
  },

  buildFilters(input: FiltersInput): QueryFilter[] | null {
    const fn = FILTERS_DISPATCH[input.intentCode];
    if (!fn) return null;
    return fn(input.params ?? {});
  },

  postProcessAnswer(input: AnswerPostProcessInput): string {
    const { answer, manifest, message, params, user } = input;
    const resource = manifest?.tool_binding?.resource;
    // dealer_metrics 的库存+线索补丁
    if (resource === "dealer_metrics" && /库存/.test(message ?? "") && /线索/.test(message ?? "") && !/线索/.test(answer)) {
      return `${answer}\n\n线索维度也在本次优先级问题范围内；如需展开，可继续查看 lead 类经营指标。`;
    }
    if (params?.store && user?.default_store && params.store === user.default_store && !/默认(?:store|门店)|已自动套用/.test(answer)) {
      return `${answer}\n\n这里按你的默认门店「${user.default_store}」来看的。`;
    }
    return answer;
  },

  // ── NLP 启发式接口（供 query-parser 动态调用） ──

  isRelevantQuestion(question: string): boolean {
    return isDealerQuestion(question);
  },

  isAnalysisQuestion(question: string): boolean {
    return isDealerAnalysisQuestion(question);
  },

  parseQuery(input: { question: string; operation: string; forcedTarget?: string }): QueryIR | null {
    return parseDealerQuery(input);
  },

  planMultiQuery(input: { question: string; operation?: string }): QueryIR[] | null {
    return planDealerMultiQuery(input);
  },
};
