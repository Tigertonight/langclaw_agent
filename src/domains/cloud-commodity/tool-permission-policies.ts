import type { JsonObject, PermissionDecision, QueryFilter, ToolCall, UserContext } from "../../types/agent-contracts.js";
import type { ToolPermissionPolicy } from "../types.js";

const SCOPED_CLOUD_RESOURCES = new Set([
  "cloud_customers",
  "cloud_contracts",
  "cloud_subscriptions",
  "cloud_orders",
  "cloud_bills",
  "cloud_invoices",
  "cloud_renewal_opportunities",
  "cloud_sales_opportunities",
]);

function allow(): PermissionDecision {
  return { allow: true };
}

function deny(code: string, message: string): PermissionDecision {
  return { allow: false, code, message };
}

function hasPermission(user: UserContext | undefined, permission: string): boolean {
  return Array.isArray(user?.permissions) && user.permissions.includes(permission);
}

function accessibleCustomerIds(user: UserContext): Set<string> {
  const raw = (user as Record<string, unknown>).accessible_customer_ids;
  return new Set(Array.isArray(raw) ? raw.map(String) : []);
}

function normalizeFilters(filters: unknown): QueryFilter[] {
  if (!Array.isArray(filters)) return [];
  return filters
    .filter((item): item is JsonObject => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({ ...item, field: String(item.field ?? ""), op: String(item.op ?? item.operator ?? "") }));
}

function getRequestedCustomerIds(toolCall: ToolCall): string[] {
  const ids: string[] = [];
  for (const filter of normalizeFilters(toolCall.args?.filters)) {
    if (filter.field !== "customer_id") continue;
    if (Array.isArray(filter.value)) ids.push(...filter.value.map(String));
    else if (filter.value != null) ids.push(String(filter.value));
  }
  return ids;
}

const cloudScopedBusinessDataPolicy: ToolPermissionPolicy = {
  name: "cloud_commodity.scoped_business_data",
  matches: ({ toolCall }) => {
    if (toolCall.name !== "query_business_data") return false;
    return SCOPED_CLOUD_RESOURCES.has(String(toolCall.args?.resource ?? ""));
  },
  authorize: async ({ user, toolCall }) => {
    if (!hasPermission(user, "cloud:read") && !hasPermission(user, "cloud:admin")) {
      return deny("missing_permission", "你没有权限查询云商品客户、合同或账单数据。");
    }
    if (hasPermission(user, "cloud:admin")) return allow();
    const requestedIds = getRequestedCustomerIds(toolCall);
    if (!requestedIds.length) return allow();
    const allowed = accessibleCustomerIds(user);
    const deniedId = requestedIds.find((id) => !allowed.has(id));
    if (deniedId) {
      return deny("customer_scope_denied", `你没有权限查看客户 ${deniedId} 的云商品数据。`);
    }
    return allow();
  },
};

export const CLOUD_TOOL_PERMISSION_POLICIES: ToolPermissionPolicy[] = [
  cloudScopedBusinessDataPolicy,
];
