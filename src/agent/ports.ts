export const INTENTS = {
  KNOWLEDGE_QA: "knowledge_qa",
  DATA_QUERY: "data_query",
  MIXED: "mixed",
  LEAVE_REQUEST: "leave_request",
  SMALLTALK: "smalltalk",
  UNSUPPORTED: "unsupported"
} as const;

export const INTENT_CODES = {
  KNOWLEDGE_POLICY_QA: "knowledge.policy_qa",
  BUSINESS_CUSTOMER_QUERY: "business.customer_query",
  BUSINESS_ORDER_QUERY: "business.order_query",
  BUSINESS_SALES_REPORT_QUERY: "business.sales_report_query",
  ORG_EMPLOYEE_QUERY: "org.employee_query",
  ORG_DEPARTMENT_QUERY: "org.department_query",
  DEALER_INVENTORY_QUERY: "dealer.inventory_query",
  DEALER_LEAD_QUERY: "dealer.lead_query",
  DEALER_ORDER_QUERY: "dealer.order_query",
  DEALER_FINANCE_QUERY: "dealer.finance_query",
  DEALER_AFTER_SALES_QUERY: "dealer.after_sales_query",
  DEALER_WARRANTY_QUERY: "dealer.warranty_query",
  DEALER_ANALYSIS_QUERY: "dealer.analysis_query",
  ATTENDANCE_LEAVE_QUERY: "attendance.leave_query",
  WORKFLOW_LEAVE_REQUEST: "workflow.leave_request",
  SMALLTALK: "chat.smalltalk",
  UNSUPPORTED: "system.unsupported"
} as const;

export type Intent = typeof INTENTS[keyof typeof INTENTS];
export type IntentCode = typeof INTENT_CODES[keyof typeof INTENT_CODES];
