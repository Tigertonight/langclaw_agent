/**
 * Dealer 业务域确定性路由规则。
 *
 * 从 src/router/deterministic-rule-registry.ts 迁出的 dealer 专属规则和 extractors。
 * 使用 DeterministicRuleDefinition 的 match() 逃生口保持行为完全一致。
 */

import type { DeterministicRuleDefinition } from "../types.js";
import type { JsonValue } from "../../types/agent-contracts.js";

// ─── Extractors（导出供 intent-router.ts 复用，消除重复定义）────────────────

export function extractStore(text: string): string | null {
  if (/华东旗舰店|华东/.test(text)) return "华东旗舰店";
  if (/华南标准店|华南/.test(text)) return "华南标准店";
  return null;
}

export function extractOwner(text: string): string | null {
  if (/林悦/.test(text)) return "林悦";
  if (/沈清和/.test(text)) return "沈清和";
  if (/孟云岚/.test(text)) return "孟云岚";
  return null;
}

export function extractTimeRange(text: string): string | null {
  if (/本月|这个月/.test(text)) return "本月";
  if (/上月|上个月/.test(text)) return "上月";
  if (/本周|这周/.test(text)) return "本周";
  if (/今天|今日/.test(text)) return "今天";
  if (/昨天|昨日/.test(text)) return "昨天";
  if (/最近|近一个月/.test(text)) return "近一个月";
  return null;
}

export function extractVehicleModel(text: string): string | null {
  const known = ["汉EV", "唐DM-p", "唐DM", "宋L", "海豹", "汉", "唐", "宋"];
  return known.find((item) => text.includes(item)) ?? null;
}

export function extractVehicleSeries(text: string): string | null {
  const known = ["汉EV", "宋L", "海豹", "秦PLUS", "唐", "汉", "宋"];
  const matched = known.find((item) => text.includes(item));
  if (!matched) return null;
  if (matched === "汉EV") return "汉";
  return matched;
}

export function extractFinanceResourceType(text: string): string | null {
  if (/折让金/.test(text)) return "discount_wallet";
  if (/返利/.test(text)) return "rebate";
  if (/应付|付款|付了|付完|款项/.test(text)) return "payable";
  if (/应收/.test(text)) return "receivable";
  if (/收款|收到|入账|到账|首付/.test(text)) return "receipt";
  return null;
}

export function extractFinanceDirection(text: string): string | null {
  if (/出账|付款|付了|付完|扣款|支出/.test(text)) return "出账";
  if (/收款|收到|入账|到账|首付/.test(text)) return "收款";
  return null;
}

export function extractPriceMin(text: string): number | null {
  const match = text.match(/(\d+(?:\.\d+)?)\s*万以上/);
  if (match) return Number(match[1]) * 10000;
  return null;
}

export function extractAmountMin(text: string): number | null {
  const match = text.match(/(?:超过|大于|不少于|至少)\s*(\d+(?:\.\d+)?)\s*万?/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return /万/.test(match[0]) ? value * 10000 : value;
}

export function extractMetricCategory(text: string): string | null {
  if (/库存/.test(text) && /线索/.test(text)) return "inventory";
  if (/库存/.test(text)) return "inventory";
  if (/财务|折让金|返利|应付|应收|收款|付款/.test(text)) return "finance";
  if (/三包|索赔|质保|保修/.test(text)) return "warranty";
  if (/售后|维修|工单/.test(text)) return "after_sales";
  return null;
}

export function extractWarrantyClaimStatus(text: string): string | null {
  if (/(被拒|驳回|拒绝)/.test(text)) return "已驳回";
  if (/审核|厂家/.test(text)) return "厂家审核中";
  if (/核准|通过/.test(text)) return "已核准";
  if (/结算/.test(text)) return "已结算";
  if (/待提交|未提交/.test(text)) return "待提交";
  return null;
}

export function extractWarrantyFaultCategory(text: string): string | null {
  if (/三电|电池|电机|电控/.test(text)) return "三电";
  if (/内饰/.test(text)) return "内饰";
  if (/电气/.test(text)) return "电气";
  if (/底盘/.test(text)) return "底盘";
  return null;
}

export function extractWarrantyEvidenceStatus(text: string): string | null {
  if (/证据缺失|缺照片/.test(text)) return "缺照片";
  if (/缺工时单/.test(text)) return "缺工时单";
  if (/照片齐全|证据齐全/.test(text)) return "照片齐全";
  return null;
}

export function extractLeadGroupBy(text: string): string | null {
  if (/意向等级/.test(text)) return "intention_level";
  if (/来源/.test(text)) return "source";
  if (/各门店|每个门店/.test(text)) return "store_name";
  if (/销售顾问|顾问/.test(text)) return "owner_name";
  return null;
}

export function extractSalesMetric(text: string): string {
  if (/毛利率|毛利/.test(text)) return "gross_margin";
  if (/平均成交价/.test(text)) return "avg_price";
  if (/最高/.test(text)) return "max_price";
  if (/卖了多少|多少台|多少单/.test(text)) return "order_count";
  return "total_revenue";
}

export function extractSalesGroupBy(text: string): string | null {
  if (/车系|按车系/.test(text)) return "series";
  if (/各门店|每个门店/.test(text)) return "store_name";
  if (/销售顾问|排行榜|谁卖得最好/.test(text)) return "owner_name";
  return null;
}

export function extractRepairMetric(text: string): string {
  if (/平均工时费|平均/.test(text)) return "avg_labor";
  if (/应收|结算金额|金额|合计/.test(text)) return "total_receivable";
  return "order_count";
}

// ─── Rules ───────────────────────────────────────────────────────────────────

export const DEALER_DETERMINISTIC_RULES: DeterministicRuleDefinition[] = [
  {
    id: "dealer.finance_amount",
    intentCode: "dealer.query.finance",
    priority: 10,
    match: ({ message }) => {
      const text = message;
      if (!/(应付|应收|款).*\d+\s*万以上|\d+\s*万以上.*(应付|应收|款)/.test(text)) return null;
      return {
        intentCode: "dealer.query.finance",
        params: {
          store: extractStore(text),
          resource_type: extractFinanceResourceType(text),
          amount_min: extractPriceMin(text),
        },
        reasoning: "命中财务金额阈值高确定性本地预路由。",
      };
    },
  },
  {
    id: "dealer.sales_amount",
    intentCode: "dealer.query.sales_orders",
    priority: 10,
    match: ({ message }) => {
      const text = message;
      if (!/改成\s*\d+\s*万以上|\d+\s*万以上/.test(text)) return null;
      return {
        intentCode: "dealer.query.sales_orders",
        params: {
          store: extractStore(text),
          price_min: extractPriceMin(text),
        },
        reasoning: "命中金额阈值高确定性本地预路由。",
      };
    },
  },
  {
    id: "dealer.metrics",
    intentCode: "dealer.query.metrics",
    priority: 20,
    match: ({ message }) => {
      const text = message;
      if (!/经营风险|风险总览|经营周报|晨会|最该关注|优先级|财务风险|库存压力|损失风险复盘|三包.*风险|售后.*风险/.test(text)) return null;
      return {
        intentCode: "dealer.query.metrics",
        params: {
          store: extractStore(text),
          category: extractMetricCategory(text),
          severity: /紧急|严重|最高|最该关注/.test(text) ? "critical" : null,
        },
        reasoning: "命中经营指标高确定性本地预路由。",
      };
    },
  },
  {
    id: "dealer.agentic_comparison",
    intentCode: "general",
    priority: 25,
    match: ({ message }) => {
      const text = message;
      if (!/(对比|相比|环比|跟上周比|和上周比)/.test(text)) return null;
      return {
        intentCode: "general",
        params: {
          original_reasoning: "跨时间或跨指标对比，需要自主规划多次查询后综合回答。",
        },
        reasoning: "命中跨期对比问题，转入 agentic。",
      };
    },
  },
  {
    id: "dealer.warranty_claims",
    intentCode: "dealer.query.warranty_claims",
    priority: 50,
    match: ({ message }) => {
      const text = message;
      if (!/(三包|索赔|保修|质保)/.test(text)) return null;
      return {
        intentCode: "dealer.query.warranty_claims",
        params: {
          store: extractStore(text),
          series: extractVehicleSeries(text),
          claim_status: extractWarrantyClaimStatus(text),
          fault_category: extractWarrantyFaultCategory(text),
          evidence_status: extractWarrantyEvidenceStatus(text),
          time_range: extractTimeRange(text),
          difference_min: extractAmountMin(text),
        },
        reasoning: "命中三包索赔高确定性本地预路由。",
      };
    },
  },
  {
    id: "dealer.leads_aggregate",
    intentCode: "dealer.aggregate.leads",
    priority: 50,
    match: ({ message }) => {
      const text = message;
      if (!/(线索.*转化率|转化率|线索数|多少线索|各.*线索|各.*意向等级|各.*来源)/.test(text)) return null;
      return {
        intentCode: "dealer.aggregate.leads",
        params: {
          metric: /转化率/.test(text) ? "conversion_rate" : "lead_count",
          group_by: extractLeadGroupBy(text),
          store: extractStore(text),
          intention_level: /高意向|H\s*级|热单/.test(text) ? "H" : null,
          source: /抖音/.test(text) ? "抖音直播" : null,
          time_range: extractTimeRange(text),
        },
        reasoning: "命中线索聚合高确定性本地预路由。",
      };
    },
  },
  {
    id: "dealer.finance_aggregate",
    intentCode: "dealer.aggregate.finance",
    priority: 50,
    match: ({ message }) => {
      const text = message;
      if (!/(应付|应收|返利|折让金|款项).*(合计|总额|总共|多少|分别|分布)|各门店.*应付/.test(text)) return null;
      return {
        intentCode: "dealer.aggregate.finance",
        params: {
          metric: /未结清|待结算|没到账|未到账/.test(text) ? "unsettled_amount" : "total_amount",
          group_by: /各门店|每个门店|分布/.test(text) ? "store_name" : null,
          resource_type: extractFinanceResourceType(text),
          store: extractStore(text),
          direction: extractFinanceDirection(text),
          status: /未结清|还没结清|待结算|没到账|未到账/.test(text) ? (/待结算/.test(text) ? "待结算" : "未结清") : null,
          time_range: extractTimeRange(text),
        },
        reasoning: "命中财务聚合高确定性本地预路由。",
      };
    },
  },
  {
    id: "dealer.sales_status_aggregate",
    intentCode: "dealer.aggregate.sales_orders",
    priority: 50,
    match: ({ message }) => {
      const text = message;
      if (!/签单状态|订单状态.*(分布|统计|情况)|按订单状态|客户.*签单状态/.test(text)) return null;
      return {
        intentCode: "dealer.aggregate.sales_orders",
        params: {
          metric: "order_count",
          group_by: "order_status",
          store: extractStore(text),
          series: extractVehicleSeries(text),
          time_range: extractTimeRange(text),
        },
        reasoning: "命中订单状态聚合高确定性本地预路由。",
      };
    },
  },
  {
    id: "dealer.sales_aggregate",
    intentCode: "dealer.aggregate.sales_orders",
    priority: 50,
    match: ({ message }) => {
      const text = message;
      if (!/毛利率|毛利|成交总额|平均成交价|最高.*成交|成交价最高|销售排行榜|卖得最好|卖了多少|多少单|各门店.*成交|各销售顾问|按车系/.test(text)) return null;
      return {
        intentCode: "dealer.aggregate.sales_orders",
        params: {
          metric: extractSalesMetric(text),
          group_by: extractSalesGroupBy(text),
          store: extractStore(text),
          series: extractVehicleSeries(text),
          time_range: extractTimeRange(text),
        },
        reasoning: "命中销售聚合高确定性本地预路由。",
      };
    },
  },
  {
    id: "dealer.repair_aggregate",
    intentCode: "dealer.aggregate.repair_orders",
    priority: 50,
    match: ({ message }) => {
      const text = message;
      if (!(/(工单|维修).*(多少|总共|平均|合计|金额)|平均工时费/.test(text) && !/上周|对比|环比/.test(text))) return null;
      return {
        intentCode: "dealer.aggregate.repair_orders",
        params: {
          metric: extractRepairMetric(text),
          group_by: null,
          store: extractStore(text),
          time_range: extractTimeRange(text),
        },
        reasoning: "命中维修工单聚合高确定性本地预路由。",
      };
    },
  },
  {
    id: "dealer.repair_query",
    intentCode: "dealer.query.repair_orders",
    priority: 60,
    match: ({ message }) => {
      const text = message;
      if (!(/维修工单|工单|超期|逾期|施工|事故维修|常规保养|服务顾问/.test(text) && !/上周|对比|环比/.test(text))) return null;
      return {
        intentCode: "dealer.query.repair_orders",
        params: {
          store: extractStore(text),
          status: /超期|逾期/.test(text) ? "未交付" : /施工/.test(text) ? "施工中" : null,
          order_type: /事故/.test(text) ? "事故维修" : /保养/.test(text) ? "常规保养" : null,
          overdue_only: /超期|逾期/.test(text) ? true : null,
          time_range: extractTimeRange(text),
        },
        reasoning: "命中维修工单高确定性本地预路由。",
      };
    },
  },
  {
    id: "dealer.sales_orders",
    intentCode: "dealer.query.sales_orders",
    priority: 60,
    match: ({ message }) => {
      const text = message;
      if (!/销售订单|成交订单|成交了哪些订单|哪几单|华东订单|华南订单|车辆申请|车辆.*进度|交付进度|待交付|未交付|交车|结清款项|按揭|分期|定金|开票|发票/.test(text)) return null;
      return {
        intentCode: "dealer.query.sales_orders",
        params: {
          store: extractStore(text),
          owner: extractOwner(text),
          delivery_status: /车辆申请|车辆.*进度|交付进度|未交付|交车/.test(text) ? "未交付" : /待交付/.test(text) ? "待交付" : null,
          payment_status: /定金|还没付完/.test(text) ? "部分收款" : /结清/.test(text) ? "已结清" : null,
          order_type: /按揭|分期|贷款/.test(text) ? "按揭" : null,
          time_range: extractTimeRange(text),
        },
        reasoning: "命中销售订单高确定性本地预路由。",
      };
    },
  },
  {
    id: "dealer.finance_query",
    intentCode: "dealer.query.finance",
    priority: 70,
    match: ({ message }) => {
      const text = message;
      if (!/折让金|返利|应付|应收|收款|收到|付款|付了|入账|出账|首付|款项|流水/.test(text)) return null;
      return {
        intentCode: "dealer.query.finance",
        params: {
          store: extractStore(text),
          resource_type: extractFinanceResourceType(text),
          category: /首付/.test(text) ? "客户首付" : null,
          direction: extractFinanceDirection(text),
          status: /未结清|还没结清|待结算|没到账|未到账/.test(text) ? (/待结算/.test(text) ? "待结算" : "未结清") : null,
          time_range: extractTimeRange(text),
        },
        reasoning: "命中财务流水高确定性本地预路由。",
      };
    },
  },
  {
    id: "dealer.inventory_query",
    intentCode: "dealer.query.inventory",
    priority: 70,
    match: ({ message }) => {
      const text = message;
      if (!/库存|库龄|配额|承诺交期|交期|在途|整车|预警|融资车|有车|订一台|关注级别.*车/.test(text)) return null;
      return {
        intentCode: "dealer.query.inventory",
        params: {
          store: extractStore(text),
          vehicle_model: extractVehicleModel(text),
          warning_level: /紧急/.test(text) ? "紧急" : /关注/.test(text) ? "关注" : null,
          time_range: extractTimeRange(text),
        },
        reasoning: "命中库存高确定性本地预路由。",
      };
    },
  },
  {
    id: "dealer.leads_query",
    intentCode: "dealer.query.leads",
    priority: 70,
    match: ({ message }) => {
      const text = message;
      if (!/线索|高意向|H\s*级|热单|战败|漏斗|跟进|新进|想买|抖音|自然到店|自然到访/.test(text)) return null;
      return {
        intentCode: "dealer.query.leads",
        params: {
          store: extractStore(text),
          series: extractVehicleSeries(text),
          intention_level: /高意向|H\s*级|热单/.test(text) ? "H" : null,
          status: /战败|流失/.test(text) ? "已流失" : /跟进/.test(text) ? "跟进中" : null,
          source: /抖音/.test(text) ? "抖音直播" : /自然到店|自然到访/.test(text) ? "自然到店" : null,
          time_range: extractTimeRange(text),
        },
        reasoning: "命中销售线索高确定性本地预路由。",
      };
    },
  },
];

/**
 * Dealer 域 extractors（供 manifest deterministic_rules 引用）。
 *
 * 这些 extractor 名称与 deterministic-rule-registry.ts 中的 runExtractor 保持一致，
 * 确保 manifest JSON 中的 extractors 字段引用能正确解析。
 */
// ─── 短句修参用 extractors（供 IntentRouter.buildShortCorrectionDelta 动态查找）──

export function extractGroupBy(text: string): string | null {
  if (/按车系|各车系|分车系/.test(text)) return "series";
  if (/按门店|各门店|分门店|每个门店/.test(text)) return "store_name";
  if (/按销售|各销售|销售顾问|顾问/.test(text)) return "owner_name";
  if (/按状态|各状态/.test(text)) return "status";
  if (/按来源|各来源/.test(text)) return "source";
  if (/按意向等级|各意向等级/.test(text)) return "intention_level";
  if (/按类型|各类型/.test(text)) return "order_type";
  return null;
}

export function extractGenericStatus(text: string): string | null {
  if (/待交付|未交付|还没交车|没交车/.test(text)) return "待交付";
  if (/已交付|已经交车/.test(text)) return "已交付";
  if (/整备中/.test(text)) return "整备中";
  if (/已结清|结清/.test(text)) return "已结清";
  if (/未结清|还没结清|欠着/.test(text)) return "未结清";
  if (/部分收款|定金/.test(text)) return "部分收款";
  if (/待结算/.test(text)) return "待结算";
  if (/已到账|到账/.test(text)) return "已到账";
  if (/跟进中|还在跟进/.test(text)) return "跟进中";
  if (/战败|流失/.test(text)) return "已流失";
  if (/施工中|正在施工/.test(text)) return "施工中";
  if (/已核准|核准|通过/.test(text)) return "已核准";
  if (/审核中|厂家审核/.test(text)) return "厂家审核中";
  return null;
}

export function extractLeadIntentionLevel(text: string): string | null {
  if (/高意向|H\s*级|热单/.test(text)) return "H";
  if (/中意向|M\s*级/.test(text)) return "M";
  if (/低意向|L\s*级/.test(text)) return "L";
  return null;
}

export function extractLeadSource(text: string): string | null {
  if (/抖音/.test(text)) return "抖音直播";
  if (/懂车帝/.test(text)) return "懂车帝";
  if (/汽车之家/.test(text)) return "汽车之家";
  if (/自然到店|自然到访|到店/.test(text)) return "自然到店";
  return null;
}

export function normalizeSeries(value: string): string {
  if (value === "汉EV") return "汉";
  if (/唐DM/.test(value)) return "唐";
  return value;
}

export const DEALER_EXTRACTORS: Record<string, (text: string) => JsonValue | undefined> = {
  store: extractStore,
  vehicle_model: extractVehicleModel,
  vehicle_series: extractVehicleSeries,
  time_range: extractTimeRange,
  metric_category: extractMetricCategory,
  metric_severity: (text) => /紧急|严重|最高|最该关注/.test(text) ? "critical" : null,
  lead_intention_level: extractLeadIntentionLevel,
  lead_status: (text) => /战败|流失/.test(text) ? "已流失" : /跟进/.test(text) ? "跟进中" : null,
  lead_source: extractLeadSource,
  warranty_claim_status: extractWarrantyClaimStatus,
  warranty_fault_category: extractWarrantyFaultCategory,
  warranty_evidence_status: extractWarrantyEvidenceStatus,
  amount_min: extractAmountMin,
  finance_resource_type: extractFinanceResourceType,
  finance_direction: extractFinanceDirection,
  price_min: extractPriceMin,
  group_by: extractGroupBy,
  generic_status: extractGenericStatus,
  normalize_series: normalizeSeries as (text: string) => JsonValue | undefined,
};
