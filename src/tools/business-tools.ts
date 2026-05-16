import { loadJson, saveJson } from "../data/load-json.js";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { resolveProjectPath } from "../data/load-json.js";
import { buildDealerMetrics } from "../dealer/dealer-metrics.js";
import type { JsonObject, JsonValue, QueryFilter, QuerySort, ToolDefinition, ToolExecutionContext } from "../types/agent-contracts.js";

interface QueryArgs extends JsonObject {
  filters?: QueryFilter[];
  sort?: QuerySort[];
}

interface LeaveTimeRange {
  startTime?: string | null;
  endTime?: string | null;
  leaveDuration?: string | null;
}

type DataRow = Record<string, unknown>;
type AggregateValue = number | string | boolean | null;

interface BusinessToolContext {
  user: {
    id: string;
    name?: string;
    department?: string;
    permissions?: string[];
    accessible_customer_ids?: string[];
  };
}

interface ResourceConfig {
  file?: string;
  scopeField?: string;
  scopeType?: string;
  fields: string[];
  loader?: (context: BusinessToolContext) => Promise<DataRow[]>;
}

interface BusinessQueryArgs extends QueryArgs {
  resource?: string;
  operation?: string;
  aggregations?: QueryAggregation[];
  metrics?: QueryAggregation[];
  derived?: QueryDerivedExpression[];
  group_by?: string | string[];
  fields?: string[];
  limit?: number;
  display?: JsonValue;
}

interface QueryAggregation extends JsonObject {
  type?: string;
  field?: string;
  as?: string;
}

interface QueryDerivedExpression extends JsonObject {
  as?: string;
  const?: number | string;
  ref?: string;
  op?: string;
  left?: QueryDerivedExpression;
  right?: QueryDerivedExpression;
}

function normalize(text: unknown): string {
  return String(text ?? "").trim();
}

const RESOURCE_CONFIG: Record<string, ResourceConfig> = {
  customers: {
    file: "data/customers.json",
    scopeField: "id",
    fields: [
      "id",
      "name",
      "owner_user_id",
      "department",
      "tier",
      "industry",
      "industry_category",
      "annual_revenue",
      "deal_status",
      "follow_status",
      "renewal_status",
      "last_contacted_at",
      "next_follow_up_at",
      "contract_expire_at"
    ]
  },
  orders: {
    file: "data/orders.json",
    scopeField: "customer_id",
    fields: [
      "id",
      "customer_id",
      "customer_name",
      "status",
      "amount",
      "created_at",
      "expected_delivery"
    ]
  },
  sales_reports: {
    file: "data/sales_reports.json",
    fields: [
      "department",
      "period",
      "revenue",
      "pipeline",
      "top_customers"
    ]
  },
  employees: {
    file: "data/wecom-users.json",
    fields: [
      "userid",
      "name",
      "alias",
      "department_name",
      "position",
      "role",
      "direct_leader",
      "reporting",
      "main_department",
      "department"
    ]
  },
  departments: {
    file: "data/wecom-departments.json",
    fields: [
      "id",
      "name",
      "parentid",
      "order",
      "leader_userid",
      "vertical_relation",
      "vertical_department",
      "relation"
    ]
  },
  leave_requests: {
    file: "data/leave-requests.json",
    scopeType: "self_user",
    fields: [
      "id",
      "applicant_user_id",
      "applicant_name",
      "department",
      "leave_type",
      "leave_duration",
      "start_time",
      "end_time",
      "reason",
      "status",
      "submitted_at"
    ]
  },
  dealer_stores: {
    file: "data/dealer-stores.json",
    fields: ["id", "name", "short_name", "city", "region", "store_type", "manager_user_id", "capacity", "status"]
  },
  dealer_vehicles: {
    file: "data/dealer-vehicles.json",
    fields: ["vin", "store_id", "store_name", "series", "model", "year", "color", "source_type", "purchase_mode", "cost", "finance_interest_accrued", "landing_cost", "min_sale_price", "inbound_date", "stock_age_days", "stock_warning_level", "status", "certificate_status", "vehicle_tag", "mileage", "sales_order_id"]
  },
  dealer_inbounds: {
    file: "data/dealer-inbounds.json",
    fields: ["id", "store_id", "store_name", "order_type", "series", "model", "color", "customer_name", "sales_consultant_id", "byd_order_no", "status", "expected_arrival_date", "customer_promised_date", "deposit_amount"]
  },
  dealer_quotas: {
    file: "data/dealer-quotas.json",
    fields: ["id", "store_id", "store_name", "month", "series", "model", "color", "quota_total", "bound_inbound_count", "available_quota"]
  },
  dealer_leads: {
    file: "data/dealer-leads.json",
    fields: ["id", "customer_name", "phone_masked", "source", "campaign", "store_id", "store_name", "owner_user_id", "owner_name", "interested_series", "intention_level", "status", "created_at", "assigned_at", "first_contact_at", "last_followup_at", "followup_count", "visit_count", "expected_purchase_date", "lost_reason", "converted_order_id"]
  },
  dealer_sales_orders: {
    file: "data/dealer-sales-orders.json",
    fields: ["id", "store_id", "store_name", "customer_name", "owner_user_id", "owner_name", "vin", "series", "model", "order_type", "order_status", "payment_status", "invoice_status", "delivery_status", "list_price", "final_price", "landing_cost", "gross_profit", "deposit_amount", "paid_amount", "finance_amount", "created_at", "expected_delivery_date"]
  },
  dealer_finance: {
    file: "data/dealer-finance.json",
    fields: ["id", "resource_type", "store_id", "store_name", "direction", "category", "amount", "balance_after", "related_order_id", "occurred_at", "status"]
  },
  dealer_repair_orders: {
    file: "data/dealer-repair-orders.json",
    fields: ["id", "store_id", "store_name", "customer_name", "vin", "series", "service_advisor_id", "service_advisor_name", "order_type", "status", "appointment_at", "reception_at", "promised_finish_at", "labor_amount", "part_amount", "receivable_amount", "warranty_claim_id", "next_service_suggestion"]
  },
  dealer_warranty_claims: {
    file: "data/dealer-warranty-claims.json",
    fields: ["id", "repair_order_id", "store_id", "store_name", "customer_name", "vin", "series", "fault_category", "fault_code", "claim_status", "claimed_amount", "approved_amount", "difference_amount", "submitted_at", "expected_settlement_at", "evidence_status"]
  },
  dealer_metrics: {
    loader: buildDealerMetrics,
    fields: ["id", "scope", "store_name", "category", "metric", "value", "unit", "severity", "summary", "recommendation", "related_resource", "related_ids"]
  }
};

const FIELD_LABELS = {
  id: "ID",
  name: "客户名",
  customer_name: "客户名",
  customer_id: "客户ID",
  owner_user_id: "负责人ID",
  department: "部门",
  tier: "等级",
  industry: "行业",
  industry_category: "行业类别",
  annual_revenue: "年度成交额",
  deal_status: "签单状态",
  follow_status: "跟进状态",
  renewal_status: "续签状态",
  last_contacted_at: "最近联系时间",
  next_follow_up_at: "下次跟进时间",
  contract_expire_at: "合同到期时间",
  status: "状态",
  amount: "金额",
  created_at: "创建时间",
  expected_delivery: "预计交付时间",
  period: "周期",
  revenue: "销售收入",
  pipeline: "Pipeline",
  userid: "员工ID",
  alias: "别名",
  department_name: "所属组织",
  position: "岗位",
  role: "角色",
  direct_leader: "直属上级",
  reporting: "汇报关系",
  main_department: "主部门ID",
  parentid: "上级部门ID",
  leader_userid: "部门负责人",
  vertical_relation: "垂直关系",
  vertical_department: "垂直归属",
  relation: "协作关系",
  applicant_user_id: "申请人工号",
  applicant_name: "申请人",
  leave_type: "请假类型",
  leave_duration: "请假时长",
  start_time: "开始时间",
  end_time: "结束时间",
  reason: "请假理由",
  submitted_at: "提交时间",
  vin: "VIN",
  store_id: "门店ID",
  store_name: "门店",
  short_name: "门店简称",
  city: "城市",
  region: "区域",
  store_type: "门店类型",
  manager_user_id: "门店负责人",
  capacity: "库容",
  series: "车系",
  model: "车型",
  year: "年款",
  color: "颜色",
  source_type: "来源类型",
  purchase_mode: "进车方式",
  cost: "成本",
  finance_interest_accrued: "融资利息累计",
  landing_cost: "综合落地成本",
  min_sale_price: "最低售价参考",
  inbound_date: "入库日期",
  stock_age_days: "库龄天数",
  stock_warning_level: "库龄预警",
  certificate_status: "合格证状态",
  vehicle_tag: "车辆标签",
  mileage: "里程",
  sales_order_id: "销售订单",
  order_type: "订单类型",
  expected_arrival_date: "预计到店",
  customer_promised_date: "客户承诺交期",
  deposit_amount: "定金",
  month: "月份",
  quota_total: "总配额",
  bound_inbound_count: "已绑定在途",
  available_quota: "剩余配额",
  phone_masked: "手机号",
  source: "来源",
  campaign: "活动",
  owner_name: "负责人",
  interested_series: "意向车系",
  intention_level: "意向等级",
  assigned_at: "分配时间",
  first_contact_at: "首次联系",
  last_followup_at: "最近跟进",
  followup_count: "跟进次数",
  visit_count: "到店次数",
  expected_purchase_date: "预计购车",
  lost_reason: "战败原因",
  converted_order_id: "成交订单",
  order_status: "订单状态",
  payment_status: "收款状态",
  invoice_status: "开票状态",
  delivery_status: "交付状态",
  list_price: "指导价",
  final_price: "成交价",
  gross_profit: "毛利",
  paid_amount: "已收金额",
  finance_amount: "金融放款",
  expected_delivery_date: "预计交付",
  resource_type: "资金类型",
  direction: "方向",
  category: "类别",
  balance_after: "变动后余额",
  related_order_id: "关联单据",
  occurred_at: "发生日期",
  service_advisor_id: "服务顾问ID",
  service_advisor_name: "服务顾问",
  appointment_at: "预约时间",
  reception_at: "接待时间",
  promised_finish_at: "承诺完工",
  labor_amount: "工时费",
  part_amount: "配件费",
  receivable_amount: "应收金额",
  warranty_claim_id: "三包索赔单",
  next_service_suggestion: "下次服务建议",
  repair_order_id: "维修工单",
  fault_category: "故障类别",
  fault_code: "故障代码",
  claim_status: "索赔状态",
  claimed_amount: "申报金额",
  approved_amount: "核准金额",
  difference_amount: "差异金额",
  expected_settlement_at: "预计结算",
  evidence_status: "证据状态",
  scope: "范围",
  metric: "指标",
  value: "指标值",
  unit: "单位",
  severity: "严重程度",
  summary: "摘要",
  recommendation: "建议",
  related_resource: "关联资源",
  related_ids: "关联记录"
};

async function findCustomerByName(customerName: unknown): Promise<DataRow | undefined> {
  const customers = await loadJson("data/customers.json") as DataRow[];
  const normalized = normalize(customerName);
  return customers.find((customer) => String(customer.name ?? "").includes(normalized) || normalized.includes(String(customer.name ?? "")));
}

async function executeBusinessDataQuery(args: BusinessQueryArgs = {}, context: BusinessToolContext) {
  args = normalizeQueryArgs(args);
  const resource = String(args.resource ?? "");
  const config = RESOURCE_CONFIG[resource];
  if (!config) {
    return { ok: false, tool: "query_business_data", error: "invalid_resource", message: "不支持该业务资源。" };
  }

  const operation = args.operation ?? "search";
  let rows = config.loader ? await config.loader(context) : await loadJson(config.file ?? "") as DataRow[];
  if (resource === "leave_requests") {
    rows = rows.map(normalizeLeaveRequestRecord);
  }
  const runtimeFilters = await resolveRuntimeFilters(args.filters ?? [], context);
  rows = await injectUserScope(rows, config, context.user, runtimeFilters);
  rows = applyFilters(rows, runtimeFilters, config.fields);
  const total = rows.length;

  if (args.sort?.length) {
    rows = applySort(rows, args.sort, config.fields);
  }

  if (operation === "aggregate") {
    const aggregations = Array.isArray(args.aggregations) && args.aggregations.length
      ? args.aggregations
      : (Array.isArray(args.metrics) && args.metrics.length ? args.metrics : [{ type: "count", field: "id", as: "count" }]);
    const groupByField = typeof args.group_by === "string" ? args.group_by
      : (Array.isArray(args.group_by) && args.group_by.length === 1 ? args.group_by[0] : null);
    const derived = Array.isArray(args.derived) ? args.derived : [];

    if (groupByField && !config.fields.includes(groupByField)) {
      return {
        ok: false,
        tool: "query_business_data",
        error: "invalid_group_by",
        message: `group_by 字段 ${groupByField} 不在允许字段集内。`
      };
    }

    if (groupByField) {
      const buckets = new Map();
      for (const row of rows) {
        const key = row[groupByField];
        const list = buckets.get(key) ?? [];
        list.push(row);
        buckets.set(key, list);
      }
      const groups = [];
      for (const [key, bucketRows] of buckets.entries()) {
        const aggregateValues = computeAggregations(bucketRows, aggregations, config.fields);
        const derivedValues = computeDerived(aggregateValues, derived);
        groups.push({
          group: { [groupByField]: key },
          row_count: bucketRows.length,
          aggregates: { ...aggregateValues, ...derivedValues }
        });
      }
      groups.sort((a, b) => b.row_count - a.row_count);
      return {
        ok: true,
        tool: "query_business_data",
        data: {
          resource,
          operation,
          total,
          group_by: groupByField,
          groups,
          query: sanitizeQuery(args)
        }
      };
    }

    const aggregateValues = computeAggregations(rows, aggregations, config.fields);
    const derivedValues = computeDerived(aggregateValues, derived);
    return {
      ok: true,
      tool: "query_business_data",
      data: {
          resource,
        operation,
        total,
        aggregates: { ...aggregateValues, ...derivedValues },
        // 兼容老调用方
        metrics: Object.entries(aggregateValues).map(([as, value]) => ({ as, value })),
        query: sanitizeQuery(args)
      }
    };
  }

  const limit = clampLimit(args.limit ?? 20);
  const fields = normalizeFields(args.fields, config.fields);
  const selectedRows = await enrichRows(resource, rows.slice(0, limit).map((row) => pickFields(row, fields)));
  return {
    ok: true,
    tool: "query_business_data",
    data: {
      resource,
      operation: "search",
      total,
      rows: selectedRows,
      fields,
      field_labels: FIELD_LABELS,
      query: sanitizeQuery(args)
    }
  };
}

async function injectUserScope(rows: DataRow[], config: ResourceConfig, user: BusinessToolContext["user"], runtimeFilters: QueryFilter[] = []): Promise<DataRow[]> {
  if (config.scopeType === "self_user") {
    if (runtimeFilters.some((filter) => filter.runtime_scope === "all_org_users") && user.permissions?.includes("org:read")) {
      return rows;
    }
    const reportIds = user.permissions?.includes("org:read")
      ? await getReportTreeUserIds(user.id)
      : [];
    const allowedIds = new Set([user.id, ...reportIds]);
    const requestedApplicantIds = getRequestedApplicantIds(runtimeFilters);
    const hasNamedApplicantFilter = runtimeFilters.some((filter) => filter.field === "applicant_name");
    const hasDepartmentFilter = runtimeFilters.some((filter) => filter.field === "department");
    if (hasDepartmentFilter && user.permissions?.includes("org:read")) {
      return rows;
    }
    if (requestedApplicantIds.length > 0) {
      return rows.filter((row) => allowedIds.has(String(row.applicant_user_id ?? "")));
    }
    if (hasNamedApplicantFilter && user.permissions?.includes("org:read")) {
      return rows.filter((row) => allowedIds.has(String(row.applicant_user_id ?? "")));
    }
    return rows.filter((row) => row.applicant_user_id === user.id);
  }
  if (!config.scopeField) return rows;
  const allowed = new Set(user.accessible_customer_ids ?? []);
  return rows.filter((row) => allowed.has(String(row[config.scopeField])));
}

function applyFilters(rows: DataRow[], filters: QueryFilter[], allowedFields: string[]): DataRow[] {
  return rows.filter((row) => filters.every((filter) => matchFilter(row, filter, allowedFields)));
}

function normalizeQueryArgs(args: QueryArgs = {}): QueryArgs {
  return {
    ...args,
    filters: normalizeFilters(args.filters),
    sort: normalizeSort(args.sort)
  };
}

function normalizeFilters(filters: QueryFilter[] = []): QueryFilter[] {
  if (!Array.isArray(filters)) return [];
  const normalized = filters
    .map((filter) => ({
      ...filter,
      op: filter.op ?? filter.operator
    }))
    .filter((filter) => filter.field && filter.op);
  return mergeSameFieldEqFilters(normalized);
}

function mergeSameFieldEqFilters(filters: QueryFilter[]): QueryFilter[] {
  const eqGroups = new Map<string, JsonValue[]>();
  for (const filter of filters) {
    if (filter.op !== "eq") continue;
    const key = filter.field;
    const values = eqGroups.get(key) ?? [];
    values.push(filter.value);
    eqGroups.set(key, values);
  }

  const mergedFields = new Set([...eqGroups.entries()]
    .filter(([, values]) => new Set(values.map(String)).size > 1)
    .map(([field]) => field));
  if (!mergedFields.size) return filters;

  const emitted = new Set();
  const result: QueryFilter[] = [];
  for (const filter of filters) {
    if (filter.op !== "eq" || !mergedFields.has(filter.field)) {
      result.push(filter);
      continue;
    }
    if (emitted.has(filter.field)) continue;
    emitted.add(filter.field);
    result.push({
      ...filter,
      op: "in",
      value: [...new Set(eqGroups.get(filter.field).map((value) => value))]
    });
  }
  return result;
}

function normalizeSort(sort: QuerySort[] = []): QuerySort[] {
  if (!Array.isArray(sort)) return [];
  return sort
    .map((item) => ({
      ...item,
      direction: String(item.direction ?? item.order ?? "desc")
    }))
    .filter((item) => item.field);
}

async function resolveRuntimeFilters(filters: QueryFilter[], context: BusinessToolContext): Promise<QueryFilter[]> {
  const reportIds = filters.some((filter) => filter.value === "__CURRENT_USER_SUBORDINATES__" || filter.value === "__CURRENT_USER_REPORTS__")
    ? await getReportTreeUserIds(context.user.id)
    : [];
  const allOrgIds = filters.some((filter) => filter.value === "__ALL_ORG_USERS__")
    ? await getAllOrgUserIds()
    : [];
  return filters.map((filter) => ({
    ...filter,
    value: filter.value === "__CURRENT_USER__"
      ? context.user.id
      : filter.value === "__CURRENT_USER_SUBORDINATES__" || filter.value === "__CURRENT_USER_REPORTS__"
        ? reportIds
        : filter.value === "__ALL_ORG_USERS__"
          ? allOrgIds
        : filter.value
    ,
    runtime_scope: filter.value === "__ALL_ORG_USERS__" ? "all_org_users" : filter.runtime_scope
  }));
}

function matchFilter(row: DataRow, filter: QueryFilter, allowedFields: string[]): boolean {
  if (!allowedFields.includes(filter.field)) return false;
  const actual = row[filter.field];
  const expected = filter.value;
  if (filter.op === "eq") return Array.isArray(actual)
    ? actual.map(String).includes(String(expected ?? ""))
    : String(actual ?? "") === String(expected ?? "");
  if (filter.op === "neq") return Array.isArray(actual)
    ? !actual.map(String).includes(String(expected ?? ""))
    : String(actual ?? "") !== String(expected ?? "");
  if (filter.op === "contains") return Array.isArray(actual)
    ? actual.map(String).some((item) => item.includes(String(expected ?? "")))
    : String(actual ?? "").includes(String(expected ?? ""));
  if (filter.op === "in") {
    if (!Array.isArray(expected)) return false;
    const expectedSet = new Set(expected.map(String));
    if (Array.isArray(actual)) return actual.map(String).some((item) => expectedSet.has(item));
    return expectedSet.has(String(actual ?? ""));
  }
  if (filter.op === "gte") return compareValues(actual, expected) >= 0;
  if (filter.op === "lte") return compareValues(actual, expected) <= 0;
  return false;
}

function compareValues(left: unknown, right: unknown): number {
  const dateCompared = compareDateLikeValues(left, right);
  if (dateCompared !== null) return dateCompared;
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
  return String(left ?? "").localeCompare(String(right ?? ""));
}

function compareDateLikeValues(left: unknown, right: unknown): number | null {
  const leftText = String(left ?? "");
  const rightText = String(right ?? "");
  const leftDate = leftText.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  const rightDate = rightText.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (!leftDate || !rightDate) return null;
  return leftDate.localeCompare(rightDate);
}

function applySort(rows: DataRow[], sort: QuerySort[], allowedFields: string[]): DataRow[] {
  const safeSort = sort.filter((item) => allowedFields.includes(item.field));
  return rows.slice().sort((left, right) => {
    for (const item of safeSort) {
      const direction = item.direction === "asc" ? 1 : -1;
      const compared = compareValues(left[item.field], right[item.field]);
      if (compared !== 0) return compared * direction;
    }
    return 0;
  });
}

function computeMetrics(rows: DataRow[], metrics: QueryAggregation[], allowedFields: string[]): Array<Record<string, unknown>> {
  return metrics.map((metric) => {
    const type = metric.type ?? "count";
    const field = metric.field ?? "id";
    const as = metric.as ?? `${type}_${field}`;
    if (type === "count") return { as, type, field, value: rows.length };
    if (!allowedFields.includes(field)) return { as, type, field, value: null };
    const values = rows.map((row) => Number(row[field])).filter(Number.isFinite);
    if (type === "sum") return { as, type, field, value: values.reduce((sum, value) => sum + value, 0) };
    if (type === "avg") {
      const sum = values.reduce((total, value) => total + value, 0);
      return { as, type, field, value: values.length ? Math.round((sum / values.length) * 100) / 100 : null };
    }
    return { as, type, field, value: null };
  });
}

function computeAggregations(rows: DataRow[], aggregations: QueryAggregation[], allowedFields: string[]): Record<string, AggregateValue> {
  const result: Record<string, AggregateValue> = {};
  for (const item of aggregations) {
    const type = item.type ?? "count";
    const field = item.field ?? "id";
    const as = item.as ?? `${type}_${field}`;
    if (type === "count") {
      result[as] = rows.length;
      continue;
    }
    if (!allowedFields.includes(field)) {
      result[as] = null;
      continue;
    }
    if (type === "distinct_count") {
      const set = new Set<string>();
      for (const row of rows) {
        const value = row[field];
        if (value !== null && value !== undefined && value !== "") set.add(String(value));
      }
      result[as] = set.size;
      continue;
    }
    const numbers = rows.map((row) => Number(row[field])).filter(Number.isFinite);
    if (numbers.length === 0) {
      result[as] = null;
      continue;
    }
    if (type === "sum") {
      result[as] = numbers.reduce((acc, n) => acc + n, 0);
    } else if (type === "avg") {
      const sum = numbers.reduce((acc, n) => acc + n, 0);
      result[as] = Math.round((sum / numbers.length) * 100) / 100;
    } else if (type === "max") {
      result[as] = Math.max(...numbers);
    } else if (type === "min") {
      result[as] = Math.min(...numbers);
    } else {
      result[as] = null;
    }
  }
  return result;
}

function computeDerived(aggregates: Record<string, AggregateValue>, derived: QueryDerivedExpression[]): Record<string, AggregateValue> {
  const result: Record<string, AggregateValue> = {};
  // 顺序计算：后续 derived 可以引用前面 derived 的 as
  const context = { ...aggregates };
  for (const item of derived ?? []) {
    if (!item || !item.as) continue;
    const value = evalExpr(item, context);
    result[item.as] = value;
    context[item.as] = value;
  }
  return result;
}

function evalExpr(expr: QueryDerivedExpression, aggregates: Record<string, AggregateValue>, depth = 0): number | null {
  if (depth > 5) return null;
  if (expr === null || expr === undefined) return null;
  if (typeof expr !== "object") return null;
  if ("const" in expr) {
    const value = Number(expr.const);
    return Number.isFinite(value) ? value : null;
  }
  if ("ref" in expr) {
    const value = aggregates[expr.ref];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  if (expr.op && "left" in expr && "right" in expr) {
    const left = expr.left ? evalExpr(expr.left, aggregates, depth + 1) : null;
    const right = expr.right ? evalExpr(expr.right, aggregates, depth + 1) : null;
    if (left === null || right === null) return null;
    if (expr.op === "+") return roundN(left + right);
    if (expr.op === "-") return roundN(left - right);
    if (expr.op === "*") return roundN(left * right);
    if (expr.op === "/") return right === 0 ? null : roundN(left / right);
    return null;
  }
  return null;
}

function roundN(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 10000) / 10000;
}

function normalizeFields(fields: unknown, allowedFields: string[]): string[] {
  const requested = Array.isArray(fields) && fields.length ? fields : allowedFields;
  return requested.filter((field) => allowedFields.includes(field));
}

function pickFields(row: DataRow, fields: string[]): DataRow {
  return Object.fromEntries(fields.map((field) => [field, row[field]]));
}

async function getReportTreeUserIds(userId: string): Promise<string[]> {
  const employees = await loadJson("data/wecom-users.json") as DataRow[];
  const ids = new Set<string>();
  let frontier = [userId];
  while (frontier.length > 0) {
    const next = employees
      .filter((employee) => Array.isArray(employee.direct_leader)
        && employee.direct_leader.some((leaderId) => frontier.includes(String(leaderId)))
        && !ids.has(String(employee.userid ?? "")))
      .map((employee) => String(employee.userid ?? ""));
    for (const id of next) ids.add(id);
    frontier = next;
  }
  return [...ids];
}

async function getAllOrgUserIds(): Promise<string[]> {
  const [employees, leaveRequests] = await Promise.all([
    loadJson("data/wecom-users.json"),
    loadJson("data/leave-requests.json")
  ]);
  const employeeRows = employees as DataRow[];
  const leaveRows = leaveRequests as DataRow[];
  return [...new Set([
    ...employeeRows.map((employee) => employee.userid),
    ...leaveRows.map((request) => request.applicant_user_id)
  ].filter(Boolean).map(String))];
}

function getRequestedApplicantIds(filters: QueryFilter[] = []): string[] {
  return filters.flatMap((filter) => {
    if (filter.field !== "applicant_user_id") return [];
    if (filter.op === "eq" && filter.value) return [String(filter.value)];
    if (filter.op === "in" && Array.isArray(filter.value)) return filter.value.map(String);
    return [];
  });
}

async function enrichRows(resource: string, rows: DataRow[]): Promise<DataRow[]> {
  if (resource === "employees") return enrichEmployeeRows(rows);
  if (resource === "departments") return enrichDepartmentRows(rows);
  return rows;
}

async function enrichEmployeeRows(rows: DataRow[]): Promise<DataRow[]> {
  const employees = await loadJson("data/wecom-users.json") as DataRow[];
  const byUserId = new Map(employees.map((employee) => [employee.userid, employee]));
  return rows.map((row) => {
    const directLeaderProfiles = Array.isArray(row.direct_leader)
      ? row.direct_leader.map((userid) => summarizeEmployee(byUserId.get(userid), userid))
      : [];
    return {
      ...row,
      direct_leader_profiles: directLeaderProfiles,
      reporting: enrichReporting(row.reporting, byUserId)
    };
  });
}

async function enrichDepartmentRows(rows: DataRow[]): Promise<DataRow[]> {
  const employees = await loadJson("data/wecom-users.json") as DataRow[];
  const byUserId = new Map(employees.map((employee) => [employee.userid, employee]));
  return rows.map((row) => ({
    ...row,
    leader_profile: summarizeEmployee(byUserId.get(row.leader_userid), row.leader_userid)
  }));
}

function enrichReporting(reporting: unknown, byUserId: Map<unknown, DataRow>): unknown {
  if (!reporting || typeof reporting !== "object") return reporting;
  const record = reporting as Record<string, unknown>;
  return {
    ...record,
    manager_profile: summarizeEmployee(byUserId.get(record.manager_userid), record.manager_userid),
    store_manager_profile: summarizeEmployee(byUserId.get(record.store_manager_userid), record.store_manager_userid)
  };
}

function summarizeEmployee(employee: DataRow | undefined, fallbackUserId?: unknown): DataRow | null {
  if (!employee && !fallbackUserId) return null;
  return {
    userid: employee?.userid ?? fallbackUserId,
    name: employee?.name ?? fallbackUserId,
    department_name: employee?.department_name,
    position: employee?.position
  };
}

function clampLimit(value: unknown): number {
  const limit = Number(value);
  if (!Number.isFinite(limit)) return 20;
  return Math.max(1, Math.min(100, limit));
}

function sanitizeQuery(args: BusinessQueryArgs): Record<string, unknown> {
  return {
    resource: args.resource,
    operation: args.operation ?? "search",
    filters: args.filters ?? [],
    metrics: args.metrics ?? [],
    sort: args.sort ?? [],
    fields: args.fields ?? [],
    limit: args.limit ?? 20,
    display: args.display
  };
}

export function createBusinessTools(): ToolDefinition[] {
  return [
    {
      name: "query_business_data",
      description: "通用业务数据查询工具。支持资源、筛选、聚合、排序、字段选择和分页限制，工具内部会自动按当前用户权限注入数据范围。",
      metadata: {
        required_permissions: [] as string[],
        risk_level: "read",
        requires_confirmation: false,
        intents: ["data_query", "mixed"]
      },
      schema: {
        type: "object",
        required: ["resource"],
        properties: {
          resource: { type: "string", enum: Object.keys(RESOURCE_CONFIG) },
          operation: { type: "string", enum: ["search", "aggregate"] },
          filters: {
            type: "array",
            items: {
              type: "object",
              required: ["field", "op", "value"],
              properties: {
                field: { type: "string" },
                op: { type: "string", enum: ["eq", "neq", "contains", "in", "gte", "lte"] },
                value: {}
              }
            }
          },
          metrics: {
            type: "array",
            items: {
              type: "object",
              required: ["type", "field"],
              properties: {
                type: { type: "string", enum: ["count", "sum", "avg"] },
                field: { type: "string" },
                as: { type: "string" }
              }
            }
          },
          sort: {
            type: "array",
            items: {
              type: "object",
              required: ["field"],
              properties: {
                field: { type: "string" },
                direction: { type: "string", enum: ["asc", "desc"] }
              }
            }
          },
          fields: { type: "array", items: { type: "string" } },
          limit: { type: "number" }
        }
      },
      async execute(args: JsonObject = {}, context: ToolExecutionContext = {}) {
        return executeBusinessDataQuery(args as BusinessQueryArgs, context as BusinessToolContext);
      }
    },
    {
      name: "list_my_customers",
      description: "列出当前登录员工权限范围内可访问的客户列表。",
      metadata: {
        required_permissions: ["customer:read"],
        risk_level: "read",
        requires_confirmation: false,
        intents: ["data_query", "mixed"]
      },
      schema: {
        type: "object",
        required: [],
        properties: {}
      },
      async execute(_args: JsonObject = {}, context: ToolExecutionContext = {}) {
        const user = (context as BusinessToolContext).user;
        const customers = await loadJson("data/customers.json") as DataRow[];
        const allowed = new Set(user.accessible_customer_ids ?? []);
        const matched = customers
          .filter((customer) => allowed.has(String(customer.id ?? "")))
          .sort((a, b) => String(a.id ?? "").localeCompare(String(b.id ?? "")));
        return {
          ok: true,
          tool: "list_my_customers",
          data: {
            user_id: user.id,
            customers: matched.map((customer) => ({
              id: customer.id,
              name: customer.name,
              tier: customer.tier,
              industry: customer.industry,
              department: customer.department,
              annual_revenue: customer.annual_revenue,
              owner_user_id: customer.owner_user_id
            }))
          }
        };
      }
    },
    {
      name: "query_customer",
      description: "查询客户基础信息，例如客户等级、行业、负责人范围内的年度成交额。",
      metadata: {
        required_permissions: ["customer:read"],
        risk_level: "read",
        requires_confirmation: false,
        intents: ["data_query", "mixed"]
      },
      schema: {
        type: "object",
        required: ["customer_name"],
        properties: {
          customer_name: { type: "string", description: "客户名称" }
        }
      },
      async execute(args: JsonObject = {}) {
        const customer = await findCustomerByName(args.customer_name);
        if (!customer) {
          return { ok: false, tool: "query_customer", error: "not_found", message: "未找到该客户。" };
        }
        return {
          ok: true,
          tool: "query_customer",
          data: {
            id: customer.id,
            name: customer.name,
            tier: customer.tier,
            industry: customer.industry,
            department: customer.department,
            annual_revenue: customer.annual_revenue
          }
        };
      }
    },
    {
      name: "query_order",
      description: "查询客户最近订单状态、金额和预计交付时间。",
      metadata: {
        required_permissions: ["order:read"],
        risk_level: "read",
        requires_confirmation: false,
        intents: ["data_query", "mixed"]
      },
      schema: {
        type: "object",
        required: ["customer_name"],
        properties: {
          customer_name: { type: "string", description: "客户名称" },
          period: { type: "string", enum: ["latest"], description: "当前只支持 latest" }
        }
      },
      async execute(args: JsonObject = {}) {
        const orders = await loadJson("data/orders.json") as DataRow[];
        const normalized = normalize(args.customer_name);
        const matched = orders
          .filter((order) => String(order.customer_name ?? "").includes(normalized) || normalized.includes(String(order.customer_name ?? "")))
          .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));

        if (matched.length === 0) {
          return { ok: false, tool: "query_order", error: "not_found", message: "未找到该客户订单。" };
        }

        return {
          ok: true,
          tool: "query_order",
          data: matched[0]
        };
      }
    },
    {
      name: "query_sales_report",
      description: "查询部门销售报表，只返回聚合指标。",
      metadata: {
        required_permissions: ["sales_report:read"],
        risk_level: "sensitive_read",
        requires_confirmation: false,
        intents: ["data_query", "mixed"]
      },
      schema: {
        type: "object",
        required: ["department"],
        properties: {
          department: { type: "string", description: "部门名称" },
          period: { type: "string", description: "周期，例如 2026Q2" }
        }
      },
      async execute(args: JsonObject = {}, context: ToolExecutionContext = {}) {
        const user = (context as BusinessToolContext).user;
        const reports = await loadJson("data/sales_reports.json") as DataRow[];
        const department = args.department ?? user.department;
        const period = args.period ?? "2026Q2";
        const report = reports.find((item) => item.department === department && item.period === period);
        if (!report) {
          return { ok: false, tool: "query_sales_report", error: "not_found", message: "未找到该部门报表。" };
        }
        return {
          ok: true,
          tool: "query_sales_report",
          data: report
        };
      }
    },
    {
      name: "submit_leave_request",
      description: "提交员工请假申请，需要请假类型、开始时间、结束时间和请假事由。",
      metadata: {
        required_permissions: ["leave:submit"],
        risk_level: "write",
        requires_confirmation: true,
        scenarios: ["leave_request"],
        steps: ["awaiting_confirmation"]
      },
      schema: {
        type: "object",
        required: ["leave_type", "start_time", "end_time", "reason"],
        properties: {
          leave_type: { type: "string", enum: ["年假", "病假", "事假", "调休", "其他"] },
          start_time: { type: "string", description: "请假开始时间" },
          end_time: { type: "string", description: "请假结束时间" },
          reason: { type: "string", description: "请假事由" }
        }
      },
      async execute(args: JsonObject = {}, context: ToolExecutionContext = {}) {
        const user = (context as BusinessToolContext).user;
        const request = normalizeLeaveRequestRecord({
          id: `LR-${Date.now()}`,
          applicant_user_id: user.id,
          applicant_name: user.name,
          department: user.department,
          leave_duration: inferLeaveDuration(args),
          status: "submitted",
          ...args,
          submitted_at: new Date().toISOString()
        });
        const tableFile = "data/leave-requests.json";
        const existing = await loadJson(tableFile).catch((): DataRow[] => []) as DataRow[];
        await saveJson(tableFile, existing.concat(request).map(normalizeLeaveRequestRecord) as unknown as JsonValue);
        const dir = resolveProjectPath("logs");
        await mkdir(dir, { recursive: true });
        await appendFile(path.join(dir, "leave_requests.jsonl"), `${JSON.stringify(request)}\n`, "utf8");
        return {
          ok: true,
          tool: "submit_leave_request",
          data: request
        };
      }
    }
  ];
}

function inferLeaveDuration(args: JsonObject): string {
  if (args.leave_duration) return String(args.leave_duration);
  const text = `${args.start_time ?? ""} ${args.end_time ?? ""} ${args.reason ?? ""}`;
  const matched = text.match(/(半天|一天|两天|三天|四天|五天|[一二三四五六七八九十\d]+天|[一二三四五六七八九十\d]+小时)/);
  if (matched) return matched[1];
  if (String(args.end_time ?? "").startsWith("开始后")) {
    return String(args.end_time).replace(/^开始后/, "");
  }
  return "待补充";
}

function normalizeLeaveRequestRecord(record: DataRow): DataRow {
  const startTime = normalizeLeaveDateTime(record.start_time, { fallbackTime: "09:00" });
  const endTime = normalizeLeaveEndTime(record.end_time, { startTime, leaveDuration: record.leave_duration === undefined ? undefined : String(record.leave_duration) });
  return {
    ...record,
    leave_duration: normalizeLeaveDuration(record.leave_duration, { startTime, endTime }),
    start_time: startTime,
    end_time: endTime
  };
}

function normalizeLeaveDuration(value: unknown, { startTime, endTime }: LeaveTimeRange = {}): string {
  const text = String(value ?? "").trim();
  if (text === "半天") return "半天";
  if (["一天", "1天"].includes(text)) return "1天";
  const dayMatch = text.match(/^([一二三四五六七八九十两\d]+)天$/);
  if (dayMatch) return `${parseChineseNumber(dayMatch[1]) ?? dayMatch[1]}天`;
  const hourMatch = text.match(/^([一二三四五六七八九十两\d]+)小时$/);
  if (hourMatch) return `${parseChineseNumber(hourMatch[1]) ?? hourMatch[1]}小时`;
  if (startTime && endTime) {
    const inferred = inferDurationFromRange(startTime, endTime);
    if (inferred) return inferred;
  }
  return text || "待补充";
}

function normalizeLeaveDateTime(value: unknown, { fallbackTime = "09:00" }: { fallbackTime?: string } = {}): string {
  const text = String(value ?? "").trim();
  if (!text) return text;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text} ${fallbackTime}`;
  if (/^\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}$/.test(text)) return normalizeMinutePrecision(text);
  const sameDayHalf = text.match(/^(\d{4}-\d{2}-\d{2})\s+半天$/);
  if (sameDayHalf) return `${sameDayHalf[1]} 09:00`;
  return text;
}

function normalizeLeaveEndTime(value: unknown, { startTime, leaveDuration }: LeaveTimeRange = {}): string {
  const text = String(value ?? "").trim();
  if (!text && startTime && leaveDuration) return deriveEndTimeFromDuration(startTime, leaveDuration);
  if (/^\d{4}-\d{2}-\d{2}\s+全天$/.test(text)) {
    const date = text.replace(/\s+全天$/, "");
    return `${date} 18:00`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text} 18:00`;
  if (/^\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}$/.test(text)) return normalizeMinutePrecision(text);
  if (text.startsWith("开始后") && startTime) {
    return deriveEndTimeFromDuration(startTime, text.replace(/^开始后/, ""));
  }
  return text;
}

function deriveEndTimeFromDuration(startTime: string, leaveDuration: string): string {
  const start = parseDateTime(startTime);
  if (!start) return "";
  const duration = normalizeLeaveDuration(leaveDuration);
  if (duration === "半天") {
    const end = new Date(start);
    end.setHours(start.getHours() + 4, 0, 0, 0);
    return formatDateTime(end);
  }
  const dayMatch = duration.match(/^(\d+)天$/);
  if (dayMatch) {
    const end = new Date(start);
    end.setDate(end.getDate() + Number(dayMatch[1]) - 1);
    end.setHours(18, 0, 0, 0);
    return formatDateTime(end);
  }
  const hourMatch = duration.match(/^(\d+)小时$/);
  if (hourMatch) {
    const end = new Date(start);
    end.setHours(end.getHours() + Number(hourMatch[1]), 0, 0, 0);
    return formatDateTime(end);
  }
  return "";
}

function inferDurationFromRange(startTime: string, endTime: string): string | null {
  const start = parseDateTime(startTime);
  const end = parseDateTime(endTime);
  if (!start || !end) return null;
  const diffHours = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60));
  if (diffHours === 4) return "半天";
  if (diffHours === 9) return "1天";
  if (diffHours > 0 && diffHours < 9) return `${diffHours}小时`;
  if (diffHours >= 9) {
    const days = Math.max(1, Math.round(diffHours / 9));
    return `${days}天`;
  }
  return null;
}

function parseDateTime(value: unknown): Date | null {
  const normalized = String(value ?? "").trim().replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTime(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function normalizeMinutePrecision(value: unknown): string {
  const [datePart, timePart] = String(value).trim().split(/\s+/);
  const [hour, minute] = timePart.split(":");
  return `${datePart} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseChineseNumber(text: unknown): number | null {
  if (/^\d+$/.test(String(text))) return Number(text);
  return {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10
  }[String(text)] ?? null;
}
