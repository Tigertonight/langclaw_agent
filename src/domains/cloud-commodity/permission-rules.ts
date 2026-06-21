import type { PermissionRuleFn } from "../types.js";

const CLOUD_READ_RESOURCES = new Set([
  "cloud_products",
  "cloud_offers",
  "cloud_skus",
  "cloud_specs",
  "cloud_meters",
  "cloud_prices",
  "cloud_regions",
  "cloud_release_requests",
  "cloud_approval_tasks",
  "cloud_risk_signals",
  "cloud_workflow_tasks",
  "cloud_operating_metrics",
  "cloud_usage_estimators",
  "cloud_ipd_checkpoints",
  "cloud_gtm_assets",
  "cloud_capacity_pools",
  "cloud_sla_incidents",
  "cloud_cost_simulations",
  "cloud_ai_models",
  "cloud_demo_scenarios",
  "cloud_source_refs",
]);

const CLOUD_SCOPED_RESOURCES = new Set([
  "cloud_customers",
  "cloud_contracts",
  "cloud_subscriptions",
  "cloud_orders",
  "cloud_bills",
  "cloud_invoices",
  "cloud_renewal_opportunities",
  "cloud_sales_opportunities",
]);

const cloudAdminRule: PermissionRuleFn = ({ resource, userPermissions }) => {
  if (typeof resource === "string" && resource.startsWith("cloud_") && userPermissions.has("cloud:admin")) {
    return { ok: true };
  }
  return null;
};

const cloudReadRule: PermissionRuleFn = ({ resource, userPermissions }) => {
  if (typeof resource === "string" && CLOUD_READ_RESOURCES.has(resource) && userPermissions.has("cloud:read")) {
    return { ok: true };
  }
  return null;
};

const cloudScopedReadRule: PermissionRuleFn = ({ resource, userPermissions }) => {
  if (typeof resource !== "string" || !CLOUD_SCOPED_RESOURCES.has(resource)) return null;
  if (userPermissions.has("cloud:read")) return { ok: true };
  return null;
};

export const CLOUD_PERMISSION_RULES: PermissionRuleFn[] = [
  cloudAdminRule,
  cloudReadRule,
  cloudScopedReadRule,
];
