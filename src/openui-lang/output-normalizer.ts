import type { JsonObject, JsonValue } from "../types/agent-contracts.js";

export interface NormalizedOpenUIGroup extends JsonObject {
  label: string;
  rowCount?: number;
  aggregates?: JsonObject;
}

export interface NormalizedOpenUIMetric extends JsonObject {
  key: string;
  label: string;
  value: JsonValue;
  unit?: string;
}

export interface NormalizedOpenUIChart extends JsonObject {
  kind: string;
  title?: string;
  xKey?: string;
  yKey?: string;
  categoryKey?: string;
  valueKey?: string;
  series: JsonObject[];
}

export interface NormalizedOpenUIOutput extends JsonObject {
  resource: string;
  total?: number;
  groupBy?: string;
  rows: JsonObject[];
  groups: NormalizedOpenUIGroup[];
  aggregates: JsonObject;
  metrics: NormalizedOpenUIMetric[];
  charts: NormalizedOpenUIChart[];
  insights: JsonObject[];
  sources: JsonObject[];
  raw: JsonObject;
}

export function normalizeOpenUIOutputs(record: Record<string, unknown>): NormalizedOpenUIOutput[] {
  const output = readObject(record.output) ?? {};
  const debug = readObject(record.debug) ?? readObject(output.debug) ?? {};
  const nestedContext = readObject(output._openui_lang_context) ?? readObject(output._a2ui_context) ?? {};
  const explicitStructured = readStructuredOutput(record.structured) ?? readStructuredOutput(output.structured);
  const directToolResults = readArray(record.tool_results).length ? readArray(record.tool_results) : readArray(output.tool_results);
  const toolResults = readArray(debug.tool_results);
  const contextToolResults = readArray(nestedContext.tool_results);
  const candidates = explicitStructured
    ? [explicitStructured]
    : directToolResults.length
      ? directToolResults
      : toolResults.length
        ? toolResults
        : contextToolResults.length
          ? contextToolResults
          : [output, record as JsonObject];
  const normalized: NormalizedOpenUIOutput[] = [];
  for (const candidate of candidates) {
    const item = normalizeOpenUIOutput(candidate);
    if (item) normalized.push(item);
  }
  return normalized;
}

export function normalizeOpenUIOutput(result: JsonObject): NormalizedOpenUIOutput | null {
  const data = readObject(result.data) ?? {};
  const structured = readStructuredOutput(result.structured) ?? readStructuredOutput(data.structured);
  const source = structured ?? result;
  const sourceData = structured ? structured : data;
  const rows = readRows(source, sourceData);
  const groups = readGroups(source, sourceData);
  const aggregates = readObject(source.aggregates) ?? readObject(sourceData.aggregates) ?? {};
  const metrics = readMetrics(source, sourceData, aggregates);
  const charts = readCharts(source, sourceData);
  const insights = readInsights(source, sourceData);
  const sources = readArray(source.sources).length ? readArray(source.sources) : readArray(sourceData.sources);
  if (!rows.length && !groups.length && !Object.keys(aggregates).length && !metrics.length && !charts.length && !insights.length && !sources.length) return null;
  return {
    resource: String(source.resource ?? sourceData.resource ?? result.resource ?? result.tool ?? "structured_data"),
    total: (readNumber(source.total) ?? readNumber(sourceData.total) ?? rows.length) || undefined,
    groupBy: typeof source.group_by === "string" ? source.group_by : typeof sourceData.group_by === "string" ? sourceData.group_by : undefined,
    rows,
    groups,
    aggregates,
    metrics,
    charts,
    insights,
    sources,
    raw: result
  };
}

export function rowsFromNormalizedOutput(output: NormalizedOpenUIOutput): JsonObject[] {
  if (output.groups.length) {
    return output.groups.map((group, index) => ({
      ...(readObject(group.group) ?? {}),
      ...(group.aggregates ?? {}),
      row_count: group.rowCount ?? group.row_count ?? 0,
      key: group.label || `group_${index}`
    }));
  }
  if (output.metrics.length) {
    return output.metrics.map((metric) => ({
      key: metric.key,
      label: metric.label,
      value: metric.value,
      unit: metric.unit
    }));
  }
  return output.rows;
}

function readStructuredOutput(value: unknown): JsonObject | null {
  const object = readObject(value);
  if (!object) return null;
  return object;
}

function readRows(source: JsonObject, data: JsonObject): JsonObject[] {
  const sourceTable = readObject(source.table) ?? {};
  const dataTable = readObject(data.table) ?? {};
  const sourceResult = readObject(source.result) ?? {};
  const dataResult = readObject(data.result) ?? {};
  for (const item of [
    source.rows, source.sample_rows, source.items,
    data.rows, data.sample_rows, data.items,
    sourceTable.rows, dataTable.rows,
    sourceResult.rows, sourceResult.items,
    dataResult.rows, dataResult.items
  ]) {
    const rows = readArray(item);
    if (rows.length) return rows;
  }
  return [];
}

function readGroups(source: JsonObject, data: JsonObject): NormalizedOpenUIGroup[] {
  const groups = readArray(source.groups).length ? readArray(source.groups) : readArray(data.groups);
  return groups.map((group, index) => {
    const groupObject = readObject(group.group) ?? {};
    const aggregates = readObject(group.aggregates) ?? {};
    const label = String(Object.values(groupObject).find((value) => value !== undefined && value !== null) ?? group.label ?? group.key ?? `group_${index}`);
    return {
      ...group,
      label,
      rowCount: readNumber(group.row_count) ?? readNumber(group.count) ?? undefined,
      aggregates
    };
  });
}

function readMetrics(source: JsonObject, data: JsonObject, aggregates: JsonObject): NormalizedOpenUIMetric[] {
  const rawMetrics = readArray(source.metrics).length
    ? readArray(source.metrics)
    : readArray(data.metrics).length
      ? readArray(data.metrics)
      : readArray(source.kpis).length
        ? readArray(source.kpis)
        : readArray(data.kpis).length
          ? readArray(data.kpis)
          : readArray(source.stats).length
            ? readArray(source.stats)
            : readArray(data.stats);
  if (rawMetrics.length) {
    return rawMetrics.map((metric, index) => {
      const key = String(metric.key ?? metric.as ?? `metric_${index}`);
      return {
        ...metric,
        key,
        label: String(metric.label ?? humanizeKey(key)),
        value: toJsonValue(metric.value ?? metric.count ?? metric.total ?? "-")
      };
    });
  }
  const metricObject = readObject(source.metrics) ?? readObject(data.metrics) ?? readObject(source.kpis) ?? readObject(data.kpis) ?? readObject(source.stats) ?? readObject(data.stats);
  if (metricObject) {
    return Object.entries(metricObject)
      .filter(([key]) => !key.startsWith("_"))
      .map(([key, value]) => ({ key, label: humanizeKey(key), value: toJsonValue(value) }));
  }
  return Object.entries(aggregates)
    .filter(([key]) => !key.startsWith("_"))
    .map(([key, value]) => ({ key, label: humanizeKey(key), value: toJsonValue(value) }));
}

function readCharts(source: JsonObject, data: JsonObject): NormalizedOpenUIChart[] {
  const singleChart = readObject(source.chart) ?? readObject(data.chart);
  const charts = readArray(source.charts).length
    ? readArray(source.charts)
    : readArray(data.charts).length
      ? readArray(data.charts)
      : readArray(source.visualizations).length
        ? readArray(source.visualizations)
        : readArray(data.visualizations).length
          ? readArray(data.visualizations)
          : singleChart
            ? [singleChart]
            : [];
  return charts.map((chart, index) => {
    const kind = String(chart.kind ?? chart.type ?? "bar").toLowerCase();
    return {
      ...chart,
      kind,
      title: typeof chart.title === "string" ? chart.title : undefined,
      xKey: typeof chart.xKey === "string" ? chart.xKey : typeof chart.x_key === "string" ? chart.x_key : undefined,
      yKey: typeof chart.yKey === "string" ? chart.yKey : typeof chart.y_key === "string" ? chart.y_key : undefined,
      categoryKey: typeof chart.categoryKey === "string" ? chart.categoryKey : typeof chart.category_key === "string" ? chart.category_key : undefined,
      valueKey: typeof chart.valueKey === "string" ? chart.valueKey : typeof chart.value_key === "string" ? chart.value_key : undefined,
      series: readArray(chart.series).length ? readArray(chart.series) : readArray(chart.data),
      key: String(chart.key ?? `chart_${index}`)
    };
  }).filter((chart) => chart.series.length);
}

function readInsights(source: JsonObject, data: JsonObject): JsonObject[] {
  for (const item of [source.insights, data.insights, source.findings, data.findings, source.analysis, data.analysis]) {
    const insights = normalizeInsightArray(item);
    if (insights.length) return insights;
  }
  const recommendations = normalizeInsightArray(source.recommendations).length
    ? normalizeInsightArray(source.recommendations)
    : normalizeInsightArray(data.recommendations);
  if (recommendations.length) {
    return recommendations.map((item, index) => ({
      title: item.title ?? `建议 ${index + 1}`,
      summary: item.summary ?? item.text ?? item.recommendation,
      recommendation: item.recommendation ?? item.summary ?? item.text
    }));
  }
  return [];
}

function normalizeInsightArray(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      const object = readObject(item);
      if (object) return object;
      if (typeof item === "string") return { title: `分析 ${index + 1}`, summary: item };
      return null;
    })
    .filter((item): item is JsonObject => Boolean(item));
}

function readArray(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(readObject) : [];
}

function readObject(value: unknown): JsonObject | null {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function readNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(toJsonValue);
  const object = readObject(value);
  if (object) return object;
  return String(value ?? "");
}

function humanizeKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}
