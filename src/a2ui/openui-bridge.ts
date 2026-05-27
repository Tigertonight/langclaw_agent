import { OPENUI_BRIDGE_VERSION, type OpenUIView } from "./types.js";
import type { JsonObject } from "../types/agent-contracts.js";

export function openUIView(component: string, props: JsonObject = {}, actions: JsonObject[] = []): OpenUIView {
  return {
    protocol: OPENUI_BRIDGE_VERSION,
    component,
    props,
    actions
  };
}

export function businessSurface(kind: string, title: string, props: JsonObject, actions: JsonObject[] = []): JsonObject {
  return {
    business_surface: {
      kind,
      version: "1.0",
      title
    },
    openui: openUIView(componentForKind(kind), props, actions)
  };
}

function componentForKind(kind: string): string {
  const map: Record<string, string> = {
    approval_flow: "ApprovalFlow",
    task_resume: "TaskResumeCard",
    vehicle_progress: "DealerVehicleProgress",
    expense_estimate: "ExpenseEstimate",
    leave_request_form: "LeaveRequestForm",
    source_citation: "CitationDisclosure",
    runtime_summary: "RuntimeSummary"
  };
  return map[kind] ?? "GenericBusinessCard";
}
