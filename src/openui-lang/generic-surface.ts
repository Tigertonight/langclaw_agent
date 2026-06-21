import type { JsonObject } from "../types/agent-contracts.js";
import { card, list, openUIView, text, type OpenUILangCompatComponentInstance, type SurfaceBuildOutput } from "./compat.js";
import { normalizeOpenUIOutputs, rowsFromNormalizedOutput, type NormalizedOpenUIOutput } from "./output-normalizer.js";
import { decideOpenUIPresentation, type OpenUIPresentationDecision } from "./presentation-policy.js";
import type { OpenUILangDataTableColumn } from "./types.js";

export interface GenericOpenUIStructuredData {
  resource: string;
  title: string;
  rows: JsonObject[];
  total?: number;
  groupBy?: string;
  decision: OpenUIPresentationDecision;
  normalized: NormalizedOpenUIOutput;
  component:
    | "BusinessBriefSurface"
    | "ProductLaunchFormSurface"
    | "DataTableSurface"
    | "RiskListSurface"
    | "MetricCardsSurface"
    | "GroupedListSurface"
    | "BarChartSurface"
    | "PieChartSurface"
    | "LineChartSurface"
    | "InsightSummarySurface"
    | "AnalyticsDashboardSurface";
}

const FIELD_LABELS: Record<string, string> = {
  customer_name: "客户",
  customer: "客户",
  name: "名称",
  phone: "电话",
  source: "来源",
  priority: "优先级",
  status: "状态",
  stage: "阶段",
  store_name: "门店",
  series: "车系",
  model: "车型",
  vehicle_model: "车型",
  stock_age_days: "库龄",
  stock_warning_level: "预警",
  expected_delivery_date: "预计交付",
  delivery_date: "交付日期",
  risk: "风险",
  owner: "负责人",
  owner_user_id: "负责人",
  owner_team: "负责团队",
  metric_id: "指标ID",
  metric_group: "指标分组",
  metric_name: "指标名称",
  metric_value: "指标值",
  period: "周期",
  as_of_date: "统计日期",
  unit: "单位",
  compare_period: "对比周期",
  compare_value: "对比值",
  change_rate: "变化率",
  source_type: "来源类型",
  mocked: "Demo假设",
  confidence: "置信度",
  billing_month: "账期",
  amount_cny: "金额",
  dispute_amount_cny: "争议金额",
  dispute_reason: "争议原因",
  step: "流程环节",
  delay_hours: "延迟小时",
  blocker_reason: "阻塞原因",
  renewal_probability: "续约概率",
  risk_level: "风险等级",
  followup_at: "跟进时间",
  created_at: "创建时间"
};

export function extractGenericOpenUIStructuredData(record: Record<string, unknown>): GenericOpenUIStructuredData | null {
  const output = readObject(record.output) ?? {};
  const debug = readObject(record.debug) ?? readObject(output.debug) ?? {};
  const nestedContext = readObject(output._openui_lang_context) ?? readObject(output._a2ui_context) ?? {};
  const message = record.user_message ?? record.message ?? output.user_message ?? output.message;
  const answer = record.answer ?? output.answer;
  const modelDecision = readObject(debug.openui_lang_decision)
    ?? readObject(nestedContext.openui_lang_decision)
    ?? readObject(record.openui_lang_decision)
    ?? readObject(output.openui_lang_decision);

  for (const normalized of normalizeOpenUIOutputs(record)) {
    const decision = decideOpenUIPresentation({ message, answer, output: normalized, modelDecision });
    if (!decision.enabled) continue;
    const component = componentForSurfaceKind(decision.surfaceKind);
    if (!component) continue;
    const rows = rowsFromNormalizedOutput(normalized);
    if (!rows.length && component !== "MetricCardsSurface" && component !== "PieChartSurface" && component !== "LineChartSurface" && component !== "InsightSummarySurface" && component !== "AnalyticsDashboardSurface") continue;
    return {
      resource: normalized.resource,
      title: titleForResource(normalized.resource, { component, groupBy: normalized.groupBy }),
      rows: rows.slice(0, 20),
      total: normalized.total ?? rows.length,
      groupBy: normalized.groupBy,
      decision,
      normalized,
      component
    };
  }
  return null;
}

export function buildGenericDataTableSurface(data: GenericOpenUIStructuredData, ctx: { surfacePrefix: string; runId: string }): SurfaceBuildOutput {
  if (data.component === "RiskListSurface") return buildGenericRiskListSurface(data, ctx);
  if (data.component === "MetricCardsSurface") return buildGenericMetricCardsSurface(data, ctx);
  if (data.component === "GroupedListSurface") return buildGenericGroupedListSurface(data, ctx);
  if (data.component === "BarChartSurface") return buildGenericBarChartSurface(data, ctx);
  if (data.component === "PieChartSurface") return buildGenericPieChartSurface(data, ctx);
  if (data.component === "LineChartSurface") return buildGenericLineChartSurface(data, ctx);
  if (data.component === "InsightSummarySurface") return buildGenericInsightSummarySurface(data, ctx);
  if (data.component === "AnalyticsDashboardSurface") return buildGenericAnalyticsDashboardSurface(data, ctx);
  const surfaceId = `${ctx.surfacePrefix}_${ctx.runId}_openui_table_${safeId(data.resource)}`;
  const columns = inferColumns(data.rows);
  return {
    surfaceId,
    root: "openui_table_root",
    data: {
      title: data.title,
      resource: data.resource,
      row_count: data.total ?? data.rows.length,
      openui_lang: {
        protocol: "openui-lang/1.0",
        intent: data.decision.intent,
        decision: data.decision,
        normalized_output: {
          resource: data.normalized.resource,
          has_rows: data.normalized.rows.length > 0,
          has_groups: data.normalized.groups.length > 0,
          has_metrics: data.normalized.metrics.length > 0,
          has_aggregates: Object.keys(data.normalized.aggregates).length > 0
        }
      },
      openui: openUIView("DataTableSurface", {
        title: data.title,
        description: `${data.total ?? data.rows.length} 条记录`,
        columns,
        rows: data.rows,
        rowCount: data.total ?? data.rows.length
      })
    },
    components: dataTableFallbackComponents(data, columns)
  };
}

function buildGenericPieChartSurface(data: GenericOpenUIStructuredData, ctx: { surfacePrefix: string; runId: string }): SurfaceBuildOutput {
  const chart = data.normalized.charts[0];
  const categoryKey = chart?.categoryKey ?? chart?.xKey ?? inferChartXKey(data);
  const valueKey = chart?.valueKey ?? chart?.yKey ?? inferChartYKey(chart?.series ?? data.rows, categoryKey);
  const series = (chart?.series.length ? chart.series : data.rows).slice(0, 12);
  return buildOpenUIOnlySurface(data, ctx, "pie_chart", "openui_pie_chart_root", "PieChartSurface", {
    title: chart?.title ?? data.title,
    categoryKey,
    valueKey,
    series
  });
}

function buildGenericLineChartSurface(data: GenericOpenUIStructuredData, ctx: { surfacePrefix: string; runId: string }): SurfaceBuildOutput {
  const chart = data.normalized.charts[0];
  const xKey = chart?.xKey ?? inferTemporalKey(chart?.series.length ? chart.series : data.rows) ?? "date";
  const yKey = chart?.yKey ?? inferChartYKey(chart?.series ?? data.rows, xKey);
  const series = (chart?.series.length ? chart.series : data.rows).slice(0, 60);
  return buildOpenUIOnlySurface(data, ctx, "line_chart", "openui_line_chart_root", "LineChartSurface", {
    title: chart?.title ?? data.title,
    xKey,
    yKey,
    series
  });
}

function buildGenericInsightSummarySurface(data: GenericOpenUIStructuredData, ctx: { surfacePrefix: string; runId: string }): SurfaceBuildOutput {
  return buildOpenUIOnlySurface(data, ctx, "insights", "openui_insights_root", "InsightSummarySurface", {
    title: data.title,
    insights: data.normalized.insights.slice(0, 20)
  });
}

function buildGenericAnalyticsDashboardSurface(data: GenericOpenUIStructuredData, ctx: { surfacePrefix: string; runId: string }): SurfaceBuildOutput {
  const columns = data.rows.length ? inferColumns(data.rows) : [];
  return buildOpenUIOnlySurface(data, ctx, "analytics", "openui_analytics_root", "AnalyticsDashboardSurface", {
    title: data.title,
    metrics: data.normalized.metrics.slice(0, 12),
    charts: data.normalized.charts.slice(0, 6),
    rows: data.rows.slice(0, 20),
    columns,
    insights: data.normalized.insights.slice(0, 20)
  });
}

function buildOpenUIOnlySurface(
  data: GenericOpenUIStructuredData,
  ctx: { surfacePrefix: string; runId: string },
  kind: string,
  root: string,
  component: string,
  props: JsonObject
): SurfaceBuildOutput {
  const surfaceId = `${ctx.surfacePrefix}_${ctx.runId}_openui_${kind}_${safeId(data.resource)}`;
  return {
    surfaceId,
    root,
    data: {
      title: data.title,
      resource: data.resource,
      row_count: data.total ?? data.rows.length,
      openui_lang: { protocol: "openui-lang/1.0", intent: data.decision.intent, decision: data.decision },
      openui: openUIView(component, props)
    },
    components: [
      text(`${root}_title`, data.title),
      card(root, [`${root}_title`])
    ]
  };
}

function buildGenericBarChartSurface(data: GenericOpenUIStructuredData, ctx: { surfacePrefix: string; runId: string }): SurfaceBuildOutput {
  const surfaceId = `${ctx.surfacePrefix}_${ctx.runId}_openui_bar_chart_${safeId(data.resource)}`;
  const xKey = inferChartXKey(data);
  const yKey = inferChartYKey(data.rows, xKey);
  const series = data.rows.slice(0, 12).map((row) => ({
    [xKey]: row[xKey] ?? "未分组",
    [yKey]: readNumber(row[yKey]) ?? 0,
    rowCount: readNumber(row.row_count) ?? undefined
  }));
  return {
    surfaceId,
    root: "openui_bar_chart_root",
    data: {
      title: data.title,
      resource: data.resource,
      row_count: data.total ?? data.rows.length,
      openui_lang: { protocol: "openui-lang/1.0", intent: data.decision.intent, decision: data.decision },
      openui: openUIView("BarChartSurface", {
        title: data.title,
        xKey,
        yKey,
        series
      })
    },
    components: [
      text("openui_bar_chart_title", data.title),
      ...series.map((item, index) => text(`openui_bar_chart_${index}`, `${formatCell(item[xKey])}：${formatCell(item[yKey])}`)),
      list("openui_bar_chart_list", series.map((_item, index) => `openui_bar_chart_${index}`)),
      card("openui_bar_chart_root", ["openui_bar_chart_title", "openui_bar_chart_list"])
    ]
  };
}

function buildGenericRiskListSurface(data: GenericOpenUIStructuredData, ctx: { surfacePrefix: string; runId: string }): SurfaceBuildOutput {
  const surfaceId = `${ctx.surfacePrefix}_${ctx.runId}_openui_risk_${safeId(data.resource)}`;
  const risks = data.rows.slice(0, 12).map((row, index) => ({
    id: String(row.id ?? row.vin ?? `${data.resource}_${index}`),
    level: normalizeRiskLevel(row.risk_level ?? row.warning_level ?? row.stock_warning_level ?? row.priority ?? row.status),
    tool: String(row.resource ?? data.resource),
    message: summarizeRow(row),
    mitigated: /已处理|完成|正常|done|closed/i.test(String(row.status ?? ""))
  }));
  return {
    surfaceId,
    root: "openui_risk_root",
    data: {
      title: data.title,
      resource: data.resource,
      row_count: data.total ?? data.rows.length,
      openui_lang: { protocol: "openui-lang/1.0", intent: data.decision.intent, decision: data.decision },
      openui: openUIView("RiskListSurface", { title: data.title, risks })
    },
    components: [
      text("openui_risk_title", `${data.title}（${risks.length} 项）`),
      ...risks.map((risk, index) => text(`openui_risk_${index}`, `[${risk.level}] ${risk.message}`)),
      list("openui_risk_list", risks.map((_risk, index) => `openui_risk_${index}`)),
      card("openui_risk_root", ["openui_risk_title", "openui_risk_list"])
    ]
  };
}

function buildGenericMetricCardsSurface(data: GenericOpenUIStructuredData, ctx: { surfacePrefix: string; runId: string }): SurfaceBuildOutput {
  const surfaceId = `${ctx.surfacePrefix}_${ctx.runId}_openui_metrics_${safeId(data.resource)}`;
  const metrics = data.rows.slice(0, 6).map((row, index) => {
    const keys = Object.keys(row);
    const labelKey = keys.find((key) => /(label|name|metric|title|key)/i.test(key)) ?? keys[0] ?? "metric";
    const valueKey = keys.find((key) => /(value|count|total|amount|rate|score)/i.test(key)) ?? keys.find((key) => typeof row[key] === "number") ?? keys[1] ?? labelKey;
    return {
      key: String(row.key ?? row[labelKey] ?? `${data.resource}_${index}`),
      label: String(row[labelKey] ?? columnForKey(labelKey).label),
      value: row[valueKey] ?? "-",
      unit: typeof row.unit === "string" ? row.unit : undefined,
      trend: normalizeTrend(row.trend)
    };
  });
  return {
    surfaceId,
    root: "openui_metrics_root",
    data: {
      title: data.title,
      resource: data.resource,
      row_count: data.total ?? data.rows.length,
      openui_lang: { protocol: "openui-lang/1.0", intent: data.decision.intent, decision: data.decision },
      openui: openUIView("MetricCardsSurface", { title: data.title, metrics })
    },
    components: [
      text("openui_metrics_title", data.title),
      ...metrics.map((metric, index) => text(`openui_metric_${index}`, `${metric.label}：${formatCell(metric.value)}`)),
      list("openui_metrics_list", metrics.map((_metric, index) => `openui_metric_${index}`)),
      card("openui_metrics_root", ["openui_metrics_title", "openui_metrics_list"])
    ]
  };
}

function buildGenericGroupedListSurface(data: GenericOpenUIStructuredData, ctx: { surfacePrefix: string; runId: string }): SurfaceBuildOutput {
  const surfaceId = `${ctx.surfacePrefix}_${ctx.runId}_openui_grouped_${safeId(data.resource)}`;
  const groupKey = inferGroupKey(data.rows);
  const groups = new Map<string, JsonObject[]>();
  for (const row of data.rows) {
    const key = String(row[groupKey] ?? "未分组");
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const renderedGroups = [...groups.entries()].slice(0, 8).map(([label, rows]) => ({
    label,
    count: rows.length,
    items: rows.slice(0, 6).map((row) => summarizeRow(row))
  }));
  return {
    surfaceId,
    root: "openui_grouped_root",
    data: {
      title: data.title,
      resource: data.resource,
      row_count: data.total ?? data.rows.length,
      group_key: groupKey,
      groups: renderedGroups,
      openui_lang: { protocol: "openui-lang/1.0", intent: data.decision.intent, decision: data.decision },
      openui: openUIView("GroupedListSurface", { title: data.title, groupKey, groups: renderedGroups })
    },
    components: [
      text("openui_grouped_title", `${data.title}（按 ${columnForKey(groupKey).label} 分组）`),
      ...renderedGroups.map((group, index) => text(`openui_group_${index}`, `${group.label}（${group.count}）：${group.items.join("；")}`)),
      list("openui_grouped_list", renderedGroups.map((_group, index) => `openui_group_${index}`)),
      card("openui_grouped_root", ["openui_grouped_title", "openui_grouped_list"])
    ]
  };
}

function dataTableFallbackComponents(data: GenericOpenUIStructuredData, columns: OpenUILangDataTableColumn[]): OpenUILangCompatComponentInstance[] {
  const children = ["openui_table_title"];
  const rowIds: string[] = [];
  for (const [index, row] of data.rows.slice(0, 8).entries()) {
    const line = columns.slice(0, 6)
      .map((column) => `${column.label}：${formatCell(row[column.key])}`)
      .join(" | ");
    const id = `openui_table_row_${index}`;
    rowIds.push(id);
    children.push(id);
  }
  return [
    text("openui_table_title", `${data.title}（${data.total ?? data.rows.length} 条）`),
    ...rowIds.map((id, index) => {
      const row = data.rows[index];
      const line = columns.slice(0, 6)
        .map((column) => `${column.label}：${formatCell(row[column.key])}`)
        .join(" | ");
      return text(id, line);
    }),
    list("openui_table_list", rowIds),
    card("openui_table_root", ["openui_table_title", "openui_table_list"])
  ];
}

function inferColumns(rows: JsonObject[]): OpenUILangDataTableColumn[] {
  const keys: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (keys.includes(key)) continue;
      if (isNoisyField(key)) continue;
      keys.push(key);
      if (keys.length >= 8) return keys.map(columnForKey);
    }
  }
  return keys.map(columnForKey);
}

function columnForKey(key: string): OpenUILangDataTableColumn {
  return {
    key,
    label: FIELD_LABELS[key] ?? humanizeKey(key),
    type: inferType(key)
  };
}

function inferType(key: string): OpenUILangDataTableColumn["type"] {
  if (/(status|stage|level|warning|risk)/i.test(key)) return "status";
  if (/(date|time|_at)$/i.test(key)) return "date";
  if (/(amount|price|cost|fee|revenue)/i.test(key)) return "currency";
  if (/(count|days|age|score|rate|total|num)/i.test(key)) return "number";
  return "text";
}

function titleForResource(resource: string, options: { component?: string; groupBy?: string } = {}): string {
  if (options.component === "BarChartSurface") {
    const group = options.groupBy ? `按${columnForKey(options.groupBy).label}` : "";
    if (/sales_order/i.test(resource)) return `${group}销售订单分布`;
    return `${group}分布图`;
  }
  if (options.component === "PieChartSurface") return "构成分析";
  if (options.component === "LineChartSurface") return "趋势分析";
  if (options.component === "InsightSummarySurface") return "分析结论";
  if (options.component === "AnalyticsDashboardSurface") return "数据分析看板";
  if (/lead/i.test(resource)) return "线索明细";
  if (/customer/i.test(resource)) return "客户明细";
  if (/order|delivery|vehicle/i.test(resource)) return "交付/车辆明细";
  return "结构化数据明细";
}

function componentForSurfaceKind(surfaceKind: OpenUIPresentationDecision["surfaceKind"]): GenericOpenUIStructuredData["component"] | null {
  if (surfaceKind === "RiskListSurface") return "RiskListSurface";
  if (surfaceKind === "MetricCardsSurface") return "MetricCardsSurface";
  if (surfaceKind === "BarChartSurface") return "BarChartSurface";
  if (surfaceKind === "PieChartSurface") return "PieChartSurface";
  if (surfaceKind === "LineChartSurface") return "LineChartSurface";
  if (surfaceKind === "InsightSummarySurface") return "InsightSummarySurface";
  if (surfaceKind === "AnalyticsDashboardSurface") return "AnalyticsDashboardSurface";
  if (surfaceKind === "GroupedListSurface") return "GroupedListSurface";
  if (surfaceKind === "DataTableSurface") return "DataTableSurface";
  return null;
}

function inferChartXKey(data: GenericOpenUIStructuredData): string {
  if (data.groupBy && data.rows.some((row) => row[data.groupBy] !== undefined)) return data.groupBy;
  return inferGroupKey(data.rows);
}

function inferChartYKey(rows: JsonObject[], xKey: string): string {
  const first = rows[0] ?? {};
  const preferred = ["total_revenue", "order_count", "gross_margin_pct", "lead_count", "value", "count", "row_count"];
  for (const key of preferred) {
    if (key !== xKey && rows.some((row) => readNumber(row[key]) !== null)) return key;
  }
  return Object.keys(first).find((key) => key !== xKey && readNumber(first[key]) !== null) ?? "value";
}

function normalizeRiskLevel(value: unknown): "high" | "medium" | "low" {
  const text = String(value ?? "").toLowerCase();
  if (/高|紧急|严重|逾期|high|critical|urgent|p0|p1/.test(text)) return "high";
  if (/中|关注|medium|warn|warning|p2/.test(text)) return "medium";
  return "low";
}

function normalizeTrend(value: unknown): "up" | "down" | "flat" | undefined {
  const text = String(value ?? "").toLowerCase();
  if (/up|rise|增长|上升/.test(text)) return "up";
  if (/down|drop|下降|降低/.test(text)) return "down";
  if (/flat|持平/.test(text)) return "flat";
  return undefined;
}

function inferGroupKey(rows: JsonObject[]): string {
  const candidates = ["priority", "status", "stage", "source", "store_name", "owner", "advisor", "consultant", "category", "type", "series"];
  for (const key of candidates) {
    const values = new Set(rows.map((row) => row[key]).filter((value) => value !== undefined && value !== null));
    if (values.size >= 2 && values.size <= Math.max(6, rows.length)) return key;
  }
  return Object.keys(rows[0] ?? {}).find((key) => typeof rows[0]?.[key] === "string") ?? "status";
}

function inferTemporalKey(rows: JsonObject[]): string | null {
  const first = rows[0] ?? {};
  return Object.keys(first).find((key) => /(date|day|week|month|time|时间|日期)/i.test(key)) ?? null;
}

function summarizeRow(row: JsonObject): string {
  const columns = inferColumns([row]).slice(0, 5);
  return columns.map((column) => formatCell(row[column.key])).filter((value) => value && value !== "-").join(" · ") || JSON.stringify(row).slice(0, 120);
}

function readObject(value: unknown): JsonObject | null {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function readNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function humanizeKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function isNoisyField(key: string): boolean {
  return /^(id|uuid|vin|raw|payload|metadata|debug)$/i.test(key);
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "object") return JSON.stringify(value).slice(0, 80);
  return String(value);
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "data";
}
