import { loadJson } from "../data/load-json.js";
import type { JsonObject, JsonValue } from "../types/agent-contracts.js";

interface DealerRow extends JsonObject {
  id?: string;
  vin?: string;
  store_name?: string;
  stock_warning_level?: string;
  certificate_status?: string;
  order_status?: string;
  delivery_status?: string;
  payment_status?: string;
  intention_level?: string;
  converted_order_id?: string;
  status?: string;
  first_contact_at?: string;
  resource_type?: string;
  occurred_at?: string;
  balance_after?: number;
  amount?: number;
  difference_amount?: number;
  claimed_amount?: number;
  evidence_status?: string;
  claim_status?: string;
}

interface DealerMetric extends JsonObject {
  id: string;
  scope: "store";
  store_name: string;
  category: string;
  metric: string;
  value: JsonValue;
  unit: string;
  severity: "critical" | "warning" | "normal";
  summary: string;
  recommendation: string;
  related_resource: string;
  related_ids: string[];
}

interface BuildStoreMetricsInput {
  storeName: string;
  vehicles: DealerRow[];
  leads: DealerRow[];
  orders: DealerRow[];
  finance: DealerRow[];
  repairOrders: DealerRow[];
  warrantyClaims: DealerRow[];
}

interface MetricInput {
  storeName: string;
  category: string;
  metric: string;
  value: JsonValue;
  unit: string;
  severity: "critical" | "warning" | "normal";
  summary: string;
  recommendation: string;
  related_resource: string;
  related_ids: unknown[];
}

export async function buildDealerMetrics(): Promise<DealerMetric[]> {
  const [vehicles, leads, orders, finance, repairOrders, warrantyClaims] = await Promise.all([
    loadJson<DealerRow[]>("data/dealer-vehicles.json"),
    loadJson<DealerRow[]>("data/dealer-leads.json"),
    loadJson<DealerRow[]>("data/dealer-sales-orders.json"),
    loadJson<DealerRow[]>("data/dealer-finance.json"),
    loadJson<DealerRow[]>("data/dealer-repair-orders.json"),
    loadJson<DealerRow[]>("data/dealer-warranty-claims.json")
  ]);

  const stores = [...new Set([
    ...vehicles.map((item) => item.store_name),
    ...leads.map((item) => item.store_name),
    ...orders.map((item) => item.store_name),
    ...finance.map((item) => item.store_name),
    ...repairOrders.map((item) => item.store_name),
    ...warrantyClaims.map((item) => item.store_name)
  ].filter(Boolean))];

  return stores.flatMap((storeName) => buildStoreMetrics({
    storeName,
    vehicles: vehicles.filter((item) => item.store_name === storeName),
    leads: leads.filter((item) => item.store_name === storeName),
    orders: orders.filter((item) => item.store_name === storeName),
    finance: finance.filter((item) => item.store_name === storeName),
    repairOrders: repairOrders.filter((item) => item.store_name === storeName),
    warrantyClaims: warrantyClaims.filter((item) => item.store_name === storeName)
  }));
}

function buildStoreMetrics({ storeName, vehicles, leads, orders, finance, repairOrders, warrantyClaims }: BuildStoreMetricsInput): DealerMetric[] {
  const riskyVehicles = vehicles.filter((item) => ["关注", "预警", "紧急"].includes(item.stock_warning_level));
  const urgentVehicles = vehicles.filter((item) => item.stock_warning_level === "紧急");
  const mortgagedVehicles = vehicles.filter((item) => item.certificate_status === "已抵押");
  const pendingOrders = orders.filter((item) => item.order_status === "待交付" || String(item.delivery_status ?? "").includes("待") || item.delivery_status === "整备中");
  const unpaidOrders = orders.filter((item) => item.payment_status !== "已结清");
  const hotLeads = leads.filter((item) => ["H", "A"].includes(item.intention_level) && !item.converted_order_id && item.status !== "战败");
  const noContactLeads = leads.filter((item) => item.status === "待首次联系" || !item.first_contact_at);
  const lostLeads = leads.filter((item) => item.status === "战败");
  const walletRows = finance.filter((item) => item.resource_type === "discount_wallet");
  const latestWallet = walletRows.slice().sort((left, right) => String(right.occurred_at).localeCompare(String(left.occurred_at)))[0];
  const unsettledPayables = finance.filter((item) => item.resource_type === "payable" && item.status !== "已结清");
  const pendingRebates = finance.filter((item) => item.resource_type === "rebate" && item.status !== "已入账");
  const pendingRepairOrders = repairOrders.filter((item) => item.status !== "已结算" && item.status !== "已关闭");
  const riskyClaims = warrantyClaims.filter((item) => item.claim_status === "已拒绝" || Number(item.difference_amount ?? 0) > 0 || item.evidence_status === "照片不足");

  return [
    metric({
      storeName,
      category: "inventory",
      metric: "stock_risk_vehicle_count",
      value: riskyVehicles.length,
      unit: "辆",
      severity: urgentVehicles.length > 0 ? "critical" : riskyVehicles.length > 0 ? "warning" : "normal",
      summary: `${storeName} 有 ${riskyVehicles.length} 辆库龄风险车，其中 ${urgentVehicles.length} 辆紧急。`,
      recommendation: urgentVehicles.length > 0 ? "优先处理90天以上库存，制定清库、调拨或促销方案。" : "持续跟踪关注级库存周转。",
      related_resource: "dealer_vehicles",
      related_ids: riskyVehicles.map((item) => item.vin)
    }),
    metric({
      storeName,
      category: "inventory",
      metric: "mortgaged_certificate_vehicle_count",
      value: mortgagedVehicles.length,
      unit: "辆",
      severity: mortgagedVehicles.length >= 2 ? "warning" : "normal",
      summary: `${storeName} 有 ${mortgagedVehicles.length} 辆车合格证处于抵押状态。`,
      recommendation: "结合待交付订单检查解押节奏，避免交付被合格证卡住。",
      related_resource: "dealer_vehicles",
      related_ids: mortgagedVehicles.map((item) => item.vin)
    }),
    metric({
      storeName,
      category: "sales",
      metric: "pending_delivery_order_count",
      value: pendingOrders.length,
      unit: "单",
      severity: pendingOrders.length > 0 ? "warning" : "normal",
      summary: `${storeName} 有 ${pendingOrders.length} 张订单仍在待交付或整备相关状态。`,
      recommendation: "逐单检查收款、整备、开票和合格证状态，保障交付节点。",
      related_resource: "dealer_sales_orders",
      related_ids: pendingOrders.map((item) => item.id)
    }),
    metric({
      storeName,
      category: "sales",
      metric: "unpaid_order_count",
      value: unpaidOrders.length,
      unit: "单",
      severity: unpaidOrders.length > 0 ? "warning" : "normal",
      summary: `${storeName} 有 ${unpaidOrders.length} 张订单尚未结清收款。`,
      recommendation: "优先跟进部分收款订单和金融放款到账。",
      related_resource: "dealer_sales_orders",
      related_ids: unpaidOrders.map((item) => item.id)
    }),
    metric({
      storeName,
      category: "lead",
      metric: "hot_open_lead_count",
      value: hotLeads.length,
      unit: "条",
      severity: hotLeads.length > 0 ? "warning" : "normal",
      summary: `${storeName} 有 ${hotLeads.length} 条H/A级未成交线索。`,
      recommendation: "优先邀约到店试驾，并针对车型库存匹配成交方案。",
      related_resource: "dealer_leads",
      related_ids: hotLeads.map((item) => item.id)
    }),
    metric({
      storeName,
      category: "lead",
      metric: "no_contact_lead_count",
      value: noContactLeads.length,
      unit: "条",
      severity: noContactLeads.length > 0 ? "critical" : "normal",
      summary: `${storeName} 有 ${noContactLeads.length} 条线索未完成首次联系。`,
      recommendation: "首次联系超时会显著影响转化，应当天清零。",
      related_resource: "dealer_leads",
      related_ids: noContactLeads.map((item) => item.id)
    }),
    metric({
      storeName,
      category: "lead",
      metric: "lost_lead_count",
      value: lostLeads.length,
      unit: "条",
      severity: lostLeads.length > 0 ? "warning" : "normal",
      summary: `${storeName} 有 ${lostLeads.length} 条战败线索。`,
      recommendation: "复盘战败原因，重点关注价格型战败是否反映定价策略问题。",
      related_resource: "dealer_leads",
      related_ids: lostLeads.map((item) => item.id)
    }),
    metric({
      storeName,
      category: "finance",
      metric: "discount_wallet_balance",
      value: latestWallet?.balance_after ?? 0,
      unit: "元",
      severity: Number(latestWallet?.balance_after ?? 0) < 100000 ? "critical" : Number(latestWallet?.balance_after ?? 0) < 300000 ? "warning" : "normal",
      summary: `${storeName} 折让金最新余额为 ${latestWallet?.balance_after ?? 0} 元。`,
      recommendation: "结合近期采购计划评估折让金抵扣能力。",
      related_resource: "dealer_finance",
      related_ids: latestWallet ? [latestWallet.id] : []
    }),
    metric({
      storeName,
      category: "finance",
      metric: "unsettled_payable_amount",
      value: sum(unsettledPayables.map((item) => item.amount)),
      unit: "元",
      severity: unsettledPayables.length > 0 ? "warning" : "normal",
      summary: `${storeName} 未结清应付金额为 ${sum(unsettledPayables.map((item) => item.amount))} 元。`,
      recommendation: "关注账期到期和现金流安排。",
      related_resource: "dealer_finance",
      related_ids: unsettledPayables.map((item) => item.id)
    }),
    metric({
      storeName,
      category: "finance",
      metric: "pending_rebate_amount",
      value: sum(pendingRebates.map((item) => item.amount)),
      unit: "元",
      severity: pendingRebates.length > 0 ? "warning" : "normal",
      summary: `${storeName} 待结算返利金额为 ${sum(pendingRebates.map((item) => item.amount))} 元。`,
      recommendation: "跟进返利结算进度，避免折让金入账滞后影响采购。",
      related_resource: "dealer_finance",
      related_ids: pendingRebates.map((item) => item.id)
    }),
    metric({
      storeName,
      category: "after_sales",
      metric: "open_repair_order_count",
      value: pendingRepairOrders.length,
      unit: "单",
      severity: pendingRepairOrders.length > 0 ? "warning" : "normal",
      summary: `${storeName} 有 ${pendingRepairOrders.length} 张售后工单未关闭。`,
      recommendation: "跟进施工、质检和结算节点，避免超时。",
      related_resource: "dealer_repair_orders",
      related_ids: pendingRepairOrders.map((item) => item.id)
    }),
    metric({
      storeName,
      category: "warranty",
      metric: "warranty_claim_loss_risk_amount",
      value: sum(riskyClaims.map((item) => item.difference_amount ?? item.claimed_amount ?? 0)),
      unit: "元",
      severity: riskyClaims.length > 0 ? "critical" : "normal",
      summary: `${storeName} 三包索赔损失风险金额为 ${sum(riskyClaims.map((item) => item.difference_amount ?? item.claimed_amount ?? 0))} 元。`,
      recommendation: "优先补齐照片不足的索赔材料，并复盘被拒原因。",
      related_resource: "dealer_warranty_claims",
      related_ids: riskyClaims.map((item) => item.id)
    })
  ];
}

function metric({
  storeName,
  category,
  metric,
  value,
  unit,
  severity,
  summary,
  recommendation,
  related_resource,
  related_ids
}: MetricInput): DealerMetric {
  return {
    id: `DM-${storeName}-${metric}`.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, "-"),
    scope: "store",
    store_name: storeName,
    category,
    metric,
    value,
    unit,
    severity,
    summary,
    recommendation,
    related_resource,
    related_ids: related_ids.filter((id): id is string => typeof id === "string")
  };
}

function sum(values: Array<unknown>): number {
  return values.map(Number).filter(Number.isFinite).reduce((total, value) => total + value, 0);
}
