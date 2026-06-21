process.env.WECOM_MODE ??= "mock";
process.env.CLOUD_AGENTIC_DETERMINISTIC_SHORTCUT ??= "1";

const { createApp } = await import("../app.js");
import type { JsonObject, Route, UserContext } from "../types/agent-contracts.js";

const app = createApp();
await app.init();

const failures: Array<{ name: string; message: string }> = [];

const cloudExec: UserContext = {
  id: "cloud_exec_001",
  name: "沈澜",
  role: "cloud_executive",
  department: "云业务管理层",
  permissions: ["cloud:read", "cloud:estimate", "cloud:risk", "cloud:draft", "policy:read", "org:read"],
  accessible_customer_ids: ["cust_ai_studio", "cust_media_stream", "cust_enterprise_ops", "cust_finance_core"],
};

const cloudPm: UserContext = {
  id: "cloud_pm_001",
  name: "程一川",
  role: "cloud_pm",
  department: "云商品平台",
  permissions: ["cloud:read", "cloud:estimate", "cloud:draft", "cloud:risk", "cloud:admin", "policy:read", "org:read"],
  accessible_customer_ids: ["cust_ai_studio", "cust_media_stream", "cust_enterprise_ops", "cust_finance_core"],
};

const cloudSales: UserContext = {
  id: "cloud_sales_001",
  name: "陆衡",
  role: "cloud_sales",
  department: "云解决方案销售",
  permissions: ["cloud:read", "cloud:estimate", "cloud:draft", "cloud:risk", "policy:read", "org:read"],
  accessible_customer_ids: ["cust_ai_studio", "cust_media_stream"],
};

const cloudCustomer: UserContext = {
  id: "cloud_customer_001",
  name: "自助客户",
  role: "cloud_customer",
  department: "客户自助服务",
  permissions: ["cloud:read", "cloud:estimate", "policy:read"],
  accessible_customer_ids: ["cust_ai_studio"],
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

await gate("云商品风险总览中文化", cloudExec, "cloud_commodity", "当前云商品平台有什么风险，谁卡住流程？", {
  must: ["结论", "风险排序", "负责人", "下一步动作", "证据来源"],
  mustNot: ["severity=high", "delay_hours>0", "cloud_risk_signals", "owner_user_id", "{", "}"],
});

await gate("ECS GPU GMV 目标", cloudExec, "cloud_commodity", "ECS GPU 商品本月 GMV 目标完成得怎么样？毛利、交付、容量和客户风险分别谁负责？", {
  must: ["GMV", "毛利率", "pipeline", "容量", "客户", "负责人"],
});

await gate("金融客户 ECS 组合方案", cloudSales, "cloud_commodity", "金融客户预算 30 万，优先稳定性和可审计，ECS GPU、RDS、TOS、CLB 应该怎么组合？正式报价前要确认什么？", {
  must: ["ECS", "RDS", "TOS", "CLB", "关键假设", "报价边界", "置信度"],
  mustNot: ["建议组合 Seedance + Agent Plan + TOS + CDN"],
});

await gate("客户自助账单友好结果", cloudCustomer, "cloud_commodity", "查询我能看的 2026 年 6 月账单和发票状态。", {
  mustAny: ["账单", "发票", "暂无", "能看的"],
  mustNot: ["permission_denied", "没有权限", "HTTP 402"],
});

await gate("经销商场景拦截云商品", dealerUser, "dealer", "ECS GPU 商品本月 GMV 目标完成得怎么样？", {
  must: ["属于云商品场景", "当前处于经销商场景", "切换场景"],
  mustNot: ["GMV 目标", "经营指标"],
});

await gate("Seedance 估算完整口径", cloudCustomer, "cloud_commodity", "10000 元预算能生成多少秒视频？", {
  must: ["计算公式", "关键假设", "报价边界", "置信度", "不是正式报价"],
});

await gate("Seedance 价格互斥", cloudPm, "cloud_commodity", "Seedance Mini 自助购买入口上线前，价格、资源包和合同折扣怎么做互斥？", {
  must: ["互斥", "毛利", "审批", "折扣"],
});

await gate("Seedance 大促队列", cloudPm, "cloud_commodity", "Seedance Mini 大促生成队列健康度不够，应该怎么限流、告警和通知销售？", {
  must: ["限流", "告警", "SRE", "销售通知"],
});

await gate("Agent Plan 毛利", cloudPm, "cloud_commodity", "Agent Plan 高成本模型、联网搜索和视频生成会不会把毛利打穿？", {
  must: ["高成本模型", "联网搜索", "视频生成", "毛利"],
  mustNot: ["HTTP 402"],
});

await gate("Agent Plan 超额付费", cloudCustomer, "cloud_commodity", "Agent Plan 套餐额度用完后会自动扣费吗？我要怎么确认超额付费？", {
  must: ["不会自动扣费", "二次确认", "客户管理员"],
});

await gate("续约风险", cloudSales, "cloud_commodity", "哪些重点云客户续约有风险，影响金额是多少？", {
  must: ["续约风险", "金额", "续约概率", "负责人", "下一步"],
});

await gate("Seedance 事故降级", cloudPm, "cloud_commodity", "Seedance Mini 上线后如果生成失败率升高，商品页和销售话术应该怎么降级？", {
  must: ["商品页降级", "销售话术", "客服通知", "SRE 告警", "回滚检查点"],
});

await gate("发布审批摘要", cloudPm, "cloud_commodity", "生成 Seedance Mini 自助购买发布审批摘要，包含风险、人审、回滚和客服通知。", {
  must: ["审批摘要", "人审", "回滚检查点", "客服通知", "只生成草稿"],
  mustNot: ["release_request_id", "owner_user_id", "{", "}"],
});

await gate("上线复盘模板", cloudExec, "cloud_commodity", "把 Seedance Mini 从上架、销售、交付、经营风险复盘成下一次商品上架模板。", {
  must: ["复盘", "商品上架检查模板", "客户成功检查模板", "可复用 checkpoint"],
  mustNot: ["购买页字段", "字段清单"],
});

await gate("新模型商品建模", cloudPm, "cloud_commodity", "我想上一个新的商品，名字叫ABC，是一款模型产品，规格是按token计费，会员的话每天登陆送50RMB等值token。", {
  must: ["ABC", "云商品建模草稿", "Token", "会员每日", "50", "待补齐", "草稿"],
  mustNot: ["HTTP 402", "product_not_found", "没有找到可建模产品"],
});

if (failures.length) {
  console.error(`cloud-browser-badcase-gates: ${failures.length} failure(s)`);
  for (const failure of failures) console.error(`- ${failure.name}: ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log("cloud-browser-badcase-gates: OK");
}

async function gate(
  name: string,
  user: UserContext,
  selectedDomain: string,
  message: string,
  expectations: { must?: string[]; mustAny?: string[]; mustNot?: string[] },
): Promise<void> {
  try {
    const answer = await ask(user, selectedDomain, message);
    for (const needle of expectations.must ?? []) {
      if (!answer.includes(needle)) throw new Error(`missing ${needle}: ${answer}`);
    }
    if (expectations.mustAny?.length && !expectations.mustAny.some((needle) => answer.includes(needle))) {
      throw new Error(`missing any of ${expectations.mustAny.join(", ")}: ${answer}`);
    }
    for (const needle of expectations.mustNot ?? []) {
      if (answer.includes(needle)) throw new Error(`leaked ${needle}: ${answer}`);
    }
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, message: error instanceof Error ? error.message : String(error) });
    console.log(`FAIL ${name}`);
  }
}

async function ask(user: UserContext, selectedDomain: string, message: string): Promise<string> {
  const route = await app.intentRouter.route({ message, user_context: user, selected_domain: selectedDomain });
  if (route.intent_code === "general" && (route.params as JsonObject | undefined)?.domain_mismatch === true) {
    const result = await app.agenticHandler.execute({ user, message, route, selectedDomain });
    return String(result.answer ?? "");
  }
  if (route.handler_type === "agentic" || route.intent_code === "general") {
    const result = await app.agenticHandler.execute({ user, message, route, selectedDomain });
    return String(result.answer ?? "");
  }
  const result = await app.intentQueryHandler.execute({
    user,
    message,
    intent_code: route.intent_code,
    params: route.params ?? {},
    route: route as Route,
    selectedDomain,
  });
  return String(result.answer ?? JSON.stringify(result));
}
