import type {
  DeterministicRuleManifest,
  IntentManifest,
  JsonObject,
  JsonValue,
  Route
} from "../types/agent-contracts.js";

interface DeterministicRuleRegistryInput {
  registry?: { listCodes?: () => IntentManifest[] };
  createRoute?: (intentCode: string, params: JsonObject, reasoning: string) => Route | null;
}

interface ManifestRule extends DeterministicRuleManifest {
  intent_code: string;
  manifest_description?: string;
}

interface MatchedRule {
  intent_code: string;
  params: JsonObject;
  reasoning: string;
}

type RuleFn = (text: string) => MatchedRule | null;
type ExtractorFn = (text: string) => JsonValue | undefined;

export class DeterministicRuleRegistry {
  private readonly createRoute?: DeterministicRuleRegistryInput["createRoute"];
  private readonly manifestRules: ManifestRule[];
  private readonly rules: RuleFn[];

  constructor({ registry, createRoute }: DeterministicRuleRegistryInput = {}) {
    this.createRoute = createRoute;
    this.manifestRules = buildManifestRules(registry);
    this.rules = [
      leaveRequestRule,
      leaveQueryRule,
      knowledgePolicyRule,
      financeAmountRule,
      salesAmountRule,
      dealerMetricsRule,
      agenticComparisonRule,
      warrantyClaimsRule,
      leadsAggregateRule,
      financeAggregateRule,
      salesStatusAggregateRule,
      salesAggregateRule,
      repairAggregateRule,
      repairQueryRule,
      salesOrdersRule,
      financeQueryRule,
      inventoryQueryRule,
      leadsQueryRule
    ];
  }

  match({ message }: { message?: string } = {}): Route | null {
    const text = String(message ?? "").trim();
    if (!text || typeof this.createRoute !== "function") return null;
    for (const rule of this.manifestRules) {
      const matched = matchManifestRule(rule, text);
      if (!matched) continue;
      return this.createRoute(matched.intent_code, matched.params, matched.reasoning);
    }
    for (const rule of this.rules) {
      const matched = rule(text);
      if (!matched) continue;
      return this.createRoute(matched.intent_code, matched.params, matched.reasoning);
    }
    return null;
  }
}

function buildManifestRules(registry?: { listCodes?: () => IntentManifest[] }): ManifestRule[] {
  if (!registry || typeof registry.listCodes !== "function") return [];
  return registry.listCodes()
    .flatMap((manifest) => (manifest.deterministic_rules ?? []).map((rule) => ({
      ...rule,
      intent_code: rule.intent_code ?? manifest.intent_code,
      manifest_description: manifest.description
    })))
    .filter((rule) => rule.enabled !== false && typeof rule.intent_code === "string" && Array.isArray(rule.patterns))
    .map((rule) => rule as ManifestRule)
    .sort((a, b) => Number(a.priority ?? 100) - Number(b.priority ?? 100));
}

function matchManifestRule(rule: ManifestRule, text: string): MatchedRule | null {
  const positive = rule.patterns.some((pattern) => new RegExp(pattern).test(text));
  if (!positive) return null;
  if ((rule.negative_patterns ?? []).some((pattern) => new RegExp(pattern).test(text))) return null;
  const params: JsonObject = { ...(rule.params ?? {}) };
  for (const [paramName, extractorName] of Object.entries(rule.extractors ?? {})) {
    params[paramName] = runExtractor(extractorName, text);
  }
  return {
    intent_code: rule.intent_code,
    params,
    reasoning: rule.reasoning ?? `命中 manifest 确定性规则：${rule.name ?? rule.intent_code}。`
  };
}

function runExtractor(name: string, text: string): JsonValue | undefined {
  const extractors: Record<string, ExtractorFn> = {
    store: extractStore,
    vehicle_model: extractVehicleModel,
    vehicle_series: extractVehicleSeries,
    time_range: extractTimeRange,
    leave_scope: extractLeaveQueryScope,
    leave_department: extractLeaveDepartment,
    leave_type: extractLeaveType,
    leave_time_range: (value) => extractLeaveQueryTimeRange(value) ?? "近三个月",
    metric_category: extractMetricCategory,
    metric_severity: (value) => /紧急|严重|最高|最该关注/.test(value) ? "critical" : null,
    lead_intention_level: (value) => /高意向|H\s*级|热单/.test(value) ? "H" : null,
    lead_status: (value) => /战败|流失/.test(value) ? "已流失" : /跟进/.test(value) ? "跟进中" : null,
    lead_source: (value) => /抖音/.test(value) ? "抖音直播" : /自然到店|自然到访/.test(value) ? "自然到店" : null,
    warranty_claim_status: extractWarrantyClaimStatus,
    warranty_fault_category: extractWarrantyFaultCategory,
    warranty_evidence_status: extractWarrantyEvidenceStatus,
    amount_min: extractAmountMin,
    finance_resource_type: extractFinanceResourceType,
    finance_direction: extractFinanceDirection,
    price_min: extractPriceMin
  };
  return extractors[name]?.(text) ?? null;
}

function leaveQueryRule(text: string): MatchedRule | null {
  if (!/(请假记录|请假历史|请假情况|请假次数|休假记录|休假历史|休假情况|谁请假|最近请假|查.*请假|看.*请假)/.test(text)) return null;
  return {
    intent_code: "attendance.leave_query",
    params: {
      scope: extractLeaveQueryScope(text),
      department: extractLeaveDepartment(text),
      leave_type: extractLeaveType(text),
      time_range: extractLeaveQueryTimeRange(text) ?? "近三个月",
      status: null,
      limit: null
    },
    reasoning: "命中请假记录查询高确定性本地预路由。"
  };
}

function leaveRequestRule(text: string): MatchedRule | null {
  if (!looksLikeLeaveRequest(text)) return null;
  return {
    intent_code: "workflow.leave_request",
    params: {
      leave_type: extractLeaveType(text),
      start_time: extractLeaveStartTime(text),
      end_time: null,
      reason: extractLeaveReason(text)
    },
    reasoning: "命中请假申请高确定性本地预路由。"
  };
}

function knowledgePolicyRule(text: string): MatchedRule | null {
  if (!/(制度|政策|规则|手册|报销|试用期|年假|病假|权限|审批|流程)/.test(text)) return null;
  return {
    intent_code: "knowledge.policy_qa",
    params: {},
    reasoning: "命中知识制度问答高确定性本地预路由。"
  };
}

function agenticComparisonRule(text: string): MatchedRule | null {
  if (!/(对比|相比|环比|跟上周比|和上周比)/.test(text)) return null;
  return {
    intent_code: "general",
    params: {
      original_reasoning: "跨时间或跨指标对比，需要自主规划多次查询后综合回答。"
    },
    reasoning: "命中跨期对比问题，转入 agentic。"
  };
}

function financeAmountRule(text: string): MatchedRule | null {
  if (!/(应付|应收|款).*\d+\s*万以上|\d+\s*万以上.*(应付|应收|款)/.test(text)) return null;
  return {
    intent_code: "dealer.query.finance",
    params: {
      store: extractStore(text),
      resource_type: extractFinanceResourceType(text),
      amount_min: extractPriceMin(text)
    },
    reasoning: "命中财务金额阈值高确定性本地预路由。"
  };
}

function salesAmountRule(text: string): MatchedRule | null {
  if (!/改成\s*\d+\s*万以上|\d+\s*万以上/.test(text)) return null;
  return {
    intent_code: "dealer.query.sales_orders",
    params: {
      store: extractStore(text),
      price_min: extractPriceMin(text)
    },
    reasoning: "命中金额阈值高确定性本地预路由。"
  };
}

function dealerMetricsRule(text: string): MatchedRule | null {
  if (!/经营风险|风险总览|经营周报|晨会|最该关注|优先级|财务风险|库存压力|损失风险复盘|三包.*风险|售后.*风险/.test(text)) return null;
  return {
    intent_code: "dealer.query.metrics",
    params: {
      store: extractStore(text),
      category: extractMetricCategory(text),
      severity: /紧急|严重|最高|最该关注/.test(text) ? "critical" : null
    },
    reasoning: "命中经营指标高确定性本地预路由。"
  };
}

function warrantyClaimsRule(text: string): MatchedRule | null {
  if (!/(三包|索赔|保修|质保)/.test(text)) return null;
  return {
    intent_code: "dealer.query.warranty_claims",
    params: {
      store: extractStore(text),
      series: extractVehicleSeries(text),
      claim_status: extractWarrantyClaimStatus(text),
      fault_category: extractWarrantyFaultCategory(text),
      evidence_status: extractWarrantyEvidenceStatus(text),
      time_range: extractTimeRange(text),
      difference_min: extractAmountMin(text)
    },
    reasoning: "命中三包索赔高确定性本地预路由。"
  };
}

function leadsAggregateRule(text: string): MatchedRule | null {
  if (!/(线索.*转化率|转化率|线索数|多少线索|各.*线索|各.*意向等级|各.*来源)/.test(text)) return null;
  return {
    intent_code: "dealer.aggregate.leads",
    params: {
      metric: /转化率/.test(text) ? "conversion_rate" : "lead_count",
      group_by: extractLeadGroupBy(text),
      store: extractStore(text),
      intention_level: /高意向|H\s*级|热单/.test(text) ? "H" : null,
      source: /抖音/.test(text) ? "抖音直播" : null,
      time_range: extractTimeRange(text)
    },
    reasoning: "命中线索聚合高确定性本地预路由。"
  };
}

function financeAggregateRule(text: string): MatchedRule | null {
  if (!/(应付|应收|返利|折让金|款项).*(合计|总额|总共|多少|分别|分布)|各门店.*应付/.test(text)) return null;
  return {
    intent_code: "dealer.aggregate.finance",
    params: {
      metric: /未结清|待结算|没到账|未到账/.test(text) ? "unsettled_amount" : "total_amount",
      group_by: /各门店|每个门店|分布/.test(text) ? "store_name" : null,
      resource_type: extractFinanceResourceType(text),
      store: extractStore(text),
      direction: extractFinanceDirection(text),
      status: /未结清|还没结清|待结算|没到账|未到账/.test(text) ? (/待结算/.test(text) ? "待结算" : "未结清") : null,
      time_range: extractTimeRange(text)
    },
    reasoning: "命中财务聚合高确定性本地预路由。"
  };
}

function salesStatusAggregateRule(text: string): MatchedRule | null {
  if (!/签单状态|订单状态.*(分布|统计|情况)|按订单状态|客户.*签单状态/.test(text)) return null;
  return {
    intent_code: "dealer.aggregate.sales_orders",
    params: {
      metric: "order_count",
      group_by: "order_status",
      store: extractStore(text),
      series: extractVehicleSeries(text),
      time_range: extractTimeRange(text)
    },
    reasoning: "命中订单状态聚合高确定性本地预路由。"
  };
}

function salesAggregateRule(text: string): MatchedRule | null {
  if (!/毛利率|毛利|成交总额|平均成交价|最高.*成交|成交价最高|销售排行榜|卖得最好|卖了多少|多少单|各门店.*成交|各销售顾问|按车系/.test(text)) return null;
  return {
    intent_code: "dealer.aggregate.sales_orders",
    params: {
      metric: extractSalesMetric(text),
      group_by: extractSalesGroupBy(text),
      store: extractStore(text),
      series: extractVehicleSeries(text),
      time_range: extractTimeRange(text)
    },
    reasoning: "命中销售聚合高确定性本地预路由。"
  };
}

function repairAggregateRule(text: string): MatchedRule | null {
  if (!(/(工单|维修).*(多少|总共|平均|合计|金额)|平均工时费/.test(text) && !/上周|对比|环比/.test(text))) return null;
  return {
    intent_code: "dealer.aggregate.repair_orders",
    params: {
      metric: extractRepairMetric(text),
      group_by: null,
      store: extractStore(text),
      time_range: extractTimeRange(text)
    },
    reasoning: "命中维修工单聚合高确定性本地预路由。"
  };
}

function repairQueryRule(text: string): MatchedRule | null {
  if (!(/维修工单|工单|超期|逾期|施工|事故维修|常规保养|服务顾问/.test(text) && !/上周|对比|环比/.test(text))) return null;
  return {
    intent_code: "dealer.query.repair_orders",
    params: {
      store: extractStore(text),
      status: /超期|逾期/.test(text) ? "未交付" : /施工/.test(text) ? "施工中" : null,
      order_type: /事故/.test(text) ? "事故维修" : /保养/.test(text) ? "常规保养" : null,
      overdue_only: /超期|逾期/.test(text) ? true : null,
      time_range: extractTimeRange(text)
    },
    reasoning: "命中维修工单高确定性本地预路由。"
  };
}

function salesOrdersRule(text: string): MatchedRule | null {
  if (!/销售订单|成交订单|成交了哪些订单|哪几单|华东订单|华南订单|待交付|未交付|交车|结清款项|按揭|分期|定金|开票|发票/.test(text)) return null;
  return {
    intent_code: "dealer.query.sales_orders",
    params: {
      store: extractStore(text),
      owner: extractOwner(text),
      delivery_status: /待交付|未交付|交车/.test(text) ? "待交付" : null,
      payment_status: /定金|还没付完/.test(text) ? "部分收款" : /结清/.test(text) ? "已结清" : null,
      order_type: /按揭|分期|贷款/.test(text) ? "按揭" : null,
      time_range: extractTimeRange(text)
    },
    reasoning: "命中销售订单高确定性本地预路由。"
  };
}

function financeQueryRule(text: string): MatchedRule | null {
  if (!/折让金|返利|应付|应收|收款|收到|付款|付了|入账|出账|首付|款项|流水/.test(text)) return null;
  return {
    intent_code: "dealer.query.finance",
    params: {
      store: extractStore(text),
      resource_type: extractFinanceResourceType(text),
      category: /首付/.test(text) ? "客户首付" : null,
      direction: extractFinanceDirection(text),
      status: /未结清|还没结清|待结算|没到账|未到账/.test(text) ? (/待结算/.test(text) ? "待结算" : "未结清") : null,
      time_range: extractTimeRange(text)
    },
    reasoning: "命中财务流水高确定性本地预路由。"
  };
}

function inventoryQueryRule(text: string): MatchedRule | null {
  if (!/库存|库龄|配额|承诺交期|交期|在途|整车|预警|融资车|有车|订一台|关注级别.*车/.test(text)) return null;
  return {
    intent_code: "dealer.query.inventory",
    params: {
      store: extractStore(text),
      vehicle_model: extractVehicleModel(text),
      warning_level: /紧急/.test(text) ? "紧急" : /关注/.test(text) ? "关注" : null,
      time_range: extractTimeRange(text)
    },
    reasoning: "命中库存高确定性本地预路由。"
  };
}

function leadsQueryRule(text: string): MatchedRule | null {
  if (!/线索|高意向|H\s*级|热单|战败|漏斗|跟进|新进|想买|抖音|自然到店|自然到访/.test(text)) return null;
  return {
    intent_code: "dealer.query.leads",
    params: {
      store: extractStore(text),
      series: extractVehicleSeries(text),
      intention_level: /高意向|H\s*级|热单/.test(text) ? "H" : null,
      status: /战败|流失/.test(text) ? "已流失" : /跟进/.test(text) ? "跟进中" : null,
      source: /抖音/.test(text) ? "抖音直播" : /自然到店|自然到访/.test(text) ? "自然到店" : null,
      time_range: extractTimeRange(text)
    },
    reasoning: "命中销售线索高确定性本地预路由。"
  };
}

function extractStore(text: string): string | null {
  if (/华东旗舰店|华东/.test(text)) return "华东旗舰店";
  if (/华南标准店|华南/.test(text)) return "华南标准店";
  return null;
}

function extractOwner(text: string): string | null {
  if (/林悦/.test(text)) return "林悦";
  if (/沈清和/.test(text)) return "沈清和";
  if (/孟云岚/.test(text)) return "孟云岚";
  return null;
}

function extractTimeRange(text: string): string | null {
  if (/本月|这个月/.test(text)) return "本月";
  if (/上月|上个月/.test(text)) return "上月";
  if (/本周|这周/.test(text)) return "本周";
  if (/今天|今日/.test(text)) return "今天";
  if (/昨天|昨日/.test(text)) return "昨天";
  if (/最近|近一个月/.test(text)) return "近一个月";
  return null;
}

function extractFinanceResourceType(text: string): string | null {
  if (/折让金/.test(text)) return "discount_wallet";
  if (/返利/.test(text)) return "rebate";
  if (/应付|付款|付了|付完|款项/.test(text)) return "payable";
  if (/应收/.test(text)) return "receivable";
  if (/收款|收到|入账|到账|首付/.test(text)) return "receipt";
  return null;
}

function extractFinanceDirection(text: string): string | null {
  if (/出账|付款|付了|付完|扣款|支出/.test(text)) return "出账";
  if (/收款|收到|入账|到账|首付/.test(text)) return "收款";
  return null;
}

function extractPriceMin(text: string): number | null {
  const match = text.match(/(\d+(?:\.\d+)?)\s*万以上/);
  if (match) return Number(match[1]) * 10000;
  return null;
}

function extractAmountMin(text: string): number | null {
  const match = text.match(/(?:超过|大于|不少于|至少)\s*(\d+(?:\.\d+)?)\s*万?/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return /万/.test(match[0]) ? value * 10000 : value;
}

function extractMetricCategory(text: string): string | null {
  if (/库存/.test(text) && /线索/.test(text)) return "inventory";
  if (/库存/.test(text)) return "inventory";
  if (/财务|折让金|返利|应付|应收|收款|付款/.test(text)) return "finance";
  if (/三包|索赔|质保|保修/.test(text)) return "warranty";
  if (/售后|维修|工单/.test(text)) return "after_sales";
  return null;
}

function extractLeadGroupBy(text: string): string | null {
  if (/意向等级/.test(text)) return "intention_level";
  if (/来源/.test(text)) return "source";
  if (/各门店|每个门店/.test(text)) return "store_name";
  if (/销售顾问|顾问/.test(text)) return "owner_name";
  return null;
}

function extractSalesMetric(text: string): string {
  if (/毛利率|毛利/.test(text)) return "gross_margin";
  if (/平均成交价/.test(text)) return "avg_price";
  if (/最高/.test(text)) return "max_price";
  if (/卖了多少|多少台|多少单/.test(text)) return "order_count";
  return "total_revenue";
}

function extractSalesGroupBy(text: string): string | null {
  if (/车系|按车系/.test(text)) return "series";
  if (/各门店|每个门店/.test(text)) return "store_name";
  if (/销售顾问|排行榜|谁卖得最好/.test(text)) return "owner_name";
  return null;
}

function extractRepairMetric(text: string): string {
  if (/平均工时费|平均/.test(text)) return "avg_labor";
  if (/应收|结算金额|金额|合计/.test(text)) return "total_receivable";
  return "order_count";
}

function extractVehicleSeries(text: string): string | null {
  const known = ["汉EV", "宋L", "海豹", "秦PLUS", "唐", "汉", "宋"];
  const matched = known.find((item) => text.includes(item));
  if (!matched) return null;
  if (matched === "汉EV") return "汉";
  return matched;
}

function extractWarrantyClaimStatus(text: string): string | null {
  if (/(被拒|驳回|拒绝)/.test(text)) return "已驳回";
  if (/审核|厂家/.test(text)) return "厂家审核中";
  if (/核准|通过/.test(text)) return "已核准";
  if (/结算/.test(text)) return "已结算";
  if (/待提交|未提交/.test(text)) return "待提交";
  return null;
}

function extractWarrantyFaultCategory(text: string): string | null {
  if (/三电|电池|电机|电控/.test(text)) return "三电";
  if (/内饰/.test(text)) return "内饰";
  if (/电气/.test(text)) return "电气";
  if (/底盘/.test(text)) return "底盘";
  return null;
}

function extractWarrantyEvidenceStatus(text: string): string | null {
  if (/证据缺失|缺照片/.test(text)) return "缺照片";
  if (/缺工时单/.test(text)) return "缺工时单";
  if (/照片齐全|证据齐全/.test(text)) return "照片齐全";
  return null;
}

function looksLikeLeaveRequest(text: string): boolean {
  if (/(请假记录|请假历史|请假情况|请假次数|谁请假|最近请假|查.*请假|看.*请假)/.test(text)) return false;
  return /(想请假|我要请|我想请|帮我请|帮我申请.*假|申请.*假|请个假|休假|走个假勤|请.*年假|请.*病假|请.*事假|请.*调休)/.test(text);
}

function extractLeaveType(text: string): string | null {
  if (/年假/.test(text)) return "年假";
  if (/病假/.test(text)) return "病假";
  if (/事假|家里有事/.test(text)) return "事假";
  if (/调休/.test(text)) return "调休";
  return null;
}

function extractLeaveStartTime(text: string): string | null {
  if (/后天/.test(text)) return "后天";
  if (/明天/.test(text)) return "明天";
  if (/今天|下午|上午/.test(text)) return "今天";
  return null;
}

function extractLeaveReason(text: string): string | null {
  const reasonMatch = text.match(/因为(.+)$/);
  if (reasonMatch?.[1]) return reasonMatch[1].trim();
  if (/家里有事/.test(text)) return "家里有事";
  if (/身体不舒服|不舒服/.test(text)) return "身体不舒服";
  return null;
}

function extractLeaveQueryScope(text: string): string | null {
  if (/我|我的|本人/.test(text)) return "self";
  if (/下面|下属|下级|团队|组员|同学/.test(text)) return "team";
  if (/全公司|整个公司|公司/.test(text)) return "company";
  return null;
}

function extractLeaveDepartment(text: string): string | null {
  if (/销售部/.test(text)) return "销售部";
  if (/人事部|人力资源|行政人事/.test(text)) return "人事部";
  return null;
}

function extractLeaveQueryTimeRange(text: string): string | null {
  if (/近三个月|最近三个月|过去三个月/.test(text)) return "近三个月";
  if (/近一个月|最近一个月|过去一个月|最近/.test(text)) return "近一个月";
  if (/本月|这个月/.test(text)) return "本月";
  return null;
}

function extractVehicleModel(text: string): string | null {
  const known = ["汉EV", "唐DM-p", "唐DM", "宋L", "海豹", "汉", "唐", "宋"];
  return known.find((item) => text.includes(item)) ?? null;
}
