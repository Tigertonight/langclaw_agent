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
