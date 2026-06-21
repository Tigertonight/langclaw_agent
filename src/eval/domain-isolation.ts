process.env.WECOM_MODE ??= "mock";

const { createApp } = await import("../app.js");
import { buildOpenUILangLegacyEnvelopes } from "../openui-lang/index.js";
import type { JsonObject, Route, ToolResult, UserContext } from "../types/agent-contracts.js";

const app = createApp();
await app.init();

const failures: Array<{ name: string; message: string }> = [];

const cloudUser: UserContext = {
  id: "cloud_pm_001",
  name: "程一川",
  role: "cloud_pm",
  department: "云商品平台",
  permissions: ["cloud:read", "cloud:estimate", "cloud:draft", "cloud:risk", "cloud:admin", "policy:read", "org:read"],
  accessible_customer_ids: ["cust_ai_studio", "cust_media_stream", "cust_finance_core"],
};

const dealerUser: UserContext = {
  id: "sales_001",
  name: "李雷",
  role: "sales",
  department: "销售一部",
  permissions: ["dealer:read", "sales:read", "customer:read", "policy:read", "org:read"],
  accessible_store_ids: ["store_001"],
  accessible_customer_ids: ["cust_001", "cust_002"],
};

await test("cloud selected domain accepts cloud customer renewal wording", async () => {
  const route = await app.intentRouter.route({
    message: "我负责的云客户里，本周最该跟进哪三个机会？请按续约风险、金额和下一步动作排序。",
    user_context: cloudUser,
    selected_domain: "cloud_commodity",
  });
  if (!String(route.intent_code).startsWith("cloud.") && route.intent_code !== "general") {
    throw new Error(`expected cloud/general route, got ${route.intent_code}`);
  }
  if (String(route.intent_code).startsWith("dealer.")) throw new Error(`leaked dealer route ${route.intent_code}`);
});

await test("cloud selected domain blocks dealer lead wording", async () => {
  const route = await app.intentRouter.route({
    message: "我负责的客户里，本周最该跟进哪三个线索？",
    user_context: cloudUser,
    selected_domain: "cloud_commodity",
  });
  assertDomainGate(route, "dealer.query.leads");
});

await test("dealer selected domain blocks cloud renewal wording", async () => {
  const route = await app.intentRouter.route({
    message: "哪些云客户续约有风险，影响金额是多少？",
    user_context: dealerUser,
    selected_domain: "dealer",
  });
  assertDomainGate(route, /^cloud\./);
});

await test("dealer selected domain accepts dealer lead wording", async () => {
  const route = await app.intentRouter.route({
    message: "我负责的客户里，本周最该跟进哪三个线索？",
    user_context: dealerUser,
    selected_domain: "dealer",
  });
  if (route.intent_code !== "dealer.query.leads") throw new Error(`expected dealer.query.leads, got ${route.intent_code}`);
});

await test("query_business_data rejects dealer resource in cloud domain", async () => {
  const result = await app.toolRegistry.execute(
    { name: "query_business_data", args: { resource: "dealer_vehicles", operation: "search", limit: 1 } },
    { user: cloudUser, selected_domain: "cloud_commodity" },
  ) as ToolResult;
  assertToolDomainMismatch(result, "dealer resource in cloud");
});

await test("query_business_data rejects cloud resource in dealer domain", async () => {
  const result = await app.toolRegistry.execute(
    { name: "query_business_data", args: { resource: "cloud_bills", operation: "search", limit: 1 } },
    { user: dealerUser, selected_domain: "dealer" },
  ) as ToolResult;
  assertToolDomainMismatch(result, "cloud resource in dealer");
});

await test("tool registry rejects cloud dedicated tool in dealer domain", async () => {
  const result = await app.toolRegistry.execute(
    { name: "cloud_gmv_target_briefing", args: { product_code: "ECS", period: "2026-06" } },
    { user: dealerUser, selected_domain: "dealer" },
  ) as ToolResult;
  assertToolDomainMismatch(result, "cloud tool in dealer");
});

await test("tool registry allows cloud dedicated tool in cloud domain", async () => {
  const result = await app.toolRegistry.execute(
    { name: "cloud_gmv_target_briefing", args: { product_code: "ECS", period: "2026-06" } },
    { user: cloudUser, selected_domain: "cloud_commodity" },
  ) as ToolResult;
  if (result.ok === false) throw new Error(`cloud tool should run in cloud domain: ${result.message ?? result.error}`);
});

await test("OpenUI surfaces carry domain_id and skip mismatched selected domain", async () => {
  const result = await app.toolRegistry.execute(
    { name: "cloud_gmv_target_briefing", args: { product_code: "ECS", period: "2026-06" } },
    { user: cloudUser, selected_domain: "cloud_commodity" },
  ) as ToolResult;
  const cloudEnvelopes = buildOpenUILangLegacyEnvelopes({
    result: {
      run_id: "domain_isolation_openui_cloud",
      user_message: "ECS GPU 商品本月 GMV 目标完成得怎么样？",
      debug: {
        selected_domain: "cloud_commodity",
        route: { intent_code: "cloud.gmv.target_briefing" },
        tool_results: [result as JsonObject],
      },
    },
  });
  const cloudData = cloudEnvelopes.map((envelope) => envelope.updateDataModel?.value).find((value) => value && typeof value === "object") as JsonObject | undefined;
  if (!cloudData || cloudData.domain_id !== "cloud_commodity") {
    throw new Error(`expected cloud OpenUI domain_id, got ${JSON.stringify(cloudData)}`);
  }

  const dealerEnvelopes = buildOpenUILangLegacyEnvelopes({
    result: {
      run_id: "domain_isolation_openui_dealer",
      user_message: "ECS GPU 商品本月 GMV 目标完成得怎么样？",
      debug: {
        selected_domain: "dealer",
        route: { intent_code: "cloud.gmv.target_briefing" },
        tool_results: [result as JsonObject],
      },
    },
  });
  const leaked = dealerEnvelopes.some((envelope) => (envelope.updateDataModel?.value as JsonObject | undefined)?.domain_id === "cloud_commodity");
  if (leaked) throw new Error("cloud OpenUI surface leaked into dealer selected domain");
});

if (failures.length) {
  console.error(`domain-isolation: ${failures.length} failure(s)`);
  for (const failure of failures) console.error(`- ${failure.name}: ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log("domain-isolation: OK");
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

function assertDomainGate(route: Route, originalIntent: string | RegExp): void {
  if (route.intent_code !== "general") {
    throw new Error(`expected domain gate to general, got ${String(route.intent_code)}`);
  }
  const params = route.params && typeof route.params === "object" && !Array.isArray(route.params) ? route.params as JsonObject : {};
  if (params.domain_mismatch !== true) throw new Error(`missing domain_mismatch params: ${JSON.stringify(route)}`);
  const actualOriginal = String(params.original_intent_code ?? "");
  if (typeof originalIntent === "string") {
    if (actualOriginal !== originalIntent) throw new Error(`expected original ${originalIntent}, got ${actualOriginal}`);
  } else if (!originalIntent.test(actualOriginal)) {
    throw new Error(`expected original matching ${String(originalIntent)}, got ${actualOriginal}`);
  }
}

function assertToolDomainMismatch(result: ToolResult, label: string): void {
  if (result.ok !== false || result.error !== "domain_mismatch") {
    throw new Error(`${label}: expected domain_mismatch, got ${JSON.stringify(result)}`);
  }
}
