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

// 核心 kind → OpenUI 组件映射
const CORE_COMPONENT_MAP: Record<string, string> = {
  approval_flow: "ApprovalFlow",
  task_resume: "TaskResumeCard",
  expense_estimate: "ExpenseEstimate",
  source_citation: "CitationDisclosure",
  runtime_summary: "RuntimeSummary"
};

// 域特定 kind → OpenUI 组件映射（由域 Surface 插件通过 registerComponentMapping 动态注册）
const _domainComponentMap: Record<string, string> = {};

/**
 * 注册域特定的 kind → OpenUI 组件映射。
 */
export function registerComponentMapping(kind: string, component: string): void {
  _domainComponentMap[kind] = component;
}

function componentForKind(kind: string): string {
  return CORE_COMPONENT_MAP[kind] ?? _domainComponentMap[kind] ?? "GenericBusinessCard";
}
