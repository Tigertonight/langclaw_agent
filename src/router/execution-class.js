export const EXECUTION_CLASSES = {
  CONTROLLED: "controlled_execution",
  AUTONOMOUS: "autonomous_planning"
};

const CONTROLLED_HANDLERS = new Set(["chitchat", "intent_query", "knowledge_lookup", "workflow"]);
const AUTONOMOUS_HANDLERS = new Set(["agentic"]);

export function executionClassForHandler(handlerType) {
  if (CONTROLLED_HANDLERS.has(handlerType)) return EXECUTION_CLASSES.CONTROLLED;
  if (AUTONOMOUS_HANDLERS.has(handlerType)) return EXECUTION_CLASSES.AUTONOMOUS;
  return EXECUTION_CLASSES.AUTONOMOUS;
}

export function normalizeExecutionClass(value, handlerType) {
  if (value === EXECUTION_CLASSES.CONTROLLED || value === EXECUTION_CLASSES.AUTONOMOUS) {
    return value;
  }
  return executionClassForHandler(handlerType);
}

export function isControlledExecution(route) {
  return normalizeExecutionClass(route?.execution_class, route?.handler_type) === EXECUTION_CLASSES.CONTROLLED;
}

export function isAutonomousPlanning(route) {
  return normalizeExecutionClass(route?.execution_class, route?.handler_type) === EXECUTION_CLASSES.AUTONOMOUS;
}
