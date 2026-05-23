import type { ExecutionClass } from "../types/agent-contracts.js";
import { handlerManifestRegistry } from "../handlers/handler-manifest.js";

export const EXECUTION_CLASSES: {
  CONTROLLED: ExecutionClass;
  AUTONOMOUS: ExecutionClass;
} = {
  CONTROLLED: "controlled_execution",
  AUTONOMOUS: "autonomous_planning"
};

export function executionClassForHandler(handlerType?: string): ExecutionClass {
  const manifest = handlerManifestRegistry.get(handlerType);
  if (manifest) return manifest.execution_class;
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
