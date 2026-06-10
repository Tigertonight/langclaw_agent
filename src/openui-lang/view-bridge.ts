import type { JsonObject } from "../types/agent-contracts.js";
import { OPENUI_LANG_VIEW_PROTOCOL, type OpenUILangView } from "./types.js";

export function openUIView(component: string, props: JsonObject = {}, actions: JsonObject[] = []): OpenUILangView {
  return {
    protocol: OPENUI_LANG_VIEW_PROTOCOL,
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

const CORE_COMPONENT_MAP: Record<string, string> = {
  approval_flow: "ApprovalFlow",
  task_resume: "TaskResumeCard",
  expense_estimate: "ExpenseEstimate",
  source_citation: "CitationDisclosure",
  runtime_summary: "RuntimeSummary"
};

const domainComponentMap: Record<string, string> = {};

export function registerComponentMapping(kind: string, component: string): void {
  domainComponentMap[kind] = component;
}

function componentForKind(kind: string): string {
  return CORE_COMPONENT_MAP[kind] ?? domainComponentMap[kind] ?? "GenericBusinessCard";
}
