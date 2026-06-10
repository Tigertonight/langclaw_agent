/**
 * OpenUI Lang Workbench — Phase 4 新增
 *
 * 企业经营工作台的 OpenUI Lang Surface 构建器。
 * 将复杂业务数据渲染为结构化 OpenUI Lang compatibility envelope，而不只靠文本承载。
 *
 * 工作台组件：
 * - ToolCatalogSurface     当前可用能力列表（按业务域分组）
 * - RiskListSurface        风险条目列表（库存/工单/索赔/线索/财务）
 * - MetricCardsSurface     关键经营指标卡（KPI/同比/环比）
 * - EvidenceSurface        工具执行证据（query filters / source refs / tool result）
 * - PendingActionSurface   需要确认的执行动作（ask 级别工具）
 * - TaskTrackingSurface    活动任务追踪（active tasks / cron reports）
 *
 * 设计原则：
 * 1. 每个 Surface builder 接收业务数据，返回OpenUI Lang compatibility envelope
 * 2. surfaceId 唯一标识一个渲染面板，支持多面板并存
 * 3. 所有 builder 函数纯函数，不依赖外部状态
 * 4. 与 legacy compatibility envelope 协议兼容（createSurface + updateComponents + updateDataModel）
 */

import type { JsonObject, JsonValue } from "../types/agent-contracts.js";
import type { OpenUILangCompatComponent, OpenUILangWireEnvelope } from "./types.js";
import { text, button, card, list, row } from "./builders.js";
import type { CatalogEntry, ToolCatalogResult } from "../tools/tool-catalog.js";
import type { PlanModeDecision } from "../tools/plan-mode.js";
import { getCatalogDomains, getFieldLabelFromRegistry } from "../domains/runtime-registry.js";

// ── ToolCatalogSurface ────────────────────────────────────────────────────

export interface ToolCatalogSurfaceData {
  catalog: ToolCatalogResult;
  plan_mode: boolean;
  user_name?: string;
}

/**
 * buildToolCatalogSurface() — 按业务域渲染可用工具目录。
 */
export function buildToolCatalogSurface(surfaceId: string, data: ToolCatalogSurfaceData): OpenUILangWireEnvelope {
  const { catalog, plan_mode, user_name } = data;
  const components: OpenUILangCompatComponent[] = [];

  // Header
  components.push(text("catalog_header", `能力目录 — ${catalog.total} 个工具${plan_mode ? "（Plan Mode）" : ""}`));
  if (user_name) {
    components.push(text("catalog_user", `当前用户：${user_name} | 可执行：${catalog.plan_mode_allowed.length} | 需确认：${catalog.ask_tools.length} | 已拒绝：${catalog.deny_tools.length}`));
  }

  // 按业务域分组
  const domainMap = new Map<string, CatalogEntry[]>();
  for (const entry of catalog.entries as unknown as CatalogEntry[]) {
    const list = domainMap.get(entry.domain) ?? [];
    list.push(entry);
    domainMap.set(entry.domain, list);
  }

  // 从 registry 动态构建 domain 标签，核心域保留 fallback
  const CORE_DOMAIN_LABELS: Record<string, string> = {
    "knowledge":        "知识库",
    "sandbox":          "安全沙箱",
    "task":             "任务与调度",
    "memory":           "记忆与会话",
    "system":           "系统维护",
    "other":            "其他"
  };
  const DOMAIN_LABELS: Record<string, string> = { ...CORE_DOMAIN_LABELS };
  for (const cd of getCatalogDomains()) {
    DOMAIN_LABELS[cd.id] = cd.label;
  }

  const PERMISSION_ICONS: Record<string, string> = {
    allow: "✓",
    ask:   "?",
    deny:  "✗"
  };

  for (const [domain, entries] of domainMap) {
    const label = DOMAIN_LABELS[domain] ?? domain;
    const domainId = `domain_${domain.replace(/\./g, "_")}`;
    components.push(text(`${domainId}_header`, `【${label}】（${entries.length} 个工具）`));

    const entryIds: string[] = [];
    for (const entry of entries) {
      const icon = PERMISSION_ICONS[entry.permission_level] ?? "·";
      const riskBadge = entry.risk_level !== "read" ? ` [${entry.risk_level}]` : "";
      const itemId = `${domainId}_${entry.name.replace(/\./g, "_")}`;
      components.push(text(itemId, `  ${icon} ${entry.name}${riskBadge} — ${entry.description.slice(0, 80)}`));
      entryIds.push(itemId);
    }
    components.push(list(domainId, entryIds));
  }

  return buildEnvelope(surfaceId, "ToolCatalogSurface", components, {
    total: catalog.total,
    plan_mode,
    domains: catalog.domains.length
  });
}

// ── RiskListSurface ───────────────────────────────────────────────────────

export interface RiskItem extends JsonObject {
  id: string;
  type: "inventory" | "work_order" | "claim" | "lead" | "finance" | string;
  level: "high" | "medium" | "low";
  title: string;
  description: string;
  action?: string;
}

export function buildRiskListSurface(surfaceId: string, risks: RiskItem[]): OpenUILangWireEnvelope {
  const components: OpenUILangCompatComponent[] = [];
  const LEVEL_ICONS: Record<string, string> = { high: "🔴", medium: "🟡", low: "🟢" };

  components.push(text("risk_header", `风险列表 — ${risks.length} 项`));

  const highRisks = risks.filter((r) => r.level === "high");
  const others = risks.filter((r) => r.level !== "high");

  const allRisks = [...highRisks, ...others];
  const itemIds: string[] = [];

  for (const [i, risk] of allRisks.entries()) {
    const icon = LEVEL_ICONS[risk.level] ?? "·";
    const typeLabel = getFieldLabelFromRegistry(risk.type) ?? risk.type;
    const itemId = `risk_item_${i}`;
    components.push(text(itemId, `${icon} [${typeLabel}] ${risk.title} — ${risk.description.slice(0, 120)}`));
    itemIds.push(itemId);

    if (risk.action) {
      const actionId = `risk_action_${i}`;
      components.push(button(actionId, `处理：${risk.action}`, "risk.action_clicked", { risk_id: risk.id, action: risk.action }));
      itemIds.push(actionId);
    }
  }

  components.push(list("risk_list", itemIds));
  return buildEnvelope(surfaceId, "RiskListSurface", components, { count: risks.length });
}

// ── MetricCardsSurface ────────────────────────────────────────────────────

export interface MetricCard extends JsonObject {
  key: string;
  label: string;
  value: JsonValue;
  unit?: string;
  change?: number;
  change_type?: "yoy" | "mom" | string;
  trend?: "up" | "down" | "flat";
}

export function buildMetricCardsSurface(surfaceId: string, metrics: MetricCard[], title?: string): OpenUILangWireEnvelope {
  const components: OpenUILangCompatComponent[] = [];
  const TREND_ICONS: Record<string, string> = { up: "↑", down: "↓", flat: "→" };

  components.push(text("metrics_header", title ?? `经营指标（${metrics.length} 项）`));

  const cardIds: string[] = [];
  for (const [i, metric] of metrics.entries()) {
    const trend = metric.trend ? ` ${TREND_ICONS[metric.trend] ?? ""}` : "";
    const change = typeof metric.change === "number"
      ? ` ${metric.change > 0 ? "+" : ""}${metric.change.toFixed(1)}%（${metric.change_type === "yoy" ? "同比" : metric.change_type === "mom" ? "环比" : metric.change_type ?? "变化"}）`
      : "";
    const unit = metric.unit ? ` ${metric.unit}` : "";
    const valueStr = String(metric.value ?? "-");

    const metricId = `metric_${i}_${metric.key}`;
    const valueId = `${metricId}_value`;
    const labelId = `${metricId}_label`;

    components.push(text(labelId, metric.label));
    components.push(text(valueId, `${valueStr}${unit}${trend}${change}`));
    components.push(card(metricId, [labelId, valueId]));
    cardIds.push(metricId);
  }

  components.push(row("metrics_row", cardIds));
  return buildEnvelope(surfaceId, "MetricCardsSurface", components, { count: metrics.length });
}

// ── EvidenceSurface ───────────────────────────────────────────────────────

export interface EvidenceData extends JsonObject {
  tool_name: string;
  query_filters?: JsonObject[];
  source_refs?: string[];
  result_preview?: string;
  rows_count?: number;
}

export function buildEvidenceSurface(surfaceId: string, evidence: EvidenceData): OpenUILangWireEnvelope {
  const components: OpenUILangCompatComponent[] = [];

  components.push(text("evidence_header", `数据来源：${evidence.tool_name}`));

  if (Array.isArray(evidence.query_filters) && evidence.query_filters.length > 0) {
    const filterStr = evidence.query_filters
      .map((f) => `${f["field"]} ${f["op"] ?? "="} ${JSON.stringify(f["value"])}`)
      .join(", ");
    components.push(text("evidence_filters", `查询条件：${filterStr}`));
  }

  if (Array.isArray(evidence.source_refs) && evidence.source_refs.length > 0) {
    components.push(text("evidence_refs", `来源引用：${evidence.source_refs.slice(0, 5).join(", ")}`));
  }

  if (evidence.result_preview) {
    components.push(text("evidence_preview", `结果摘要：${String(evidence.result_preview).slice(0, 300)}`));
  }

  if (typeof evidence.rows_count === "number") {
    components.push(text("evidence_count", `共 ${evidence.rows_count} 行数据`));
  }

  return buildEnvelope(surfaceId, "EvidenceSurface", components, { tool: evidence.tool_name });
}

// ── PendingActionSurface ──────────────────────────────────────────────────

export interface PendingActionData extends JsonObject {
  action_id: string;
  tool_name: string;
  description: string;
  args_preview?: string;
  risk_level?: string;
  decision?: Partial<PlanModeDecision>;
}

export function buildPendingActionSurface(surfaceId: string, actions: PendingActionData[]): OpenUILangWireEnvelope {
  const components: OpenUILangCompatComponent[] = [];

  components.push(text("pending_header", `待确认操作 — ${actions.length} 项`));

  const cardIds: string[] = [];
  for (const [i, action] of actions.entries()) {
    const actionCardId = `pending_action_${i}`;
    const descId = `${actionCardId}_desc`;
    const confirmId = `${actionCardId}_confirm`;
    const cancelId = `${actionCardId}_cancel`;

    components.push(text(descId, `${action.tool_name}: ${action.description}${action.args_preview ? ` | ${action.args_preview.slice(0, 100)}` : ""}`));
    components.push(button(confirmId, "确认执行", "pending_action.confirm", { action_id: action.action_id }));
    components.push(button(cancelId, "取消", "pending_action.cancel", { action_id: action.action_id }));
    components.push(card(actionCardId, [descId, confirmId, cancelId]));
    cardIds.push(actionCardId);
  }

  components.push(list("pending_list", cardIds));
  return buildEnvelope(surfaceId, "PendingActionSurface", components, { count: actions.length });
}

// ── TaskTrackingSurface ───────────────────────────────────────────────────

export interface TaskTrackingEntry extends JsonObject {
  id: string;
  subject: string;
  status: string;
  next_action?: string;
  updated_at?: string;
  type?: "task" | "cron" | "reminder";
}

export function buildTaskTrackingSurface(surfaceId: string, tasks: TaskTrackingEntry[], title?: string): OpenUILangWireEnvelope {
  const components: OpenUILangCompatComponent[] = [];
  const TYPE_LABELS: Record<string, string> = { task: "任务", cron: "定时", reminder: "提醒" };
  const STATUS_ICONS: Record<string, string> = { active: "▶", waiting_user: "⏳", completed: "✓", archived: "◼" };

  components.push(text("task_header", title ?? `任务追踪（${tasks.length} 项）`));

  const itemIds: string[] = [];
  for (const [i, task] of tasks.entries()) {
    const icon = STATUS_ICONS[task.status] ?? "·";
    const typeLabel = TYPE_LABELS[task.type ?? "task"] ?? task.type ?? "任务";
    const nextAction = task.next_action ? ` → ${String(task.next_action).slice(0, 60)}` : "";
    const itemId = `task_item_${i}`;
    components.push(text(itemId, `${icon} [${typeLabel}] ${task.subject}${nextAction}`));
    itemIds.push(itemId);
  }

  components.push(list("task_list", itemIds));
  return buildEnvelope(surfaceId, "TaskTrackingSurface", components, { count: tasks.length });
}

// ── 内部工具 ──────────────────────────────────────────────────────────────

function buildEnvelope(
  surfaceId: string,
  surfaceType: string,
  components: OpenUILangCompatComponent[],
  dataModel: JsonObject
): OpenUILangWireEnvelope {
  return {
    version: "v0.9",
    createSurface: {
      surfaceId,
      root: "root",
      sendDataModel: true,
      theme: {}
    },
    updateComponents: {
      surfaceId,
      components
    },
    updateDataModel: {
      surfaceId,
      path: "workbench",
      value: {
        surface_type: surfaceType,
        generated_at: new Date().toISOString(),
        ...dataModel
      }
    }
  };
}
