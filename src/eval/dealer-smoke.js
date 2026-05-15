process.env.WECOM_MODE ??= "mock";

const { createApp } = await import("../app.js");
const { agent } = createApp();
const runId = `dealer_smoke_${Date.now()}`;
const failures = [];
let caseIndex = 0;

await test("库存风险查询走 dealer.query.inventory", async () => {
  const result = await run("store_gm_001", "查一下当前整车库存库龄风险");
  expectRoute(result, "dealer.query.inventory", "intent_query");
  expectResource(result, "dealer_vehicles");
});

await test("配额/承诺类问题归入库存意图", async () => {
  const result = await run("sales_manager_001", "宋L 这个月还有多少配额可以承诺");
  expectRoute(result, "dealer.query.inventory", "intent_query");
  expectResource(result, "dealer_vehicles");
});

await test("订车交期承诺归入库存意图", async () => {
  const result = await run("store_gm_001", "客户想订一台汉EV 715KM 冰川蓝，帮我看看还能不能承诺交期");
  expectRoute(result, "dealer.query.inventory", "intent_query");
  expectResource(result, "dealer_vehicles");
});

await test("线索漏斗查询走 dealer.query.leads", async () => {
  const result = await run("sales_manager_001", "看一下最近线索漏斗和战败情况");
  expectRoute(result, "dealer.query.leads", "intent_query");
  expectResource(result, "dealer_leads");
});

await test("待交付订单查询走 dealer.query.sales_orders", async () => {
  const result = await run("store_gm_001", "查一下待交付的销售订单");
  expectRoute(result, "dealer.query.sales_orders", "intent_query");
  expectResource(result, "dealer_sales_orders");
  expectParam(result, "delivery_status", /待交付|未交付/);
});

await test("折让金查询走 dealer.query.finance", async () => {
  const result = await run("finance_001", "查一下华东旗舰店折让金余额和最近流水");
  expectRoute(result, "dealer.query.finance", "intent_query");
  expectResource(result, "dealer_finance");
  expectParam(result, "resource_type", "discount_wallet");
});

await test("三包索赔查询走 dealer.query.warranty_claims", async () => {
  const result = await run("store_gm_001", "查一下三包索赔审核和被拒情况");
  expectRoute(result, "dealer.query.warranty_claims", "intent_query");
  expectResource(result, "dealer_warranty_claims");
});

await test("跨域经营判断优先走经营指标", async () => {
  const result = await run("store_gm_001", "帮我看一下销售订单、库存和线索，判断华东旗舰店这周经营上最该关注什么");
  expectRoute(result, "dealer.query.metrics", "intent_query");
  expectResource(result, "dealer_metrics");
});

await test("经营风险总览走 dealer.query.metrics", async () => {
  const result = await run("store_gm_001", "华东旗舰店经营风险总览");
  expectRoute(result, "dealer.query.metrics", "intent_query");
  expectResource(result, "dealer_metrics");
  expectMetricCategory(result, "inventory");
  expectSeverity(result, "critical");
});

await test("经营周报优先使用经营指标", async () => {
  const result = await run("store_gm_001", "给我一份华东旗舰店本周经营周报");
  expectRoute(result, "dealer.query.metrics", "intent_query");
  expectResource(result, "dealer_metrics");
  expectRows(result, "dealer_metrics");
});

await test("库存和线索优先级使用经营指标", async () => {
  const result = await run("sales_manager_001", "看一下华东旗舰店库存和线索的优先级");
  expectRoute(result, "dealer.query.metrics", "intent_query");
  expectResource(result, "dealer_metrics");
  expectMetricCategory(result, "inventory");
  expectMetricCategoryOrAnswer(result, "lead", /线索/);
});

await test("财务风险分析命中财务类指标", async () => {
  const result = await run("finance_001", "华东旗舰店财务风险有哪些");
  expectRoute(result, "dealer.query.metrics", "intent_query");
  expectResource(result, "dealer_metrics");
  expectMetricCategory(result, "finance");
});

await test("售后三包损失风险复盘允许 agentic 分析", async () => {
  const result = await run("store_gm_001", "华东旗舰店售后三包损失风险复盘");
  const route = result.debug.route ?? {};
  const ok = route.intent_code === "dealer.query.metrics" || route.intent_code === "general";
  if (!ok) throw new Error(`expected dealer.query.metrics or general, got ${route.intent_code}`);
  if (route.intent_code === "dealer.query.metrics") expectResource(result, "dealer_metrics");
  if (!result.answer || /暂时无法直接给出/.test(result.answer)) {
    throw new Error(`expected non-empty analytical answer, got ${truncate(result.answer)}`);
  }
});

await test("今天最该关注什么使用经营指标", async () => {
  const result = await run("store_gm_001", "华东旗舰店今天最该关注什么");
  expectRoute(result, "dealer.query.metrics", "intent_query");
  expectResource(result, "dealer_metrics");
  expectSeverity(result, "critical");
});

if (failures.length > 0) {
  console.log(`\n${failures.length} dealer smoke case(s) failed.`);
  for (const failure of failures) console.log(`FAIL ${failure.name}: ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log("\nAll dealer smoke cases passed.");
}

async function run(userId, message) {
  caseIndex += 1;
  return agent.run({
    userId,
    wecomUserId: userId,
    message,
    sessionId: `${runId}_${String(caseIndex).padStart(2, "0")}_${userId}`,
    debug: true
  });
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, message: error.message });
    console.log(`FAIL ${name}`);
  }
}

function expectRoute(result, intentCode, handlerType) {
  const route = result.debug.route ?? {};
  if (route.intent_code !== intentCode) throw new Error(`intent_code: expected ${intentCode}, got ${route.intent_code}`);
  if (handlerType && route.handler_type !== handlerType) throw new Error(`handler_type: expected ${handlerType}, got ${route.handler_type}`);
}

function expectResource(result, resource) {
  const hasResource = result.debug.tool_calls?.some((call) => call.resource === resource)
    || result.debug.tool_results?.some((item) => item.resource === resource);
  if (!hasResource) throw new Error(`expected resource ${resource}`);
}

function expectParam(result, key, expectedValue) {
  const actual = result.debug.route?.params?.[key];
  if (expectedValue instanceof RegExp) {
    if (!expectedValue.test(String(actual ?? ""))) throw new Error(`expected param ${key} to match ${expectedValue}, got ${actual}`);
    return;
  }
  if (actual !== expectedValue) throw new Error(`expected param ${key}=${expectedValue}, got ${actual}`);
}

function expectMetricCategory(result, category) {
  const rows = getResourceRows(result, "dealer_metrics");
  if (!rows.some((row) => row.category === category)) throw new Error(`expected dealer_metrics category ${category}`);
}

function expectMetricCategoryOrAnswer(result, category, answerPattern) {
  const rows = getResourceRows(result, "dealer_metrics");
  if (rows.some((row) => row.category === category)) return;
  if (answerPattern.test(result.answer ?? "")) return;
  throw new Error(`expected dealer_metrics category ${category} or answer to match ${answerPattern}`);
}

function expectRows(result, resource) {
  const item = result.debug.tool_results?.find((row) => row.resource === resource);
  if (!item || item.row_count <= 0) throw new Error(`expected ${resource} to return rows`);
}

function expectSeverity(result, severity) {
  const rows = getResourceRows(result, "dealer_metrics");
  if (!rows.some((row) => row.severity === severity)) throw new Error(`expected dealer_metrics severity ${severity}`);
}

function getResourceRows(result, resource) {
  return result.debug.tool_results
    ?.filter((item) => item.resource === resource)
    .flatMap((item) => item.sample_rows ?? item.rows ?? item.data?.rows ?? []) ?? [];
}

function truncate(s) {
  if (!s) return "";
  return s.length > 80 ? s.slice(0, 80) + "..." : s;
}
