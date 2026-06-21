import type { JsonObject } from "../types/agent-contracts.js";
import type { NormalizedOpenUIOutput } from "./output-normalizer.js";

export type OpenUIPresentationIntent = "none" | "table" | "metrics" | "risk_list" | "grouped_list" | "form" | "chart" | "insights" | "analytics" | "sources";
export type OpenUIPresentationSurfaceKind =
  | "BusinessBriefSurface"
  | "ProductLaunchFormSurface"
  | "DataTableSurface"
  | "MetricCardsSurface"
  | "RiskListSurface"
  | "GroupedListSurface"
  | "BarChartSurface"
  | "PieChartSurface"
  | "LineChartSurface"
  | "InsightSummarySurface"
  | "AnalyticsDashboardSurface"
  | "CitationDisclosure"
  | null;

export interface OpenUIPresentationDecision extends JsonObject {
  enabled: boolean;
  intent: OpenUIPresentationIntent;
  surfaceKind: OpenUIPresentationSurfaceKind;
  reason: string;
  confidence: "low" | "medium" | "high";
  source: "output_shape" | "model_hint" | "explicit_hint" | "none";
}

export const OPENUI_PRESENTATION_POLICY_CAPABILITIES: JsonObject = {
  version: "openui.presentation-policy/1.0",
  default_behavior: "OpenUI is selected from normalized output shape; plain text remains Markdown.",
  mappings: [
    { output_shape: "rows[] with 2+ objects", intent: "table", surface: "DataTableSurface" },
    { output_shape: "metrics[] or aggregates{}", intent: "metrics", surface: "MetricCardsSurface" },
    { output_shape: "charts[] with kind=pie", intent: "chart", surface: "PieChartSurface" },
    { output_shape: "charts[] with kind=line", intent: "chart", surface: "LineChartSurface" },
    { output_shape: "rows[] + trend/time-series hint", intent: "chart", surface: "LineChartSurface" },
    { output_shape: "rows[] + composition/share hint", intent: "chart", surface: "PieChartSurface" },
    { output_shape: "rows[] + ranking/distribution/comparison hint", intent: "chart", surface: "BarChartSurface" },
    { output_shape: "metrics[] + charts[] + rows[]/insights[]", intent: "analytics", surface: "AnalyticsDashboardSurface" },
    { output_shape: "insights[]", intent: "insights", surface: "InsightSummarySurface" },
    { output_shape: "groups[] with numeric aggregates", intent: "chart", surface: "BarChartSurface" },
    { output_shape: "rows[] with risk/severity/warning/status risk fields", intent: "risk_list", surface: "RiskListSurface" },
    { output_shape: "rows[] with grouping hint", intent: "grouped_list", surface: "GroupedListSurface" },
    { output_shape: "sources[]", intent: "sources", surface: "CitationDisclosure" }
  ],
  explicit_hints: ["表格", "列表", "卡片", "指标", "图表", "柱状图", "饼图", "折线图", "趋势", "分布", "排行", "分析", "统计", "明细", "风险", "分组", "引用", "经营", "报价", "估算", "套餐", "上架", "审批", "回滚", "续约"],
  fallback: "markdown"
};

const STRUCTURED_HINTS = /(表格|列表|看板|面板|卡片|图表|柱状图|条形图|饼图|折线图|趋势图|图形|业绩|KPI|kpi|图标|进度|状态|分组|统计|分析|指标|排行|分布|构成|明细|汇总|日报|审批|表单|填写|提交|引用|来源|风险|经营|报价|估算|套餐|上架|发布|回滚|续约|合同|账单|询价|方案)/;

export function decideOpenUIPresentation(input: {
  message?: unknown;
  answer?: unknown;
  output?: NormalizedOpenUIOutput;
  rows?: JsonObject[];
  modelDecision?: unknown;
}): OpenUIPresentationDecision {
  const modelDecision = readModelDecision(input.modelDecision);
  if (modelDecision) return modelDecision;

  const message = String(input.message ?? "");
  const answer = String(input.answer ?? "");
  const output = input.output;
  const rows = output?.rows ?? (Array.isArray(input.rows) ? input.rows : []);
  const text = `${message}\n${answer}`;
  const hasExplicitHint = STRUCTURED_HINTS.test(text);

  if (output && shouldUseAnalyticsDashboard(output, text)) {
    return decision("analytics", "AnalyticsDashboardSurface", "multiple analytics output shapes available", "high", "output_shape");
  }
  if (output?.charts?.length) {
    const chart = output.charts[0];
    const kind = String(chart.kind || "").toLowerCase();
    if (/pie|donut|doughnut/.test(kind)) return decision("chart", "PieChartSurface", "pie chart output available", "high", "output_shape");
    if (/line|trend|timeseries|time_series/.test(kind)) return decision("chart", "LineChartSurface", "line chart output available", "high", "output_shape");
    return decision("chart", "BarChartSurface", "chart output available", "high", "output_shape");
  }
  if (output?.insights?.length) {
    return decision("insights", "InsightSummarySurface", "analysis insights available", "high", "output_shape");
  }
  if (output?.groups?.length && hasNumericGroupAggregates(output)) {
    return decision("chart", "BarChartSurface", "grouped numeric aggregates available", "high", "output_shape");
  }
  if (output?.metrics?.length || (output?.aggregates && Object.keys(output.aggregates).length)) {
    return decision("metrics", "MetricCardsSurface", "metrics or aggregates available", "high", "output_shape");
  }
  if (rows.length >= 2) {
    if (/(图表|柱状图|条形图|趋势图|折线图|饼图|可视化|chart|bar chart)/i.test(text) && hasNumericRows(rows)) {
      const inferred = inferChartSurfaceFromRows(rows, text);
      return decision("chart", inferred, "chart hint with numeric rows", "medium", "explicit_hint");
    }
    if (/(趋势|走势|变化|按天|按周|按月|最近\\d+天|time series|timeseries|trend)/i.test(text) && hasTemporalRows(rows) && hasNumericRows(rows)) {
      return decision("chart", "LineChartSurface", "trend-shaped rows", "medium", "explicit_hint");
    }
    if (/(构成|占比|比例|份额|来源|pie|donut|composition|share)/i.test(text) && hasNumericRows(rows)) {
      return decision("chart", "PieChartSurface", "composition-shaped rows", "medium", "explicit_hint");
    }
    if (/(排行|排名|top|分布|对比|比较|按.+统计|按.+分布|distribution|ranking|compare)/i.test(text) && hasNumericRows(rows)) {
      return decision("chart", "BarChartSurface", "ranking/distribution-shaped rows", "medium", "explicit_hint");
    }
    if (/(指标|业绩|统计|汇总|同比|环比|KPI|kpi)/.test(text) && rows.length <= 6) {
      return decision("metrics", "MetricCardsSurface", "metric hint with compact rows", "medium", "explicit_hint");
    }
    if (rows.some(isRiskRow) || /(风险|预警|异常|逾期|阻塞|审批|回滚|上架|发布|续约)/.test(text)) {
      return decision("risk_list", "RiskListSurface", "risk-shaped rows or risk hint", "high", rows.some(isRiskRow) ? "output_shape" : "explicit_hint");
    }
    if (/(分组|按.+组)/.test(text)) {
      return decision("grouped_list", "GroupedListSurface", "grouped presentation hint", "medium", "explicit_hint");
    }
    return decision("table", "DataTableSurface", `structured rows available (${rows.length})`, "high", "output_shape");
  }
  if (output?.sources?.length) {
    return decision("sources", "CitationDisclosure", "sources available", "medium", "output_shape");
  }
  if (hasExplicitHint) {
    return decision("table", "DataTableSurface", "structured presentation requested but no supported output shape was found", "low", "explicit_hint");
  }
  return {
    enabled: false,
    intent: "none",
    surfaceKind: null,
    reason: "plain text is sufficient",
    confidence: "high",
    source: "none"
  };
}

function decision(
  intent: OpenUIPresentationIntent,
  surfaceKind: OpenUIPresentationSurfaceKind,
  reason: string,
  confidence: OpenUIPresentationDecision["confidence"],
  source: OpenUIPresentationDecision["source"]
): OpenUIPresentationDecision {
  return { enabled: true, intent, surfaceKind, reason, confidence, source };
}

function readModelDecision(value: unknown): OpenUIPresentationDecision | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const enabled = typeof record.enabled === "boolean" ? record.enabled : typeof record.eligible === "boolean" ? record.eligible : null;
  if (enabled === null) return null;
  const intent = typeof record.intent === "string" ? record.intent as OpenUIPresentationIntent : "none";
  return {
    enabled,
    intent,
    surfaceKind: typeof record.surfaceKind === "string" ? record.surfaceKind as OpenUIPresentationSurfaceKind : surfaceForIntent(intent),
    reason: typeof record.reason === "string" ? record.reason : "model decision",
    confidence: readConfidence(record.confidence),
    source: "model_hint"
  };
}

function surfaceForIntent(intent: OpenUIPresentationIntent): OpenUIPresentationSurfaceKind {
  if (intent === "table") return "DataTableSurface";
  if (intent === "metrics") return "MetricCardsSurface";
  if (intent === "risk_list") return "RiskListSurface";
  if (intent === "grouped_list") return "GroupedListSurface";
  if (intent === "chart") return "BarChartSurface";
  if (intent === "insights") return "InsightSummarySurface";
  if (intent === "analytics") return "AnalyticsDashboardSurface";
  if (intent === "sources") return "CitationDisclosure";
  return null;
}

function readConfidence(value: unknown): OpenUIPresentationDecision["confidence"] {
  return value === "low" || value === "medium" || value === "high" ? value : "medium";
}

function hasNumericGroupAggregates(output: NormalizedOpenUIOutput): boolean {
  return output.groups.some((group) => Object.values(group.aggregates ?? {}).some((value) => Number.isFinite(Number(value))));
}

function hasNumericRows(rows: JsonObject[]): boolean {
  return rows.some((row) => Object.values(row).some((value) => Number.isFinite(Number(value))));
}

function shouldUseAnalyticsDashboard(output: NormalizedOpenUIOutput, text = ""): boolean {
  const shapeCount = [
    output.metrics.length > 0,
    output.charts.length > 0,
    output.insights.length > 0,
    output.rows.length > 0,
    output.groups.length > 0
  ].filter(Boolean).length;
  const hasAnalyticsHint = /(分析|统计|看板|dashboard|经营|概览|overview|诊断|复盘)/i.test(text);
  return output.charts.length > 1
    || shapeCount >= 3
    || (output.charts.length > 0 && output.metrics.length > 0 && output.rows.length > 0)
    || (hasAnalyticsHint && shapeCount >= 2);
}

function isRiskRow(row: JsonObject): boolean {
  return Object.keys(row).some((key) => /(risk|warning|severity|alert)/i.test(key))
    || Object.values(row).some((value) => /(风险|预警|异常|逾期|紧急|critical|warning|high)/i.test(String(value ?? "")));
}

function inferChartSurfaceFromRows(rows: JsonObject[], text: string): Exclude<OpenUIPresentationSurfaceKind, null> {
  if (/(趋势|走势|变化|折线|按天|按周|按月|最近\\d+天|line|trend|time series|timeseries)/i.test(text) && hasTemporalRows(rows)) return "LineChartSurface";
  if (/(饼图|构成|占比|比例|份额|pie|donut|composition|share)/i.test(text)) return "PieChartSurface";
  return "BarChartSurface";
}

function hasTemporalRows(rows: JsonObject[]): boolean {
  return rows.some((row) => Object.entries(row).some(([key, value]) => {
    if (/(date|day|week|month|time|时间|日期)/i.test(key)) return true;
    return /^\\d{4}-\\d{1,2}-\\d{1,2}/.test(String(value ?? "")) || /^\\d{1,2}-\\d{1,2}$/.test(String(value ?? ""));
  }));
}
