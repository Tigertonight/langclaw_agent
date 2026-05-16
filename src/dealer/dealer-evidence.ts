import type { BusinessQueryArgs, QueryFilter, QuerySort, Route, ToolCall } from "../types/agent-contracts.js";

type DealerEvidenceFact =
  | "dealer_metrics"
  | "dealer_inventory_detail"
  | "dealer_lead_detail"
  | "dealer_order_detail"
  | "dealer_finance_detail"
  | "dealer_after_sales_detail"
  | "dealer_warranty_detail";

interface EvidenceResourceSpec {
  resource: string;
  fields: string[];
  sort: QuerySort[];
  limit: number;
}

interface AgentStateWithMissingFacts {
  missing_facts?: string[];
}

interface DealerEvidenceFollowUpInput {
  message?: string;
  route?: Partial<Route> | null;
  agentState?: AgentStateWithMissingFacts | null;
  previousCalls?: ToolCall[];
}

const STORE_ALIASES: Array<[string, string, string[]]> = [
  ["byd-east-flagship", "比亚迪华东旗舰店", ["华东旗舰店", "华东"]],
  ["byd-south-standard", "比亚迪华南标准店", ["华南标准店", "华南"]],
  ["byd-north-satellite", "比亚迪华北卫星店", ["华北卫星店", "华北"]]
];

const EVIDENCE_TO_RESOURCE: Record<DealerEvidenceFact, EvidenceResourceSpec> = {
  dealer_metrics: {
    resource: "dealer_metrics",
    fields: ["store_name", "category", "metric", "value", "unit", "severity", "summary", "recommendation", "related_resource", "related_ids"],
    sort: [{ field: "severity", direction: "asc" }],
    limit: 80
  },
  dealer_inventory_detail: {
    resource: "dealer_vehicles",
    fields: ["vin", "store_name", "series", "model", "status", "stock_age_days", "stock_warning_level", "certificate_status", "landing_cost", "sales_order_id"],
    sort: [{ field: "stock_age_days", direction: "desc" }],
    limit: 30
  },
  dealer_lead_detail: {
    resource: "dealer_leads",
    fields: ["id", "customer_name", "store_name", "owner_name", "intention_level", "status", "created_at", "first_contact_at", "last_followup_at", "followup_count", "visit_count", "lost_reason", "converted_order_id"],
    sort: [{ field: "created_at", direction: "desc" }],
    limit: 30
  },
  dealer_order_detail: {
    resource: "dealer_sales_orders",
    fields: ["id", "store_name", "customer_name", "owner_name", "vin", "series", "order_status", "payment_status", "invoice_status", "delivery_status", "final_price", "gross_profit", "paid_amount", "expected_delivery_date"],
    sort: [{ field: "created_at", direction: "desc" }],
    limit: 30
  },
  dealer_finance_detail: {
    resource: "dealer_finance",
    fields: ["id", "resource_type", "store_name", "direction", "category", "amount", "balance_after", "related_order_id", "occurred_at", "status"],
    sort: [{ field: "occurred_at", direction: "desc" }],
    limit: 30
  },
  dealer_after_sales_detail: {
    resource: "dealer_repair_orders",
    fields: ["id", "store_name", "customer_name", "vin", "series", "service_advisor_name", "order_type", "status", "appointment_at", "promised_finish_at", "receivable_amount", "warranty_claim_id"],
    sort: [{ field: "appointment_at", direction: "desc" }],
    limit: 30
  },
  dealer_warranty_detail: {
    resource: "dealer_warranty_claims",
    fields: ["id", "repair_order_id", "store_name", "customer_name", "vin", "series", "fault_category", "fault_code", "claim_status", "claimed_amount", "approved_amount", "difference_amount", "submitted_at", "evidence_status"],
    sort: [{ field: "submitted_at", direction: "desc" }],
    limit: 30
  }
};

export function inferDealerEvidenceFacts(message?: string, route?: Partial<Route> | null): DealerEvidenceFact[] {
  const text = String(message ?? "");
  if (!isDealerRoute(route) && !/(经销|门店|库存|车辆|库龄|在途|配额|PDI|合格证|线索|意向|到店|战败|锁车|折让金|应付|返利|售后|维修|工单|三包|索赔|比亚迪|旗舰店|标准店|卫星店)/.test(text)) return [];

  const facts: DealerEvidenceFact[] = [];
  const broadReport = /(报告|月报|周报|日报|复盘|看板|晨会|经营计划|行动项|管理动作|原因|方案|数据明细|负责人)/.test(text);
  const analysis = /(分析|风险|承压|健康度|优先级|对比|哪家|最该关注|为什么)/.test(text);

  if (broadReport || analysis || route?.intent_code === "dealer.analysis_query") {
    facts.push("dealer_metrics");
  }

  if (broadReport && /(数据明细|原因|方案|报告|月报|复盘|晨会|经营计划)/.test(text)) {
    facts.push(
      "dealer_inventory_detail",
      "dealer_lead_detail",
      "dealer_order_detail",
      "dealer_finance_detail",
      "dealer_after_sales_detail",
      "dealer_warranty_detail"
    );
  }

  if (/(库存|车辆|库龄|合格证|清库|调拨)/.test(text)) facts.push("dealer_inventory_detail");
  if (/(线索|意向|战败|跟进|首联|转化)/.test(text)) facts.push("dealer_lead_detail");
  if (/(销售|订单|交付|收款|开票|毛利)/.test(text)) facts.push("dealer_order_detail");
  if (/(财务|折让金|应付|返利|现金流|采购)/.test(text)) facts.push("dealer_finance_detail");
  if (/(售后|维修|工单|满意度)/.test(text)) facts.push("dealer_after_sales_detail");
  if (/(三包|索赔|质保|拒赔|证据)/.test(text)) facts.push("dealer_warranty_detail");

  return [...new Set(facts)];
}

export function planDealerEvidenceFollowUp({ message, route, agentState, previousCalls = [] }: DealerEvidenceFollowUpInput): { calls: ToolCall[]; reason?: string } {
  const missingFacts = agentState?.missing_facts ?? [];
  const needed = missingFacts.filter(isDealerEvidenceFact);
  if (!needed.length) return { calls: [] };

  const previousKeys = new Set(previousCalls.map((call) => callKey(call)));
  const calls: ToolCall[] = [];
  for (const fact of needed) {
    const spec = EVIDENCE_TO_RESOURCE[fact];
    const args = buildEvidenceArgs({ spec, message, route, fact });
    const call = {
      name: "query_business_data",
      args
    };
    const key = callKey(call);
    if (previousKeys.has(key)) continue;
    previousKeys.add(key);
    calls.push(call);
    if (calls.length >= 3) break;
  }

  return {
    calls,
    reason: calls.length ? "长任务证据清单仍有缺口，继续补齐经销商经营明细。" : "经销商证据查询已覆盖。"
  };
}

function buildEvidenceArgs({ spec, message, fact }: { spec: EvidenceResourceSpec; message?: string; route?: Partial<Route> | null; fact: DealerEvidenceFact }): BusinessQueryArgs {
  const filters: QueryFilter[] = [];
  const store = inferStore(message);
  if (store) filters.push({ field: "store_name", op: "eq", value: store.name });

  if (fact === "dealer_inventory_detail") {
    filters.push({ field: "stock_warning_level", op: "in", value: ["关注", "预警", "紧急"] });
  }
  if (fact === "dealer_lead_detail") {
    filters.push({ field: "status", op: "in", value: ["待首次联系", "跟进中", "战败"] });
  }
  if (fact === "dealer_order_detail") {
    filters.push({ field: "delivery_status", op: "neq", value: "已交付" });
  }
  if (fact === "dealer_after_sales_detail") {
    filters.push({ field: "status", op: "neq", value: "已结算" });
  }

  return {
    resource: spec.resource,
    operation: "search",
    filters,
    metrics: [],
    fields: spec.fields,
    sort: spec.sort,
    limit: spec.limit,
    display: {
      domain: "dealer",
      evidence_fact: fact,
      reason: "为长任务报告/复盘补齐可引用的业务明细证据"
    }
  };
}

function inferStore(message?: string): { name: string } | null {
  const text = String(message ?? "");
  const matched = STORE_ALIASES.find(([, fullName, aliases]) => text.includes(fullName) || aliases.some((alias) => text.includes(alias)));
  return matched ? { name: matched[1] } : null;
}

function isDealerRoute(route?: Partial<Route> | null): boolean {
  return String(route?.intent_code ?? "").startsWith("dealer.");
}

function callKey(call: ToolCall): string {
  const args = call.args ?? {};
  return JSON.stringify({
    name: call.name,
    resource: args.resource,
    operation: args.operation ?? "search",
    filters: args.filters ?? []
  });
}

function isDealerEvidenceFact(fact: string): fact is DealerEvidenceFact {
  return fact.startsWith("dealer_") && fact in EVIDENCE_TO_RESOURCE;
}
