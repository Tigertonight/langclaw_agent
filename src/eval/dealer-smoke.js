process.env.WECOM_MODE ??= "mock";

const { createApp } = await import("../app.js");
const { agent } = createApp();
const runId = `dealer_smoke_${Date.now()}`;
const failures = [];
let caseIndex = 0;

await test("库存风险查询走 dealer-inventory", async () => {
  const result = await run("store_gm_001", "查一下当前整车库存库龄风险");
  expectEqual(result.debug.route?.intent_code, "dealer.inventory_query", "intent_code");
  expectEqual(result.debug.selected_skill, "dealer-inventory", "selected_skill");
  expectResource(result, "dealer_vehicles");
  expectAnswer(result, ["LGXCF6CD0P000001", "库龄"]);
});

await test("配额查询命中 dealer_quotas", async () => {
  const result = await run("sales_manager_001", "宋L 这个月还有多少配额可以承诺");
  expectEqual(result.debug.selected_skill, "dealer-inventory", "selected_skill");
  expectResource(result, "dealer_quotas");
  expectAnswer(result, ["宋L", "剩余"]);
});

await test("订车承诺应联查配额和在途", async () => {
  const result = await run("store_gm_001", "客户想订一台汉EV 715KM 冰川蓝，帮我看看还能不能承诺交期");
  expectEqual(result.debug.route?.intent_code, "dealer.inventory_query", "intent_code");
  expectEqual(result.debug.selected_skill, "dealer-inventory", "selected_skill");
  expectResource(result, "dealer_quotas");
  expectResource(result, "dealer_inbounds");
  expectAnswer(result, ["剩余可承诺 0", "生产中"]);
});

await test("线索漏斗查询走 dealer-sales", async () => {
  const result = await run("sales_manager_001", "看一下最近线索漏斗和战败情况");
  expectEqual(result.debug.selected_skill, "dealer-sales", "selected_skill");
  expectResource(result, "dealer_leads");
  expectAnswer(result, ["战败", "跟进"]);
});

await test("待交付订单查询走 dealer-sales", async () => {
  const result = await run("store_gm_001", "查一下待交付的销售订单");
  expectResource(result, "dealer_sales_orders");
  expectAnswer(result, ["SO-202605-001", "待交付"]);
});

await test("折让金查询走 dealer-finance", async () => {
  const result = await run("finance_001", "查一下华东旗舰店折让金余额和最近流水");
  expectEqual(result.debug.selected_skill, "dealer-finance", "selected_skill");
  expectResource(result, "dealer_finance");
  expectAnswer(result, ["折让金", "余额"]);
});

await test("三包索赔查询走 dealer-after-sales", async () => {
  const result = await run("store_gm_001", "查一下三包索赔审核和被拒情况");
  expectEqual(result.debug.selected_skill, "dealer-after-sales", "selected_skill");
  expectResource(result, "dealer_warranty_claims");
  expectAnswer(result, ["WC-", "索赔"]);
});

await test("跨域经营判断应联查订单库存线索", async () => {
  const result = await run("store_gm_001", "帮我看一下销售订单、库存和线索，判断华东旗舰店这周经营上最该关注什么");
  expectEqual(result.debug.selected_skill, "dealer-analysis", "selected_skill");
  expectResource(result, "dealer_metrics");
  expectResource(result, "dealer_sales_orders");
  expectResource(result, "dealer_vehicles");
  expectResource(result, "dealer_leads");
  expectAnswer(result, ["SO-202605-001", "LGXCF6CD0P000001", "王芳"]);
});

await test("经营风险总览走 dealer-analysis 和 dealer_metrics", async () => {
  const result = await run("store_gm_001", "华东旗舰店经营风险总览");
  expectEqual(result.debug.route?.intent_code, "dealer.analysis_query", "intent_code");
  expectEqual(result.debug.selected_skill, "dealer-analysis", "selected_skill");
  expectResource(result, "dealer_metrics");
  expectMetricCategory(result, "inventory");
  expectSeverity(result, "critical");
});

await test("经营周报优先使用经营指标", async () => {
  const result = await run("store_gm_001", "给我一份华东旗舰店本周经营周报");
  expectEqual(result.debug.selected_skill, "dealer-analysis", "selected_skill");
  expectResource(result, "dealer_metrics");
  expectRows(result, "dealer_metrics");
});

await test("库存和线索优先级联查指标与明细", async () => {
  const result = await run("sales_manager_001", "看一下华东旗舰店库存和线索的优先级");
  expectEqual(result.debug.selected_skill, "dealer-analysis", "selected_skill");
  expectResource(result, "dealer_metrics");
  expectResource(result, "dealer_vehicles");
  expectResource(result, "dealer_leads");
  expectToolFilter(result, "dealer_metrics", "category", ["inventory", "lead"]);
});

await test("财务风险分析命中财务类指标", async () => {
  const result = await run("finance_001", "华东旗舰店财务风险有哪些");
  expectEqual(result.debug.selected_skill, "dealer-analysis", "selected_skill");
  expectResource(result, "dealer_metrics");
  expectToolFilter(result, "dealer_metrics", "category", "finance");
});

await test("售后三包损失风险复盘联查指标和索赔", async () => {
  const result = await run("store_gm_001", "华东旗舰店售后三包损失风险复盘");
  expectEqual(result.debug.selected_skill, "dealer-analysis", "selected_skill");
  expectResource(result, "dealer_metrics");
  expectResource(result, "dealer_warranty_claims");
  expectToolFilter(result, "dealer_metrics", "category", ["after_sales", "warranty"]);
});

await test("今天最该关注什么使用经营指标", async () => {
  const result = await run("store_gm_001", "华东旗舰店今天最该关注什么");
  expectEqual(result.debug.selected_skill, "dealer-analysis", "selected_skill");
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

function expectResource(result, resource) {
  const hasResource = result.debug.tool_calls?.some((call) => call.resource === resource)
    || result.debug.tool_results?.some((item) => item.resource === resource);
  if (!hasResource) throw new Error(`expected resource ${resource}`);
}

function expectAnswer(result, snippets) {
  for (const snippet of snippets) {
    if (!result.answer.includes(snippet)) throw new Error(`expected answer to include ${snippet}`);
  }
}

function expectMetricCategory(result, category) {
  const rows = getResourceRows(result, "dealer_metrics");
  if (!rows.some((row) => row.category === category)) throw new Error(`expected dealer_metrics category ${category}`);
}

function expectRows(result, resource) {
  const item = result.debug.tool_results?.find((row) => row.resource === resource);
  if (!item || item.row_count <= 0) throw new Error(`expected ${resource} to return rows`);
}

function expectToolFilter(result, resource, field, expectedValue) {
  const call = result.debug.tool_calls?.find((item) => item.resource === resource);
  const filter = call?.filters?.find((item) => item.field === field);
  if (!filter) throw new Error(`expected ${resource} filter ${field}`);
  const values = Array.isArray(filter.value) ? filter.value : [filter.value];
  const expected = Array.isArray(expectedValue) ? expectedValue : [expectedValue];
  for (const item of expected) {
    if (!values.includes(item)) throw new Error(`expected ${resource} filter ${field} to include ${item}`);
  }
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

function expectEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}
