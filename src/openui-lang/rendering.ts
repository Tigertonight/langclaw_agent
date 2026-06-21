import { parseOpenUILangJsonPointer, type OpenUILangSurfaceSnapshot } from "./core.js";
import type { OpenUILangCompatComponent } from "./types.js";
import type { JsonObject, JsonValue } from "../types/agent-contracts.js";

export interface BasicComponentDescriptor {
  name: string;
  acceptsChildren: boolean;
}

export interface OpenUILangComponentCatalog<TComponent = unknown> {
  lookup(componentName: string): TComponent | undefined;
  listRegistered(): string[];
}

export interface OpenUILangRenderer<TNode = unknown> {
  renderSurface(surface: OpenUILangSurfaceSnapshot): TNode;
}

export interface OpenUILangReactNode {
  type: string;
  props: JsonObject;
  children?: Array<OpenUILangReactNode | string>;
}

export interface OpenUILangFormField extends JsonObject {
  name: string;
  label: string;
  component: "Input" | "TextArea" | "Select" | "DateTime" | "Hidden";
  required?: boolean;
  options?: Array<{ label: string; value: string }>;
}

export interface OpenUILangFormContract extends JsonObject {
  fields: OpenUILangFormField[];
  initialValues: JsonObject;
  submitAction: {
    name: string;
    label?: string;
    context?: JsonObject;
  };
}

export interface OpenUILangFormilyFieldSchema extends JsonObject {
  type: "string";
  title: string;
  required?: boolean;
  "x-component": string;
  "x-component-props"?: JsonObject;
  enum?: Array<{ label: string; value: string }>;
}

export interface OpenUILangFormilySchema extends JsonObject {
  type: "object";
  properties: Record<string, OpenUILangFormilyFieldSchema>;
}

export interface OpenUILangFormilyRenderPlan extends JsonObject {
  schema: OpenUILangFormilySchema;
  initialValues: JsonObject;
  submitAction: OpenUILangFormContract["submitAction"];
}

export type OpenUIRenderer<TNode = unknown> = (input: {
  surface: OpenUILangSurfaceSnapshot;
  props: JsonObject;
  actions: JsonObject[];
  component: string;
}) => TNode | null;

const BASIC_COMPONENT_NAMES = ["Text", "Image", "Icon", "Video", "AudioPlayer", "Row", "Column", "List", "Card", "Tabs", "Button"] as const;
const CHILDREN_COMPONENTS = new Set(["Card", "Row", "Column", "List", "Tabs"]);

export class BasicComponentCatalog implements OpenUILangComponentCatalog<BasicComponentDescriptor> {
  private readonly components = new Map<string, BasicComponentDescriptor>(
    BASIC_COMPONENT_NAMES.map((name) => [name, { name, acceptsChildren: CHILDREN_COMPONENTS.has(name) }])
  );

  lookup(componentName: string): BasicComponentDescriptor | undefined {
    return this.components.get(componentName);
  }

  listRegistered(): string[] {
    return [...this.components.keys()];
  }
}

export class OpenUIRendererRegistry<TNode = unknown> {
  private readonly renderers = new Map<string, OpenUIRenderer<TNode>>();

  constructor(private readonly renderUnknown: (component: string) => TNode | null = () => null) {}

  register(component: string, renderer: OpenUIRenderer<TNode>): void {
    this.renderers.set(component, renderer);
  }

  has(component: string): boolean {
    return this.renderers.has(component);
  }

  listRegistered(): string[] {
    return [...this.renderers.keys()];
  }

  render(surface: OpenUILangSurfaceSnapshot): TNode | null {
    const openui = readOpenUI(surface.data);
    if (!openui) return null;
    const renderer = this.renderers.get(openui.component);
    if (!renderer) return this.renderUnknown(openui.component);
    return renderer({
      surface,
      component: openui.component,
      props: openui.props,
      actions: openui.actions
    });
  }
}

export class OpenUILangBasicHtmlRenderer implements OpenUILangRenderer<string> {
  constructor(private readonly openui = new OpenUIRendererRegistry<string>((component) => {
    return `<section class="openui-card openui-unsupported"><strong>不支持的组件</strong><p>客户端暂不支持 ${escapeHtml(component)}，已降级显示。</p></section>`;
  })) {
    this.registerDefaultOpenUIRenderers();
  }

  renderSurface(surface: OpenUILangSurfaceSnapshot): string {
    const openui = this.openui.render(surface);
    if (openui) return openui;
    const byId = new Map(surface.components.map((component) => [component.id, component]));
    return this.renderComponent(surface, byId, surface.root) ?? "";
  }

  registerOpenUI(component: string, renderer: Parameters<OpenUIRendererRegistry<string>["register"]>[1]): void {
    this.openui.register(component, renderer);
  }

  private registerDefaultOpenUIRenderers(): void {
    this.openui.register("BusinessBriefSurface", (_input) => renderBusinessBriefHtml(_input.props));
    this.openui.register("ProductLaunchFormSurface", (_input) => renderProductLaunchFormHtml(_input.props));
    this.openui.register("DataTableSurface", (_input) => renderDataTableHtml(_input.props));
    this.openui.register("RiskListSurface", (_input) => renderRiskListHtml(_input.props));
    this.openui.register("MetricCardsSurface", (_input) => renderMetricCardsHtml(_input.props));
    this.openui.register("TagListSurface", (_input) => renderTagListHtml(_input.props));
    this.openui.register("BarChartSurface", (_input) => renderBarChartHtml(_input.props));
    this.openui.register("PieChartSurface", (_input) => renderPieChartHtml(_input.props));
    this.openui.register("LineChartSurface", (_input) => renderLineChartHtml(_input.props));
    this.openui.register("InsightSummarySurface", (_input) => renderInsightsHtml(_input.props));
    this.openui.register("AnalyticsDashboardSurface", (_input) => renderAnalyticsDashboardHtml(_input.props));
    this.openui.register("GroupedListSurface", (_input) => renderGroupedListHtml(_input.props));
    this.openui.register("CitationDisclosure", (_input) => renderSourcesHtml(_input.props, "引用来源"));
    this.openui.register("EvidenceSurface", (_input) => renderSourcesHtml(_input.props, "参考依据"));
    this.openui.register("ToolCatalogSurface", (_input) => renderToolCatalogHtml(_input.props));
    this.openui.register("TaskTrackingSurface", (_input) => renderTaskTrackingHtml(_input.props));
    this.openui.register("PendingActionSurface", (_input) => renderPendingActionHtml(_input.props));
    this.openui.register("ExpenseEstimate", (_input) => renderGenericBusinessHtml(_input.props, "报销金额测算"));
    this.openui.register("ApprovalFlow", (_input) => renderGenericBusinessHtml(_input.props, "审批确认流程"));
    this.openui.register("TaskResumeCard", (_input) => renderGenericBusinessHtml(_input.props, "继续任务"));
    this.openui.register("RuntimeSummary", (_input) => renderGenericBusinessHtml(_input.props, "运行摘要"));
  }

  private renderComponent(surface: OpenUILangSurfaceSnapshot, byId: Map<string, OpenUILangCompatComponent>, id: string): string | null {
    const item = byId.get(id);
    if (!item) return null;
    const [type, rawProps] = Object.entries(item.component ?? {})[0] ?? [];
    const props = isJsonObject(rawProps) ? rawProps : {};
    if (!type) return null;
    if (type === "Card") return wrap("section", "openui-card", this.renderChildren(surface, byId, props.children));
    if (type === "Row") return wrap("div", "openui-row", this.renderChildren(surface, byId, props.children));
    if (type === "Column" || type === "List") return wrap("div", type === "Column" ? "openui-column" : "openui-list", this.renderChildren(surface, byId, props.children));
    if (type === "Tabs") return wrap("div", "openui-tabs", this.renderChildren(surface, byId, props.children));
    if (type === "Text") return wrap("div", "openui-text", escapeHtml(resolveOpenUILangText(props.text, surface.data)));
    if (type === "Button") {
      return `<button type="button" class="openui-button" data-action="${escapeHtml(readActionName(props.action))}">${escapeHtml(resolveOpenUILangText(props.text, surface.data))}</button>`;
    }
    if (type === "Image") return `<img class="openui-image" src="${escapeHtml(String(props.src ?? ""))}" alt="${escapeHtml(String(props.alt ?? ""))}">`;
    if (type === "Icon") return `<span class="openui-icon">${escapeHtml(String(props.name ?? ""))}</span>`;
    return wrap("div", "openui-unsupported", `不支持的组件：${escapeHtml(type)}`);
  }

  private renderChildren(surface: OpenUILangSurfaceSnapshot, byId: Map<string, OpenUILangCompatComponent>, children: unknown): string {
    if (!Array.isArray(children)) return "";
    return children.map((child) => this.renderComponent(surface, byId, String(child)) ?? "").join("");
  }
}

function renderBusinessBriefHtml(props: JsonObject): string {
  const title = escapeHtml(String(props.title ?? "业务结论"));
  const verdict = escapeHtml(String(props.verdict ?? ""));
  const subtitle = props.subtitle ? `<p>${escapeHtml(String(props.subtitle))}</p>` : "";
  const kpis = Array.isArray(props.kpis) ? props.kpis.filter(isJsonObject) : [];
  const priorityItems = Array.isArray(props.priority_items) ? props.priority_items.filter(isJsonObject) : [];
  const nextActions = Array.isArray(props.next_actions) ? props.next_actions.filter(isJsonObject) : [];
  const metrics = kpis.length ? renderMetricCardsHtml({ title: "关键指标", metrics: kpis.slice(0, 4) }) : "";
  const priorities = priorityItems.length ? `<section><strong>优先处理事项</strong><ol>${priorityItems.slice(0, 4).map((item) => `<li>${escapeHtml(String(item.title ?? item.label ?? item.value ?? ""))}</li>`).join("")}</ol></section>` : "";
  const actions = nextActions.length ? `<section><strong>后续动作</strong><ol>${nextActions.slice(0, 4).map((item, index) => `<li>${escapeHtml(cleanBusinessBriefActionTitle(String(item.title ?? item.label ?? item.detail ?? ""), index))}</li>`).join("")}</ol></section>` : "";
  const evidence = props.evidence_label ? `<p>证据：${escapeHtml(String(props.evidence_label))}</p>` : "";
  const boundary = props.boundary_label ? `<p>${escapeHtml(String(props.boundary_label))}</p>` : "";
  return `<section class="openui-card openui-business-brief"><strong>${title}</strong><h3>${verdict}</h3>${subtitle}${metrics}${priorities}${actions}${evidence}${boundary}</section>`;
}

function cleanBusinessBriefActionTitle(value: string, index: number): string {
  if (/^(下一步|行动)\s*\d+$/i.test(value.trim())) return `动作 ${index + 1}`;
  return value;
}

function renderProductLaunchFormHtml(props: JsonObject): string {
  const sections = Array.isArray(props.sections) ? props.sections.filter(isJsonObject) : [];
  const missing = Array.isArray(props.missing_items) ? props.missing_items : [];
  const actions = Array.isArray(props.actions) ? props.actions.filter(isJsonObject) : [];
  const sectionHtml = sections.map((section) => {
    const fields = Array.isArray(section.fields) ? section.fields.filter(isJsonObject) : [];
    const fieldHtml = fields.map((field) => {
      const label = escapeHtml(String(field.label ?? field.key ?? ""));
      const value = escapeHtml(String(field.value ?? field.hint ?? "待确认"));
      const required = field.required ? " *" : "";
      return `<label><span>${label}${required}</span><input value="${value}" readonly></label>`;
    }).join("");
    return `<section><strong>${escapeHtml(String(section.title ?? "配置字段"))}</strong>${section.description ? `<p>${escapeHtml(String(section.description))}</p>` : ""}${fieldHtml}</section>`;
  }).join("");
  const missingHtml = missing.length ? `<section><strong>待补齐</strong><ul>${missing.slice(0, 8).map((item) => `<li>${escapeHtml(String(item))}</li>`).join("")}</ul></section>` : "";
  const actionHtml = actions.length ? `<section><strong>后续动作</strong><ul>${actions.slice(0, 4).map((item) => `<li>${escapeHtml(String(item.label ?? item.detail ?? ""))}</li>`).join("")}</ul></section>` : "";
  const boundary = props.boundary_label ? `<p>${escapeHtml(String(props.boundary_label))}</p>` : "";
  return `<section class="openui-card openui-product-launch-form"><strong>${escapeHtml(String(props.title ?? "云商品上架表单"))}</strong>${props.guide ? `<p>${escapeHtml(String(props.guide))}</p>` : ""}${sectionHtml}${missingHtml}${actionHtml}${boundary}</section>`;
}

function renderDataTableHtml(props: JsonObject): string {
  const columns = Array.isArray(props.columns) ? props.columns.filter(isJsonObject) : [];
  const rows = Array.isArray(props.rows) ? props.rows.filter(isJsonObject) : [];
  const title = escapeHtml(String(props.title ?? "数据明细"));
  const description = escapeHtml(String(props.description ?? `${props.rowCount ?? rows.length} 条记录`));
  if (!columns.length || !rows.length) return `<section class="openui-card"><strong>${title}</strong><p>${description}</p><p class="openui-empty">暂无可展示记录</p></section>`;
  const head = columns.slice(0, 8).map((column) => `<th>${escapeHtml(String(column.label ?? column.key ?? ""))}</th>`).join("");
  const body = rows.slice(0, 20).map((row) => {
    const cells = columns.slice(0, 8).map((column) => {
      const key = String(column.key ?? "");
      return `<td>${formatHtmlCell(row[key], String(column.type ?? ""))}</td>`;
    }).join("");
    return `<tr>${cells}</tr>`;
  }).join("");
  return `<section class="openui-card"><strong>${title}</strong><p>${description}</p><div class="openui-table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></section>`;
}

function renderRiskListHtml(props: JsonObject): string {
  const risks = Array.isArray(props.risks) ? props.risks.filter(isJsonObject) : [];
  const title = escapeHtml(String(props.title ?? "风险提示"));
  const items = risks.slice(0, 12).map((risk) => {
    const level = escapeHtml(String(risk.level ?? "unknown"));
    const message = escapeHtml(String(risk.message ?? risk.id ?? ""));
    const tool = risk.tool ? `<span class="openui-chip">${escapeHtml(String(risk.tool))}</span>` : "";
    return `<li><span class="openui-chip openui-risk-${level}">${level}</span>${tool}<span>${message}</span></li>`;
  }).join("");
  return `<section class="openui-card"><strong>${title}</strong><ul class="openui-list">${items}</ul></section>`;
}

function renderMetricCardsHtml(props: JsonObject): string {
  const metrics = Array.isArray(props.metrics) ? props.metrics.filter(isJsonObject) : [];
  const title = escapeHtml(String(props.title ?? "关键指标"));
  const items = metrics.slice(0, 6).map((metric) => {
    const value = escapeHtml(String(metric.value ?? "-"));
    const unit = escapeHtml(String(metric.unit ?? ""));
    const label = escapeHtml(String(metric.label ?? "-"));
    return `<div class="openui-metric"><strong>${value}${unit}</strong><span>${label}</span></div>`;
  }).join("");
  return `<section class="openui-card"><strong>${title}</strong><div class="openui-metrics">${items}</div></section>`;
}

function renderTagListHtml(props: JsonObject): string {
  const tags = Array.isArray(props.tags) ? props.tags.filter(isJsonObject) : [];
  const title = escapeHtml(String(props.title ?? "业务标签"));
  if (!tags.length) return `<section class="openui-card"><strong>${title}</strong><p class="openui-empty">暂无标签</p></section>`;
  const items = tags.slice(0, 40).map((tag) => {
    const label = escapeHtml(String(tag.label ?? "-"));
    const value = tag.value === undefined || tag.value === null || tag.value === "" ? "" : `<strong>${escapeHtml(String(tag.value))}</strong>`;
    return `<span class="openui-chip">${label}${value}</span>`;
  }).join("");
  return `<section class="openui-card"><strong>${title}</strong><div class="openui-tags">${items}</div></section>`;
}

function renderBarChartHtml(props: JsonObject): string {
  const series = Array.isArray(props.series) ? props.series.filter(isJsonObject) : [];
  const xKey = String(props.xKey ?? "label");
  const yKey = String(props.yKey ?? "value");
  const title = escapeHtml(String(props.title ?? "分布图"));
  if (!series.length) return `<section class="openui-card"><strong>${title}</strong><p class="openui-empty">暂无可展示数据</p></section>`;
  const values = series.map((item) => Number(item[yKey])).filter(Number.isFinite);
  const max = Math.max(...values, 1);
  const rows = series.slice(0, 12).map((item) => {
    const label = escapeHtml(String(item[xKey] ?? item.key ?? "未分组"));
    const value = Number(item[yKey]);
    const width = Number.isFinite(value) ? Math.max(2, Math.round(value / max * 100)) : 2;
    const display = escapeHtml(formatNumberForChart(value));
    return `<div class="openui-bar-row"><span>${label}</span><div class="openui-bar-track"><i style="width:${width}%"></i></div><strong>${display}</strong></div>`;
  }).join("");
  return `<section class="openui-card"><strong>${title}</strong><div class="openui-bar-chart">${rows}</div></section>`;
}

function renderPieChartHtml(props: JsonObject): string {
  const series = Array.isArray(props.series) ? props.series.filter(isJsonObject) : [];
  const categoryKey = String(props.categoryKey ?? props.xKey ?? "label");
  const valueKey = String(props.valueKey ?? props.yKey ?? "value");
  const title = escapeHtml(String(props.title ?? "构成分析"));
  if (!series.length) return `<section class="openui-card"><strong>${title}</strong><p class="openui-empty">暂无可展示数据</p></section>`;
  const items = series.slice(0, 12).map((item) => `<li><span class="openui-chip">${escapeHtml(String(item[categoryKey] ?? item.label ?? "未分组"))}</span><strong>${escapeHtml(formatNumberForChart(Number(item[valueKey])))}</strong></li>`).join("");
  return `<section class="openui-card"><strong>${title}</strong><ul class="openui-list" data-chart="pie">${items}</ul></section>`;
}

function renderLineChartHtml(props: JsonObject): string {
  const series = Array.isArray(props.series) ? props.series.filter(isJsonObject) : [];
  const xKey = String(props.xKey ?? "date");
  const yKey = String(props.yKey ?? "value");
  const title = escapeHtml(String(props.title ?? "趋势分析"));
  if (!series.length) return `<section class="openui-card"><strong>${title}</strong><p class="openui-empty">暂无可展示数据</p></section>`;
  const items = series.slice(0, 40).map((item) => `<li><span>${escapeHtml(String(item[xKey] ?? "-"))}</span><strong>${escapeHtml(formatNumberForChart(Number(item[yKey])))}</strong></li>`).join("");
  return `<section class="openui-card"><strong>${title}</strong><ul class="openui-list" data-chart="line">${items}</ul></section>`;
}

function renderInsightsHtml(props: JsonObject): string {
  const insights = Array.isArray(props.insights) ? props.insights.filter(isJsonObject) : [];
  const title = escapeHtml(String(props.title ?? "分析结论"));
  if (!insights.length) return `<section class="openui-card"><strong>${title}</strong><p class="openui-empty">暂无分析结论</p></section>`;
  const items = insights.slice(0, 20).map((insight) => {
    const heading = escapeHtml(String(insight.title ?? insight.summary ?? "分析发现"));
    const summary = insight.summary ? `<p>${escapeHtml(String(insight.summary))}</p>` : "";
    const recommendation = insight.recommendation ? `<p>建议：${escapeHtml(String(insight.recommendation))}</p>` : "";
    return `<li><strong>${heading}</strong>${summary}${recommendation}</li>`;
  }).join("");
  return `<section class="openui-card"><strong>${title}</strong><ul class="openui-list">${items}</ul></section>`;
}

function renderAnalyticsDashboardHtml(props: JsonObject): string {
  const parts: string[] = [];
  if (Array.isArray(props.metrics) && props.metrics.length) parts.push(renderMetricCardsHtml({ title: "关键指标", metrics: props.metrics }));
  if (Array.isArray(props.tags) && props.tags.length) parts.push(renderTagListHtml({ title: "业务标签", tags: props.tags }));
  if (Array.isArray(props.charts)) {
    for (const chart of props.charts.filter(isJsonObject).slice(0, 4)) {
      const kind = String(chart.kind ?? "").toLowerCase();
      if (/pie|donut|doughnut/.test(kind)) parts.push(renderPieChartHtml(chart));
      else if (/line|trend|timeseries|time_series/.test(kind)) parts.push(renderLineChartHtml(chart));
      else parts.push(renderBarChartHtml(chart));
    }
  }
  if (Array.isArray(props.insights) && props.insights.length) parts.push(renderInsightsHtml({ title: "分析结论", insights: props.insights }));
  if (Array.isArray(props.rows) && props.rows.length) {
    const rows = props.rows.filter(isJsonObject);
    const columns = Array.isArray(props.columns) ? props.columns : inferHtmlColumns(rows);
    parts.push(renderDataTableHtml({ title: "数据明细", columns, rows, rowCount: rows.length }));
  }
  return `<section class="openui-card"><strong>${escapeHtml(String(props.title ?? "数据分析看板"))}</strong>${parts.join("")}</section>`;
}

function renderGroupedListHtml(props: JsonObject): string {
  const groups = Array.isArray(props.groups) ? props.groups.filter(isJsonObject) : [];
  const title = escapeHtml(String(props.title ?? "分组列表"));
  const items = groups.slice(0, 8).map((group) => {
    const label = escapeHtml(String(group.label ?? "未分组"));
    const count = escapeHtml(String(group.count ?? 0));
    const children = Array.isArray(group.items) ? group.items.slice(0, 6).map((item) => escapeHtml(String(item))).join("；") : "";
    return `<li><span class="openui-chip">${label}</span><span class="openui-chip">${count} 项</span><p>${children}</p></li>`;
  }).join("");
  return `<section class="openui-card"><strong>${title}</strong><ul class="openui-list">${items}</ul></section>`;
}

function renderSourcesHtml(props: JsonObject, fallbackTitle: string): string {
  const sources = readSourceItems(props);
  const title = escapeHtml(String(props.title ?? fallbackTitle));
  if (!sources.length) return `<section class="openui-card"><strong>${title}</strong><p class="openui-empty">暂无来源</p></section>`;
  const items = sources.slice(0, 8).map((source) => {
    const heading = [source.title, source.heading].filter(Boolean).map((item) => String(item)).join(" / ") || String(source.source ?? "来源");
    const meta = [source.source, typeof source.score === "number" ? `相关度 ${source.score.toFixed(2)}` : ""].filter(Boolean).join(" · ");
    const quote = source.quote ? `<p>${escapeHtml(String(source.quote).slice(0, 220))}</p>` : "";
    return `<li><strong>${escapeHtml(heading)}</strong>${meta ? `<span class="openui-meta">${escapeHtml(meta)}</span>` : ""}${quote}</li>`;
  }).join("");
  return `<section class="openui-card"><strong>${title}</strong><ul class="openui-list">${items}</ul></section>`;
}

function renderToolCatalogHtml(props: JsonObject): string {
  const tools = Array.isArray(props.tools) ? props.tools.filter(isJsonObject) : [];
  const title = escapeHtml(String(props.title ?? "可用工具"));
  if (!tools.length) return `<section class="openui-card"><strong>${title}</strong><p class="openui-empty">暂无可用工具</p></section>`;
  const items = tools.slice(0, 40).map((tool) => {
    const chips = [tool.category, tool.risk_level].filter(Boolean).map((item) => `<span class="openui-chip">${escapeHtml(String(item))}</span>`).join("");
    const desc = tool.description ? `<p>${escapeHtml(String(tool.description).slice(0, 180))}</p>` : "";
    return `<li><strong>${escapeHtml(String(tool.name ?? "-"))}</strong>${chips}${desc}</li>`;
  }).join("");
  return `<section class="openui-card"><strong>${title}</strong><ul class="openui-list">${items}</ul></section>`;
}

function renderTaskTrackingHtml(props: JsonObject): string {
  const tasks = Array.isArray(props.tasks) ? props.tasks.filter(isJsonObject) : [];
  const title = escapeHtml(String(props.title ?? "任务跟踪"));
  if (!tasks.length) return `<section class="openui-card"><strong>${title}</strong><p class="openui-empty">暂无任务</p></section>`;
  const items = tasks.slice(0, 20).map((task) => {
    const label = String(task.subject ?? task.title ?? task.id ?? "任务");
    const status = task.status ? `<span class="openui-chip">${escapeHtml(String(task.status))}</span>` : "";
    const next = task.next_action ? `<p>${escapeHtml(String(task.next_action).slice(0, 160))}</p>` : "";
    return `<li><strong>${escapeHtml(label)}</strong>${status}${next}</li>`;
  }).join("");
  return `<section class="openui-card"><strong>${title}</strong><ul class="openui-list">${items}</ul></section>`;
}

function renderPendingActionHtml(props: JsonObject): string {
  const actions = Array.isArray(props.actions) ? props.actions.filter(isJsonObject) : [];
  const title = escapeHtml(String(props.title ?? "待确认操作"));
  if (!actions.length) return `<section class="openui-card"><strong>${title}</strong><p class="openui-empty">暂无待确认操作</p></section>`;
  const items = actions.slice(0, 20).map((action) => {
    const label = String(action.description ?? action.title ?? action.tool_name ?? action.action_id ?? "待确认操作");
    const risk = action.risk_level ? `<span class="openui-chip">${escapeHtml(String(action.risk_level))}</span>` : "";
    const args = action.args_preview ? `<p>${escapeHtml(String(action.args_preview).slice(0, 180))}</p>` : "";
    return `<li><strong>${escapeHtml(label)}</strong>${risk}${args}</li>`;
  }).join("");
  return `<section class="openui-card"><strong>${title}</strong><ul class="openui-list">${items}</ul></section>`;
}

function renderGenericBusinessHtml(props: JsonObject, fallbackTitle: string): string {
  const title = escapeHtml(String(props.title ?? props.name ?? fallbackTitle));
  const entries = Object.entries(props)
    .filter(([key, value]) => key !== "title" && key !== "actions" && value !== undefined && value !== null && typeof value !== "object")
    .slice(0, 8)
    .map(([key, value]) => `<li><span class="openui-chip">${escapeHtml(key)}</span><span>${escapeHtml(String(value))}</span></li>`)
    .join("");
  if (entries) return `<section class="openui-card"><strong>${title}</strong><ul class="openui-list">${entries}</ul></section>`;
  return `<section class="openui-card"><strong>${title}</strong><pre>${escapeHtml(JSON.stringify(props, null, 2).slice(0, 1200))}</pre></section>`;
}

function readSourceItems(props: JsonObject): JsonObject[] {
  if (Array.isArray(props.sources)) return props.sources.filter(isJsonObject);
  if (Array.isArray(props.items)) return props.items.filter(isJsonObject);
  return [];
}

function formatHtmlCell(value: unknown, type: string): string {
  if (value === null || value === undefined || value === "") return "-";
  if (type === "currency") {
    const n = Number(value);
    return Number.isFinite(n) ? `${Math.round(n).toLocaleString("zh-CN")} 元` : "-";
  }
  if (type === "number" && typeof value === "number") return value.toLocaleString("zh-CN");
  if (type === "status") return `<span class="openui-chip">${escapeHtml(String(value))}</span>`;
  if (Array.isArray(value)) return escapeHtml(value.map((item) => String(item)).join("、")).slice(0, 120);
  if (typeof value === "object") return escapeHtml(JSON.stringify(value).slice(0, 120));
  return escapeHtml(String(value));
}

function inferHtmlColumns(rows: JsonObject[]): JsonObject[] {
  const keys: string[] = [];
  for (const row of rows.slice(0, 10)) {
    for (const key of Object.keys(row)) {
      if (!keys.includes(key) && !/^(id|uuid|raw|payload|metadata|debug)$/i.test(key)) keys.push(key);
      if (keys.length >= 8) break;
    }
  }
  return keys.map((key) => ({
    key,
    label: key.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase()),
    type: /(count|amount|total|rate|score|num|price|revenue)/i.test(key) ? "number" : /(status|risk|level|warning)/i.test(key) ? "status" : "text"
  }));
}

export class OpenUILangReactBasicRenderer implements OpenUILangRenderer<OpenUILangReactNode | null> {
  constructor(private readonly openui = new OpenUIRendererRegistry<OpenUILangReactNode>((component) => ({
    type: "OpenUIUnsupported",
    props: { component },
    children: [`不支持的组件：${component}`]
  }))) {}

  renderSurface(surface: OpenUILangSurfaceSnapshot): OpenUILangReactNode | null {
    const openui = this.openui.render(surface);
    if (openui) return openui;
    const byId = new Map(surface.components.map((component) => [component.id, component]));
    return this.renderComponent(surface, byId, surface.root);
  }

  registerOpenUI(component: string, renderer: Parameters<OpenUIRendererRegistry<OpenUILangReactNode>["register"]>[1]): void {
    this.openui.register(component, renderer);
  }

  private renderComponent(surface: OpenUILangSurfaceSnapshot, byId: Map<string, OpenUILangCompatComponent>, id: string): OpenUILangReactNode | null {
    const item = byId.get(id);
    if (!item) return null;
    const [type, rawProps] = Object.entries(item.component ?? {})[0] ?? [];
    const props = isJsonObject(rawProps) ? rawProps : {};
    if (!type) return null;
    if (type === "Card" || type === "Row" || type === "Column" || type === "List" || type === "Tabs") {
      return {
        type,
        props: { id },
        children: this.renderChildren(surface, byId, props.children)
      };
    }
    if (type === "Text") {
      const text = resolveOpenUILangText(props.text, surface.data);
      return { type, props: { id, text }, children: [text] };
    }
    if (type === "Button") {
      return {
        type,
        props: {
          id,
          text: resolveOpenUILangText(props.text, surface.data),
          action: normalizeJson(props.action)
        }
      };
    }
    if (type === "Image") return { type, props: { id, src: String(props.src ?? ""), alt: String(props.alt ?? "") } };
    if (type === "Icon") return { type, props: { id, name: String(props.name ?? "") } };
    return {
      type: "OpenUIUnsupported",
      props: { id, component: type },
      children: [`不支持的组件：${type}`]
    };
  }

  private renderChildren(surface: OpenUILangSurfaceSnapshot, byId: Map<string, OpenUILangCompatComponent>, children: unknown): Array<OpenUILangReactNode | string> {
    if (!Array.isArray(children)) return [];
    return children
      .map((child) => this.renderComponent(surface, byId, String(child)))
      .filter((child): child is OpenUILangReactNode => Boolean(child));
  }
}

export class OpenUILangFormHtmlRenderer {
  render(contract: OpenUILangFormContract): string {
    const fields = contract.fields.map((field) => this.renderField(field, contract.initialValues[field.name])).join("");
    const action = escapeHtml(contract.submitAction.name);
    const label = escapeHtml(contract.submitAction.label ?? "提交");
    return `<form class="openui-form" data-action="${action}">${fields}<button type="submit" class="openui-button">${label}</button></form>`;
  }

  private renderField(field: OpenUILangFormField, value: unknown): string {
    const name = escapeHtml(field.name);
    const label = escapeHtml(field.label);
    const required = field.required ? " required" : "";
    const current = escapeHtml(String(value ?? ""));
    if (field.component === "Hidden") return `<input type="hidden" name="${name}" value="${current}">`;
    const labelNode = `<label class="openui-form-label" for="${name}">${label}</label>`;
    if (field.component === "TextArea") return `<div class="openui-form-field">${labelNode}<textarea id="${name}" name="${name}"${required}>${current}</textarea></div>`;
    if (field.component === "Select") {
      const options = (field.options ?? []).map((option) => {
        const optionValue = escapeHtml(option.value);
        const selected = option.value === value ? " selected" : "";
        return `<option value="${optionValue}"${selected}>${escapeHtml(option.label)}</option>`;
      }).join("");
      return `<div class="openui-form-field">${labelNode}<select id="${name}" name="${name}"${required}>${options}</select></div>`;
    }
    return `<div class="openui-form-field">${labelNode}<input id="${name}" name="${name}" type="text" value="${current}"${required}></div>`;
  }
}

export class OpenUILangFormilyRenderer implements OpenUILangRenderer<OpenUILangFormilyRenderPlan | null> {
  renderSurface(surface: OpenUILangSurfaceSnapshot): OpenUILangFormilyRenderPlan | null {
    const form = readSurfaceFormContract(surface);
    return form ? this.render(form) : null;
  }

  render(contract: OpenUILangFormContract): OpenUILangFormilyRenderPlan {
    const properties: Record<string, OpenUILangFormilyFieldSchema> = {};
    for (const field of contract.fields) properties[field.name] = this.renderField(field);
    return {
      schema: { type: "object", properties },
      initialValues: contract.initialValues,
      submitAction: contract.submitAction
    };
  }

  private renderField(field: OpenUILangFormField): OpenUILangFormilyFieldSchema {
    const schema: OpenUILangFormilyFieldSchema = {
      type: "string",
      title: field.label,
      required: Boolean(field.required),
      "x-component": formilyComponentName(field.component)
    };
    if (field.component === "Hidden") schema["x-component-props"] = { style: { display: "none" } };
    if (field.component === "Select") schema.enum = (field.options ?? []).map((option) => ({ label: option.label, value: option.value }));
    return schema;
  }
}

export function readSurfaceFormContract(surface: OpenUILangSurfaceSnapshot): OpenUILangFormContract | null {
  const openui = readObject(surface.data.openui);
  const props = readObject(openui?.props);
  const form = readObject(props?.form);
  if (!form) return null;
  const fields = Array.isArray(form.fields) ? form.fields.filter(isFormField) : [];
  const submitAction = readObject(form.submitAction);
  if (!fields.length || typeof submitAction?.name !== "string") return null;
  return {
    fields,
    initialValues: readObject(form.initialValues) ?? {},
    submitAction: {
      name: submitAction.name,
      label: typeof submitAction.label === "string" ? submitAction.label : undefined,
      context: readObject(submitAction.context) ?? undefined
    }
  };
}

export function resolveOpenUILangText(value: unknown, data: JsonObject): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (isJsonObject(value)) {
    if (typeof value.literalString === "string") return value.literalString;
    if (typeof value.path === "string") {
      const resolved = readOpenUILangDataPath(data, value.path);
      return resolved === null || resolved === undefined ? "" : String(resolved);
    }
  }
  return String(value);
}

export function readOpenUILangDataPath(data: JsonObject, path: string): unknown {
  const segments = parseOpenUILangJsonPointer(path);
  let cursor: unknown = data;
  for (const segment of segments) {
    if (!isJsonObject(cursor)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

function readOpenUI(data: JsonObject): { component: string; props: JsonObject; actions: JsonObject[] } | null {
  const raw = data.openui;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as JsonObject;
  if (record.protocol !== "openui-bridge/0.1" || typeof record.component !== "string") return null;
  return {
    component: record.component,
    props: isJsonObject(record.props) ? record.props : {},
    actions: Array.isArray(record.actions) ? record.actions.filter(isJsonObject) : []
  };
}

function formilyComponentName(component: OpenUILangFormField["component"]): string {
  if (component === "TextArea") return "Input.TextArea";
  if (component === "Select") return "Select";
  if (component === "DateTime") return "DatePicker";
  if (component === "Hidden") return "Input";
  return "Input";
}

function isFormField(value: unknown): value is OpenUILangFormField {
  const record = readObject(value);
  if (!record) return false;
  const component = record.component;
  return typeof record.name === "string"
    && typeof record.label === "string"
    && (component === "Input" || component === "TextArea" || component === "Select" || component === "DateTime" || component === "Hidden");
}

function readObject(value: unknown): JsonObject | null {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function wrap(tag: string, className: string, inner: string): string {
  return `<${tag} class="${className}">${inner}</${tag}>`;
}

function readActionName(value: unknown): string {
  if (!isJsonObject(value) || !isJsonObject(value.event)) return "";
  return typeof value.event.name === "string" ? value.event.name : "";
}

function normalizeJson(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value as JsonValue;
  if (Array.isArray(value)) return value.map((item) => normalizeJson(item));
  if (isJsonObject(value)) {
    const out: JsonObject = {};
    for (const [key, item] of Object.entries(value)) out[key] = normalizeJson(item);
    return out;
  }
  return String(value);
}

function formatNumberForChart(value: number): string {
  if (!Number.isFinite(value)) return "-";
  return Math.abs(value) >= 1000 ? Math.round(value).toLocaleString("zh-CN") : String(value);
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
