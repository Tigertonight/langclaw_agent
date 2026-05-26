/**
 * Dealer 域权限规则。
 *
 * 从 IntentQueryHandler.checkPermissions 中迁出的 dealer 特有权限逻辑。
 * 通过 DomainPack.permissionRules 声明式注册，运行时由 IntentQueryHandler 动态查找。
 *
 * 这些规则实现角色级别的隐式授权，和 src/auth/permissions.ts#canReadDealerResource 对齐。
 * 只做粗粒度放行（避免在 handler 层抢着拒绝），细粒度仍交给 ToolRegistry/authorizeToolCall。
 */

import type { PermissionRuleFn } from "../types.js";

/**
 * 店总可以查看财务数据。
 */
const financeManagerRule: PermissionRuleFn = ({ resource, user }) => {
  if (resource === "dealer_finance" && user.role === "store_general_manager") {
    return { ok: true };
  }
  return null;
};

/**
 * 拥有库存/订单/销售报表权限的用户可以查看车辆、入库、配额、门店数据。
 */
const inventoryRelatedRule: PermissionRuleFn = ({ resource, userPermissions }) => {
  const inventoryResources = ["dealer_vehicles", "dealer_inbounds", "dealer_quotas", "dealer_stores"];
  if (
    typeof resource === "string" &&
    inventoryResources.includes(resource) &&
    (userPermissions.has("inventory:read") || userPermissions.has("order:read") || userPermissions.has("sales_report:read"))
  ) {
    return { ok: true };
  }
  return null;
};

/**
 * 店总和销售经理可以查看所有 dealer_ 前缀的资源。
 */
const dealerManagerRule: PermissionRuleFn = ({ resource, user }) => {
  if (
    typeof resource === "string" &&
    resource.startsWith("dealer_") &&
    ["store_general_manager", "sales_manager"].includes(user.role)
  ) {
    return { ok: true };
  }
  return null;
};

/**
 * 拥有 dealer:read 权限的用户可以查看所有 dealer_ 前缀的资源。
 */
const dealerReadPermissionRule: PermissionRuleFn = ({ resource, userPermissions }) => {
  if (typeof resource === "string" && resource.startsWith("dealer_") && userPermissions.has("dealer:read")) {
    return { ok: true };
  }
  return null;
};

/**
 * dealer_metrics 是综合经营指标，拥有任一业务读取权限即可查看。
 */
const metricsReadRule: PermissionRuleFn = ({ resource, userPermissions }) => {
  if (resource === "dealer_metrics") {
    const anyBusinessRead = ["inventory:read", "customer:read", "order:read", "sales_report:read", "finance:read", "after_sales:read"]
      .some((p) => userPermissions.has(p));
    if (anyBusinessRead) return { ok: true };
  }
  return null;
};

/**
 * 拥有客户/订单/销售报表权限的用户可以查看线索和销售订单。
 */
const salesRelatedRule: PermissionRuleFn = ({ resource, userPermissions }) => {
  const salesResources = ["dealer_leads", "dealer_sales_orders"];
  if (
    typeof resource === "string" &&
    salesResources.includes(resource) &&
    (userPermissions.has("customer:read") || userPermissions.has("order:read") || userPermissions.has("sales_report:read"))
  ) {
    return { ok: true };
  }
  return null;
};

/**
 * 拥有售后权限或店总可以查看维修工单和三包索赔。
 */
const aftersalesRelatedRule: PermissionRuleFn = ({ resource, user, userPermissions }) => {
  const aftersalesResources = ["dealer_repair_orders", "dealer_warranty_claims"];
  if (
    typeof resource === "string" &&
    aftersalesResources.includes(resource) &&
    (userPermissions.has("after_sales:read") || user.role === "store_general_manager")
  ) {
    return { ok: true };
  }
  return null;
};

/**
 * Dealer 域所有权限规则（按优先级排列）。
 */
export const DEALER_PERMISSION_RULES: PermissionRuleFn[] = [
  dealerReadPermissionRule,
  dealerManagerRule,
  financeManagerRule,
  inventoryRelatedRule,
  salesRelatedRule,
  aftersalesRelatedRule,
  metricsReadRule,
];
