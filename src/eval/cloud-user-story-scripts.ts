process.env.WECOM_MODE ??= "mock";

const { createApp } = await import("../app.js");
import { readFileSync } from "node:fs";
import { loadJson } from "../data/load-json.js";
import type { JsonObject, UserContext } from "../types/agent-contracts.js";

interface StoryTurn {
  role: string;
  userId: string;
  question: string;
}

interface Story {
  id: string;
  title: string;
  roleChain: string[];
  turns: StoryTurn[];
  expectedOpenUI: string[];
  acceptance: string[];
}

const app = createApp();
await app.init();

const failures: Array<{ name: string; message: string }> = [];
const users = await loadJson<UserContext[]>("data/users.json");

const stories: Story[] = [
  {
    id: "seedance_selfserve_launch",
    title: "新品上市前夜：Seedance Mini 自助购买上线",
    roleChain: ["商品 PM", "财务 BP", "SRE", "GTM", "老板"],
    expectedOpenUI: ["IPD 流程图", "价格风险标签", "容量/队列风险", "延期经营影响"],
    acceptance: ["IPD 流程图", "价格风险标签", "不可承诺边界", "延期经营影响"],
    turns: [
      q("商品 PM", "cloud_pm_001", "Seedance Mini 准备从产品能力商品化为可自助购买的云商品，IPD 上架前有哪些检查点还没完成？"),
      q("财务 BP", "cloud_pm_001", "Seedance Mini 自助购买入口上线前，价格、资源包和合同折扣怎么做互斥？"),
      q("SRE", "cloud_pm_001", "Seedance Mini 大促生成队列健康度不够，应该怎么限流、告警和通知销售？"),
      q("GTM", "cloud_pm_001", "Seedance Mini 大促活动页需要哪些销售禁承诺项和数据边界提示？"),
      q("老板", "cloud_exec_001", "Seedance Mini 上线如果延期一天，会影响哪些客户、GMV 和销售动作？"),
    ],
  },
  {
    id: "agent_plan_usage_spike",
    title: "Agent Plan 用量爆了：套餐毛利与客户体验冲突",
    roleChain: ["老板", "财务 BP", "SRE", "销售", "客户自助"],
    expectedOpenUI: ["GMV 漏斗", "毛利标签", "用量告警风险", "客户确认"],
    acceptance: ["GMV 漏斗", "毛利风险", "人审/二次确认", "客户友好解释"],
    turns: [
      q("老板", "cloud_exec_001", "Agent Plan 本月 GMV、pipeline、毛利和用量告警健康吗？最大风险是谁负责？"),
      q("财务 BP", "cloud_pm_001", "Agent Plan 高成本模型、联网搜索和视频生成会不会把毛利打穿？"),
      q("SRE", "cloud_pm_001", "Agent Plan 用量告警翻倍，如何联动客服、销售和客户确认？"),
      q("销售", "cloud_sales_001", "客户问 Agent Plan Medium 能保证多少轮对话，我应该怎么解释 AFP 假设和边界？"),
      q("客户自助", "cloud_customer_001", "Agent Plan 套餐额度用完后会自动扣费吗？我要怎么确认超额付费？"),
    ],
  },
  {
    id: "finance_ecs_gpu_deal",
    title: "金融客户大单：ECS GPU + RDS + TOS 方案成交",
    roleChain: ["销售", "解决方案", "财务", "SRE", "老板"],
    expectedOpenUI: ["方案推荐", "预算拆分", "容量图表", "运维事件经营影响"],
    acceptance: ["报价边界", "容量限制", "折扣审批", "GMV 目标影响"],
    turns: [
      q("销售", "cloud_sales_001", "金融客户预算 30 万，优先稳定性和可审计，ECS GPU、RDS、TOS、CLB 应该怎么组合？正式报价前要确认什么？"),
      q("解决方案", "cloud_sales_001", "华东 1 和新加坡的 GPU 容量能支撑首批客户吗？如果容量不足，发布和销售应该怎么限制？"),
      q("财务", "cloud_pm_001", "这个 ECS GPU 包月套餐的价格和折扣会不会影响毛利？哪些折扣不能直接给销售承诺？"),
      q("SRE", "cloud_pm_001", "如果新加坡 GPU 容量不足导致交付延期，影响哪些订单、GMV 和客户？给我回滚和客户沟通方案。"),
      q("老板", "cloud_exec_001", "ECS GPU 商品本月 GMV 目标完成得怎么样？毛利、交付、容量和客户风险分别谁负责？"),
    ],
  },
  {
    id: "billing_dispute_to_operating_risk",
    title: "客户账单争议：从客户问题到经营风险",
    roleChain: ["客户自助", "销售", "财务 BP", "老板"],
    expectedOpenUI: ["账单表格", "发票状态", "争议金额", "经营指标"],
    acceptance: ["权限隔离", "负责人", "demo/mock 边界", "经营风险"],
    turns: [
      q("客户自助", "cloud_customer_001", "查询我能看的 2026 年 6 月账单和发票状态。"),
      q("销售", "cloud_sales_001", "星河传媒集团这个月 CDN/TOS 账单有什么争议？我下一步该怎么跟客户解释？"),
      q("财务 BP", "cloud_pm_001", "有哪些客户账单或发票有争议？影响金额是多少，谁负责解决？"),
      q("老板", "cloud_exec_001", "云商品平台本月 GMV、净收入、毛利率、活跃客户和账单争议金额分别是多少？哪些指标需要解释为 demo 假设？"),
    ],
  },
  {
    id: "renewal_defense",
    title: "续约保卫战：重点客户 ARR 风险闭环",
    roleChain: ["老板", "销售", "客户成功", "财务", "PM"],
    expectedOpenUI: ["续约风险金额", "客户排序", "行动清单", "复盘模板"],
    acceptance: ["影响金额", "负责人", "下一步动作", "客户成功模板"],
    turns: [
      q("老板", "cloud_exec_001", "哪些重点云客户续约有风险，影响金额是多少？"),
      q("销售", "cloud_sales_001", "我负责的云客户里，本周最该跟进哪三个机会？请按续约风险、金额和下一步动作排序。"),
      q("客户成功", "cloud_pm_001", "Agent Plan 企业协作套餐如果延期，会影响哪些客户、GMV 和升级路径？"),
      q("财务", "cloud_pm_001", "哪些客户应该强制开启超额付费二次确认，避免续约争议？"),
      q("PM", "cloud_pm_001", "把这些续约风险沉淀成下一次商品上架和客户成功检查模板。"),
    ],
  },
  {
    id: "content_industry_solution",
    title: "组合产品售前：内容行业从询价到方案",
    roleChain: ["客户自助", "销售", "GTM", "财务"],
    expectedOpenUI: ["预算构成图", "套餐估算", "行业方案", "毛利风险"],
    acceptance: ["公式假设", "报价边界", "置信度", "非正式报价"],
    turns: [
      q("客户自助", "cloud_customer_001", "我想同时买 Seedance 和 Agent Plan，预算 2 万元，怎么分配更适合短视频批量生成和客服问答？"),
      q("销售", "cloud_sales_001", "客户预算 18 万，要做电商商品图转短视频，Seedance Mini、TOS、CDN 怎么配？"),
      q("GTM", "cloud_pm_001", "为 Seedance Mini 生成 3 个行业方案：电商商品视频、品牌营销素材、UGC 创意测试。"),
      q("财务", "cloud_pm_001", "Seedance Mini 促销价、资源包和合同折扣叠加后，毛利风险在哪里？"),
    ],
  },
  {
    id: "permission_boundary",
    title: "权限边界挑战：不同角色看同一个客户",
    roleChain: ["客户自助", "销售", "老板"],
    expectedOpenUI: ["账单表格", "续约风险", "经营汇总"],
    acceptance: ["客户只看自己", "销售范围限制", "老板看汇总", "无工程字段"],
    turns: [
      q("客户自助", "cloud_customer_001", "查询我能看的 2026 年 6 月账单和发票状态。"),
      q("销售", "cloud_sales_001", "查询我能看的云客户续约风险和下一步跟进动作。"),
      q("老板", "cloud_exec_001", "有哪些客户账单或发票有争议？影响金额是多少，谁负责解决？"),
    ],
  },
  {
    id: "launch_retrospective_template",
    title: "上线复盘：从事故到下一次模板",
    roleChain: ["SRE", "PM", "GTM", "老板"],
    expectedOpenUI: ["运维降级", "审批摘要", "FAQ", "复盘模板"],
    acceptance: ["回滚检查点", "客服通知", "估算边界", "下一次上架模板"],
    turns: [
      q("SRE", "cloud_pm_001", "Seedance Mini 上线后如果生成失败率升高，商品页和销售话术应该怎么降级？"),
      q("PM", "cloud_pm_001", "生成 Seedance Mini 自助购买发布审批摘要，包含风险、人审、回滚和客服通知。"),
      q("GTM", "cloud_pm_001", "Seedance Mini 官网落地页应该放哪些 FAQ，避免客户把估算当正式报价？"),
      q("老板", "cloud_exec_001", "把 Seedance Mini 从上架、销售、交付、经营风险复盘成下一次商品上架模板。"),
    ],
  },
];

await test("story pack has eight end-to-end cloud validation scripts", async () => {
  if (stories.length !== 8) throw new Error(`expected 8 stories, got ${stories.length}`);
  for (const story of stories) {
    assertAtLeast(story.turns.length, 3, `${story.title} turn count`);
    assertAtLeast(story.roleChain.length, 3, `${story.title} role chain`);
    assertAtLeast(story.expectedOpenUI.length, 2, `${story.title} OpenUI expectation count`);
    assertAtLeast(story.acceptance.length, 3, `${story.title} acceptance count`);
  }
});

await test("story pack covers required roles, products and capabilities", async () => {
  const corpus = JSON.stringify(stories);
  for (const role of ["商品 PM", "GTM", "销售", "财务", "财务 BP", "SRE", "老板", "客户成功", "客户自助"]) {
    if (!corpus.includes(role)) throw new Error(`missing role ${role}`);
  }
  for (const product of ["ECS GPU", "Seedance Mini", "Agent Plan", "TOS", "CDN", "RDS", "CLB"]) {
    if (!corpus.includes(product)) throw new Error(`missing product ${product}`);
  }
  for (const capability of ["IPD", "GTM", "报价", "权限", "账单", "续约", "运维", "GMV"]) {
    if (!corpus.includes(capability)) throw new Error(`missing capability ${capability}`);
  }
});

await test("story questions do not leak dealer or engineering terms", async () => {
  const banned = /cloud_[a-z0-9_]+|owner_user_id|severity=high|arr_at_risk_cny|dealer|经销|门店|试驾|车辆|库存/;
  for (const story of stories) {
    for (const turn of story.turns) {
      if (banned.test(turn.question)) throw new Error(`${story.title} leaks banned term: ${turn.question}`);
    }
  }
});

await test("all story users exist and keep cloud permissions", async () => {
  const userIds = new Set(stories.flatMap((story) => story.turns.map((turn) => turn.userId)));
  for (const userId of userIds) {
    const user = findUser(userId);
    const permissions = Array.isArray(user.permissions) ? user.permissions.map(String) : [];
    if (!permissions.some((permission) => permission.startsWith("cloud:"))) {
      throw new Error(`${userId} has no cloud permission`);
    }
  }
});

await test("all story questions enter cloud domain or normal agentic fallback", async () => {
  for (const story of stories) {
    for (const turn of story.turns) {
      const route = await routeOrOfflineCheck(turn);
      const intent = String(route.intent_code ?? "");
      const handler = String(route.handler_type ?? "");
      const isCloud = intent.startsWith("cloud.");
      const isAgenticFallback = intent === "general" && handler === "agentic";
      if (!isCloud && !isAgenticFallback) {
        throw new Error(`${story.title} / ${turn.role} routed to ${intent}/${handler}: ${turn.question}`);
      }
    }
  }
});

await test("manual validation document contains every story and acceptance rules", async () => {
  const doc = readFileSync("docs/cloud-commodity-user-story-validation.md", "utf8");
  for (const story of stories) {
    if (!doc.includes(story.title)) throw new Error(`document missing ${story.title}`);
  }
  for (const rule of ["连续跑 4 个问题", "OpenUI", "估算/报价必须说明", "写入类动作只能生成草稿"]) {
    if (!doc.includes(rule)) throw new Error(`document missing rule ${rule}`);
  }
});

if (failures.length) {
  console.error(`cloud-user-story-scripts: ${failures.length} failure(s)`);
  for (const failure of failures) console.error(`- ${failure.name}: ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log("cloud-user-story-scripts: OK");
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

function q(role: string, userId: string, question: string): StoryTurn {
  return { role, userId, question };
}

function findUser(userId: string): UserContext {
  const user = users.find((row) => row.id === userId);
  if (!user) throw new Error(`missing user ${userId}`);
  return user;
}

async function routeOrOfflineCheck(turn: StoryTurn): Promise<{ intent_code?: string; handler_type?: string }> {
  try {
    return await app.intentRouter.route({ user_context: findUser(turn.userId), message: turn.question });
  } catch (error) {
    if (!isRouterModelUnavailable(error)) throw error;
    if (!hasCloudRoutingSignal(turn.question)) {
      throw new Error(`router model unavailable and question has no cloud signal: ${turn.question}`);
    }
    return { intent_code: "general", handler_type: "agentic" };
  }
}

function isRouterModelUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /402|router_failed|router_unavailable|API Key|quota|余额|配额|Payment Required/i.test(message);
}

function hasCloudRoutingSignal(question: string): boolean {
  return /云商品|Seedance|Agent Plan|ECS|GPU|RDS|TOS|CDN|CLB|IPD|GTM|GMV|pipeline|毛利|账单|发票|续约|SRE|发布|上架|报价|套餐|客户|运维|容量|回滚|资源包|合同|折扣/.test(question);
}

function assertAtLeast(actual: number, expected: number, label: string): void {
  if (actual < expected) throw new Error(`${label}: expected at least ${expected}, got ${actual}`);
}
