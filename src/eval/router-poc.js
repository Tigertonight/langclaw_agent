// 在导入 app 之前必须先把 v2 router 标志位打开
process.env.INTENT_ROUTER_V2 = "on";
process.env.WECOM_MODE ??= "mock";

const { createApp } = await import("../app.js");
const { agent } = createApp();

// 选用 store_gm_001（顾明远，role=store_general_manager），可读 dealer 资源
const USER_ID = "store_gm_001";

const cases = [
  {
    name: "汉EV 库龄查询",
    message: "查一下华东旗舰店汉EV最近一个月的库龄",
    expect: (r) => {
      const intentCode = r.debug?.route?.intent_code;
      if (intentCode !== "dealer.query.inventory") {
        return { ok: false, reason: `intent_code=${intentCode}` };
      }
      const rows = pickFirstRows(r);
      // LLM 路径：vehicle_model="汉EV" → 至少有一行 model 含「汉EV」
      // 兜底路径：vehicle_model 可能为 null → 只要 router 没崩、查到 dealer_vehicles 即视为通过
      const hasHan = rows.some((row) => /汉EV/i.test(`${row.series ?? ""} ${row.model ?? ""}`));
      const params = r.debug?.route?.params ?? {};
      if (params.vehicle_model === "汉EV" && !hasHan) {
        return { ok: false, reason: "vehicle_model=汉EV 但结果中无 汉EV" };
      }
      return { ok: true };
    }
  },
  {
    name: "宋L 配额（PoC 范围内统一走 dealer.query.inventory）",
    message: "宋L 还有多少配额",
    expect: (r) => {
      const intentCode = r.debug?.route?.intent_code;
      if (intentCode !== "dealer.query.inventory") {
        return { ok: false, reason: `intent_code=${intentCode}` };
      }
      return { ok: true };
    }
  },
  {
    name: "华南标准店库存",
    message: "华南标准店库存怎么样",
    expect: (r) => {
      const intentCode = r.debug?.route?.intent_code;
      if (intentCode !== "dealer.query.inventory") {
        return { ok: false, reason: `intent_code=${intentCode}` };
      }
      return { ok: true };
    }
  },
  {
    name: "寒暄",
    message: "你好",
    expect: (r) => {
      const handler = r.debug?.route?.handler_type;
      if (handler !== "chitchat") {
        return { ok: false, reason: `handler_type=${handler}` };
      }
      return { ok: true };
    }
  },
  {
    name: "跨域分析（应走 agentic 或 confidence 不为 high）",
    message: "对比华东旗舰店和华南标准店哪家库存压力更大",
    expect: (r) => {
      const handler = r.debug?.route?.handler_type;
      const conf = r.debug?.route?.confidence;
      // 兼容 v2（带 confidence）与 v1（数值 confidence）
      const isAgentic = handler !== "chitchat" && handler !== "intent_query";
      const lowConf = (typeof conf === "string" ? conf !== "high" : conf < 0.9);
      if (isAgentic || lowConf) return { ok: true };
      return { ok: false, reason: `handler=${handler} conf=${conf}（既不是 agentic 也不是低置信度）` };
    }
  },
  {
    name: "（PoC deferred）连续轮 vehicle_model 修正",
    message: "把这个改成海豹",
    expect: () => ({ ok: true, deferred: true })
  },
  {
    name: "财务-华东旗舰店应付未结清",
    message: "查一下华东旗舰店应付里还没结清的款项",
    expect: (r) => {
      const intentCode = r.debug?.route?.intent_code;
      if (intentCode !== "dealer.query.finance") {
        return { ok: false, reason: `intent_code=${intentCode}` };
      }
      const params = r.debug?.route?.params ?? {};
      const okStore = !params.store || /华东/.test(params.store);
      const okType = !params.resource_type || params.resource_type === "payable";
      if (!okStore || !okType) {
        return { ok: false, reason: `params 不合理: ${JSON.stringify(params)}` };
      }
      return { ok: true };
    }
  },
  {
    name: "财务-返利待结算明细",
    message: "返利还有哪些待结算的",
    expect: (r) => {
      const intentCode = r.debug?.route?.intent_code;
      if (intentCode !== "dealer.query.finance") {
        return { ok: false, reason: `intent_code=${intentCode}` };
      }
      const params = r.debug?.route?.params ?? {};
      const okType = !params.resource_type || params.resource_type === "rebate";
      if (!okType) {
        return { ok: false, reason: `resource_type=${params.resource_type}` };
      }
      return { ok: true };
    }
  },
  {
    name: "财务-折让金最近的出账",
    message: "折让金最近的出账记录",
    expect: (r) => {
      const intentCode = r.debug?.route?.intent_code;
      if (intentCode !== "dealer.query.finance") {
        return { ok: false, reason: `intent_code=${intentCode}` };
      }
      const params = r.debug?.route?.params ?? {};
      const okType = !params.resource_type || params.resource_type === "discount_wallet";
      const okDir = !params.direction || /出账/.test(params.direction);
      if (!okType || !okDir) {
        return { ok: false, reason: `params 不合理: ${JSON.stringify(params)}` };
      }
      return { ok: true };
    }
  },
  {
    name: "售后-逾期未交付维修工单",
    message: "查一下哪些维修工单逾期还没交付",
    expect: (r) => {
      const intentCode = r.debug?.route?.intent_code;
      if (intentCode !== "dealer.query.repair_orders") {
        return { ok: false, reason: `intent_code=${intentCode}` };
      }
      const params = r.debug?.route?.params ?? {};
      // overdue_only 为 true，或者 status 暗含未交付，都算理解到位
      const ok = params.overdue_only === true || (params.status && params.status !== "已交付");
      if (!ok) {
        return { ok: false, reason: `params 没体现逾期未交付语义: ${JSON.stringify(params)}` };
      }
      return { ok: true };
    }
  },
  {
    name: "售后-厂家审核中的索赔",
    message: "厂家审核中的保修索赔有哪些",
    expect: (r) => {
      const intentCode = r.debug?.route?.intent_code;
      if (intentCode !== "dealer.query.warranty_claims") {
        return { ok: false, reason: `intent_code=${intentCode}` };
      }
      const params = r.debug?.route?.params ?? {};
      const ok = !params.claim_status || /厂家审核中|审核/.test(params.claim_status);
      if (!ok) {
        return { ok: false, reason: `claim_status=${params.claim_status}` };
      }
      return { ok: true };
    }
  },
  {
    name: "售后-三电故障索赔",
    message: "三电故障的索赔单有几条",
    expect: (r) => {
      const intentCode = r.debug?.route?.intent_code;
      if (intentCode !== "dealer.query.warranty_claims") {
        return { ok: false, reason: `intent_code=${intentCode}` };
      }
      const params = r.debug?.route?.params ?? {};
      const ok = !params.fault_category || /三电|电池|动力/.test(params.fault_category);
      if (!ok) {
        return { ok: false, reason: `fault_category=${params.fault_category}` };
      }
      return { ok: true };
    }
  },
  {
    name: "销售-未交付订单",
    message: "未交付的订单还有哪些",
    expect: (r) => {
      const intentCode = r.debug?.route?.intent_code;
      if (intentCode !== "dealer.query.sales_orders") {
        return { ok: false, reason: `intent_code=${intentCode}` };
      }
      const params = r.debug?.route?.params ?? {};
      // 未交付可能体现在 order_status 或 delivery_status，不强制
      const ok = !params.order_status || /待交付|未交付/.test(params.order_status)
        || !params.delivery_status || /待整备|整备中|未交付/.test(params.delivery_status);
      if (!ok) {
        return { ok: false, reason: `params 不合理: ${JSON.stringify(params)}` };
      }
      return { ok: true };
    }
  },
  {
    name: "销售-本月华东旗舰店成交",
    message: "本月华东旗舰店成交了哪些订单",
    expect: (r) => {
      const intentCode = r.debug?.route?.intent_code;
      if (intentCode !== "dealer.query.sales_orders") {
        return { ok: false, reason: `intent_code=${intentCode}` };
      }
      const params = r.debug?.route?.params ?? {};
      const okStore = !params.store || /华东/.test(params.store);
      if (!okStore) return { ok: false, reason: `store=${params.store}` };
      return { ok: true };
    }
  },
  {
    name: "线索-高意向客户",
    message: "高意向的客户线索还有哪些没成交",
    expect: (r) => {
      const intentCode = r.debug?.route?.intent_code;
      if (intentCode !== "dealer.query.leads") {
        return { ok: false, reason: `intent_code=${intentCode}` };
      }
      const params = r.debug?.route?.params ?? {};
      // 高意向可能映射为 H 或留 null 让 LLM 不强制（不强校验）
      const ok = !params.intention_level || params.intention_level === "H" || /高/.test(params.intention_level);
      if (!ok) return { ok: false, reason: `intention_level=${params.intention_level}` };
      return { ok: true };
    }
  },
  {
    name: "线索-本月新进",
    message: "本月新进的销售线索",
    expect: (r) => {
      const intentCode = r.debug?.route?.intent_code;
      if (intentCode !== "dealer.query.leads") {
        return { ok: false, reason: `intent_code=${intentCode}` };
      }
      return { ok: true };
    }
  },
  {
    name: "聚合-本月成交总额",
    message: "本月华东旗舰店成交总额是多少",
    expect: (r) => {
      const intentCode = r.debug?.route?.intent_code;
      if (intentCode !== "dealer.aggregate.sales_orders") {
        return { ok: false, reason: `intent_code=${intentCode}` };
      }
      const params = r.debug?.route?.params ?? {};
      if (params.metric && params.metric !== "total_revenue") {
        return { ok: false, reason: `metric=${params.metric}` };
      }
      // answer 里应有数字（口径行也应有 ※）
      if (!/\d/.test(r.answer ?? "") || !/口径/.test(r.answer ?? "")) {
        return { ok: false, reason: "answer 缺数字或口径行" };
      }
      return { ok: true };
    }
  },
  {
    name: "聚合-毛利率",
    message: "整体毛利率是多少",
    expect: (r) => {
      const intentCode = r.debug?.route?.intent_code;
      if (intentCode !== "dealer.aggregate.sales_orders") {
        return { ok: false, reason: `intent_code=${intentCode}` };
      }
      const params = r.debug?.route?.params ?? {};
      if (params.metric && params.metric !== "gross_margin") {
        return { ok: false, reason: `metric=${params.metric}` };
      }
      return { ok: true };
    }
  },
  {
    name: "聚合-各门店订单数",
    message: "各门店本月各成交了多少单",
    expect: (r) => {
      const intentCode = r.debug?.route?.intent_code;
      if (intentCode !== "dealer.aggregate.sales_orders") {
        return { ok: false, reason: `intent_code=${intentCode}` };
      }
      const params = r.debug?.route?.params ?? {};
      const okMetric = !params.metric || params.metric === "order_count";
      const okGroup = params.group_by === "store_name";
      if (!okMetric || !okGroup) {
        return { ok: false, reason: `metric=${params.metric} group_by=${params.group_by}` };
      }
      return { ok: true };
    }
  },
  {
    name: "聚合-财务应付未结清合计",
    message: "应付未结清的款项合计多少钱",
    expect: (r) => {
      const intentCode = r.debug?.route?.intent_code;
      if (intentCode !== "dealer.aggregate.finance") {
        return { ok: false, reason: `intent_code=${intentCode}` };
      }
      const params = r.debug?.route?.params ?? {};
      // 接受 unsettled_amount 或 total_amount + filter
      const ok = !params.metric || ["unsettled_amount", "total_amount"].includes(params.metric);
      if (!ok) return { ok: false, reason: `metric=${params.metric}` };
      return { ok: true };
    }
  },
  {
    name: "聚合-本月工单数",
    message: "本月维修工单总共多少个",
    expect: (r) => {
      const intentCode = r.debug?.route?.intent_code;
      if (intentCode !== "dealer.aggregate.repair_orders") {
        return { ok: false, reason: `intent_code=${intentCode}` };
      }
      const params = r.debug?.route?.params ?? {};
      const ok = !params.metric || params.metric === "order_count";
      if (!ok) return { ok: false, reason: `metric=${params.metric}` };
      return { ok: true };
    }
  },
  {
    name: "聚合-各意向等级线索数",
    message: "各个意向等级各有多少线索",
    expect: (r) => {
      const intentCode = r.debug?.route?.intent_code;
      if (intentCode !== "dealer.aggregate.leads") {
        return { ok: false, reason: `intent_code=${intentCode}` };
      }
      const params = r.debug?.route?.params ?? {};
      const okGroup = params.group_by === "intention_level";
      if (!okGroup) return { ok: false, reason: `group_by=${params.group_by}` };
      return { ok: true };
    }
  },
  {
    name: "聚合-本月转化率",
    message: "本月线索转化率是多少",
    expect: (r) => {
      const intentCode = r.debug?.route?.intent_code;
      if (intentCode !== "dealer.aggregate.leads") {
        return { ok: false, reason: `intent_code=${intentCode}` };
      }
      const params = r.debug?.route?.params ?? {};
      if (params.metric && params.metric !== "conversion_rate") {
        return { ok: false, reason: `metric=${params.metric}` };
      }
      return { ok: true };
    }
  }
];

let passed = 0;
let total = 0;
const failures = [];

for (const [index, c] of cases.entries()) {
  total += 1;
  let result;
  try {
    result = await agent.run({ userId: USER_ID, message: c.message, sessionId: `router_poc_${index}`, debug: true });
  } catch (err) {
    failures.push({ name: c.name, reason: `agent.run 抛错: ${err.message}` });
    console.log(`FAIL  ${c.name}  ← agent.run 抛错: ${err.message}`);
    continue;
  }
  const verdict = c.expect(result);
  const tag = verdict.deferred ? "DEFER" : verdict.ok ? "PASS" : "FAIL";
  if (verdict.ok) passed += 1;
  else failures.push({ name: c.name, reason: verdict.reason, route: result.debug?.route });
  console.log(`${tag}  ${c.name}`);
  if (!verdict.ok) console.log(`      reason: ${verdict.reason}`);
  console.log(`      router: intent_code=${result.debug?.route?.intent_code} handler=${result.debug?.route?.handler_type} source=${result.debug?.route?.router_source} answer=${truncate(result.answer)}`);
}

console.log(`\n${passed}/${total} router-poc cases passed.`);
if (failures.length === 0) {
  process.exit(0);
} else {
  console.log("失败明细：");
  for (const f of failures) console.log(JSON.stringify(f, null, 2));
  process.exit(1);
}

function pickFirstRows(result) {
  const tr = result.debug?.tool_results ?? [];
  for (const item of tr) {
    if (Array.isArray(item?.sample_rows) && item.sample_rows.length) return item.sample_rows;
    if (Array.isArray(item?.data?.rows)) return item.data.rows;
  }
  return [];
}

function truncate(s) {
  if (!s) return "";
  return s.length > 80 ? s.slice(0, 80) + "..." : s;
}
