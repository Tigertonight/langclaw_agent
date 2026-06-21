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

const failures: Array<{ name: string; message: string }> = [];

const ecsTools = [
  "cloud_ipd_readiness_review",
  "cloud_gtm_package_draft",
  "cloud_capacity_risk_review",
  "cloud_gmv_target_briefing",
  "cloud_ops_incident_business_impact",
];

const ecsResources = [
  "cloud_ipd_checkpoints",
  "cloud_gtm_assets",
  "cloud_capacity_pools",
  "cloud_sales_opportunities",
  "cloud_sla_incidents",
];

const ecsIntents = [
  "cloud.ipd.readiness_review",
  "cloud.gtm.package_draft",
  "cloud.capacity.risk_review",
  "cloud.gmv.target_briefing",
  "cloud.ops.incident_impact",
];

const demoQuestions = [
  "我要把 ECS GPU 训练实例接入云商品平台，支持华东 1 和新加坡，按量和包月售卖。请生成商品模型、SKU、计费项、购买页字段和 IPD 上架检查清单。",
  "生成 rel_ecs_gpu_train_202606 的发布审批摘要，重点看价格、容量、SLA 和回滚检查点。",
  "这个 ECS GPU 包月套餐的价格和折扣会不会影响毛利？哪些折扣不能直接给销售承诺？",
  "华东 1 和新加坡的 GPU 容量能支撑首批客户吗？如果容量不足，发布和销售应该怎么限制？",
  "帮我生成 ECS GPU 训练实例的 GTM 包：目标客户、卖点、FAQ、销售话术、不能承诺的边界。",
  "金融客户预算 30 万，优先稳定性和可审计，ECS GPU、RDS、TOS、CLB 应该怎么组合？正式报价前要确认什么？",
  "我想买 ECS GPU 训练实例，预算 10 万，华东 1 包月，大概能买什么规格？价格是不是正式报价？",
  "ECS GPU 商品本月 GMV 目标完成得怎么样？毛利、交付、容量和客户风险分别谁负责？",
  "如果新加坡 GPU 容量不足导致交付延期，影响哪些订单、GMV 和客户？给我回滚和客户沟通方案。",
  "把 ECS GPU 从立项到上架、销售、交付、经营达成的阻塞复盘成下一次商品上架模板。",
];

await test("ECS story resources and intents are registered", async () => {
  for (const resource of ecsResources) {
    if (!app.resourceRegistry.has(resource)) throw new Error(`missing resource ${resource}`);
    const rows = await loadJson<JsonObject[]>(`data/cloud-commodity/${resource}.json`);
    assertAtLeast(rows.length, 1, `${resource} rows`);
  }
  for (const intent of ecsIntents) {
    if (!app.intentRegistry.getCode(intent)) throw new Error(`missing intent ${intent}`);
  }
});

await test("ECS story source refs are valid", async () => {
  const refs = await loadJson<JsonObject[]>("data/cloud-commodity/cloud_source_refs.json");
  const known = new Set(refs.map((row) => String(row.source_ref_id)));
  for (const resource of ecsResources) {
    const rows = await loadJson<JsonObject[]>(`data/cloud-commodity/${resource}.json`);
    for (const row of rows) {
      const sourceRefs = Array.isArray(row.source_ref_ids) ? row.source_ref_ids.map(String) : [];
      if (!sourceRefs.length) throw new Error(`${resource} row missing source_ref_ids`);
      for (const ref of sourceRefs) {
        if (!known.has(ref)) throw new Error(`${resource} references unknown source_ref_id ${ref}`);
      }
    }
  }
});

await test("ECS release, workflow, risk, metrics and scenarios are present", async () => {
  const releases = await loadJson<JsonObject[]>("data/cloud-commodity/cloud_release_requests.json");
  if (!releases.some((row) => row.release_request_id === "rel_ecs_gpu_train_202606")) throw new Error("missing ECS GPU release request");
  const tasks = await loadJson<JsonObject[]>("data/cloud-commodity/cloud_workflow_tasks.json");
  assertAtLeast(tasks.filter((row) => row.linked_release_request_id === "rel_ecs_gpu_train_202606").length, 5, "ECS workflow tasks");
  const risks = await loadJson<JsonObject[]>("data/cloud-commodity/cloud_risk_signals.json");
  assertAtLeast(risks.filter((row) => asObject(row.linked_entities).product_id === "prod_ecs").length, 4, "ECS risk signals");
  const metrics = await loadJson<JsonObject[]>("data/cloud-commodity/cloud_operating_metrics.json");
  assertAtLeast(metrics.filter((row) => row.product_id === "prod_ecs").length, 7, "ECS operating metrics");
  const scenarios = await loadJson<JsonObject[]>("data/cloud-commodity/cloud_demo_scenarios.json");
  assertAtLeast(scenarios.filter((row) => String(row.scenario_id).startsWith("ecs_story_")).length, 10, "ECS demo scenarios");
});

await test("ECS tools return supported OpenUI surfaces without engineering leaks", async () => {
  const toolArgs: Record<string, JsonObject> = {
    cloud_ipd_readiness_review: { product_code: "ECS", release_request_id: "rel_ecs_gpu_train_202606" },
    cloud_gtm_package_draft: { product_code: "ECS", industry: "金融核心系统客户" },
    cloud_capacity_risk_review: { product_code: "ECS", release_request_id: "rel_ecs_gpu_train_202606" },
    cloud_gmv_target_briefing: { product_code: "ECS", period: "2026-06" },
    cloud_ops_incident_business_impact: { product_code: "ECS", incident_id: "inc_ecs_gpu_sg_delay_001" },
  };
  for (const tool of ecsTools) {
    const result = await execute(tool, toolArgs[tool]);
    assertOk(result, tool);
    const envelopes = buildOpenUILangLegacyEnvelopes({
      result: {
        run_id: `ecs_${tool}`,
        user_message: "请用云商品业务驾驶舱展示",
        debug: { tool_results: [result as JsonObject] },
      },
    });
    const dataModels = envelopes.map((envelope) => envelope.updateDataModel?.value).filter(Boolean) as JsonObject[];
    const cloudData = dataModels.find((data) => readPath(data, ["domain"]) === "云商品平台");
    if (!cloudData) throw new Error(`${tool} did not create cloud OpenUI surface`);
    const component = String(readPath(cloudData, ["openui", "component"]) ?? "");
    if (!["BusinessBriefSurface", "AnalyticsDashboardSurface", "MetricCardsSurface", "RiskListSurface", "DataTableSurface", "GroupedListSurface"].includes(component)) {
      throw new Error(`${tool} rendered unsupported component ${component}`);
    }
    if (component === "BusinessBriefSurface" && !String(readPath(cloudData, ["openui", "props", "verdict"]) ?? "").trim()) {
      throw new Error(`${tool} rendered BusinessBriefSurface without verdict`);
    }
    assertNoEngineeringLeaks(cloudData, tool);
  }
});

await test("ECS demo questions route to cloud intents", async () => {
  for (const question of demoQuestions) {
    const route = await app.intentRouter.route({ user_context: user, message: question });
    const intent = String(route.intent_code ?? "");
    if (!intent.startsWith("cloud.")) throw new Error(`question routed to ${intent}: ${question}`);
  }
});

if (failures.length) {
  console.error(`cloud-ecs-story: ${failures.length} failure(s)`);
  for (const failure of failures) console.error(`- ${failure.name}: ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log("cloud-ecs-story: OK");
}

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, message: error instanceof Error ? error.message : String(error) });
    console.log(`FAIL ${name}`);
  }
}

async function execute(name: string, args: JsonObject): Promise<ToolResult> {
  return app.toolRegistry.execute({ name, args }, { user, confirmed: true }) as Promise<ToolResult>;
}

function assertOk(result: ToolResult, label: string): void {
  if (result.ok === false) throw new Error(`${label} failed: ${result.message ?? result.error ?? "unknown"}`);
}

function assertAtLeast(actual: number, expected: number, label: string): void {
  if (actual < expected) throw new Error(`${label}: expected at least ${expected}, got ${actual}`);
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
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
    "delay_hours>0",
    "arr_at_risk_cny",
    "owner_user_id",
    "owner_team",
    "source_type",
    "cloud_ipd_checkpoints",
    "cloud_gtm_assets",
    "cloud_capacity_pools",
    "cloud_sales_opportunities",
    "cloud_sla_incidents",
  ];
  for (const token of banned) {
    if (visible.includes(token)) throw new Error(`${label} leaked ${token}`);
  }
}
