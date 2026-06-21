process.env.WECOM_MODE ??= "mock";

const { createApp } = await import("../app.js");
import { loadJson } from "../data/load-json.js";
import type { JsonObject } from "../types/agent-contracts.js";

interface AgentRunResult {
  answer?: string;
  debug?: {
    route?: {
      intent_code?: string;
      handler_type?: string;
      source?: string;
    };
    tool_calls?: Array<{ name?: string; resource?: string }>;
    tool_results?: Array<{ resource?: string; row_count?: number; rows?: JsonObject[]; sample_rows?: JsonObject[] }>;
  };
}

const app = createApp();
await app.init();

const failures: Array<{ name: string; message: string }> = [];
const runId = `cloud_role_${Date.now()}`;
let caseIndex = 0;

await test("four cloud roles have at least eight suggested questions", async () => {
  const commands = await loadJson<Record<string, Array<{ id: string; command: string }>>>("data/recommended-commands.json");
  for (const role of ["cloud_pm", "cloud_executive", "cloud_sales", "cloud_customer"]) {
    const rows = commands[role] ?? [];
    if (rows.length < 8) throw new Error(`${role} only has ${rows.length} suggested commands`);
    for (const row of rows) {
      if (/经销|门店|试驾|车辆|库存/.test(row.command)) {
        throw new Error(`${role}.${row.id} leaks dealer wording: ${row.command}`);
      }
    }
  }
});

await test("demo scenarios cover all four role families", async () => {
  const scenarios = await loadJson<JsonObject[]>("data/cloud-commodity/cloud_demo_scenarios.json");
  assertAtLeast(scenarios.length, 90, "cloud demo scenario count");
  const personas = new Set(scenarios.map((row) => String(row.persona ?? "")));
  for (const persona of ["商品 PM", "老板", "云销售", "客户自助"]) {
    if (!personas.has(persona)) throw new Error(`missing persona ${persona}`);
  }
  const addedScenarioCount = scenarios.filter((row) => /^cloud_(seedance_mini|agent_plan)_/.test(String(row.scenario_id ?? ""))).length;
  assertAtLeast(addedScenarioCount, 50, "Seedance Mini / Agent Plan discovered scenarios");
  const seedanceCount = scenarios.filter((row) => row.product_id === "prod_seedance").length;
  const agentPlanCount = scenarios.filter((row) => row.product_id === "prod_agent_plan").length;
  assertAtLeast(seedanceCount, 30, "Seedance Mini scenario count");
  assertAtLeast(agentPlanCount, 30, "Agent Plan scenario count");
});

await test("Seedance and Agent Plan full-chain data is present", async () => {
  const releases = await loadJson<JsonObject[]>("data/cloud-commodity/cloud_release_requests.json");
  const checkpoints = await loadJson<JsonObject[]>("data/cloud-commodity/cloud_ipd_checkpoints.json");
  const gtmAssets = await loadJson<JsonObject[]>("data/cloud-commodity/cloud_gtm_assets.json");
  const tasks = await loadJson<JsonObject[]>("data/cloud-commodity/cloud_workflow_tasks.json");
  const risks = await loadJson<JsonObject[]>("data/cloud-commodity/cloud_risk_signals.json");
  const metrics = await loadJson<JsonObject[]>("data/cloud-commodity/cloud_operating_metrics.json");
  const opportunities = await loadJson<JsonObject[]>("data/cloud-commodity/cloud_sales_opportunities.json");
  for (const productId of ["prod_seedance", "prod_agent_plan"]) {
    if (!releases.some((row) => row.product_id === productId)) throw new Error(`missing release for ${productId}`);
    assertAtLeast(checkpoints.filter((row) => row.product_id === productId).length, 6, `${productId} IPD checkpoints`);
    assertAtLeast(gtmAssets.filter((row) => row.product_id === productId).length, 4, `${productId} GTM assets`);
    assertAtLeast(risks.filter((row) => (row.linked_entities as JsonObject | undefined)?.product_id === productId).length, 4, `${productId} risks`);
    assertAtLeast(metrics.filter((row) => row.product_id === productId).length, 5, `${productId} operating metrics`);
    assertAtLeast(opportunities.filter((row) => Array.isArray(row.product_ids) && row.product_ids.includes(productId)).length, 3, `${productId} opportunities`);
  }
  for (const releaseId of ["rel_seedance_mini_selfserve_202606", "rel_agent_plan_enterprise_202606"]) {
    assertAtLeast(tasks.filter((row) => row.linked_release_request_id === releaseId).length, 4, `${releaseId} workflow tasks`);
  }
});

await test("demo scenario source refs are valid", async () => {
  const sourceRefs = await loadJson<JsonObject[]>("data/cloud-commodity/cloud_source_refs.json");
  const known = new Set(sourceRefs.map((row) => String(row.source_ref_id)));
  const scenarios = await loadJson<JsonObject[]>("data/cloud-commodity/cloud_demo_scenarios.json");
  for (const scenario of scenarios) {
    const refs = Array.isArray(scenario.source_ref_ids) ? scenario.source_ref_ids.map(String) : [];
    if (!refs.length) throw new Error(`${scenario.scenario_id} missing source_ref_ids`);
    for (const ref of refs) {
      if (!known.has(ref)) throw new Error(`${scenario.scenario_id} references unknown source_ref_id ${ref}`);
    }
  }
});

await test("billing and invoice samples cover multiple customer situations", async () => {
  const bills = await loadJson<JsonObject[]>("data/cloud-commodity/cloud_bills.json");
  const invoices = await loadJson<JsonObject[]>("data/cloud-commodity/cloud_invoices.json");
  const billCustomers = new Set(bills.map((row) => String(row.customer_id)));
  for (const customerId of ["cust_ai_studio", "cust_media_stream", "cust_finance_core"]) {
    if (!billCustomers.has(customerId)) throw new Error(`missing bill for ${customerId}`);
  }
  if (!bills.some((row) => row.status === "disputed" && Number(row.dispute_amount_cny ?? 0) > 0)) {
    throw new Error("missing disputed bill with impact amount");
  }
  if (!invoices.some((row) => row.status === "on_hold_dispute")) throw new Error("missing invoice hold scenario");
});

await test("renewal opportunities point to existing contracts", async () => {
  const contracts = await loadJson<JsonObject[]>("data/cloud-commodity/cloud_contracts.json");
  const contractIds = new Set(contracts.map((row) => String(row.contract_id)));
  const renewals = await loadJson<JsonObject[]>("data/cloud-commodity/cloud_renewal_opportunities.json");
  for (const row of renewals) {
    const contractId = String(row.contract_id);
    if (!contractIds.has(contractId)) throw new Error(`renewal ${row.renewal_id} references missing contract ${contractId}`);
  }
});

await test("customer self-service bill query is scoped to own customer", async () => {
  const result = await runAgent("cloud_customer_001", "查询我能看的 2026 年 6 月账单和发票状态。");
  assertCloudAnswer(result, "cloud_customer bill query");
  const text = result.answer ?? "";
  if (/星河传媒|远山金融|cust_media_stream|cust_finance_core/.test(text)) {
    throw new Error(`customer saw out-of-scope bill data: ${truncate(text)}`);
  }
});

await test("product manager release question stays in cloud domain", async () => {
  const result = await runAgent("cloud_pm_001", "帮我生成 Seedance Mini 灰度发布检查清单，包含配置、计费、回滚、客服通知和销售话术。");
  assertCloudAnswer(result, "cloud_pm release checklist");
  expectAny(textOf(result), [/Seedance/i, /回滚|灰度|发布/, /人工|确认|审批/]);
});

await test("Seedance Mini IPD question uses Seedance data instead of ECS", async () => {
  const result = await runAgent("cloud_pm_001", "Seedance Mini 准备从产品能力商品化为可自助购买的云商品，IPD 上架前有哪些检查点还没完成？");
  assertCloudAnswer(result, "seedance ipd");
  assertNormalAgenticLoop(result, "seedance ipd");
  const text = textOf(result);
  expectAny(text, [/Seedance|视频生成模型/, /IPD|检查点|就绪度/, /毛利|内容安全|队列|GTM/]);
  if (/ECS GPU|云服务器/.test(text)) throw new Error(`Seedance IPD answer leaked ECS story: ${truncate(text)}`);
});

await test("Agent Plan GTM question uses Agent Plan data", async () => {
  const result = await runAgent("cloud_pm_001", "帮我生成 Agent Plan 面向个人开发者、企业研发、客户成功团队的 GTM 包。");
  assertCloudAnswer(result, "agent plan gtm");
  assertNormalAgenticLoop(result, "agent plan gtm");
  const text = textOf(result);
  expectAny(text, [/Agent Plan/, /开发者|企业研发|客户成功/, /不可承诺|边界|正式报价/]);
  if (/ECS GPU|云服务器/.test(text)) throw new Error(`Agent Plan GTM answer leaked ECS story: ${truncate(text)}`);
});

await test("Seedance and Agent Plan executive GMV questions return product-specific cockpit", async () => {
  const seedance = await runAgent("cloud_exec_001", "Seedance Mini 本月 GMV、pipeline、毛利和容量风险怎么样？谁负责下一步？");
  assertCloudAnswer(seedance, "seedance gmv");
  expectAny(textOf(seedance), [/Seedance|视频生成模型/, /GMV|pipeline|毛利/, /demo|mock|样本|正式承诺/]);
  const agentPlan = await runAgent("cloud_exec_001", "Agent Plan 本月 GMV、pipeline、毛利和用量告警健康吗？最大风险是谁负责？");
  assertCloudAnswer(agentPlan, "agent plan gmv");
  expectAny(textOf(agentPlan), [/Agent Plan/, /GMV|pipeline|毛利|用量告警/, /demo|mock|样本|正式承诺/]);
});

await test("executive operating question returns operating language", async () => {
  const result = await runAgent("cloud_exec_001", "云商品平台本月 GMV、净收入、毛利率、活跃客户和账单争议金额分别是多少？哪些指标需要解释为 demo 假设？");
  assertCloudAnswer(result, "cloud_exec operating metrics");
  expectAny(textOf(result), [/GMV|净收入|毛利/, /demo|mock|假设/, /账单争议|争议金额/]);
});

await test("sales solution question includes assumptions and boundary", async () => {
  const result = await runAgent("cloud_sales_001", "客户是内容行业，预算 10 万元，想做短视频批量生成和智能客服，Seedance、Agent Plan、TOS、CDN 怎么配？");
  assertCloudAnswer(result, "cloud_sales solution");
  expectAny(textOf(result), [/Seedance/i, /Agent Plan/i, /预算|10 万|100000/, /假设|demo\s*估算|非正式报价/, /边界|正式报价|固定产能|承诺/, /置信|confidence|0\.68/]);
});

await test("cloud answers hide engineering keys and internal owner ids", async () => {
  const result = await runAgent("cloud_exec_001", "谁卡住了云商品上线流程？哪些任务延期了？");
  assertCloudAnswer(result, "cloud workflow owner labels");
  const answer = textOf(result);
  if (/(owner_user_id|owner_team|metric_id|source_type|severity=|delay_hours|arr_at_risk_cny|cloud_[a-z0-9_]+|finance_reviewer_001|legal_001|ai_business|cloud_business|MD_CODE_\d+)/.test(answer)) {
    throw new Error(`answer leaked engineering key or internal id: ${truncate(answer)}`);
  }
  expectAny(answer, [/财务复核负责人|财务团队/, /模型价格复核|AFP 计费规则财务复核|流程环节/]);
});

if (failures.length) {
  console.error(`cloud-role-scenarios: ${failures.length} failure(s)`);
  for (const failure of failures) console.error(`- ${failure.name}: ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log("cloud-role-scenarios: OK");
}

async function runAgent(userId: string, message: string): Promise<AgentRunResult> {
  caseIndex += 1;
  const value = await app.agent.run({
    userId,
    wecomUserId: userId,
    message,
    sessionId: `${runId}_${String(caseIndex).padStart(2, "0")}_${userId}`,
    debug: true,
  });
  return normalize(value);
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

function assertCloudAnswer(result: AgentRunResult, label: string): void {
  const route = result.debug?.route;
  const answer = result.answer ?? "";
  if (!answer.trim()) throw new Error(`${label} returned empty answer`);
  if (/dealer\.|经销商|门店|试驾|整车库存/.test(answer)) {
    throw new Error(`${label} leaked dealer content: ${truncate(answer)}`);
  }
  if (route?.intent_code && !route.intent_code.startsWith("cloud.") && route.intent_code !== "general") {
    throw new Error(`${label} routed to non-cloud intent ${route.intent_code}`);
  }
}

function assertNormalAgenticLoop(result: AgentRunResult, label: string): void {
  const debug = result.debug as Record<string, unknown> | undefined;
  if (debug?.deterministic_cloud_tool === true) {
    throw new Error(`${label} used deterministic cloud shortcut instead of normal agentic loop`);
  }
}

function expectAny(text: string, patterns: RegExp[]): void {
  const missing = patterns.filter((pattern) => !pattern.test(text));
  if (missing.length) throw new Error(`answer missing ${missing.map(String).join(", ")}: ${truncate(text)}`);
}

function textOf(result: AgentRunResult): string {
  return result.answer ?? "";
}

function assertAtLeast(actual: number, expected: number, label: string): void {
  if (actual < expected) throw new Error(`${label}: expected at least ${expected}, got ${actual}`);
}

function normalize(value: unknown): AgentRunResult {
  const obj = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    answer: typeof obj.answer === "string" ? obj.answer : undefined,
    debug: obj.debug && typeof obj.debug === "object" ? obj.debug as AgentRunResult["debug"] : undefined,
  };
}

function truncate(value: unknown): string {
  const text = String(value ?? "");
  return text.length > 180 ? `${text.slice(0, 180)}...` : text;
}
