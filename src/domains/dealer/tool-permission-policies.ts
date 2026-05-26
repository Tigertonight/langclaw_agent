/**
 * Dealer 域工具级权限策略。
 *
 * 从 src/auth/permissions.ts 迁出的 dealer/CRM 业务策略：
 * - customer_list: list_my_customers 工具
 * - customer_or_order_detail: query_customer / query_order
 * - sales_report: query_sales_report 及 query_business_data 中 sales_reports 资源
 * - business_data: query_business_data 中 customers/orders 资源的 scope 校验
 *
 * 这些策略不属于引擎层，迁到 dealer DomainPack 通过 toolPermissionPolicies 声明。
 */

import { loadJson } from "../../data/load-json.js";
import { getResourceDataPath } from "../runtime-registry.js";
import type {
  JsonObject,
  PermissionDecision,
  QueryFilter,
  ToolCall,
  UserContext,
} from "../../types/agent-contracts.js";
import type { ToolPermissionPolicy } from "../types.js";

interface CustomerRecord extends JsonObject {
  id: string;
  name: string;
}

let customersCache: CustomerRecord[] | undefined;

async function getCustomerByName(customerName: string | null | undefined): Promise<CustomerRecord | null> {
  if (!customerName) return null;
  if (!customersCache) {
    customersCache = await loadJson<CustomerRecord[]>(getResourceDataPath("customers") ?? "data/customers.json");
  }
  return customersCache.find((customer) => customer.name === customerName) ?? null;
}

function hasPermission(user: UserContext | undefined, permission: string): boolean {
  return Array.isArray(user?.permissions) && user.permissions.includes(permission);
}

function allow(): PermissionDecision {
  return { allow: true };
}

function deny(code: string, message: string): PermissionDecision {
  return { allow: false, code, message };
}

function canAccessCustomer(user: UserContext, customerId: string): boolean {
  return Array.isArray(user.accessible_customer_ids) && user.accessible_customer_ids.includes(customerId);
}

function normalizeFilters(filters: unknown = []): QueryFilter[] {
  if (!Array.isArray(filters)) return [];
  return filters
    .filter((item): item is JsonObject => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map((filter) => ({
      ...filter,
      field: String(filter.field ?? ""),
      op: String(filter.op ?? filter.operator ?? ""),
    }));
}

function getFilterValue(filters: unknown = [], field: string): QueryFilter["value"] | null {
  const filter = normalizeFilters(filters).find((item) => item.field === field && ["eq", "contains"].includes(item.op ?? ""));
  return filter?.value ?? null;
}

async function authorizeScopedCustomerData(
  user: UserContext,
  toolCall: ToolCall,
  permission: string,
  filterField: string,
  message: string,
): Promise<PermissionDecision> {
  if (!hasPermission(user, permission)) return deny("missing_permission", message);
  const customerName = getFilterValue(toolCall.args?.filters, filterField);
  if (!customerName) return allow();
  const customer = await getCustomerByName(String(customerName));
  if (!customer) return allow();
  if (canAccessCustomer(user, customer.id)) return allow();
  return deny("customer_scope_denied", `你没有权限查看客户「${customer.name}」的数据。`);
}

const customerListPolicy: ToolPermissionPolicy = {
  name: "dealer.customer_list",
  matches: ({ toolCall }) => toolCall.name === "list_my_customers",
  authorize: async ({ user }) => hasPermission(user, "customer:read")
    ? allow()
    : deny("missing_permission", "你没有权限查询客户列表。"),
};

const customerOrOrderDetailPolicy: ToolPermissionPolicy = {
  name: "dealer.customer_or_order_detail",
  matches: ({ toolCall }) => toolCall.name === "query_customer" || toolCall.name === "query_order",
  authorize: async ({ user, toolCall }) => {
    if (!hasPermission(user, "customer:read") && !hasPermission(user, "order:read")) {
      return deny("missing_permission", "你没有权限查询客户或订单数据。");
    }
    const customer = await getCustomerByName(String(toolCall.args?.customer_name ?? ""));
    if (!customer) return allow();
    if (canAccessCustomer(user, customer.id)) return allow();
    return deny("customer_scope_denied", `你没有权限查看客户「${customer.name}」的数据。`);
  },
};

const salesReportPolicy: ToolPermissionPolicy = {
  name: "dealer.sales_report",
  matches: ({ toolCall }) => toolCall.name === "query_sales_report",
  authorize: async ({ user, toolCall }) => {
    if (!hasPermission(user, "sales_report:read")) {
      return deny("missing_permission", "你没有权限查看销售报表。");
    }
    const requestedDepartment = toolCall.args?.department ?? user.department;
    if (user.role === "manager" && requestedDepartment === user.department) return allow();
    return deny("department_scope_denied", "你只能查看自己部门的销售报表。");
  },
};

/**
 * query_business_data + dealer/CRM 资源的工具级策略。
 * 引擎默认对 query_business_data 不做 deny，由域级策略接管 customers/orders/sales_reports。
 */
const businessDataDealerPolicy: ToolPermissionPolicy = {
  name: "dealer.business_data",
  matches: ({ toolCall }) => {
    if (toolCall.name !== "query_business_data") return false;
    const resource = toolCall.args?.resource;
    return resource === "customers" || resource === "orders" || resource === "sales_reports";
  },
  authorize: async ({ user, toolCall }) => {
    const resource = toolCall.args?.resource;
    if (resource === "customers") {
      return authorizeScopedCustomerData(user, toolCall, "customer:read", "name", "你没有权限查询客户数据。");
    }
    if (resource === "orders") {
      return authorizeScopedCustomerData(user, toolCall, "order:read", "customer_name", "你没有权限查询订单数据。");
    }
    if (resource === "sales_reports") {
      if (!hasPermission(user, "sales_report:read")) return deny("missing_permission", "你没有权限查看销售报表。");
      const requestedDepartment = getFilterValue(toolCall.args?.filters, "department") ?? user.department;
      if (user.role === "manager" && requestedDepartment === user.department) return allow();
      return deny("department_scope_denied", "你只能查看自己部门的销售报表。");
    }
    return null;
  },
};

export const DEALER_TOOL_PERMISSION_POLICIES: ToolPermissionPolicy[] = [
  customerListPolicy,
  customerOrOrderDetailPolicy,
  salesReportPolicy,
  businessDataDealerPolicy,
];
