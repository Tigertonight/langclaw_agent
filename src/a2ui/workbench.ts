/**
 * Legacy A2UI Workbench facade.
 *
 * OpenUI Lang owns the Workbench surface builders. This module keeps the old
 * import path available while callers migrate to ../openui-lang/workbench.js.
 */

export {
  buildEvidenceSurface,
  buildMetricCardsSurface,
  buildPendingActionSurface,
  buildRiskListSurface,
  buildTaskTrackingSurface,
  buildToolCatalogSurface
} from "../openui-lang/workbench.js";

export type {
  EvidenceData,
  MetricCard,
  PendingActionData,
  RiskItem,
  TaskTrackingEntry,
  ToolCatalogSurfaceData
} from "../openui-lang/workbench.js";
