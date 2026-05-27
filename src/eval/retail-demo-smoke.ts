/**
 * retail-demo domain smoke test。
 *
 * 验证 Milestone 2.5 的核心目标：
 * 1. 新业务域（retail-demo）通过纯声明式 DomainPack 接入
 * 2. 不修改任何核心代码即可支持 "查询门店销量" 和 "查询库存告警"
 * 3. ResourceRegistry 正确注册了 retail_sales / retail_inventory_alerts 资源
 * 4. 确定性规则正确路由到 retail.query.sales / retail.query.inventory_alerts
 * 5. 不影响现有 dealer / attendance 域的功能（无回归）
 */

process.env.WECOM_MODE ??= "mock";

const { createApp } = await import("../app.js");

interface SmokeResult {
  answer?: string;
  debug: {
    route?: { intent_code?: string; handler_type?: string; params?: Record<string, unknown> };
    tool_calls?: Array<{ resource?: string; name?: string }>;
    tool_results?: Array<{ resource?: string; row_count?: number; [key: string]: unknown }>;
  };
}

const app = createApp();
await app.init();
const { agent, resourceRegistry, domainRegistry } = app;
const runId = `retail_demo_smoke_${Date.now()}`;
const failures: Array<{ name: string; message: string }> = [];
let caseIndex = 0;

// ── 基础设施验证 ──────────────────────────────────────────────────────────

await test("ResourceRegistry 包含 retail_sales", async () => {
  if (!resourceRegistry.has("retail_sales")) {
    throw new Error("retail_sales 未注册到 ResourceRegistry");
  }
});

await test("ResourceRegistry 包含 retail_inventory_alerts", async () => {
  if (!resourceRegistry.has("retail_inventory_alerts")) {
    throw new Error("retail_inventory_alerts 未注册到 ResourceRegistry");
  }
});

await test("ResourceRegistry 包含 retail_stores", async () => {
  if (!resourceRegistry.has("retail_stores")) {
    throw new Error("retail_stores 未注册到 ResourceRegistry");
  }
});

await test("DomainRegistry 包含 retail-demo", async () => {
  if (!domainRegistry.has("retail-demo")) {
    throw new Error("retail-demo 未注册到 DomainRegistry");
  }
});

await test("retail-demo DomainPack 无 register() 逃生口", async () => {
  const pack = domainRegistry.get("retail-demo");
  if (!pack) throw new Error("retail-demo pack not found");
  if (typeof pack.register === "function") {
    throw new Error("retail-demo DomainPack 不应有 register() 逃生口（M2.5 约束）");
  }
});

// ── 门店销量查询 ──────────────────────────────────────────────────────────

await test("门店销量查询走 retail.query.sales", async () => {
  const result = await run("retail_user_001", "查一下门店销量");
  expectRoute(result, "retail.query.sales", "intent_query");
  expectResource(result, "retail_sales");
});

await test("各门店销售情况走 retail.query.sales", async () => {
  const result = await run("retail_user_001", "各门店销售情况怎么样");
  expectRoute(result, "retail.query.sales", "intent_query");
  expectResource(result, "retail_sales");
});

await test("销量排行走 retail.query.sales", async () => {
  const result = await run("retail_user_001", "各门店销量排行");
  expectRoute(result, "retail.query.sales", "intent_query");
  expectResource(result, "retail_sales");
});

// ── 库存告警查询 ──────────────────────────────────────────────────────────

await test("库存告警查询走 retail.query.inventory_alerts", async () => {
  const result = await run("retail_user_001", "哪些东西要断货了");
  expectRoute(result, "retail.query.inventory_alerts", "intent_query");
  expectResource(result, "retail_inventory_alerts");
});

await test("缺货查询走 retail.query.inventory_alerts", async () => {
  const result = await run("retail_user_001", "哪些原料快没了");
  expectRoute(result, "retail.query.inventory_alerts", "intent_query");
  expectResource(result, "retail_inventory_alerts");
});

await test("补货查询走 retail.query.inventory_alerts", async () => {
  const result = await run("retail_user_001", "需要补货的有哪些");
  expectRoute(result, "retail.query.inventory_alerts", "intent_query");
  expectResource(result, "retail_inventory_alerts");
});

// ── 无回归验证 ────────────────────────────────────────────────────────────

await test("dealer 域库存查询不受影响", async () => {
  if (!resourceRegistry.has("dealer_vehicles")) {
    throw new Error("dealer_vehicles 应仍在 ResourceRegistry 中");
  }
});

await test("attendance 域请假查询不受影响", async () => {
  if (!resourceRegistry.has("leave_requests")) {
    throw new Error("leave_requests 应仍在 ResourceRegistry 中");
  }
});

// ── 结果汇总 ──────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.log(`\n${failures.length} retail-demo smoke case(s) failed.`);
  for (const failure of failures) console.log(`  FAIL ${failure.name}: ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log("\nAll retail-demo smoke cases passed.");
}

// ── 辅助函数 ──────────────────────────────────────────────────────────────

async function run(userId: string, message: string): Promise<SmokeResult> {
  caseIndex += 1;
  const raw = await agent.run({
    userId,
    wecomUserId: userId,
    message,
    sessionId: `${runId}_${String(caseIndex).padStart(2, "0")}_${userId}`,
    debug: true,
  });
  return {
    answer: typeof raw.answer === "string" ? raw.answer : undefined,
    debug: raw.debug && typeof raw.debug === "object" ? raw.debug as SmokeResult["debug"] : {},
  };
}

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, message: error instanceof Error ? error.message : String(error) });
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function expectRoute(result: SmokeResult, intentCode: string, handlerType?: string): void {
  const route = result.debug.route ?? {};
  if (route.intent_code !== intentCode) {
    throw new Error(`intent_code: expected ${intentCode}, got ${route.intent_code}`);
  }
  if (handlerType && route.handler_type !== handlerType) {
    throw new Error(`handler_type: expected ${handlerType}, got ${route.handler_type}`);
  }
}

function expectResource(result: SmokeResult, resource: string): void {
  const hasResource =
    result.debug.tool_calls?.some((call) => call.resource === resource) ||
    result.debug.tool_results?.some((item) => item.resource === resource);
  if (!hasResource) {
    throw new Error(`expected resource ${resource} in tool_calls or tool_results`);
  }
}
