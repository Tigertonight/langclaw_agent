import { z } from "zod";
import type { JsonObject } from "../types/agent-contracts.js";
import type { OpenUILangCompatComponent } from "./types.js";

const TextValueSchema = z.union([
  z.string(),
  z.object({
    literalString: z.string().optional(),
    path: z.string().min(1).optional()
  }).strict()
]);

const ActionSchema = z.object({
  event: z.object({
    name: z.string().min(1),
    context: z.record(z.string(), z.unknown()).optional()
  }).strict()
}).strict();

const ChildrenSchema = z.array(z.string().min(1)).max(200);

const BasicComponentContracts = {
  Text: z.object({ text: TextValueSchema }).strict(),
  Image: z.object({ src: z.string().min(1), alt: z.string().optional() }).strict(),
  Icon: z.object({ name: z.string().min(1).optional(), label: z.string().optional() }).strict(),
  Video: z.object({ src: z.string().min(1) }).strict(),
  AudioPlayer: z.object({ src: z.string().min(1) }).strict(),
  Row: z.object({ children: ChildrenSchema }).strict(),
  Column: z.object({ children: ChildrenSchema }).strict(),
  List: z.object({ children: ChildrenSchema }).strict(),
  Card: z.object({ children: ChildrenSchema }).strict(),
  Tabs: z.object({ children: ChildrenSchema }).strict(),
  Button: z.object({ text: TextValueSchema, action: ActionSchema }).strict()
} as const;

const DataTableColumnSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["text", "number", "date", "status", "currency"]).optional()
}).strict();

const RiskItemSchema = z.object({
  id: z.string().min(1).optional(),
  level: z.string().min(1).optional(),
  message: z.string().min(1).optional(),
  tool: z.string().optional(),
  mitigated: z.boolean().optional()
}).passthrough();

const MetricSchema = z.object({
  key: z.string().optional(),
  label: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean()]),
  unit: z.string().optional(),
  trend: z.string().optional(),
  delta: z.union([z.string(), z.number()]).optional()
}).passthrough();

const GroupSchema = z.object({
  label: z.string().min(1),
  count: z.number().int().nonnegative().optional(),
  items: z.array(z.string()).optional()
}).passthrough();

const BarChartDatumSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));
const ChartDatumSchema = BarChartDatumSchema;

const InsightSchema = z.object({
  title: z.string().optional(),
  summary: z.string().optional(),
  severity: z.string().optional(),
  recommendation: z.string().optional()
}).passthrough();

const SourceSchema = z.object({
  title: z.string().optional(),
  source: z.string().optional(),
  heading: z.string().optional(),
  quote: z.string().optional(),
  score: z.number().optional()
}).passthrough();

const OpenUIComponentContracts = {
  DataTableSurface: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    columns: z.array(DataTableColumnSchema).min(1).max(20),
    rows: z.array(z.record(z.string(), z.unknown())).max(200),
    rowCount: z.number().int().nonnegative().optional()
  }).strict(),
  GroupedListSurface: z.object({
    title: z.string().optional(),
    groupKey: z.string().optional(),
    groups: z.array(GroupSchema).min(1).max(50)
  }).strict(),
  RiskListSurface: z.object({
    title: z.string().optional(),
    risks: z.array(RiskItemSchema).min(1).max(100)
  }).strict(),
  MetricCardsSurface: z.object({
    title: z.string().optional(),
    metrics: z.array(MetricSchema).min(1).max(24)
  }).strict(),
  BarChartSurface: z.object({
    title: z.string().optional(),
    xKey: z.string().min(1),
    yKey: z.string().min(1),
    series: z.array(BarChartDatumSchema).min(1).max(100)
  }).strict(),
  PieChartSurface: z.object({
    title: z.string().optional(),
    categoryKey: z.string().min(1),
    valueKey: z.string().min(1),
    series: z.array(ChartDatumSchema).min(1).max(100)
  }).strict(),
  LineChartSurface: z.object({
    title: z.string().optional(),
    xKey: z.string().min(1),
    yKey: z.string().min(1),
    series: z.array(ChartDatumSchema).min(1).max(200)
  }).strict(),
  InsightSummarySurface: z.object({
    title: z.string().optional(),
    insights: z.array(InsightSchema).min(1).max(50)
  }).strict(),
  AnalyticsDashboardSurface: z.object({
    title: z.string().optional(),
    metrics: z.array(MetricSchema).max(24).optional(),
    charts: z.array(z.object({
      kind: z.string().min(1),
      title: z.string().optional(),
      xKey: z.string().optional(),
      yKey: z.string().optional(),
      categoryKey: z.string().optional(),
      valueKey: z.string().optional(),
      series: z.array(ChartDatumSchema).min(1).max(200)
    }).passthrough()).max(12).optional(),
    columns: z.array(DataTableColumnSchema).max(20).optional(),
    rows: z.array(z.record(z.string(), z.unknown())).max(200).optional(),
    insights: z.array(InsightSchema).max(50).optional()
  }).strict(),
  CitationDisclosure: z.object({
    sources: z.array(SourceSchema).optional()
  }).passthrough(),
  EvidenceSurface: z.object({
    title: z.string().optional(),
    items: z.array(SourceSchema).optional(),
    sources: z.array(SourceSchema).optional()
  }).passthrough(),
  ToolCatalogSurface: z.object({
    title: z.string().optional(),
    tools: z.array(z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      risk_level: z.string().optional(),
      category: z.string().optional()
    }).passthrough()).max(200)
  }).strict(),
  TaskTrackingSurface: z.object({
    title: z.string().optional(),
    tasks: z.array(z.record(z.string(), z.unknown())).max(100)
  }).passthrough(),
  PendingActionSurface: z.object({
    title: z.string().optional(),
    actions: z.array(z.record(z.string(), z.unknown())).max(50)
  }).passthrough(),
  RuntimeSummary: z.record(z.string(), z.unknown()),
  ApprovalFlow: z.record(z.string(), z.unknown()),
  TaskResumeCard: z.record(z.string(), z.unknown()),
  ExpenseEstimate: z.record(z.string(), z.unknown())
} as const;

export const BASIC_OPENUI_LANG_COMPONENT_NAMES = Object.keys(BasicComponentContracts);
export const CORE_OPENUI_COMPONENT_NAMES = Object.keys(OpenUIComponentContracts);

export interface OpenUIComponentContractDoc extends JsonObject {
  name: string;
  signature: string;
  description: string;
}

export const BASIC_OPENUI_COMPONENT_CONTRACT_DOCS: OpenUIComponentContractDoc[] = [
  { name: "Text", signature: "Text(text: string | { literalString?: string; path?: string })", description: "Render plain text or a JSON Pointer bound value." },
  { name: "Image", signature: "Image(src: string, alt?: string)", description: "Render a static image." },
  { name: "Icon", signature: "Icon(name?: string, label?: string)", description: "Render a compact symbolic status/icon label." },
  { name: "Video", signature: "Video(src: string)", description: "Render a video with controls." },
  { name: "AudioPlayer", signature: "AudioPlayer(src: string)", description: "Render an audio player with controls." },
  { name: "Row", signature: "Row(children: string[])", description: "Horizontal/wrapping layout container for child component ids." },
  { name: "Column", signature: "Column(children: string[])", description: "Vertical layout container for child component ids." },
  { name: "List", signature: "List(children: string[])", description: "Repeated item container for child component ids." },
  { name: "Card", signature: "Card(children: string[])", description: "Bounded content block for related UI." },
  { name: "Tabs", signature: "Tabs(children: string[])", description: "Tabbed container for child component ids when the renderer supports tabs." },
  { name: "Button", signature: "Button(text: string | TextValue, action: { event: { name: string; context?: object } })", description: "User action trigger. Action names must be registered server capabilities." }
];

export const OPENUI_BUSINESS_COMPONENT_CONTRACT_DOCS: OpenUIComponentContractDoc[] = [
  { name: "DataTableSurface", signature: "DataTableSurface(title?, description?, columns: {key,label,type?}[], rows: object[], rowCount?)", description: "Structured row/column data table with text, number, date, status, or currency cells." },
  { name: "GroupedListSurface", signature: "GroupedListSurface(title?, groupKey?, groups: {label,count?,items?}[])", description: "Grouped summary list for segmented rows." },
  { name: "RiskListSurface", signature: "RiskListSurface(title?, risks: {id?,level?,message?,tool?,mitigated?}[])", description: "Prioritized risk/alert list." },
  { name: "MetricCardsSurface", signature: "MetricCardsSurface(title?, metrics: {key?,label,value,unit?,trend?,delta?}[])", description: "Compact KPI/metric cards." },
  { name: "BarChartSurface", signature: "BarChartSurface(title?, xKey: string, yKey: string, series: object[])", description: "Minimal grouped bar chart for numeric series." },
  { name: "PieChartSurface", signature: "PieChartSurface(title?, categoryKey: string, valueKey: string, series: object[])", description: "Distribution or composition pie chart." },
  { name: "LineChartSurface", signature: "LineChartSurface(title?, xKey: string, yKey: string, series: object[])", description: "Time series or trend line chart." },
  { name: "InsightSummarySurface", signature: "InsightSummarySurface(title?, insights: {title?,summary?,severity?,recommendation?}[])", description: "Analytical findings, explanations, and recommendations." },
  { name: "AnalyticsDashboardSurface", signature: "AnalyticsDashboardSurface(title?, metrics?, charts?, rows?, insights?)", description: "BI-style mixed analytics dashboard combining cards, charts, insights, and details." },
  { name: "CitationDisclosure", signature: "CitationDisclosure(sources?: {title?,source?,heading?,quote?,score?}[])", description: "Collapsible source citation list." },
  { name: "EvidenceSurface", signature: "EvidenceSurface(title?, items? | sources?: {title?,source?,heading?,quote?,score?}[])", description: "Evidence and source snippets from tool execution." },
  { name: "ToolCatalogSurface", signature: "ToolCatalogSurface(title?, tools: {name,description?,risk_level?,category?}[])", description: "Available tool/capability catalog." },
  { name: "TaskTrackingSurface", signature: "TaskTrackingSurface(title?, tasks: object[])", description: "Task, reminder, or scheduled work tracking list." },
  { name: "PendingActionSurface", signature: "PendingActionSurface(title?, actions: object[])", description: "Actions that require user confirmation or rejection." },
  { name: "RuntimeSummary", signature: "RuntimeSummary(props: object)", description: "Debug/runtime summary panel." },
  { name: "ApprovalFlow", signature: "ApprovalFlow(props: object)", description: "Approval or confirmation flow." },
  { name: "TaskResumeCard", signature: "TaskResumeCard(props: object)", description: "Resume/ignore a recalled task." },
  { name: "ExpenseEstimate", signature: "ExpenseEstimate(props: object)", description: "Expense reimbursement estimate." }
];

export function formatOpenUIComponentContractDocs(docs: readonly OpenUIComponentContractDoc[]): string[] {
  return docs.map((doc) => `- ${doc.signature} — ${doc.description}`);
}

export interface OpenUIContractIssue {
  path: string;
  message: string;
}

export interface OpenUISurfaceContractInput {
  surfaceId: string;
  root: string;
  data: JsonObject;
  components: OpenUILangCompatComponent[];
  allowedOpenUIComponents?: readonly string[];
}

export function validateOpenUISurfaceContract(input: OpenUISurfaceContractInput): OpenUIContractIssue[] {
  const issues: OpenUIContractIssue[] = [];
  const ids = new Set<string>();
  const childRefs = new Set<string>();

  for (const [index, component] of input.components.entries()) {
    const path = `components[${index}]`;
    if (!component || typeof component !== "object" || Array.isArray(component)) {
      issues.push({ path, message: "component must be an object" });
      continue;
    }
    if (typeof component.id !== "string" || component.id.length === 0) {
      issues.push({ path: `${path}.id`, message: "id is required" });
      continue;
    }
    if (ids.has(component.id)) {
      issues.push({ path: `${path}.id`, message: `duplicate component id "${component.id}"` });
    }
    ids.add(component.id);

    const entry = readSingleComponentEntry(component);
    if (!entry) {
      issues.push({ path: `${path}.component`, message: "component must contain exactly one registered component" });
      continue;
    }
    const [name, props] = entry;
    const contract = BasicComponentContracts[name as keyof typeof BasicComponentContracts];
    if (!contract) {
      issues.push({ path: `${path}.component`, message: `unsupported basic component "${name}"` });
      continue;
    }
    const parsed = contract.safeParse(props);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.push({ path: `${path}.component.${name}.${issue.path.join(".")}`, message: issue.message });
      }
      continue;
    }
    const children = readChildren(parsed.data);
    for (const child of children) childRefs.add(child);
  }

  if (!input.root) {
    issues.push({ path: "root", message: "root is required" });
  } else if (!ids.has(input.root)) {
    issues.push({ path: "root", message: `root component "${input.root}" is not defined` });
  }
  for (const child of childRefs) {
    if (!ids.has(child)) issues.push({ path: "components.children", message: `child component "${child}" is not defined` });
  }

  issues.push(...validateOpenUIViewContract(input.data, input.allowedOpenUIComponents));
  return issues;
}

export function validateOpenUIViewContract(data: JsonObject, allowedOpenUIComponents: readonly string[] = CORE_OPENUI_COMPONENT_NAMES): OpenUIContractIssue[] {
  const view = readObject(data.openui);
  if (!view) return [];
  const issues: OpenUIContractIssue[] = [];
  if (view.protocol !== "openui-bridge/0.1") {
    issues.push({ path: "data.openui.protocol", message: "openui view protocol must be openui-bridge/0.1" });
  }
  const component = typeof view.component === "string" ? view.component : "";
  if (!component) {
    issues.push({ path: "data.openui.component", message: "openui view component is required" });
    return issues;
  }
  if (!allowedOpenUIComponents.includes(component)) {
    issues.push({ path: "data.openui.component", message: `unsupported OpenUI component "${component}"` });
    return issues;
  }
  const contract = OpenUIComponentContracts[component as keyof typeof OpenUIComponentContracts];
  if (!contract) return issues;
  const props = readObject(view.props) ?? {};
  const parsed = contract.safeParse(props);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({ path: `data.openui.props.${issue.path.join(".")}`, message: issue.message });
    }
  }
  return issues;
}

export function summarizeContractIssues(issues: readonly OpenUIContractIssue[]): string {
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
}

function readSingleComponentEntry(component: OpenUILangCompatComponent): [string, unknown] | null {
  const body = component.component;
  if (!readObject(body)) return null;
  const entries = Object.entries(body);
  if (entries.length !== 1) return null;
  return entries[0];
}

function readChildren(props: unknown): string[] {
  const record = readObject(props);
  return Array.isArray(record?.children) ? record.children.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function readObject(value: unknown): JsonObject | null {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}
