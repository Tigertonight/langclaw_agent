#!/usr/bin/env node

const baseUrl = process.env.BASE_URL ?? "http://localhost:3001";

const cases = [
  {
    name: "商品 PM / IPD 建模",
    user_id: "cloud_pm_001",
    message: "我要把 ECS GPU 训练实例接入云商品平台，支持华东 1 和新加坡，按量和包月售卖。请生成商品模型、SKU、计费项、购买页字段和 IPD 上架检查清单。",
    expectedIntent: "cloud.ipd.readiness_review",
    expectedTool: "tool.cloud_ipd_readiness_review",
    mustInclude: ["IPD", "检查点", "负责人"]
  },
  {
    name: "商品 PM / 发布审批",
    user_id: "cloud_pm_001",
    message: "生成 rel_ecs_gpu_train_202606 的发布审批摘要，重点看价格、容量、SLA 和回滚检查点。",
    expectedIntent: "cloud.workflow.release_request",
    expectedTool: "tool.create_cloud_approval_summary",
    mustInclude: ["风险", "回滚", "人工"]
  },
  {
    name: "财务 BP / 毛利折扣",
    user_id: "cloud_exec_001",
    message: "这个 ECS GPU 包月套餐的价格和折扣会不会影响毛利？哪些折扣不能直接给销售承诺？",
    expectedIntent: "cloud.gmv.target_briefing",
    expectedTool: "tool.cloud_gmv_target_briefing",
    mustInclude: ["毛利", "折扣", "财务"]
  },
  {
    name: "SRE / 容量限售",
    user_id: "cloud_pm_001",
    message: "华东 1 和新加坡的 GPU 容量能支撑首批客户吗？如果容量不足，发布和销售应该怎么限制？",
    expectedIntent: "cloud.capacity.risk_review",
    expectedTool: "tool.cloud_capacity_risk_review",
    mustInclude: ["华东 1", "新加坡", "容量预约"]
  },
  {
    name: "GTM / 销售包",
    user_id: "cloud_sales_001",
    message: "帮我生成 ECS GPU 训练实例的 GTM 包：目标客户、卖点、FAQ、销售话术、不能承诺的边界。",
    expectedIntent: "cloud.gtm.package_draft",
    expectedTool: "tool.cloud_gtm_package_draft",
    mustInclude: ["GTM", "不可承诺", "正式报价"]
  },
  {
    name: "云销售 / 金融方案",
    user_id: "cloud_sales_001",
    message: "金融客户预算 30 万，优先稳定性和可审计，ECS GPU、RDS、TOS、CLB 应该怎么组合？正式报价前要确认什么？",
    expectedIntent: "cloud.solution.recommendation",
    expectedTool: "tool.cloud_solution_recommendation",
    mustInclude: ["ECS", "RDS", "TOS", "CLB", "报价边界"]
  },
  {
    name: "客户自助 / ECS 询价",
    user_id: "cloud_customer_001",
    message: "我想买 ECS GPU 训练实例，预算 10 万，华东 1 包月，大概能买什么规格？价格是不是正式报价？",
    expectedIntent: "cloud.solution.recommendation",
    expectedTool: "tool.cloud_solution_recommendation",
    mustInclude: ["预算", "正式报价", "不是"]
  },
  {
    name: "老板 / GMV 驾驶舱",
    user_id: "cloud_exec_001",
    message: "ECS GPU 商品本月 GMV 目标完成得怎么样？毛利、交付、容量和客户风险分别谁负责？",
    expectedIntent: "cloud.gmv.target_briefing",
    expectedTool: "tool.cloud_gmv_target_briefing",
    mustInclude: ["GMV", "目标", "毛利", "负责人"]
  },
  {
    name: "运维事件 / 经营影响",
    user_id: "cloud_exec_001",
    message: "如果新加坡 GPU 容量不足导致交付延期，影响哪些订单、GMV 和客户？给我回滚和客户沟通方案。",
    expectedIntent: "cloud.ops.incident_impact",
    expectedTool: "tool.cloud_ops_incident_business_impact",
    mustInclude: ["延期", "GMV", "客户", "回滚"]
  },
  {
    name: "复盘 / 上架模板",
    user_id: "cloud_pm_001",
    message: "把 ECS GPU 从立项到上架、销售、交付、经营达成的阻塞复盘成下一次商品上架模板。",
    expectedIntentPrefix: "cloud.",
    mustInclude: ["ECS", "上架", "下一步"]
  }
];

const leakPatterns = [
  /owner_user_id/i,
  /owner_team/i,
  /source_type/i,
  /severity=high/i,
  /delay_hours>0/i,
  /arr_at_risk_cny/i,
  /cloud_(ipd_checkpoints|gtm_assets|capacity_pools|sales_opportunities|sla_incidents|risk_signals|workflow_tasks|operating_metrics)/i
];

const unsupportedPattern = /不支持的组件|Unsupported component/i;

let failures = 0;

console.log(`Cloud ECS demo verification: ${baseUrl}`);

for (const [index, item] of cases.entries()) {
  const sessionId = `verify_cloud_ecs_${Date.now()}_${index}`;
  try {
    const response = await fetch(`${baseUrl}/api/openui/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: item.user_id,
        message: item.message,
        session_id: sessionId,
        debug: true
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    const json = await response.json();
    const answer = String(json.answer ?? "");
    const visible = JSON.stringify(json);
    const intent = String(json.debug?.route?.intent_code ?? json.debug?.intent_code ?? "");
    const tool = String(json.debug?.tool_calls?.[0]?.name ?? json.toolPlan?.calls?.[0]?.name ?? "");
    const hasOpenUi = /"openui"|"openui_lang"|openui_envelope|a2ui_envelope|Surface/i.test(visible);

    assert(answer.trim(), "没有回答文本");
    if (item.expectedIntent) assert(intent === item.expectedIntent, `路由应为 ${item.expectedIntent}，实际 ${intent}`);
    if (item.expectedIntentPrefix) assert(intent.startsWith(item.expectedIntentPrefix), `路由应以 ${item.expectedIntentPrefix} 开头，实际 ${intent}`);
    if (item.expectedTool) assert(tool === item.expectedTool, `工具应为 ${item.expectedTool}，实际 ${tool}`);
    for (const token of item.mustInclude) assert(answer.includes(token) || visible.includes(token), `缺少关键词：${token}`);
    assert(!unsupportedPattern.test(visible), "出现不支持组件降级");
    for (const pattern of leakPatterns) assert(!pattern.test(answer), `回答泄漏工程字段：${pattern}`);

    console.log(`PASS ${item.name}`);
    console.log(`     intent=${intent} tool=${tool || "(none)"} openui=${hasOpenUi ? "yes" : "text"}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${item.name}`);
    console.log(`     ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures) {
  console.error(`\n${failures} case(s) failed.`);
  process.exit(1);
}

console.log("\nAll ECS demo checks passed.");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
