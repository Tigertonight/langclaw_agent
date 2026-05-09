/**
 * Port definitions by convention.
 *
 * LLMClient:
 *   classifyIntent({ user, question }) -> { intent, confidence, reason }
 *   planToolCalls({ user, question, tools }) -> { calls, clarification? }
 *   generateAnswer({ user, question, route, docs, toolResults }) -> { answer }
 *
 * KnowledgeBase:
 *   search(query, user, options) -> KnowledgeChunk[]
 *
 * Tool:
 *   { name, description, schema, execute(args, context) }
 *
 * AgentOrchestrator:
 *   run({ userId, message, debug }) -> AgentOutput
 */

export const INTENTS = {
  KNOWLEDGE_QA: "knowledge_qa",
  DATA_QUERY: "data_query",
  MIXED: "mixed",
  LEAVE_REQUEST: "leave_request",
  SMALLTALK: "smalltalk",
  UNSUPPORTED: "unsupported"
};

export const INTENT_CODES = {
  KNOWLEDGE_POLICY_QA: "knowledge.policy_qa",
  BUSINESS_CUSTOMER_QUERY: "business.customer_query",
  BUSINESS_ORDER_QUERY: "business.order_query",
  BUSINESS_SALES_REPORT_QUERY: "business.sales_report_query",
  ORG_EMPLOYEE_QUERY: "org.employee_query",
  ORG_DEPARTMENT_QUERY: "org.department_query",
  ATTENDANCE_LEAVE_QUERY: "attendance.leave_query",
  WORKFLOW_LEAVE_REQUEST: "workflow.leave_request",
  SMALLTALK: "chat.smalltalk",
  UNSUPPORTED: "system.unsupported"
};
