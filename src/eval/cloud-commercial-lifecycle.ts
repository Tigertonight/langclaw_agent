process.env.WECOM_MODE ??= "mock";

const { createApp } = await import("../app.js");
import { buildOpenUILangLegacyEnvelopes } from "../openui-lang/index.js";
import { loadJson } from "../data/load-json.js";
import type { JsonObject, ToolResult, UserContext } from "../types/agent-contracts.js";

const app = createApp();
await app.init();

const user: UserContext = {
  id: "cloud_pm_001",
  name: "程一川",
  role: "cloud_pm",
  department: "云商品平台",
  accessible_customer_ids: ["cust_ai_studio", "cust_media_stream", "cust_finance_core"],
  permissions: ["cloud:read", "cloud:draft", "cloud:risk", "cloud:estimate", "cloud:admin", "policy:read", "org:read"],
};

const resources = [
  "cloud_master_data_lineage",
  "cloud_financial_commercial_policies",
  "cloud_customer_explanation_playbooks",
  "cloud_product_change_versions",
  "cloud_post_launch_checks",
];

const toolCases: Array<{ tool: string; args: JsonObject }> = [
  { tool: "cloud_master_data_impact_review", args: { product_code: "SEEDANCE" } },
  { tool: "cloud_financial_commercialization_review", args: { product_code: "AGENT_PLAN" } },
  { tool: "cloud_customer_explanation", args: { product_code: "AGENT_PLAN", scenario: "额度用完" } },
  { tool: "cloud_product_change_impact_review", args: { product_code: "AGENT_PLAN" } },
  { tool: "cloud_post_launch_health_check", args: { product_code: "SEEDANCE" } },
];

const questions: Array<{ text: string; intent: string }> = [
  { text: "这个商品的主数据应该由商品中台维护哪些字段？官网、控制台、销售和账单分别消费哪些字段？", intent: "cloud.master_data.impact_review" },
  { text: "Agent Plan 赠送额度和高成本模型调用会不会导致套餐毛利被打穿？", intent: "cloud.financial.commercialization_review" },
  { text: "我是客户，我想买 Agent Plan Medium，额度用完后会发生什么？会不会自动扣费？", intent: "cloud.customer.explanation" },
  { text: "Agent Plan Medium 要调整套餐额度，会影响哪些客户、合同、账单和官网/控制台展示？", intent: "cloud.product_change.impact_review" },
  { text: "Seedance Mini 上架后 24 小时，帮我巡检官网、控制台、订单、计量、账单和客户反馈是否正常。", intent: "cloud.post_launch.health_check" },
];

for (const resource of resources) {
  assert(app.resourceRegistry.has(resource), `missing resource ${resource}`);
  const rows = await loadJson<JsonObject[]>(`data/cloud-commodity/${resource}.json`);
  assert(rows.length > 0, `${resource} should not be empty`);
  await assertSourceRefs(rows, resource);
}

for (const item of toolCases) {
  const result = await execute(item.tool, item.args);
  assertOk(result, item.tool);
  const envelopes = buildOpenUILangLegacyEnvelopes({
    result: {
      run_id: `commercial_${item.tool}`,
      user_message: "请用云商品业务工作台展示",
      debug: { tool_results: [result as JsonObject] },
    },
  });
  const cloudData = envelopes
    .map((envelope) => envelope.updateDataModel?.value)
    .find((value): value is JsonObject => Boolean(value) && readPath(value, ["domain"]) === "云商品平台");
  assert(Boolean(cloudData), `${item.tool} should create cloud OpenUI surface`);
  assert(readPath(cloudData, ["openui", "component"]) === "BusinessBriefSurface", `${item.tool} should render BusinessBriefSurface`);
  assert(readPath(cloudData, ["openui", "props", "details", "component"]) === "AnalyticsDashboardSurface", `${item.tool} detail surface should be AnalyticsDashboardSurface`);
  assertNoEngineeringLeaks(cloudData, item.tool);
}

for (const question of questions) {
  const route = await app.intentRouter.route({ user_context: user, message: question.text });
  assert(route.intent_code === question.intent, `expected ${question.intent}, got ${route.intent_code} for ${question.text}`);
}

console.log(`cloud-commercial-lifecycle: OK (${resources.length} resources, ${toolCases.length} tools, ${questions.length} routes)`);

async function execute(name: string, args: JsonObject): Promise<ToolResult> {
  return app.toolRegistry.execute({ name, args }, { user, confirmed: true }) as Promise<ToolResult>;
}

function assertOk(result: ToolResult, label: string): void {
  if (result.ok === false) throw new Error(`${label} failed: ${result.message ?? result.error ?? "unknown"}`);
}

async function assertSourceRefs(rows: JsonObject[], resource: string): Promise<void> {
  const refs = await loadJson<JsonObject[]>("data/cloud-commodity/cloud_source_refs.json");
  const known = new Set(refs.map((row) => String(row.source_ref_id)));
  for (const row of rows) {
    const ids = Array.isArray(row.source_ref_ids) ? row.source_ref_ids.map(String) : [];
    assert(ids.length > 0, `${resource} row missing source_ref_ids`);
    for (const id of ids) assert(known.has(id), `${resource} references unknown source_ref_id ${id}`);
  }
}

function readPath(value: unknown, path: (string | number)[]): unknown {
  let cursor = value;
  for (const key of path) {
    if (cursor === null || cursor === undefined) return undefined;
    if (typeof key === "number") {
      if (!Array.isArray(cursor)) return undefined;
      cursor = cursor[key];
    } else {
      if (typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
      cursor = (cursor as Record<string, unknown>)[key];
    }
  }
  return cursor;
}

function assertNoEngineeringLeaks(value: JsonObject, label: string): void {
  const visible = JSON.stringify({
    props: readPath(value, ["openui", "props"]),
    source_labels: value.source_labels,
    tool_label: value.tool_label,
  });
  const banned = [
    "cloud_master_data_lineage",
    "cloud_financial_commercial_policies",
    "cloud_customer_explanation_playbooks",
    "cloud_product_change_versions",
    "cloud_post_launch_checks",
    "owner_user_id",
    "owner_team",
    "source_type",
    "severity=high",
    "arr_at_risk_cny",
    "gross_margin_floor",
    "deferred_revenue_rule",
  ];
  for (const token of banned) assert(!visible.includes(token), `${label} leaked ${token}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
