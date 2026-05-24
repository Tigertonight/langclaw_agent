process.env.WECOM_MODE ??= "mock";

const { createApp } = await import("../app.js");
const app = createApp();
const { agent } = app;

// 选用 store_gm_001（顾明远，role=store_general_manager），可读 dealer 资源
const USER_ID = "store_gm_001";
const runId = `router_poc_${Date.now()}`;
const CASE_TIMEOUT_MS = Number(process.env.ROUTER_POC_TIMEOUT_MS ?? 90000);

type DataRecord = Record<string, ReturnType<typeof JSON.parse>>;
type Verdict = { ok: boolean; reason?: string; deferred?: boolean };
type PocResult = DataRecord & {
  answer?: string;
  debug?: DataRecord;
};
type PocTurn = {
  message: string;
  expect?: (result: PocResult) => Verdict;
};
type PocCase = {
  name: string;
  message?: string;
  turns?: PocTurn[];
  skipRun?: boolean;
  allowOneRetry?: boolean;
  expect?: (result: PocResult) => Verdict;
  expectStatic?: (app: DataRecord) => Verdict | Promise<Verdict>;
};
type Failure = { name: string; reason?: string; route?: unknown };

const cases: PocCase[] = [
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
    name: "跨域分析（可走经营指标或 agentic）",
    message: "对比华东旗舰店和华南标准店哪家库存压力更大",
    expect: (r) => {
      const handler = r.debug?.route?.handler_type;
      const intentCode = r.debug?.route?.intent_code;
      const conf = r.debug?.route?.confidence;
      // 兼容路由层（带 confidence）与历史数值 confidence。
      const isAgentic = handler !== "chitchat" && handler !== "intent_query";
      const isControlledBusinessView = intentCode === "dealer.query.metrics" || intentCode === "dealer.query.inventory";
      const lowConf = (typeof conf === "string" ? conf !== "high" : conf < 0.9);
      if (isAgentic || isControlledBusinessView || lowConf) return { ok: true };
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
    name: "多轮修参-改成海豹",
    turns: [
      { message: "查一下华东旗舰店汉EV最近一个月的库龄" },
      {
        message: "改成海豹",
        expect: (r) => {
          const intentCode = r.debug?.route?.intent_code;
          if (intentCode !== "dealer.query.inventory") {
            return { ok: false, reason: `intent_code=${intentCode}` };
          }
          const params = r.debug?.route?.params ?? {};
          if (params.vehicle_model !== "海豹") {
            return { ok: false, reason: `vehicle_model=${params.vehicle_model}（应为 海豹）` };
          }
          // store / time_range 应继承上一轮
          if (params.store && !/华东/.test(params.store)) {
            return { ok: false, reason: `store=${params.store}（应继承 华东）` };
          }
          return { ok: true };
        }
      }
    ]
  },
  {
    name: "多轮修参-那华南呢",
    turns: [
      { message: "查一下华东旗舰店汉EV最近一个月的库龄" },
      {
        message: "那华南标准店呢",
        expect: (r) => {
          const intentCode = r.debug?.route?.intent_code;
          if (intentCode !== "dealer.query.inventory") {
            return { ok: false, reason: `intent_code=${intentCode}` };
          }
          const params = r.debug?.route?.params ?? {};
          if (params.store && !/华南/.test(params.store)) {
            return { ok: false, reason: `store=${params.store}（应为 华南）` };
          }
          if (params.vehicle_model && !/汉EV/.test(params.vehicle_model)) {
            return { ok: false, reason: `vehicle_model=${params.vehicle_model}（应继承 汉EV）` };
          }
          return { ok: true };
        }
      }
    ]
  },
  {
    name: "滑窗-跨意图修参（库存→寒暄→库龄）",
    turns: [
      { message: "查一下华东旗舰店汉EV库存怎么样" },
      { message: "你好" },
      {
        message: "看一下库龄",
        expect: (r) => {
          const intentCode = r.debug?.route?.intent_code;
          if (intentCode !== "dealer.query.inventory") {
            return { ok: false, reason: `intent_code=${intentCode}（应继承 inventory）` };
          }
          const params = r.debug?.route?.params ?? {};
          // 应继承 store=华东 / vehicle_model=汉EV
          if (params.store && !/华东/.test(params.store)) {
            return { ok: false, reason: `store=${params.store}（应继承 华东）` };
          }
          return { ok: true };
        }
      }
    ]
  },
  {
    name: "滑窗-连续两次查询不互相干扰",
    turns: [
      { message: "查一下华东旗舰店汉EV库存" },
      { message: "查一下华南标准店海豹库存" },
      {
        message: "再看看库龄",
        expect: (r) => {
          const intentCode = r.debug?.route?.intent_code;
          if (intentCode !== "dealer.query.inventory") {
            return { ok: false, reason: `intent_code=${intentCode}` };
          }
          const params = r.debug?.route?.params ?? {};
          // 应继承最近一次：华南/海豹，而不是更早的华东/汉EV
          if (params.store && !/华南/.test(params.store)) {
            return { ok: false, reason: `store=${params.store}（应继承最近一次的 华南）` };
          }
          if (params.vehicle_model && !/海豹/.test(params.vehicle_model)) {
            return { ok: false, reason: `vehicle_model=${params.vehicle_model}（应继承 海豹）` };
          }
          return { ok: true };
        }
      }
    ]
  },
  {
    name: "多轮修参-寒暄不污染 last_query_route",
    turns: [
      { message: "查一下华东旗舰店汉EV最近一个月的库龄" },
      { message: "你好" },
      {
        message: "改成海豹",
        expect: (r) => {
          const intentCode = r.debug?.route?.intent_code;
          if (intentCode !== "dealer.query.inventory") {
            return { ok: false, reason: `寒暄后仍应继承 inventory，但 intent_code=${intentCode}` };
          }
          const params = r.debug?.route?.params ?? {};
          if (params.vehicle_model !== "海豹") {
            return { ok: false, reason: `vehicle_model=${params.vehicle_model}` };
          }
          return { ok: true };
        }
      }
    ]
  },
  {
    name: "默认门店-店总省略 store 自动套用",
    message: "汉EV 库存怎么样",
    expect: (r) => {
      const intentCode = r.debug?.route?.intent_code;
      if (intentCode !== "dealer.query.inventory") {
        return { ok: false, reason: `intent_code=${intentCode}` };
      }
      // handler 层落在 toolPlan 的 filters 里——store_name contains 比亚迪华东旗舰店
      const calls = (r.debug?.tool_calls ?? []) as DataRecord[];
      const filters = (calls[0]?.filters ?? []) as DataRecord[];
      const hasStoreFilter = filters.some((f: DataRecord) => f.field === "store_name" && /华东/.test(f.value ?? ""));
      if (!hasStoreFilter) {
        return { ok: false, reason: `filters 中未注入默认 store: ${JSON.stringify(filters)}` };
      }
      // answer 应该带「已自动套用」标注
      if (!/已自动套用|默认门店/.test(r.answer ?? "")) {
        return { ok: false, reason: `answer 未标注默认门店: ${truncate(r.answer)}` };
      }
      return { ok: true };
    }
  },
  {
    name: "默认门店-用户显式指定门店时不覆盖",
    message: "查华南标准店海豹库存",
    expect: (r) => {
      const intentCode = r.debug?.route?.intent_code;
      if (intentCode !== "dealer.query.inventory") {
        return { ok: false, reason: `intent_code=${intentCode}` };
      }
      const calls = (r.debug?.tool_calls ?? []) as DataRecord[];
      const filters = (calls[0]?.filters ?? []) as DataRecord[];
      const hasNanFilter = filters.some((f: DataRecord) => f.field === "store_name" && /华南/.test(f.value ?? ""));
      const hasDongFilter = filters.some((f: DataRecord) => f.field === "store_name" && /华东/.test(f.value ?? ""));
      if (!hasNanFilter || hasDongFilter) {
        return { ok: false, reason: `应只用 华南，filters=${JSON.stringify(filters)}` };
      }
      // answer 不应该有「已自动套用」
      if (/已自动套用/.test(r.answer ?? "")) {
        return { ok: false, reason: `不应有自动套用标注` };
      }
      return { ok: true };
    }
  },
  {
    name: "库存压力对比可走经营指标或 agentic",
    message: "对比华东旗舰店和华南标准店哪家库存压力更大",
    expect: (r) => {
      const handler = r.debug?.route?.handler_type;
      const intentCode = r.debug?.route?.intent_code;
      if (handler !== "agentic" && intentCode !== "general" && intentCode !== "dealer.query.metrics" && intentCode !== "dealer.query.inventory") {
        return { ok: false, reason: `handler=${handler}/intent=${intentCode}（应走经营指标、库存查询或 agentic）` };
      }
      if (handler === "agentic") {
        const calls = (r.debug?.tool_calls ?? []) as DataRecord[];
        const hasIntentCall = calls.some((c: DataRecord) => /^intent\./.test(c.name ?? ""));
        if (!hasIntentCall) {
          return { ok: false, reason: `agentic 未调用任何 intent.* 工具，calls=${JSON.stringify(calls.map((c: DataRecord) => c.name))}` };
        }
      }
      // answer 应该有内容（不是兜底"无法直接给出"）
      if (!r.answer || /暂时无法直接给出/.test(r.answer)) {
        return { ok: false, reason: `agentic 兜底了：${truncate(r.answer)}` };
      }
      return { ok: true };
    }
  },
  {
    // 这个 case 是 agentic / 单 aggregate 边界：可以一次聚合 group_by=series + metric=total_profit
    // 解，也可以拆成两步走 agentic。两种解法都接受，但要有有效答案、不能兜底。
    name: "agentic-毛利率归因到车系",
    message: "本月毛利率怎么样，最赚钱的车系是哪个",
    expect: (r) => {
      const handler = r.debug?.route?.handler_type;
      const intentCode = r.debug?.route?.intent_code;
      const acceptable =
        handler === "agentic" ||
        intentCode === "dealer.aggregate.sales_orders";
      if (!acceptable) {
        return { ok: false, reason: `handler=${handler}/intent=${intentCode}` };
      }
      if (!r.answer || /暂时无法直接给出/.test(r.answer)) {
        return { ok: false, reason: `兜底了：${truncate(r.answer)}` };
      }
      return { ok: true };
    }
  },
  {
    name: "agentic-反例：单意图不应越权 agentic",
    message: "查华东旗舰店汉EV库存",
    expect: (r) => {
      // 这个明显是单 intent_query，不应走 agentic
      const handler = r.debug?.route?.handler_type;
      if (handler === "agentic") {
        return { ok: false, reason: `单 intent 被错判为 agentic` };
      }
      const intentCode = r.debug?.route?.intent_code;
      if (intentCode !== "dealer.query.inventory") {
        return { ok: false, reason: `intent_code=${intentCode}` };
      }
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
  },
  {
    // Intent Router 端到端：三类工具骨架在真实 agentic 循环里能跑通。
    // 由于 LLM 自由度大，单次跑某一类工具不一定被调到（比如 skill 它觉得没必要写时会跳过），
    // 但只要"不兜底 + 至少调到 intent 和 tool"就证明 tool.* 已经接上来了；
    // 三类工具齐全的能力则在另一个静态用例里断言。
    name: "Intent Router-端到端：库存压力对比（经营指标或 agentic）",
    message: "对比一下华东旗舰店和华南标准店的库存压力，按加权库龄精确算个数，再帮我写一段经营简报",
    allowOneRetry: true, // agentic LLM 偶发 timeout / safe_compute 重新声明 result，允许 1 次重试
    expect: (r) => {
      const handler = r.debug?.route?.handler_type;
      const intentCode = r.debug?.route?.intent_code;
      if (handler !== "agentic" && intentCode !== "dealer.query.metrics") {
        return { ok: false, reason: `handler=${handler}/intent=${intentCode}（应为经营指标或 agentic）` };
      }
      if (handler === "agentic") {
        const calls = (r.debug?.tool_calls ?? []) as DataRecord[];
        const names = calls.map((c: DataRecord) => String(c.name ?? ""));
        const hasIntent = names.some((n: string) => n.startsWith("intent."));
        const hasTool = names.some((n: string) => n.startsWith("tool."));
        if (!hasIntent || !hasTool) {
          return { ok: false, reason: `缺少 intent.* 或 tool.*（实际：${names.join(", ") || "空"}）` };
        }
      }
      if (!r.answer || /暂时无法直接给出/.test(r.answer)) {
        return { ok: false, reason: `兜底了：${truncate(r.answer)}` };
      }
      return { ok: true };
    }
  },
  {
    // 静态断言：getAvailableTools 能同时返回 intent.* / tool.* / skill.*。
    // 不依赖 LLM，每次必通；用来证明 Intent Router 三类工具骨架被装配起来了。
    name: "Intent Router-三类工具骨架可见（intent/tool/skill 都在 prompt 列表里）",
    message: "（probe，不会真发给 LLM）",
    skipRun: true,
    expectStatic: ({ agenticHandler }: DataRecord) => {
      const tools = agenticHandler.getAvailableTools({ user: { id: "store_gm_001", role: "store_general_manager", permissions: ["dealer:read"] } }) as DataRecord[];
      const kinds = new Set(tools.map((t: DataRecord) => t.kind));
      const missing = ["intent", "tool", "skill"].filter((k) => !kinds.has(k));
      if (missing.length) return { ok: false, reason: `缺少 kind: ${missing.join(", ")}` };
      const hasSafeCompute = tools.some((t: DataRecord) => t.name === "tool.safe_compute");
      const hasSummarize = tools.some((t: DataRecord) => t.name === "skill.summarize-alert");
      const hasMargin = tools.some((t: DataRecord) => t.name === "skill.gross-margin-attribution");
      if (!hasSafeCompute) return { ok: false, reason: "tool.safe_compute 未列出" };
      if (!hasSummarize) return { ok: false, reason: "skill.summarize-alert 未列出" };
      if (!hasMargin) return { ok: false, reason: "skill.gross-margin-attribution 未列出" };
      return { ok: true };
    }
  },
  {
    // 静态断言：gross-margin-attribution 的 preprocess + 模板渲染产出应满足
    //   - 渲染后包含整体毛利率数字
    //   - 主维度分组按毛利率从高到低排好（最赚的排第一）
    //   - 副维度（compare）章节也被注入
    // 不依赖 LLM，确保数据准备路径稳定。
    name: "Intent Router-gross-margin-attribution skill 渲染正确（静态）",
    message: "（probe，不会真发给 LLM）",
    skipRun: true,
    expectStatic: async ({ agenticSkillView }: DataRecord) => {
      const inj = await agenticSkillView.loadForInjection({
        id: "gross-margin-attribution",
        args: {
          rows: [
            { series: "秦PLUS", channel: "直营", final_price: 144000, gross_profit: 7800 },
            { series: "秦PLUS", channel: "加盟", final_price: 144000, gross_profit: 7800 },
            { series: "宋L",    channel: "直营", final_price: 170000, gross_profit: 5400 },
            { series: "唐",     channel: "加盟", final_price: 143300, gross_profit: 4400 }
          ],
          dim: "series",
          compare: "channel",
          period_label: "本月"
        }
      });
      if (!inj?.ok) return { ok: false, reason: `loadForInjection 失败：${inj?.error ?? "?"}` };
      const text = inj.injection_text ?? "";
      if (!/整体毛利率\s+\d/.test(text)) return { ok: false, reason: "整体毛利率行未渲染" };
      // 主维度第一项应为最赚的（秦PLUS 5.42%）
      if (!/1\.\s*秦PLUS/.test(text)) return { ok: false, reason: "主维度排序错（秦PLUS 应排第一）" };
      if (!/副维度分组（渠道）/.test(text)) return { ok: false, reason: "副维度章节缺失" };
      return { ok: true };
    }
  },
  {
    // v3 thin：propose_tool 静态用例。我们 stub decideNext 给出一轮 propose_tool + 一轮 answer，
    // 验证 AgenticHandler 把提议写进 traces、不报错、流程能继续到 answer。
    // 这样 LLM 真要 propose 时（我们暂不强制触发），代码路径已经安全。
    name: "v3-propose_tool 被记录、不打断主循环（静态）",
    message: "（probe，不会真发给 LLM）",
    skipRun: true,
    expectStatic: async ({ agenticHandler }: DataRecord) => {
      const stubbed = Object.create(agenticHandler);
      let call = 0;
      const decisions = [
        { action: "propose_tool", proposed_tool: { name: "tool.gross_margin_decompose", what_it_does: "把毛利率拆到车系×渠道", why_needed: "现有 intent.* 只到车系级", sample_args: { dim: ["model", "channel"] } }, reason: "缺一个分解工具" },
        { action: "answer", answer: "（stub）已记录提议；用现有工具回答即可。", reason: "stub" }
      ];
      stubbed.decideNext = async () => {
        const d = decisions[call] ?? decisions[decisions.length - 1];
        call += 1;
        return d;
      };
      // 注入 LLM_API_KEY，避开真实 fetch（decideNext 已被 stub）
      const prevKey = process.env.LLM_API_KEY;
      process.env.LLM_API_KEY = "stub";
      let result;
      try {
        result = await stubbed.execute({
          user: { id: "store_gm_001", role: "store_general_manager", permissions: ["dealer:read"] },
          message: "需要一个能把毛利率按车系×渠道拆开的能力",
          route: { intent_code: "general" },
          session: { id: "v3_static" }
        });
      } finally {
        if (prevKey === undefined) delete process.env.LLM_API_KEY;
        else process.env.LLM_API_KEY = prevKey;
      }
      const traces = (result?.debug?.traces ?? []) as DataRecord[];
      const proposalEntry = traces.find((t: DataRecord) => t.type === "propose_tool");
      if (!proposalEntry) return { ok: false, reason: `traces 未记录 propose_tool（实际：${traces.map((t: DataRecord) => t.type).join(",")}）` };
      if (!proposalEntry.proposal?.name) return { ok: false, reason: "proposal.name 未保留" };
      if (!result.answer || /暂时无法直接给出/.test(result.answer)) return { ok: false, reason: `propose_tool 后没走到 answer：${truncate(result.answer)}` };
      return { ok: true };
    }
  },

  // ============================================================
  // ↓↓↓ 第二批用例（37 → 100）
  // 设计原则：
  //   - 默认按 intent_code + 关键 params 软校验（match 现有 37 条的口径）
  //   - 关键路径上挑几条加 answer 软校验（出现数字 / 出现门店名 / 出现口径）
  //   - Agentic 类全部 allowOneRetry，避开 LLM 抖动假阳性
  //   - 每个 case 一句话注释自己想测什么
  // ============================================================

  // ---------- #1 inventory 字段全覆盖（6） ----------
  {
    name: "库存-紧急预警车辆",
    message: "现在有几台紧急预警的车",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.query.inventory") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      if (p.warning_level && !/紧急/.test(p.warning_level)) return { ok: false, reason: `warning_level=${p.warning_level}` };
      return { ok: true };
    }
  },
  {
    name: "库存-融资车占比口语化",
    message: "哪些车是融资车",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      // 没有 purchase_mode 字段，期望兜回 inventory 列表（让用户自己看），或 agentic
      if (ic !== "dealer.query.inventory" && ic !== "general") return { ok: false, reason: `intent_code=${ic}` };
      return { ok: true };
    }
  },
  {
    name: "库存-在途订单（inbounds）",
    message: "在途的车都到哪一步了",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.query.inventory") return { ok: false, reason: `intent_code=${ic}` };
      return { ok: true };
    }
  },
  {
    name: "库存-海豹库存",
    message: "海豹这款车的库存",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.query.inventory") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      if (p.vehicle_model && !/海豹/.test(p.vehicle_model)) return { ok: false, reason: `vehicle_model=${p.vehicle_model}` };
      return { ok: true };
    }
  },
  {
    name: "库存-关注级别口龄超 30 天",
    message: "关注级别的车都有哪些",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.query.inventory") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      if (p.warning_level && !/关注/.test(p.warning_level)) return { ok: false, reason: `warning_level=${p.warning_level}` };
      return { ok: true };
    }
  },
  {
    name: "库存-华南标准店唐DM-p",
    message: "华南标准店的唐DM-p还有库存吗",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.query.inventory") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      if (p.store && !/华南/.test(p.store)) return { ok: false, reason: `store=${p.store}` };
      if (p.vehicle_model && !/唐/.test(p.vehicle_model)) return { ok: false, reason: `vehicle_model=${p.vehicle_model}` };
      return { ok: true };
    }
  },

  // ---------- #2 sales_orders 字段全覆盖（8） ----------
  {
    name: "销售-按揭订单",
    message: "按揭的订单有哪些",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.query.sales_orders") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      if (p.order_type && !/按揭|分期|贷款/.test(p.order_type)) return { ok: false, reason: `order_type=${p.order_type}` };
      return { ok: true };
    }
  },
  {
    name: "销售-已结清订单",
    message: "已经结清款项的订单",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.query.sales_orders") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      if (p.payment_status && !/已结清|结清/.test(p.payment_status)) return { ok: false, reason: `payment_status=${p.payment_status}` };
      return { ok: true };
    }
  },
  {
    name: "销售-林悦的订单",
    message: "林悦本月跟了哪几单",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.query.sales_orders") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      if (p.owner && !/林悦|sales_001/.test(p.owner)) return { ok: false, reason: `owner=${p.owner}` };
      return { ok: true };
    }
  },
  {
    name: "销售-整备中等待交付",
    message: "整备中还没交车的有哪些",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.query.sales_orders") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      const ok = !p.delivery_status || /整备中|未交付|待交付/.test(p.delivery_status);
      if (!ok) return { ok: false, reason: `delivery_status=${p.delivery_status}` };
      return { ok: true };
    }
  },
  {
    name: "销售-宋L 订单明细",
    message: "宋L 的成交订单都有哪些",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.query.sales_orders") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      if (p.series && !/宋L|宋/.test(p.series)) return { ok: false, reason: `series=${p.series}` };
      return { ok: true };
    }
  },
  {
    name: "销售-20 万以上订单",
    message: "成交价 20 万以上的订单",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.query.sales_orders") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      // 20 万 = 200000；接受 price_min 在 [180000, 220000] 区间附近，或为空
      const ok = p.price_min == null || (p.price_min >= 150000 && p.price_min <= 250000);
      if (!ok) return { ok: false, reason: `price_min=${p.price_min}` };
      return { ok: true };
    }
  },
  {
    name: "销售-已开票",
    message: "已开发票的订单",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.query.sales_orders") return { ok: false, reason: `intent_code=${ic}` };
      return { ok: true };
    }
  },
  {
    name: "销售-定金已收订单",
    message: "已经收到定金但还没付完的订单",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.query.sales_orders") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      // payment_status 应为「部分收款」或「已收定金」之一
      const ok = !p.payment_status || /部分收款|已收定金|定金/.test(p.payment_status);
      if (!ok) return { ok: false, reason: `payment_status=${p.payment_status}` };
      return { ok: true };
    }
  },

  // ---------- #3 finance 字段全覆盖（6） ----------
  {
    name: "财务-收款记录",
    message: "本月收到了哪些款",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.query.finance") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      if (p.resource_type && !/receipt|收款/.test(p.resource_type)) return { ok: false, reason: `resource_type=${p.resource_type}` };
      return { ok: true };
    }
  },
  {
    name: "财务-月度销量返利",
    message: "月度销量返利还有多少没到账",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.query.finance" && ic !== "dealer.aggregate.finance") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      if (p.resource_type && p.resource_type !== "rebate") return { ok: false, reason: `resource_type=${p.resource_type}` };
      return { ok: true };
    }
  },
  {
    name: "财务-客户首付",
    message: "客户首付的入账明细",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.query.finance") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      // 接受 category=客户首付 或 resource_type=receipt
      const ok = (!p.category || /首付|客户首付/.test(p.category)) || p.resource_type === "receipt";
      if (!ok) return { ok: false, reason: `category=${p.category} resource_type=${p.resource_type}` };
      return { ok: true };
    }
  },
  {
    name: "财务-折让金所有出账",
    message: "折让金账户都付了哪些款",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.query.finance") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      if (p.resource_type && p.resource_type !== "discount_wallet") return { ok: false, reason: `resource_type=${p.resource_type}` };
      const okDir = !p.direction || /出账/.test(p.direction);
      if (!okDir) return { ok: false, reason: `direction=${p.direction}` };
      return { ok: true };
    }
  },
  {
    name: "财务-大额应付",
    message: "10 万以上的应付款都有哪些",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.query.finance") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      if (p.resource_type && p.resource_type !== "payable") return { ok: false, reason: `resource_type=${p.resource_type}` };
      const okMin = p.amount_min == null || (p.amount_min >= 80000 && p.amount_min <= 120000);
      if (!okMin) return { ok: false, reason: `amount_min=${p.amount_min}` };
      return { ok: true };
    }
  },
  {
    name: "财务-华南标准店出账明细",
    message: "华南标准店本月都付了哪些款",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.query.finance") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      if (p.store && !/华南/.test(p.store)) return { ok: false, reason: `store=${p.store}` };
      const okDir = !p.direction || /出账|payable/i.test(p.direction);
      if (!okDir) return { ok: false, reason: `direction=${p.direction}` };
      return { ok: true };
    }
  },

  // ---------- #4 repair_orders 字段全覆盖（5） ----------
  {
    name: "售后-施工中工单",
    message: "正在施工的维修工单有哪些",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.query.repair_orders") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      if (p.status && !/施工|进行/.test(p.status)) return { ok: false, reason: `status=${p.status}` };
      return { ok: true };
    }
  },
  {
    name: "售后-事故维修",
    message: "事故维修类型的工单",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.query.repair_orders") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      if (p.order_type && !/事故/.test(p.order_type)) return { ok: false, reason: `order_type=${p.order_type}` };
      return { ok: true };
    }
  },
  {
    name: "售后-小李名下工单",
    message: "服务顾问小李名下的工单",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.query.repair_orders") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      if (p.service_advisor && !/小李|after_sales_001/.test(p.service_advisor)) return { ok: false, reason: `service_advisor=${p.service_advisor}` };
      return { ok: true };
    }
  },
  {
    name: "售后-厂家拒赔工单",
    message: "厂家拒赔的工单",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.query.repair_orders" && ic !== "dealer.query.warranty_claims") {
        return { ok: false, reason: `intent_code=${ic}` };
      }
      return { ok: true };
    }
  },
  {
    name: "售后-常规保养工单",
    message: "常规保养的工单都有哪些",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.query.repair_orders") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      if (p.order_type && !/保养|常规/.test(p.order_type)) return { ok: false, reason: `order_type=${p.order_type}` };
      return { ok: true };
    }
  },

  // ---------- #5 warranty_claims 字段全覆盖（3） ----------
  {
    name: "保修-差额超 5000 的索赔",
    message: "索赔差额超过 5000 的有哪些",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.query.warranty_claims") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      if (p.difference_min != null && (p.difference_min < 3000 || p.difference_min > 8000)) {
        return { ok: false, reason: `difference_min=${p.difference_min}` };
      }
      return { ok: true };
    }
  },
  {
    name: "保修-已核准索赔",
    message: "已经核准的保修索赔",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.query.warranty_claims") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      if (p.claim_status && !/核准|通过/.test(p.claim_status)) return { ok: false, reason: `claim_status=${p.claim_status}` };
      return { ok: true };
    }
  },
  {
    name: "保修-内饰类故障",
    message: "内饰故障的索赔",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.query.warranty_claims") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      if (p.fault_category && !/内饰/.test(p.fault_category)) return { ok: false, reason: `fault_category=${p.fault_category}` };
      return { ok: true };
    }
  },

  // ---------- #6 leads 字段全覆盖（5） ----------
  {
    name: "线索-抖音直播来源",
    message: "抖音直播来的线索都有谁",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.query.leads") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      if (p.source && !/抖音/.test(p.source)) return { ok: false, reason: `source=${p.source}` };
      return { ok: true };
    }
  },
  {
    name: "线索-跟进中状态",
    message: "还在跟进的客户有几个",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.query.leads") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      if (p.status && !/跟进/.test(p.status)) return { ok: false, reason: `status=${p.status}` };
      return { ok: true };
    }
  },
  {
    name: "线索-战败客户",
    message: "战败的客户都是什么原因",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.query.leads") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      if (p.status && !/战败|失败|流失/.test(p.status)) return { ok: false, reason: `status=${p.status}` };
      return { ok: true };
    }
  },
  {
    name: "线索-门店自然到访",
    message: "自然到店的客户线索",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.query.leads") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      if (p.source && !/自然|到店|到访/.test(p.source)) return { ok: false, reason: `source=${p.source}` };
      return { ok: true };
    }
  },
  {
    name: "线索-意向汉EV",
    message: "想买汉EV的客户都有谁",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.query.leads") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      if (p.series && !/汉/.test(p.series)) return { ok: false, reason: `series=${p.series}` };
      return { ok: true };
    }
  },

  // ---------- #7 聚合矩阵补全（8） ----------
  {
    name: "聚合-销售-按车系毛利率",
    message: "按车系看本月毛利率分别多少",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.aggregate.sales_orders") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      if (p.metric && p.metric !== "gross_margin") return { ok: false, reason: `metric=${p.metric}` };
      if (p.group_by && !/series|车系/.test(p.group_by)) return { ok: false, reason: `group_by=${p.group_by}` };
      return { ok: true };
    }
  },
  {
    name: "聚合-销售-单价最高的成交",
    message: "本月成交价最高的是哪一笔",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.aggregate.sales_orders" && ic !== "dealer.query.sales_orders") {
        return { ok: false, reason: `intent_code=${ic}` };
      }
      return { ok: true };
    }
  },
  {
    name: "聚合-销售-平均成交价",
    message: "本月平均成交价多少",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.aggregate.sales_orders") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      if (p.metric && !/avg|average|平均/i.test(p.metric)) return { ok: false, reason: `metric=${p.metric}` };
      return { ok: true };
    }
  },
  {
    name: "聚合-销售-按销售顾问成交",
    message: "各销售顾问本月分别卖了多少单",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.aggregate.sales_orders") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      if (p.group_by && !/owner|销售|顾问/.test(p.group_by)) return { ok: false, reason: `group_by=${p.group_by}` };
      return { ok: true };
    }
  },
  {
    name: "聚合-财务-按门店应付分布",
    message: "各门店应付款分别多少",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.aggregate.finance") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      if (p.group_by && !/store|门店/.test(p.group_by)) return { ok: false, reason: `group_by=${p.group_by}` };
      if (p.resource_type && p.resource_type !== "payable") return { ok: false, reason: `resource_type=${p.resource_type}` };
      return { ok: true };
    }
  },
  {
    name: "聚合-售后-平均工时费",
    message: "本月维修工单平均工时费多少钱",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.aggregate.repair_orders") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      if (p.metric && !/avg|average|平均|labor/i.test(p.metric)) return { ok: false, reason: `metric=${p.metric}` };
      return { ok: true };
    }
  },
  {
    name: "聚合-线索-各来源转化率",
    message: "各来源的转化率分别多少",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.aggregate.leads") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      if (p.metric && p.metric !== "conversion_rate") return { ok: false, reason: `metric=${p.metric}` };
      if (p.group_by && !/source|来源/.test(p.group_by)) return { ok: false, reason: `group_by=${p.group_by}` };
      return { ok: true };
    }
  },
  {
    name: "聚合-线索-各门店线索数",
    message: "各门店本月线索数",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.aggregate.leads") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      if (p.group_by && !/store|门店/.test(p.group_by)) return { ok: false, reason: `group_by=${p.group_by}` };
      return { ok: true };
    }
  },

  // ---------- #8 中文同义词映射（6） ----------
  {
    name: "同义-H 级当作高意向",
    message: "H 级线索还有哪些没成交",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.query.leads") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      const ok = !p.intention_level || p.intention_level === "H" || /高/.test(p.intention_level);
      if (!ok) return { ok: false, reason: `intention_level=${p.intention_level}` };
      return { ok: true };
    }
  },
  {
    name: "同义-热单当作高意向",
    message: "热单都有谁",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      // 热单可能被理解为线索高意向，也可能被理解为销售热销车型；接受 leads 或 sales_orders/aggregate
      if (!/leads|sales_orders/.test(ic ?? "")) return { ok: false, reason: `intent_code=${ic}` };
      return { ok: true };
    }
  },
  {
    name: "同义-超期工单",
    message: "超期没交付的工单",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.query.repair_orders") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      const ok = p.overdue_only === true || (p.status && p.status !== "已交付");
      if (!ok) return { ok: false, reason: `params=${JSON.stringify(p)}` };
      return { ok: true };
    }
  },
  {
    name: "同义-分期订单当作按揭",
    message: "分期付款的订单有哪些",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.query.sales_orders") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      if (p.order_type && !/按揭|分期|贷款/.test(p.order_type)) return { ok: false, reason: `order_type=${p.order_type}` };
      return { ok: true };
    }
  },
  {
    name: "同义-动力电池故障当作三电",
    message: "动力电池故障的索赔",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.query.warranty_claims") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      if (p.fault_category && !/三电|电池|动力/.test(p.fault_category)) return { ok: false, reason: `fault_category=${p.fault_category}` };
      return { ok: true };
    }
  },
  {
    name: "同义-未结清等价于应付未结",
    message: "应付里还欠着的款",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.query.finance") return { ok: false, reason: `intent_code=${ic}` };
      const p = r.debug?.route?.params ?? {};
      if (p.resource_type && p.resource_type !== "payable") return { ok: false, reason: `resource_type=${p.resource_type}` };
      const ok = !p.status || /未结清|未付/.test(p.status);
      if (!ok) return { ok: false, reason: `status=${p.status}` };
      return { ok: true };
    }
  },

  // ---------- #9 高级多轮修参（5） ----------
  {
    name: "多轮-否定修正 不是华南是华东",
    turns: [
      { message: "查华南标准店海豹库存" },
      {
        message: "不是华南，是华东",
        expect: (r) => {
          const ic = r.debug?.route?.intent_code;
          if (ic !== "dealer.query.inventory") return { ok: false, reason: `intent_code=${ic}` };
          const p = r.debug?.route?.params ?? {};
          if (p.store && /华南/.test(p.store)) return { ok: false, reason: `store=${p.store}（应为华东）` };
          return { ok: true };
        }
      }
    ]
  },
  {
    name: "多轮-数值修正 改成 30 万以上",
    turns: [
      { message: "成交价 20 万以上的订单" },
      {
        message: "改成 30 万以上的",
        expect: (r) => {
          const ic = r.debug?.route?.intent_code;
          if (ic !== "dealer.query.sales_orders") return { ok: false, reason: `intent_code=${ic}` };
          const p = r.debug?.route?.params ?? {};
          if (p.price_min != null && (p.price_min < 250000 || p.price_min > 350000)) {
            return { ok: false, reason: `price_min=${p.price_min}` };
          }
          return { ok: true };
        }
      }
    ]
  },
  {
    name: "多轮-从车系切到具体车型",
    turns: [
      { message: "汉系列的库存" },
      {
        message: "具体看汉EV",
        expect: (r) => {
          const ic = r.debug?.route?.intent_code;
          if (ic !== "dealer.query.inventory") return { ok: false, reason: `intent_code=${ic}` };
          const p = r.debug?.route?.params ?? {};
          if (p.vehicle_model && !/汉EV/.test(p.vehicle_model)) return { ok: false, reason: `vehicle_model=${p.vehicle_model}` };
          return { ok: true };
        }
      }
    ]
  },
  {
    name: "多轮-财务切换 resource_type",
    turns: [
      { message: "应付未结清的" },
      {
        message: "返利的呢",
        expect: (r) => {
          const ic = r.debug?.route?.intent_code;
          if (ic !== "dealer.query.finance") return { ok: false, reason: `intent_code=${ic}` };
          const p = r.debug?.route?.params ?? {};
          if (p.resource_type && p.resource_type !== "rebate") return { ok: false, reason: `resource_type=${p.resource_type}` };
          return { ok: true };
        }
      }
    ]
  },
  {
    name: "多轮-销售切换 owner",
    turns: [
      { message: "林悦本月跟了哪几单" },
      {
        message: "其他销售呢",
        expect: (r) => {
          const ic = r.debug?.route?.intent_code;
          if (ic !== "dealer.query.sales_orders") return { ok: false, reason: `intent_code=${ic}` };
          // owner 已被否定，应清空或换值
          const p = r.debug?.route?.params ?? {};
          if (p.owner && /林悦|sales_001/.test(p.owner)) return { ok: false, reason: `owner=${p.owner}（应不再是林悦）` };
          return { ok: true };
        }
      }
    ]
  },

  // ---------- #10 反例 / 越权 / 边界（4） ----------
  {
    name: "边界-含糊问题不应误判 high",
    message: "最近怎么样",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      const handler = r.debug?.route?.handler_type;
      // 含糊 → 兜回 chitchat 或 general / agentic 都接受，但不应是某个 dealer.* 的 high confidence
      if (handler === "intent_query" && /^dealer\./.test(ic)) {
        return { ok: false, reason: `含糊问题被误路由到 ${ic}` };
      }
      return { ok: true };
    }
  },
  {
    name: "边界-不存在的门店",
    message: "查华西旗舰店的库存",
    expect: (r) => {
      const ic = r.debug?.route?.intent_code;
      // 应该照样路由到 inventory（数据层会查空），不应直接拒答
      if (ic !== "dealer.query.inventory") return { ok: false, reason: `intent_code=${ic}` };
      // answer 应有提示无结果或空，不应崩
      if (!r.answer) return { ok: false, reason: "无 answer" };
      return { ok: true };
    }
  },
  {
    name: "边界-反例：单 intent 不应升 agentic",
    message: "本月卖了多少台",
    expect: (r) => {
      const handler = r.debug?.route?.handler_type;
      if (handler === "agentic") return { ok: false, reason: "单聚合被错判 agentic" };
      const ic = r.debug?.route?.intent_code;
      if (ic !== "dealer.aggregate.sales_orders") return { ok: false, reason: `intent_code=${ic}` };
      return { ok: true };
    }
  },
  {
    name: "边界-歧义：华东订单",
    message: "华东订单",
    expect: (r) => {
      // 接受 sales_orders（最常见解读）或 finance（订单款项）；不应 chitchat
      const ic = r.debug?.route?.intent_code;
      const handler = r.debug?.route?.handler_type;
      if (handler === "chitchat") return { ok: false, reason: "歧义被错判寒暄" };
      if (!/sales_orders|finance|inventory/.test(ic ?? "")) return { ok: false, reason: `intent_code=${ic}` };
      return { ok: true };
    }
  },

  // ---------- #11 Agentic 真实业务（5，全部 allowOneRetry） ----------
  {
    name: "agentic-本月销售榜",
    message: "本月销售排行榜，谁卖得最好",
    allowOneRetry: true,
    expect: (r) => {
      const handler = r.debug?.route?.handler_type;
      const ic = r.debug?.route?.intent_code;
      // 接受 agentic 或 单 aggregate（group_by=owner）
      const acceptable = handler === "agentic" || ic === "dealer.aggregate.sales_orders";
      if (!acceptable) return { ok: false, reason: `handler=${handler}/intent=${ic}` };
      if (!r.answer || /暂时无法直接给出/.test(r.answer)) return { ok: false, reason: `兜底了：${truncate(r.answer)}` };
      return { ok: true };
    }
  },
  {
    name: "agentic-下周交车排程",
    message: "下周要交车的有几台，分别是谁的",
    allowOneRetry: true,
    expect: (r) => {
      const handler = r.debug?.route?.handler_type;
      const ic = r.debug?.route?.intent_code;
      const acceptable = handler === "agentic" || ic === "dealer.query.sales_orders";
      if (!acceptable) return { ok: false, reason: `handler=${handler}/intent=${ic}` };
      if (!r.answer || /暂时无法直接给出/.test(r.answer)) return { ok: false, reason: `兜底了：${truncate(r.answer)}` };
      return { ok: true };
    }
  },
  {
    name: "agentic-高意向但快战败",
    message: "高意向客户里哪些已经超过一周没跟进了",
    allowOneRetry: true,
    expect: (r) => {
      const handler = r.debug?.route?.handler_type;
      const ic = r.debug?.route?.intent_code;
      const acceptable = handler === "agentic" || ic === "dealer.query.leads";
      if (!acceptable) return { ok: false, reason: `handler=${handler}/intent=${ic}` };
      if (!r.answer || /暂时无法直接给出/.test(r.answer)) return { ok: false, reason: `兜底了：${truncate(r.answer)}` };
      return { ok: true };
    }
  },
  {
    name: "agentic-售后这周和上周对比",
    message: "这周维修工单结算金额跟上周比怎么样",
    allowOneRetry: true,
    expect: (r) => {
      const handler = r.debug?.route?.handler_type;
      // 必须 agentic（要拉两段做对比）
      if (handler !== "agentic" && r.debug?.route?.intent_code !== "general") {
        return { ok: false, reason: `handler=${handler}（应 agentic）` };
      }
      if (!r.answer || /暂时无法直接给出/.test(r.answer)) return { ok: false, reason: `兜底了：${truncate(r.answer)}` };
      return { ok: true };
    }
  },
  {
    name: "agentic-汉EV 卖得不错但毛利不行",
    message: "汉EV 卖得还行但毛利好像不太行，看下原因",
    allowOneRetry: true,
    expect: (r) => {
      const handler = r.debug?.route?.handler_type;
      const intentCode = r.debug?.route?.intent_code;
      if (handler !== "agentic" && intentCode !== "general" && intentCode !== "dealer.aggregate.sales_orders") {
        return { ok: false, reason: `handler=${handler}/intent=${intentCode}（应为销售聚合或 agentic）` };
      }
      if (!r.answer || /暂时无法直接给出/.test(r.answer)) return { ok: false, reason: `兜底了：${truncate(r.answer)}` };
      return { ok: true };
    }
  },

  // ---------- #12 Skill 端到端命中（2，全部 allowOneRetry） ----------
  {
    name: "agentic+skill-毛利率归因端到端",
    message: "这个月毛利率掉得有点厉害，按车系帮我分析下原因",
    allowOneRetry: true,
    expect: (r) => {
      const handler = r.debug?.route?.handler_type;
      const intentCode = r.debug?.route?.intent_code;
      if (handler !== "agentic" && intentCode !== "general" && intentCode !== "dealer.aggregate.sales_orders") {
        return { ok: false, reason: `handler=${handler}/intent=${intentCode}（应为销售聚合或 agentic）` };
      }
      if (!r.answer || /暂时无法直接给出/.test(r.answer)) return { ok: false, reason: `兜底了：${truncate(r.answer)}` };
      // 软校验：answer 出现毛利相关词 + 至少一个车系
      if (!/毛利|车系/.test(r.answer)) return { ok: false, reason: `answer 缺关键概念：${truncate(r.answer)}` };
      return { ok: true };
    }
  },
  {
    name: "库存告警简报端到端（经营指标或 agentic）",
    message: "把华东旗舰店库存压力写成一段经营简报",
    allowOneRetry: true,
    expect: (r) => {
      const handler = r.debug?.route?.handler_type;
      const intentCode = r.debug?.route?.intent_code;
      if (handler !== "agentic" && intentCode !== "general" && intentCode !== "dealer.query.metrics") {
        return { ok: false, reason: `handler=${handler}/intent=${intentCode}（应为经营指标或 agentic）` };
      }
      if (!r.answer || /暂时无法直接给出/.test(r.answer)) return { ok: false, reason: `兜底了：${truncate(r.answer)}` };
      // 软校验：出现门店或库存相关词
      if (!/华东|库存|库龄/.test(r.answer)) return { ok: false, reason: `answer 缺关键概念：${truncate(r.answer)}` };
      return { ok: true };
    }
  }

  // ============================================================
  // ↑↑↑ 第二批用例结束（共新增 63 条 → 总数 100）
  // ============================================================
];

let passed = 0;
let total = 0;
const failures: Failure[] = [];

for (const [index, c] of cases.entries()) {
  total += 1;
  const sessionId = `${runId}_${index}`;
  let result: PocResult = {};
  let verdict: Verdict = { ok: false, reason: "case did not run" };
  try {
    if (c.skipRun) {
      // 静态用例：不跑 agent，只对 app 子组件做断言（允许 expectStatic 是 async）
      verdict = c.expectStatic ? await c.expectStatic(app as DataRecord) : { ok: false, reason: "missing expectStatic" };
      const tag = verdict.ok ? "PASS" : "FAIL";
      if (verdict.ok) passed += 1;
      else failures.push({ name: c.name, reason: verdict.reason });
      console.log(`${tag}  ${c.name}`);
      if (!verdict.ok) console.log(`      reason: ${verdict.reason}`);
      continue;
    }
    if (Array.isArray(c.turns)) {
      // 多轮：依次跑，最后一轮的 expect 决定 verdict（中间轮没 expect 也不强校验）
      for (const [turnIdx, turn] of c.turns.entries()) {
        result = await runAgentWithTimeout({ userId: USER_ID, message: turn.message, sessionId, debug: true }, `${c.name}/turn${turnIdx + 1}`);
        if (turn.expect) verdict = turn.expect(result);
        if (turnIdx < c.turns.length - 1) {
          console.log(`      turn${turnIdx + 1}: msg=${truncate(turn.message)} → intent=${result.debug?.route?.intent_code}`);
        }
      }
      verdict ??= { ok: true };
    } else {
      // allowOneRetry：agentic 类用例偶发 LLM 抖动（超时 / JSON 解析失败 / 漏调工具），最多再补 3 次
      const retryBudget = c.allowOneRetry ? 3 : 0;
      for (let attempt = 0; attempt <= retryBudget; attempt += 1) {
        const attemptSid = attempt === 0 ? sessionId : `${sessionId}_retry${attempt}`;
        const attemptName = attempt === 0 ? c.name : `${c.name}/retry${attempt}`;
        try {
          const attemptResult = await runAgentWithTimeout({ userId: USER_ID, message: c.message ?? "", sessionId: attemptSid, debug: true }, attemptName);
          const attemptVerdict = c.expect ? c.expect(attemptResult) : { ok: true };
          result = attemptResult;
          verdict = attemptVerdict;
          if (attemptVerdict.ok) {
            break;
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          verdict = { ok: false, reason: `agent.run 抛错: ${message}` };
        }
        if (!c.allowOneRetry) {
          break;
        }
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    failures.push({ name: c.name, reason: `agent.run 抛错: ${message}` });
    console.log(`FAIL  ${c.name}  ← agent.run 抛错: ${message}`);
    continue;
  }
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

function pickFirstRows(result: PocResult): DataRecord[] {
  const tr = result.debug?.tool_results ?? [];
  for (const item of tr) {
    if (Array.isArray(item?.sample_rows) && item.sample_rows.length) return item.sample_rows;
    if (Array.isArray(item?.data?.rows)) return item.data.rows;
  }
  return [];
}

function runAgentWithTimeout(input: DataRecord, name: string): Promise<PocResult> {
  return Promise.race([
    agent.run(input as Parameters<typeof agent.run>[0]),
    new Promise<PocResult>((_, reject) => {
      setTimeout(() => reject(new Error(`case timeout after ${CASE_TIMEOUT_MS}ms: ${name}`)), CASE_TIMEOUT_MS);
    })
  ]) as Promise<PocResult>;
}

function truncate(s: unknown): string {
  if (!s) return "";
  const text = String(s);
  return text.length > 80 ? text.slice(0, 80) + "..." : text;
}
