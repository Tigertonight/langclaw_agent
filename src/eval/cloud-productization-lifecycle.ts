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
  "cloud_productization_reviews",
  "cloud_entitlement_rules",
  "cloud_channel_publication_matrix",
  "cloud_sre_readiness_gates",
];

const toolCases: Array<{ tool: string; args: JsonObject; detail: string }> = [
  { tool: "cloud_productization_readiness_review", args: { product_code: "SEEDANCE" }, detail: "ProductLaunchFormSurface" },
  { tool: "cloud_offer_design_review", args: { product_code: "AGENT_PLAN" }, detail: "AnalyticsDashboardSurface" },
  { tool: "cloud_plan_entitlement_review", args: { product_code: "AGENT_PLAN" }, detail: "ProductLaunchFormSurface" },
  { tool: "cloud_channel_publication_review", args: { product_code: "SEEDANCE" }, detail: "AnalyticsDashboardSurface" },
  { tool: "cloud_sre_launch_gate_review", args: { product_code: "SEEDANCE", release_request_id: "rel_seedance_mini_selfserve_202606" }, detail: "AnalyticsDashboardSurface" },
];

const questions: Array<{ text: string; intent: string }> = [
  { text: "Seedance Mini 目前只是一个模型能力，是否具备产品化条件？还缺哪些产品定义交付物？", intent: "cloud.productization.readiness_review" },
  { text: "帮我生成 Seedance Mini 产品化定义草稿，包含目标客户、能力边界、不可承诺项、SLA 初稿和成本测算输入。", intent: "cloud.productization.readiness_review" },
  { text: "Agent Plan 应该设计几个 Offer？按量、包月、会员权益和超额付费能否同时存在？", intent: "cloud.offer.design_review" },
  { text: "会员每天送 50 元等值 Token，这个权益如何定义？过期、退订、超额和账单解释怎么处理？", intent: "cloud.plan.entitlement_review" },
  { text: "Seedance Mini 发布到官网、控制台、销售和 API/Marketplace，各渠道应该展示哪些字段？", intent: "cloud.channel.publication_review" },
  { text: "Seedance Mini 上架前，SRE 需要确认哪些容量、限流、告警、灰度和回滚门禁？", intent: "cloud.sre.launch_gate_review" },
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
      run_id: `productization_${item.tool}`,
      user_message: "请用云商品业务工作台展示",
      debug: { tool_results: [result as JsonObject] },
    },
  });
  const cloudData = envelopes
    .map((envelope) => envelope.updateDataModel?.value)
    .find((value): value is JsonObject => Boolean(value) && readPath(value, ["domain"]) === "云商品平台");
  assert(Boolean(cloudData), `${item.tool} should create cloud OpenUI surface`);
  assert(readPath(cloudData, ["openui", "component"]) === "BusinessBriefSurface", `${item.tool} should render BusinessBriefSurface`);
  assert(readPath(cloudData, ["openui", "props", "details", "component"]) === item.detail, `${item.tool} detail surface should be ${item.detail}`);
  assertNoEngineeringLeaks(cloudData, item.tool);
}

for (const question of questions) {
  const route = await app.intentRouter.route({ user_context: user, message: question.text });
  assert(route.intent_code === question.intent, `expected ${question.intent}, got ${route.intent_code} for ${question.text}`);
}

const scenarios = await loadJson<JsonObject[]>("data/cloud-commodity/cloud_demo_scenarios.json");
const commands = await loadJson<JsonObject[]>("data/recommended-commands.json");
const badPhrase = "从官网能力接入商品平台";
assert(!JSON.stringify(scenarios).includes(badPhrase), "demo scenarios should not use the old website-source wording");
assert(!JSON.stringify(commands).includes(badPhrase), "recommended commands should not use the old website-source wording");

console.log(`cloud-productization-lifecycle: OK (${resources.length} resources, ${toolCases.length} tools, ${questions.length} routes)`);

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
    "severity=high",
    "owner_user_id",
    "owner_team",
    "source_type",
    "cloud_productization_reviews",
    "cloud_entitlement_rules",
    "cloud_channel_publication_matrix",
    "cloud_sre_readiness_gates",
  ];
  for (const token of banned) assert(!visible.includes(token), `${label} leaked ${token}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
