import { INTENT_CODES } from "../agent/ports.js";
import type { JsonObject, ToolResult } from "../types/agent-contracts.js";

interface DealerReportInput {
  question: string;
  route?: { intent_code?: string } | null;
  toolResults: ToolResult[];
}

interface DealerRow extends JsonObject {
  store_name?: string;
  severity?: string;
  category?: string;
  metric?: string;
  value?: number | string;
  unit?: string;
  summary?: string;
  stock_warning_level?: string;
  vin?: string;
  stock_age_days?: number;
  status?: string;
  converted_order_id?: string;
  intention_level?: string;
  customer_name?: string;
  owner_name?: string;
  payment_status?: string;
  delivery_status?: string;
  id?: string;
  resource_type?: string;
  amount?: number;
  order_type?: string;
  claim_status?: string;
  difference_amount?: number;
  evidence_status?: string;
}

interface StoreSummary {
  storeName: string;
  rows: DealerRow[];
  critical: number;
  warning: number;
  score: number;
  topRisks: DealerRow[];
}

interface DetailResource {
  resource: string;
  total?: number;
  rows: DealerRow[];
}

interface DealerAction {
  owner: string;
  text: string;
}

interface DealerActionGroup {
  storeName: string;
  actions: DealerAction[];
}

export function composeDealerReport({ question, route, toolResults }: DealerReportInput): { answer: string; artifacts: JsonObject[] } | null {
  const metricRows = toolResults
    .filter((result) => result.tool === "query_business_data" && result.data?.resource === "dealer_metrics")
    .flatMap((result) => (result.data?.rows ?? []) as DealerRow[]);
  if (!metricRows.length || route?.intent_code !== INTENT_CODES.DEALER_ANALYSIS_QUERY) return null;

  const rowsByStore = groupBy(metricRows, (row) => row.store_name || "全部门店");
  const storeSummaries = Object.entries(rowsByStore).map(([storeName, rows]) => summarizeDealerStore(storeName, rows));
  const ranked = storeSummaries.slice().sort((left, right) => right.score - left.score);
  const detailResources: DetailResource[] = toolResults
    .filter((result) => result.tool === "query_business_data" && result.data?.resource !== "dealer_metrics")
    .map((result) => ({
      resource: String(result.data?.resource ?? ""),
      total: Number(result.data?.total ?? 0),
      rows: (result.data?.rows ?? []) as DealerRow[]
    }));

  const lines: string[] = [];
  if (/(对比|哪家|压力更大)/.test(question) && ranked.length >= 2) {
    const top = ranked[0];
    const second = ranked[1];
    lines.push("## 经营压力对比");
    lines.push("");
    lines.push(`**结论：${top.storeName} 当前经营压力略高于 ${second.storeName}。**`);
    lines.push("");
    lines.push(`判断依据：${top.storeName} 有 ${top.critical} 项严重风险、${top.warning} 项警示风险，风险分 ${top.score}；${second.storeName} 有 ${second.critical} 项严重风险、${second.warning} 项警示风险，风险分 ${second.score}。`);
  } else if (/(日报|周报|月度|报告|复盘|看板|晨会|经营计划|行动项|管理动作)/.test(question)) {
    lines.push(`## ${buildDealerReportTitle(question)}`);
    lines.push("");
    const top = ranked[0];
    if (top) lines.push(`**总体判断：当前最高优先级是 ${top.storeName} 的 ${formatTopRisk(top.topRisks[0])}。**`);
  } else {
    const top = ranked[0];
    lines.push("## 经营风险判断");
    lines.push("");
    lines.push(`**结论：当前最该关注 ${top.storeName} 的 ${formatTopRisk(top.topRisks[0])}。**`);
  }

  lines.push("");
  lines.push("### 关键风险");
  for (const summary of ranked) {
    lines.push("");
    lines.push(`**${summary.storeName}**`);
    lines.push("");
    lines.push(`- 风险概览：${summary.critical} 项严重、${summary.warning} 项警示，风险分 ${summary.score}。`);
    const topRisks = summary.topRisks.slice(0, 5);
    if (!topRisks.length) {
      lines.push("- 重点风险：暂无高风险项。");
    } else {
      for (const risk of topRisks) {
        lines.push(`- ${formatTopRisk(risk)}：${risk.summary}`);
      }
    }
  }

  const details = summarizeDealerDetails(detailResources);
  if (details.length) {
    lines.push("");
    lines.push("### 数据明细支撑");
    for (const item of details) lines.push(`- ${item}`);
  }

  if (/(原因|为什么|承压|复盘|报告|方案)/.test(question)) {
    lines.push("");
    lines.push("### 原因分析");
    for (const summary of ranked) {
      const causes = summarizeDealerCauses(summary);
      if (causes.length) {
        lines.push("");
        lines.push(`**${summary.storeName}**`);
        for (const cause of causes) lines.push(`- ${cause}`);
      }
    }
  }

  lines.push("");
  lines.push("### 关键动作");
  const actionGroups = buildDealerActionGroups(ranked);
  for (const group of actionGroups) {
    lines.push("");
    lines.push(`**${group.storeName}**`);
    const byOwner = groupActionsByOwner(group.actions);
    for (const [owner, actions] of Object.entries(byOwner)) {
      lines.push(`- ${owner}：${actions.map((item) => stripSentenceEnd(item.text)).join("；")}。`);
    }
  }

  if (/(负责人|行动项|晨会|经营计划|下周)/.test(question)) {
    lines.push("");
    lines.push("### 负责人拆解");
    lines.push("- 销售负责人：跟进 H/A 级未成交线索、战败复盘、待交付订单收款和交付节点。");
    lines.push("- 库存负责人：处理高库龄与合格证风险车辆，给出清库、调拨或促销方案。");
    lines.push("- 财务负责人：跟进折让金余额、未结清应付和待结算返利，评估采购现金流。");
    lines.push("- 售后负责人：关闭未结算/施工中工单，补齐三包索赔证据。");
  }

  const artifact = buildDealerReportArtifact({ question, ranked, details, actionGroups });
  return { answer: lines.join("\n"), artifacts: [artifact] };
}

function summarizeDealerStore(storeName: string, rows: DealerRow[]): StoreSummary {
  const critical = rows.filter((row) => row.severity === "critical").length;
  const warning = rows.filter((row) => row.severity === "warning").length;
  const score = rows.reduce((total, row) => total + (row.severity === "critical" ? 3 : row.severity === "warning" ? 1 : 0), 0);
  const topRisks = rows
    .filter((row) => row.severity === "critical" || row.severity === "warning")
    .sort((left, right) => severityWeight(right.severity) - severityWeight(left.severity) || Number(right.value) - Number(left.value));
  return { storeName, rows, critical, warning, score, topRisks };
}

function buildDealerReportArtifact({ question, ranked, details, actionGroups }: { question: string; ranked: StoreSummary[]; details: string[]; actionGroups: DealerActionGroup[] }): JsonObject {
  return {
    id: `dealer-report-${Date.now()}`,
    type: "dealer_report",
    title: buildDealerReportTitle(question),
    summary: ranked[0] ? `${ranked[0].storeName} 当前优先级最高：${formatTopRisk(ranked[0].topRisks[0])}` : "暂无高风险经营指标。",
    sections: [
      {
        title: "门店风险排行",
        rows: ranked.map((summary) => ({
          store_name: summary.storeName,
          critical: summary.critical,
          warning: summary.warning,
          score: summary.score,
          top_risk: formatTopRisk(summary.topRisks[0])
        }))
      },
      {
        title: "数据明细支撑",
        rows: details.map((text) => ({ item: text }))
      },
      {
        title: "关键动作",
        rows: actionGroups.flatMap((group) => (
          Object.entries(groupActionsByOwner(group.actions)).map(([owner, actions]) => ({
            store_name: group.storeName,
            owner,
            action: actions.map((item) => stripSentenceEnd(item.text)).join("；")
          }))
        ))
      }
    ]
  };
}

function severityWeight(value: unknown): number {
  if (value === "critical") return 3;
  if (value === "warning") return 1;
  return 0;
}

function formatTopRisk(row?: DealerRow): string {
  if (!row) return "暂无高风险项";
  const category = dealerCategoryName(row.category);
  return `${category}「${dealerMetricName(row.metric)}」${row.value}${row.unit ?? ""}（${row.severity}）`;
}

function dealerCategoryName(value: unknown): string {
  const key = String(value ?? "");
  return {
    inventory: "库存",
    sales: "销售",
    lead: "线索",
    finance: "财务",
    after_sales: "售后",
    warranty: "三包"
  }[key] ?? key;
}

function dealerMetricName(value: unknown): string {
  const key = String(value ?? "");
  return {
    stock_risk_vehicle_count: "库龄风险车",
    mortgaged_certificate_vehicle_count: "合格证抵押车",
    pending_delivery_order_count: "待交付订单",
    unpaid_order_count: "未结清订单",
    hot_open_lead_count: "H/A级未成交线索",
    no_contact_lead_count: "未首联线索",
    lost_lead_count: "战败线索",
    discount_wallet_balance: "折让金余额",
    unsettled_payable_amount: "未结清应付",
    pending_rebate_amount: "待结算返利",
    open_repair_order_count: "未关闭工单",
    warranty_claim_loss_risk_amount: "三包索赔损失风险"
  }[key] ?? key;
}

function buildDealerReportTitle(question: string): string {
  if (question.includes("晨会")) return "晨会材料";
  if (question.includes("月度")) return "月度经营分析报告";
  if (question.includes("周报")) return "经营周报";
  if (question.includes("日报")) return "经营日报";
  if (question.includes("看板")) return "门店经营健康度看板";
  if (question.includes("经营计划")) return "下周经营计划";
  return "经营复盘";
}

function summarizeDealerDetails(resources: DetailResource[]): string[] {
  const lines: string[] = [];
  for (const item of resources) {
    if (item.resource === "dealer_vehicles") {
      const risky = item.rows.filter((row) => row.stock_warning_level && row.stock_warning_level !== "正常");
      if (risky.length) lines.push(`库存：${risky.map((row) => `${row.vin} ${row.stock_age_days}天/${row.stock_warning_level}`).join("，")}`);
    }
    if (item.resource === "dealer_leads") {
      const weak = item.rows.filter((row) => row.status === "待首次联系" || row.status === "战败" || (!row.converted_order_id && ["H", "A"].includes(row.intention_level)));
      if (weak.length) lines.push(`线索：${weak.map((row) => `${row.customer_name}/${row.owner_name}/${row.intention_level}/${row.status}`).join("，")}`);
    }
    if (item.resource === "dealer_sales_orders") {
      const risky = item.rows.filter((row) => row.payment_status !== "已结清" || row.delivery_status !== "已交付");
      if (risky.length) lines.push(`订单：${risky.map((row) => `${row.id}/${row.payment_status}/${row.delivery_status}`).join("，")}`);
    }
    if (item.resource === "dealer_finance") {
      if (item.rows.length) lines.push(`财务：${item.rows.map((row) => `${row.id}/${row.resource_type}/${row.amount}/${row.status}`).join("，")}`);
    }
    if (item.resource === "dealer_repair_orders") {
      const open = item.rows.filter((row) => !["已结算", "已关闭"].includes(row.status));
      if (open.length) lines.push(`售后：${open.map((row) => `${row.id}/${row.order_type}/${row.status}`).join("，")}`);
    }
    if (item.resource === "dealer_warranty_claims") {
      const risky = item.rows.filter((row) => row.claim_status === "已拒绝" || Number(row.difference_amount ?? 0) > 0 || row.evidence_status === "照片不足");
      if (risky.length) lines.push(`三包：${risky.map((row) => `${row.id}/${row.claim_status}/差异${row.difference_amount}`).join("，")}`);
    }
  }
  return lines;
}

function summarizeDealerCauses(summary: StoreSummary): string[] {
  const categories = new Set(summary.topRisks.map((risk) => risk.category));
  const causes: string[] = [];
  if (categories.has("inventory")) causes.push("库存侧存在高库龄或合格证约束，可能占用资金并影响交付确定性。");
  if (categories.has("sales")) causes.push("销售侧存在待交付或未结清订单，说明交付链路仍有收款、开票或整备阻塞。");
  if (categories.has("lead")) causes.push("线索侧存在未成交高意向线索或战败线索，说明转化效率和价格策略需要复盘。");
  if (categories.has("finance")) causes.push("财务侧折让金、应付或返利压力会影响采购节奏和现金流安全边界。");
  if (categories.has("after_sales")) causes.push("售后侧未关闭工单积压，可能影响客户满意度和后续结算效率。");
  if (categories.has("warranty")) causes.push("三包侧存在拒赔或差异金额，通常与证据完整度、厂家审核口径和旧件材料有关。");
  return causes;
}

function buildDealerActionGroups(summaries: StoreSummary[]): DealerActionGroup[] {
  const rankedRisks = summaries
    .flatMap((summary) => summary.topRisks.map((risk) => ({ storeName: summary.storeName, risk })))
    .sort((left, right) => severityWeight(right.risk.severity) - severityWeight(left.risk.severity) || Number(right.risk.value) - Number(left.risk.value));

  const grouped = new Map<string, Map<string, DealerAction>>();
  for (const { storeName, risk } of rankedRisks) {
    const actions = grouped.get(storeName) ?? new Map();
    const action = actionForDealerRisk(risk);
    if (action) {
      const key = `${action.owner}:${action.text}`;
      actions.set(key, action);
    }
    grouped.set(storeName, actions);
  }

  return summaries
    .filter((summary) => grouped.has(summary.storeName))
    .map((summary) => ({
      storeName: summary.storeName,
      actions: [...grouped.get(summary.storeName).values()]
    }));
}

function groupActionsByOwner(actions: DealerAction[]): Record<string, DealerAction[]> {
  const groups: Record<string, DealerAction[]> = {};
  for (const action of actions) {
    groups[action.owner] ??= [];
    if (!groups[action.owner].some((item) => item.text === action.text)) {
      groups[action.owner].push(action);
    }
  }
  return groups;
}

function stripSentenceEnd(text: unknown): string {
  return String(text ?? "").replace(/[。；;]+$/g, "");
}

function actionForDealerRisk(risk: DealerRow): DealerAction | null {
  if (risk.category === "inventory") {
    return {
      owner: "库存负责人",
      text: `优先处理${dealerMetricName(risk.metric)}，结合清库、调拨、促销或解押动作。`
    };
  }
  if (risk.category === "sales") {
    return {
      owner: "销售负责人",
      text: "逐单推进待交付和未结清订单，明确收款、开票、整备、交付阻塞点。"
    };
  }
  if (risk.category === "lead") {
    return {
      owner: "销售负责人",
      text: "当天清理未首联/H-A级未成交线索，并复盘战败原因。"
    };
  }
  if (risk.category === "finance") {
    return {
      owner: "财务负责人",
      text: "跟进折让金、应付和返利，评估采购现金流安全边界。"
    };
  }
  if (risk.category === "after_sales") {
    return {
      owner: "售后负责人",
      text: "关闭未结算或施工中工单，避免超时影响满意度。"
    };
  }
  if (risk.category === "warranty") {
    return {
      owner: "售后负责人",
      text: "补齐三包证据并复盘被拒/差异原因。"
    };
  }
  return null;
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const item of items) {
    const key = keyFn(item);
    groups[key] ??= [];
    groups[key].push(item);
  }
  return groups;
}
