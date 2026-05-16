import type { ExecutionClass } from "../types/agent-contracts.js";

export const EXECUTION_CLASSES: {
  CONTROLLED: ExecutionClass;
  AUTONOMOUS: ExecutionClass;
} = {
  CONTROLLED: "controlled_execution",
  AUTONOMOUS: "autonomous_planning"
};

const CONTROLLED_HANDLERS = new Set(["chitchat", "intent_query", "knowledge_lookup", "workflow"]);
const AUTONOMOUS_HANDLERS = new Set(["agentic"]);

export function executionClassForHandler(handlerType?: string): ExecutionClass {
  if (CONTROLLED_HANDLERS.has(String(handlerType))) return EXECUTION_CLASSES.CONTROLLED;
  if (AUTONOMOUS_HANDLERS.has(String(handlerType))) return EXECUTION_CLASSES.AUTONOMOUS;
  return EXECUTION_CLASSES.AUTONOMOUS;
}

export function normalizeExecutionClass(value: unknown, handlerType?: string): ExecutionClass {
  if (value === EXECUTION_CLASSES.CONTROLLED || value === EXECUTION_CLASSES.AUTONOMOUS) {
    return value as ExecutionClass;
  }
  return executionClassForHandler(handlerType);
}

export function isControlledExecution(route?: { execution_class?: unknown; handler_type?: string } | null): boolean {
  return normalizeExecutionClass(route?.execution_class, route?.handler_type) === EXECUTION_CLASSES.CONTROLLED;
}

export function isAutonomousPlanning(route?: { execution_class?: unknown; handler_type?: string } | null): boolean {
  return normalizeExecutionClass(route?.execution_class, route?.handler_type) === EXECUTION_CLASSES.AUTONOMOUS;
}
