/**
 * Dealer 域的查询启发式函数。
 *
 * 从 src/query/query-parser.ts 迁移而来的 NLP 启发式逻辑，
 * 用于识别经销商相关问题、推断查询目标、解析查询参数。
 *
 * 这些函数通过 DomainQueryAdapter 的 isRelevantQuestion / parseQuery / planMultiQuery
 * 接口注册到 DomainRegistry，供 query-parser 动态调用。
 */

import { createQueryIR } from "../../query/query-ir.js";
import type { QueryFilter, QueryIR, QuerySort } from "../../types/agent-contracts.js";

// ─── 问题识别 ────────────────────────────────────────────────────────────────

export function isDealerQuestion(question: unknown): boolean {
  return /(WC-\d{6}-\d{3}|RO-\d{6}-\d{3}|经销商|DMS|门店|华东旗舰店|华南标准店|华北卫星店|总经理|经营体系|经销商体系|晨会|经营计划|行动项|VIN|整车|车辆|库存|库龄|在途|配额|PDI|合格证|展车|试驾车|调拨|线索|意向|到店|战败|漏斗|销售订单|待交付订单|锁车|承诺交期|订一台|订车|折让金|应付|应收|返利|售后|维修|保养|工单|三包|质保|索赔|汉EV|宋L|海豹|秦PLUS|元PLUS|腾势N7)/i.test(String(question ?? ""));
}

export function isDealerAnalysisQuestion(question: unknown): boolean {
  const text = String(question ?? "");
  if (isSimpleOwnerLookup(text)) return false;
  const hasAnalysisView = /(经营|分析|日报|周报|复盘|最该关注|优先级|看板|总览|汇总|建议|总经理|体系|晨会|行动项|经营计划|负责人|管理动作|协调问题)/.test(text);
  const hasRiskReview = /风险/.test(text) && /(经营|总览|复盘|分析|有哪些|哪里|最该关注|优先级)/.test(text);
  const hasManagementTask = /(晨会|行动项|经营计划|管理动作|协调问题|负责人|总经理视角|经销商体系)/.test(text);
  return (hasAnalysisView || hasRiskReview)
    && (hasManagementTask || /(经销商|门店|销售订单|库存|线索|售后|财务|三包|折让金|华东旗舰店|华南标准店|华北卫星店)/.test(text));
}

function isSimpleOwnerLookup(text: unknown): boolean {
  return /(谁|哪位).{0,8}(负责人|主管|经理|总经理)|(?:负责人|主管|经理|总经理).{0,8}(是谁|哪位|谁)/.test(String(text ?? ""));
}

// ─── 查询解析 ────────────────────────────────────────────────────────────────

export function parseDealerQuery({ question, operation, forcedTarget }: { question: string; operation: string; forcedTarget?: string }): QueryIR {
  const target = forcedTarget ?? inferDealerTarget(question);
  operation = normalizeDealerOperation({ target, question, operation });
  const filters: QueryFilter[] = [];
  const store = extractDealerStore(question);
  const series = extractVehicleSeries(question);
  const warrantyClaimId = extractWarrantyClaimId(question);
  const repairOrderId = extractRepairOrderId(question);
  if (store) filters.push({ field: "store_name", op: "contains", value: store });
  if (series && ["dealer_vehicles", "dealer_inbounds", "dealer_quotas", "dealer_leads", "dealer_sales_orders", "dealer_repair_orders", "dealer_warranty_claims"].includes(target)) {
    filters.push({ field: "series", op: "contains", value: series });
  }

  if (target === "dealer_vehicles") {
    if (question.includes("库龄") || question.includes("超龄") || question.includes("风险")) filters.push({ field: "stock_warning_level", op: "in", value: ["关注", "预警", "紧急"] });
    if (question.includes("在库")) filters.push({ field: "status", op: "eq", value: "在库" });
    if (question.includes("锁定")) filters.push({ field: "status", op: "eq", value: "锁定" });
    if (question.includes("展车")) filters.push({ field: "vehicle_tag", op: "eq", value: "展示车" });
    if (question.includes("试驾")) filters.push({ field: "vehicle_tag", op: "eq", value: "试驾车" });
  }
  if (target === "dealer_inbounds" && question.includes("客户定制")) filters.push({ field: "order_type", op: "eq", value: "客户定制" });
  if (target === "dealer_quotas" && question.includes("没有配额")) filters.push({ field: "available_quota", op: "eq", value: 0 });
  if (target === "dealer_leads") {
    if (question.includes("H级") || question.includes("H 级")) filters.push({ field: "intention_level", op: "eq", value: "H" });
    if (question.includes("战败")) filters.push({ field: "status", op: "eq", value: "战败" });
    if (question.includes("待联系") || question.includes("未联系")) filters.push({ field: "status", op: "eq", value: "待首次联系" });
    if (question.includes("到店")) filters.push({ field: "visit_count", op: "gte", value: 1 });
  }
  if (target === "dealer_sales_orders") {
    if (question.includes("待交付")) filters.push({ field: "order_status", op: "contains", value: "待交付" });
    if (question.includes("按揭")) filters.push({ field: "order_type", op: "eq", value: "按揭" });
    if (question.includes("全款")) filters.push({ field: "order_type", op: "eq", value: "全款" });
  }
  if (target === "dealer_finance") {
    if (question.includes("折让金")) filters.push({ field: "resource_type", op: "eq", value: "discount_wallet" });
    if (question.includes("应付")) filters.push({ field: "resource_type", op: "eq", value: "payable" });
    if (question.includes("返利")) filters.push({ field: "resource_type", op: "eq", value: "rebate" });
    if (question.includes("收款") || question.includes("到账")) filters.push({ field: "resource_type", op: "eq", value: "receipt" });
  }
  if (target === "dealer_repair_orders") {
    if (warrantyClaimId) filters.push({ field: "warranty_claim_id", op: "eq", value: warrantyClaimId });
    if (repairOrderId) filters.push({ field: "id", op: "eq", value: repairOrderId });
    if (question.includes("三包")) filters.push({ field: "order_type", op: "eq", value: "三包索赔" });
    if (question.includes("待结算")) filters.push({ field: "status", op: "eq", value: "待结算" });
  }
  if (target === "dealer_warranty_claims") {
    if (warrantyClaimId) filters.push({ field: "id", op: "eq", value: warrantyClaimId });
    if (repairOrderId) filters.push({ field: "repair_order_id", op: "eq", value: repairOrderId });
    if ((question.includes("拒绝") || question.includes("被拒")) && question.includes("审核")) {
      filters.push({ field: "claim_status", op: "in", value: ["厂家审核中", "已拒绝"] });
    } else if (question.includes("拒绝") || question.includes("被拒")) {
      filters.push({ field: "claim_status", op: "eq", value: "已拒绝" });
    } else if (question.includes("审核")) {
      filters.push({ field: "claim_status", op: "contains", value: "审核" });
    }
    if (question.includes("差异")) filters.push({ field: "difference_amount", op: "gte", value: 1 });
  }
  if (target === "dealer_metrics") {
    const categories: string[] = [];
    if (question.includes("库存")) categories.push("inventory");
    if (question.includes("线索")) categories.push("lead");
    if (question.includes("销售") || question.includes("订单") || question.includes("交付")) categories.push("sales");
    if (question.includes("财务") || question.includes("折让金") || question.includes("应付") || question.includes("返利")) categories.push("finance");
    if (question.includes("售后") || question.includes("维修")) categories.push("after_sales");
    if (question.includes("三包") || question.includes("索赔")) categories.push("warranty");
    if (categories.length === 1) filters.push({ field: "category", op: "eq", value: categories[0] });
    if (categories.length > 1) filters.push({ field: "category", op: "in", value: [...new Set(categories)] });
    if (question.includes("风险") || question.includes("关注") || question.includes("优先")) filters.push({ field: "severity", op: "in", value: ["critical", "warning"] });
  }

  return createQueryIR({
    domain: "dealer",
    target,
    operation,
    filters,
    metrics: operation === "aggregate" ? [{ type: "count", field: defaultDealerCountField(target), as: `${target}_count` }] : [],
    sort: defaultDealerSort(target),
    limit: 20,
    reason: "用户查询经销商管理系统业务数据。"
  });
}

export function planDealerMultiQuery({ question, operation }: { question?: string; operation?: string }): QueryIR[] | null {
  const text = String(question ?? "");
  if (!isDealerQuestion(text)) return null;
  const inferredOp = operation ?? inferOperation(text);
  const targets: string[] = [];
  const warrantyClaimId = extractWarrantyClaimId(text);
  if (warrantyClaimId && /(谁|跟|负责|顾问|处理|进展)/.test(text)) {
    targets.push("dealer_warranty_claims", "dealer_repair_orders");
  }
  if (isDealerAnalysisQuestion(text)) targets.push("dealer_metrics");
  if (/(销售订单|待交付订单|订单|交付|收款状态|开票|成交价|毛利|按揭|全款)/.test(text)) targets.push("dealer_sales_orders");
  if (/(库存|库龄|整车|车辆|VIN|合格证|展车|试驾车)/i.test(text)) targets.push("dealer_vehicles");
  if (/(线索|意向|跟进|到店|战败|漏斗|获客|客户来源|转化)/.test(text)) targets.push("dealer_leads");
  if (/(配额|可承诺|承诺交期|订一台|订车)/.test(text)) targets.push("dealer_quotas", "dealer_inbounds");
  if (/(折让金|应付|应收|付款|返利|财务|余额|到账|抵扣)/.test(text)) targets.push("dealer_finance");
  if (/(售后|维修|保养|工单|接待|质检|结算|服务顾问)/.test(text)) targets.push("dealer_repair_orders");
  if (/(三包|质保|索赔|故障码|厂家审核|核准金额|损失风险)/.test(text)) targets.push("dealer_warranty_claims");

  const uniqueTargets = [...new Set(targets)];
  if (uniqueTargets.length <= 1) return null;
  return uniqueTargets.map((target) => parseDealerQuery({ question: text, operation: inferredOp, forcedTarget: target }));
}

// ─── 内部辅助函数 ────────────────────────────────────────────────────────────

function inferDealerTarget(question: unknown): string {
  const text = String(question ?? "");
  if (extractWarrantyClaimId(text)) return "dealer_warranty_claims";
  if (extractRepairOrderId(text)) return "dealer_repair_orders";
  if (isDealerAnalysisQuestion(text)) return "dealer_metrics";
  if (/(三包|质保|索赔|故障码|厂家审核|核准金额)/.test(text)) return "dealer_warranty_claims";
  if (/(售后|维修|保养|工单|接待|质检|结算|服务顾问)/.test(text)) return "dealer_repair_orders";
  if (/(折让金|应付|应收|付款|返利|财务|余额|到账|抵扣)/.test(text)) return "dealer_finance";
  if (/(销售订单|待交付订单|锁车|合同|交付|收款状态|开票|成交价|毛利|按揭|全款)/.test(text)) return "dealer_sales_orders";
  if (/(线索|意向|跟进|到店|战败|漏斗|获客|客户来源|转化)/.test(text)) return "dealer_leads";
  if (/(配额|可承诺|承诺交期|订一台|订车)/.test(text)) return "dealer_quotas";
  if (/(在途|到店|客户定制|交期)/.test(text)) return "dealer_inbounds";
  if (/(门店|店面|库容)/.test(text) && !/(库存|车辆|整车)/.test(text)) return "dealer_stores";
  return "dealer_vehicles";
}

function normalizeDealerOperation({ target, question, operation }: { target: string; question: string; operation: string }): string {
  const text = String(question ?? "");
  if (target === "dealer_quotas" && /(多少配额|多少.*可承诺|剩余|还有多少)/.test(text)) return "search";
  if (target === "dealer_finance" && /(余额|流水|明细|最近)/.test(text)) return "search";
  return operation;
}

function extractDealerStore(question: unknown): string | null {
  const stores = ["华东旗舰店", "华南标准店", "华北卫星店", "华东", "华南", "华北"];
  return stores.find((item) => String(question ?? "").includes(item)) ?? null;
}

function extractVehicleSeries(question: unknown): string | null {
  const series = ["汉", "宋L", "海豹", "秦PLUS", "唐", "元PLUS", "腾势N7"];
  return series.find((item) => String(question ?? "").includes(item)) ?? null;
}

function extractWarrantyClaimId(question: unknown): string | null {
  return String(question ?? "").match(/\bWC-\d{6}-\d{3}\b/i)?.[0]?.toUpperCase() ?? null;
}

function extractRepairOrderId(question: unknown): string | null {
  return String(question ?? "").match(/\bRO-\d{6}-\d{3}\b/i)?.[0]?.toUpperCase() ?? null;
}

function defaultDealerCountField(target: string): string {
  if (target === "dealer_vehicles") return "vin";
  return "id";
}

function defaultDealerSort(target: string): QuerySort[] {
  if (target === "dealer_vehicles") return [{ field: "stock_age_days", direction: "desc" }];
  if (target === "dealer_quotas") return [{ field: "available_quota", direction: "asc" }];
  if (target === "dealer_inbounds") return [{ field: "expected_arrival_date", direction: "asc" }];
  if (target === "dealer_finance") return [{ field: "occurred_at", direction: "desc" }];
  if (target === "dealer_warranty_claims") return [{ field: "submitted_at", direction: "desc" }];
  return [];
}

function inferOperation(question: unknown): string {
  return /(多少|几个|几次|多少次|数量|总数|统计|有多少|多少人|几个人|几名|人数)/.test(String(question ?? "")) ? "aggregate" : "search";
}
