import { loadJson } from "../data/load-json.js";
import { getResourceDataPath } from "../domains/runtime-registry.js";
import { ResourceRegistry } from "../resources/registry.js";
import type { ResourceConfig } from "../resources/types.js";
import type { JsonObject, JsonValue, QueryFilter, QuerySort, ToolDefinition } from "../types/agent-contracts.js";
import { INTENTS } from "../agent/ports.js";
import { defineTool, z, ToolResultBaseSchema } from "./zod-helpers.js";

interface QueryArgs extends JsonObject {
  filters?: QueryFilter[];
  sort?: QuerySort[];
}

type DataRow = Record<string, unknown>;
type AggregateValue = number | string | boolean | null;

interface BusinessToolContext {
  user: {
    id: string;
    name?: string;
    department?: string;
    permissions?: string[];
    [key: string]: unknown;
  };
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

const FilterValueSchema = z.union([
  z.string().max(200),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.union([z.string().max(200), z.number(), z.boolean()])).max(50)
]);

const BusinessQuerySchema = z.object({
  resource: z.string().min(1).max(64),
  operation: z.enum(["search", "aggregate"]).optional(),
  filters: z.array(z.object({
    field: z.string().max(64),
    op: z.enum(["eq", "neq", "contains", "in", "gte", "lte"]),
    value: FilterValueSchema
  }).strict()).max(20).optional(),
  metrics: z.array(z.object({
    type: z.enum(["count", "sum", "avg", "min", "max", "distinct_count"]),
    field: z.string().max(64),
    as: z.string().max(64).optional()
  }).strict()).max(10).optional(),
  aggregations: z.array(z.object({
    type: z.enum(["count", "sum", "avg", "min", "max", "distinct_count"]),
    field: z.string().max(64),
    as: z.string().max(64).optional()
  }).strict()).max(10).optional(),
  derived: z.array(z.record(z.string(), z.unknown())).max(20).optional(),
  group_by: z.union([z.string().max(64), z.array(z.string().max(64)).max(5)]).optional(),
  sort: z.array(z.object({
    field: z.string().max(64),
    direction: z.enum(["asc", "desc"]).optional()
  }).strict()).max(5).optional(),
  fields: z.array(z.string().max(64)).max(30).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  display: z.unknown().optional()
}).strict();


async function executeBusinessDataQuery(args: BusinessQueryArgs = {}, context: BusinessToolContext, registry: ResourceRegistry) {
  args = normalizeQueryArgs(args);
  const resource = String(args.resource ?? "");
  const config = registry.get(resource);
  if (!config) {
    return { ok: false, tool: "query_business_data", error: "invalid_resource", message: "不支持该业务资源。" };
  }

  const operation = args.operation ?? "search";
  let rows = config.loader ? await config.loader(context) : await loadJson(config.file ?? "") as DataRow[];
  // 资源特定的数据规范化（如 leave_requests 的时间格式化）
  if (config.normalizer) {
    rows = rows.map((row) => config.normalizer!(row));
  }
  const runtimeFilters = await resolveRuntimeFilters(args.filters ?? [], context, registry);
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
      field_labels: registry.getFieldLabels(),
      query: sanitizeQuery(args)
    }
  };
}

async function injectUserScope(rows: DataRow[], config: ResourceConfig, user: BusinessToolContext["user"], runtimeFilters: QueryFilter[] = []): Promise<DataRow[]> {
  if (config.scopeType === "self_user") {
    const idField = config.selfUserIdField ?? "user_id";
    const nameField = config.selfUserNameField;
    if (runtimeFilters.some((filter) => filter.runtime_scope === "all_org_users") && user.permissions?.includes("org:read")) {
      return rows;
    }
    const reportIds = user.permissions?.includes("org:read")
      ? await getReportTreeUserIds(user.id)
      : [];
    const allowedIds = new Set([user.id, ...reportIds]);
    const requestedIds = getSelfUserFilteredIds(runtimeFilters, idField);
    const hasNamedFilter = nameField ? runtimeFilters.some((filter) => filter.field === nameField) : false;
    const hasDepartmentFilter = runtimeFilters.some((filter) => filter.field === "department");
    if (hasDepartmentFilter && user.permissions?.includes("org:read")) {
      return rows;
    }
    if (requestedIds.length > 0) {
      return rows.filter((row) => allowedIds.has(String(row[idField] ?? "")));
    }
    if (hasNamedFilter && user.permissions?.includes("org:read")) {
      return rows.filter((row) => allowedIds.has(String(row[idField] ?? "")));
    }
    return rows.filter((row) => row[idField] === user.id);
  }
  if (!config.scopeField) return rows;
  if (!config.userScopeField) return rows;
  const userIds = (user as Record<string, unknown>)[config.userScopeField];
  const accessibleIds = Array.isArray(userIds) ? userIds.map(String) : [];
  const allowed = new Set(accessibleIds);
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

async function resolveRuntimeFilters(filters: QueryFilter[], context: BusinessToolContext, registry: ResourceRegistry): Promise<QueryFilter[]> {
  const reportIds = filters.some((filter) => filter.value === "__CURRENT_USER_SUBORDINATES__" || filter.value === "__CURRENT_USER_REPORTS__")
    ? await getReportTreeUserIds(context.user.id)
    : [];
  const allOrgIds = filters.some((filter) => filter.value === "__ALL_ORG_USERS__")
    ? await getAllOrgUserIds(registry)
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
  const employees = await loadJson(getResourceDataPath("employees") ?? "data/wecom-users.json") as DataRow[];
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

async function getAllOrgUserIds(registry: ResourceRegistry): Promise<string[]> {
  const employees = await loadJson(getResourceDataPath("employees") ?? "data/wecom-users.json") as DataRow[];
  const ids = new Set<string>(employees.map((e) => String(e.userid ?? "")).filter(Boolean));
  // 从 registry 中所有 scopeType === "self_user" 的资源动态收集用户 ID
  for (const [, config] of registry.listAll()) {
    if (config.scopeType !== "self_user") continue;
    const idField = config.selfUserIdField ?? "user_id";
    const rows = config.loader ? await config.loader({ user: { id: "" } }) : await loadJson(config.file ?? "") as DataRow[];
    for (const row of rows) {
      const val = row[idField];
      if (val) ids.add(String(val));
    }
  }
  return [...ids];
}

function getSelfUserFilteredIds(filters: QueryFilter[] = [], idField: string): string[] {
  return filters.flatMap((filter) => {
    if (filter.field !== idField) return [];
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
  const employees = await loadJson(getResourceDataPath("employees") ?? "data/wecom-users.json") as DataRow[];
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
  const employees = await loadJson(getResourceDataPath("employees") ?? "data/wecom-users.json") as DataRow[];
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

export function createBusinessTools(options: { resourceRegistry: ResourceRegistry }): ToolDefinition[] {
  const { resourceRegistry } = options;
  return [
    defineTool({
      name: "query_business_data",
      description: "通用业务数据查询工具。支持资源、筛选、聚合、排序、字段选择和分页限制，工具内部会自动按当前用户权限注入数据范围。",
      metadata: {
        required_permissions: [] as string[],
        risk_level: "read",
        requires_confirmation: false,
        intents: [INTENTS.DATA_QUERY, INTENTS.MIXED]
      },
      inputSchema: BusinessQuerySchema,
      outputSchema: ToolResultBaseSchema,
      async execute(args, context = {}) {
        return executeBusinessDataQuery(args as unknown as BusinessQueryArgs, context as BusinessToolContext, resourceRegistry);
      }
    }),
  ];
}

