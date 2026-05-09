import { INTENT_CODES, INTENTS } from "./ports.js";

export function inferIntentCode({ intent, queryIR, message = "" }) {
  if (intent === INTENTS.LEAVE_REQUEST) return INTENT_CODES.WORKFLOW_LEAVE_REQUEST;
  if (intent === INTENTS.SMALLTALK) return INTENT_CODES.SMALLTALK;
  if (intent === INTENTS.UNSUPPORTED) return INTENT_CODES.UNSUPPORTED;
  if (intent === INTENTS.KNOWLEDGE_QA) return INTENT_CODES.KNOWLEDGE_POLICY_QA;

  if (queryIR?.target === "customers") return INTENT_CODES.BUSINESS_CUSTOMER_QUERY;
  if (queryIR?.target === "orders") return INTENT_CODES.BUSINESS_ORDER_QUERY;
  if (queryIR?.target === "sales_reports") return INTENT_CODES.BUSINESS_SALES_REPORT_QUERY;
  if (queryIR?.target === "employees") return INTENT_CODES.ORG_EMPLOYEE_QUERY;
  if (queryIR?.target === "departments") return INTENT_CODES.ORG_DEPARTMENT_QUERY;
  if (queryIR?.target === "leave_requests") return INTENT_CODES.ATTENDANCE_LEAVE_QUERY;

  if (/(组织|部门|上级|下级|下属|员工|人员|岗位|汇报)/.test(message)) return INTENT_CODES.ORG_EMPLOYEE_QUERY;
  if (/(请假记录|请假历史|请假情况|请假数据|请假统计|休假记录|休假历史|休假情况|休假数据|休假统计|多少次假|我的请假|最近请假的同学|谁请假了|团队请假|部门请假)/.test(message)) return INTENT_CODES.ATTENDANCE_LEAVE_QUERY;
  if (/(订单|发货|交付)/.test(message)) return INTENT_CODES.BUSINESS_ORDER_QUERY;
  if (/(销售额|成交额|报表|pipeline|业绩)/i.test(message)) return INTENT_CODES.BUSINESS_SALES_REPORT_QUERY;
  if (/(客户|签单|续签|跟进|行业)/.test(message)) return INTENT_CODES.BUSINESS_CUSTOMER_QUERY;

  return intent === INTENTS.MIXED ? INTENT_CODES.KNOWLEDGE_POLICY_QA : INTENT_CODES.UNSUPPORTED;
}

export function normalizeIntentRoute(route) {
  return {
    ...route,
    intent_code: route.intent_code ?? inferIntentCode({
      intent: route.intent,
      queryIR: route.query_ir,
      message: route.message
    })
  };
}
