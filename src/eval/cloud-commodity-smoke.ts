process.env.WECOM_MODE ??= "mock";

const { createApp } = await import("../app.js");
import type { JsonObject, ToolResult, UserContext } from "../types/agent-contracts.js";
import { loadJson } from "../data/load-json.js";

const app = createApp();
await app.init();

const cloudPm: UserContext = {
  id: "cloud_pm_001",
  name: "程一川",
  role: "cloud_pm",
  department: "云商品平台",
  accessible_customer_ids: ["cust_ai_studio", "cust_media_stream", "cust_finance_core"],
  permissions: ["cloud:read", "cloud:draft", "cloud:risk", "cloud:estimate", "policy:read", "org:read"],
};

const limitedSales: UserContext = {
  id: "cloud_sales_limited",
  name: "销售同学",
  role: "cloud_sales",
  department: "云销售",
  accessible_customer_ids: ["cust_ai_studio"],
  permissions: ["cloud:read", "cloud:estimate"],
};

const failures: Array<{ name: string; message: string }> = [];

const requiredIntents = [
  "cloud.query.products",
  "cloud.query.prices",
  "cloud.query.risks",
  "cloud.query.workflow_bottlenecks",
  "cloud.query.renewals",
  "cloud.query.operations",
  "cloud.query.billing",
  "cloud.estimate.agent_plan_rounds",
  "cloud.estimate.seedance_video_seconds",
  "cloud.modeling.product_to_commodity",
  "cloud.risk.release_review",
  "cloud.workflow.release_request",
];

const requiredResources = [
  "cloud_products",
  "cloud_offers",
  "cloud_skus",
  "cloud_specs",
  "cloud_meters",
  "cloud_prices",
  "cloud_regions",
  "cloud_customers",
  "cloud_contracts",
  "cloud_subscriptions",
  "cloud_orders",
  "cloud_bills",
  "cloud_invoices",
  "cloud_release_requests",
  "cloud_approval_tasks",
  "cloud_risk_signals",
  "cloud_workflow_tasks",
  "cloud_renewal_opportunities",
  "cloud_operating_metrics",
  "cloud_usage_estimators",
  "cloud_cost_simulations",
  "cloud_ai_models",
  "cloud_demo_scenarios",
  "cloud_source_refs",
];

await test("DomainRegistry contains cloud_commodity", async () => {
  if (!app.domainRegistry.has("cloud_commodity")) throw new Error("cloud_commodity DomainPack 未注册");
});

await test("ResourceRegistry contains all cloud resources", async () => {
  for (const resource of requiredResources) {
    if (!app.resourceRegistry.has(resource)) throw new Error(`missing resource ${resource}`);
  }
});

await test("IntentRegistry contains all cloud intent codes", async () => {
  for (const intent of requiredIntents) {
    if (!app.intentRegistry.getCode(intent)) throw new Error(`missing intent ${intent}`);
  }
});

await test("critical tables are non-empty", async () => {
  for (const resource of requiredResources) {
    const rows = await loadJson<JsonObject[]>(`data/cloud-commodity/${resource}.json`);
    if (!Array.isArray(rows) || rows.length === 0) throw new Error(`${resource} has no rows`);
  }
});

await test("source_ref_ids point to known source refs", async () => {
  const sourceRefs = await loadJson<JsonObject[]>("data/cloud-commodity/cloud_source_refs.json");
  const refIds = new Set(sourceRefs.map((item) => String(item.source_ref_id)));
  for (const resource of ["cloud_products", "cloud_offers", "cloud_skus", "cloud_prices", "cloud_ai_models", "cloud_usage_estimators", "cloud_release_requests", "cloud_operating_metrics"]) {
    const rows = await loadJson<JsonObject[]>(`data/cloud-commodity/${resource}.json`);
    for (const row of rows) {
      const refs = Array.isArray(row.source_ref_ids) ? row.source_ref_ids.map(String) : [];
      if (!refs.length) throw new Error(`${resource} row missing source_ref_ids`);
      for (const ref of refs) {
        if (!refIds.has(ref)) throw new Error(`${resource} references unknown source_ref_id ${ref}`);
      }
    }
  }
});

await test("query_business_data can query cloud products", async () => {
  const result = await execute("query_business_data", { resource: "cloud_products", operation: "search", limit: 50 });
  assertOk(result, "cloud products query");
  assertAtLeast(rows(result).length, 8, "cloud products rows");
});

await test("customer scoped data is filtered by accessible_customer_ids", async () => {
  const result = await execute("query_business_data", { resource: "cloud_bills", operation: "search", limit: 50 }, limitedSales);
  assertOk(result, "scoped bill query");
  const billRows = rows(result);
  if (!billRows.every((row) => asObject(row).customer_id === "cust_ai_studio")) {
    throw new Error("limited user saw bills outside accessible_customer_ids");
  }
});

await test("customer scope denial fires for explicit forbidden customer", async () => {
  const result = await execute(
    "query_business_data",
    { resource: "cloud_renewal_opportunities", operation: "search", filters: [{ field: "customer_id", op: "eq", value: "cust_media_stream" }], limit: 10 },
    limitedSales,
  );
  if (result.ok !== false || result.code !== "customer_scope_denied") {
    throw new Error(`expected customer_scope_denied, got ${JSON.stringify(result)}`);
  }
});

await test("estimate_agent_plan_rounds returns positive estimate with boundary", async () => {
  const result = await execute("estimate_agent_plan_rounds", {
    package_id: "agent_plan_medium",
    extra_budget_cny: 50000,
    scenario_type: "agent_with_search",
  });
  assertOk(result, "agent plan estimate");
  const estimate = asObject(asObject(result.data).estimate);
  assertPositive(Number(estimate.estimated_rounds), "estimated_rounds");
  assertTruthy(estimate.formula, "formula");
  assertTruthy(estimate.boundary, "boundary");
});

await test("estimate_seedance_video_seconds returns positive estimate with assumptions", async () => {
  const result = await execute("estimate_seedance_video_seconds", {
    budget_cny: 10000,
    quality: "720p_standard",
    target_duration_seconds: 5,
    customer_id: "cust_ai_studio",
  });
  assertOk(result, "seedance estimate");
  const estimate = asObject(asObject(result.data).estimate);
  assertPositive(Number(estimate.estimated_video_seconds), "estimated_video_seconds");
  assertTruthy(estimate.assumptions, "assumptions");
  assertTruthy(estimate.boundary, "boundary");
});

await test("cloud_product_model_draft includes Seedance purchase fields", async () => {
  const result = await execute("cloud_product_model_draft", { product_code: "SEEDANCE" });
  assertOk(result, "product model draft");
  const draft = asObject(asObject(result.data).draft);
  const product = asObject(draft.product);
  if (product.product_id !== "prod_seedance") throw new Error(`expected prod_seedance, got ${product.product_id}`);
  assertAtLeast(asArray(draft.purchase_page_fields).length, 3, "purchase fields");
});

await test("cloud_release_risk_review requires human review", async () => {
  const result = await execute("cloud_release_risk_review", { release_request_id: "rel_seedance_mini_202606" });
  assertOk(result, "risk review");
  const report = asObject(asObject(result.data).risk_report);
  assertTruthy(report.risk_level, "risk_level");
  if (report.requires_human_review !== true) throw new Error("risk review must require human review");
});

await test("cloud_executive_briefing includes operating snapshot", async () => {
  const result = await execute("cloud_executive_briefing", { focus: "risk_workflow_renewal" });
  assertOk(result, "executive briefing");
  const briefing = asObject(asObject(result.data).executive_briefing);
  const snapshot = asObject(briefing.operating_snapshot);
  assertPositive(Number(snapshot.gmv_mtd_cny), "gmv_mtd_cny");
  assertPositive(Number(snapshot.net_revenue_mtd_cny), "net_revenue_mtd_cny");
  assertTruthy(snapshot.gross_margin_rate, "gross_margin_rate");
  assertTruthy(briefing.evidence_sources, "evidence_sources");
});

await test("draft and closed-loop tools require confirmation by default", async () => {
  const draft = await execute("create_cloud_release_draft", { product_id: "prod_seedance" }, cloudPm, false);
  if (draft.ok !== false || draft.error !== "confirmation_required") {
    throw new Error("create_cloud_release_draft should require confirmation");
  }
  const closedLoop = await execute("simulate_cloud_closed_loop", { release_request_id: "rel_seedance_mini_202606" }, cloudPm, false);
  if (closedLoop.ok !== false || closedLoop.error !== "confirmation_required") {
    throw new Error("simulate_cloud_closed_loop should require confirmation");
  }
});

await test("simulate_cloud_closed_loop returns at least five checkpoint steps when confirmed", async () => {
  const result = await execute("simulate_cloud_closed_loop", { release_request_id: "rel_seedance_mini_202606", gray_scope: "internal" }, cloudPm, true);
  assertOk(result, "closed loop");
  const plan = asObject(asObject(result.data).closed_loop_plan);
  if (plan.requires_human_review !== true || plan.production_mutation !== false) {
    throw new Error("closed loop must remain human-reviewed and non-mutating");
  }
  assertAtLeast(asArray(plan.steps).length, 5, "closed-loop steps");
});

await test("dealer domain remains registered", async () => {
  if (!app.resourceRegistry.has("dealer_vehicles")) throw new Error("dealer_vehicles missing after cloud domain merge");
});

if (failures.length) {
  console.error("cloud-commodity smoke failures:");
  for (const failure of failures) console.error(`- ${failure.name}: ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log("cloud-commodity-smoke: OK");
}

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (error) {
    failures.push({ name, message: error instanceof Error ? error.message : String(error) });
  }
}

async function execute(name: string, args: JsonObject, user: UserContext = cloudPm, confirmed = true): Promise<ToolResult> {
  return app.toolRegistry.execute({ name, args }, { user, confirmed }) as Promise<ToolResult>;
}

function rows(result: ToolResult): unknown[] {
  return asArray(asObject(result.data).rows);
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function assertOk(result: ToolResult, label: string) {
  if (result.ok === false) {
    throw new Error(`${label} failed: ${result.message ?? result.error ?? "unknown error"}`);
  }
}

function assertAtLeast(actual: number, expected: number, label: string) {
  if (actual < expected) throw new Error(`${label}: expected at least ${expected}, got ${actual}`);
}

function assertPositive(actual: number, label: string) {
  if (!Number.isFinite(actual) || actual <= 0) throw new Error(`${label}: expected positive number, got ${actual}`);
}

function assertTruthy(value: unknown, label: string) {
  if (!value) throw new Error(`${label}: expected truthy value`);
}
