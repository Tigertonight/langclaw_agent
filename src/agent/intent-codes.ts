import { INTENT_CODES, INTENTS } from "./ports.js";
import type { QueryIR, Route } from "../types/agent-contracts.js";

interface InferIntentCodeInput {
  intent?: string;
  queryIR?: Pick<QueryIR, "target"> | null;
  message?: string;
}

export function inferIntentCode({ intent, queryIR, message = "" }: InferIntentCodeInput): string {
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
  if (["dealer_vehicles", "dealer_inbounds", "dealer_quotas", "dealer_stores"].includes(queryIR?.target)) return INTENT_CODES.DEALER_INVENTORY_QUERY;
  if (queryIR?.target === "dealer_leads") return INTENT_CODES.DEALER_LEAD_QUERY;
  if (queryIR?.target === "dealer_sales_orders") return INTENT_CODES.DEALER_ORDER_QUERY;
  if (queryIR?.target === "dealer_finance") return INTENT_CODES.DEALER_FINANCE_QUERY;
  if (queryIR?.target === "dealer_repair_orders") return INTENT_CODES.DEALER_AFTER_SALES_QUERY;
  if (queryIR?.target === "dealer_warranty_claims") return INTENT_CODES.DEALER_WARRANTY_QUERY;
  if (queryIR?.target === "dealer_metrics") return INTENT_CODES.DEALER_ANALYSIS_QUERY;

  if (/\bWC-\d{6}-\d{3}\b/i.test(message)) return INTENT_CODES.DEALER_WARRANTY_QUERY;
  if (/\bRO-\d{6}-\d{3}\b/i.test(message)) return INTENT_CODES.DEALER_AFTER_SALES_QUERY;
  if (isDealerAnalysisMessage(message)) return INTENT_CODES.DEALER_ANALYSIS_QUERY;
  if (/(VIN|整车|车辆|库存|在库|库龄|在途|配额|PDI|合格证|展车|试驾车|调拨|承诺交期|订一台|订车|汉EV|宋L|海豹|秦PLUS|元PLUS|腾势N7)/i.test(message)) return INTENT_CODES.DEALER_INVENTORY_QUERY;
  if (/(线索|意向|跟进|到店|战败|漏斗|转化率|获客|客户来源)/.test(message)) return INTENT_CODES.DEALER_LEAD_QUERY;
  if (/(销售订单|锁车|合同|交付|收款状态|开票|成交价|毛利|按揭|全款)/.test(message)) return INTENT_CODES.DEALER_ORDER_QUERY;
  if (/(折让金|应付|应收|付款|返利|财务|余额|到账|抵扣|单车毛利)/.test(message)) return INTENT_CODES.DEALER_FINANCE_QUERY;
  if (/(售后|维修|保养|工单|接待|质检|结算|服务顾问)/.test(message)) return INTENT_CODES.DEALER_AFTER_SALES_QUERY;
  if (/(三包|质保|索赔|厂家审核|核准金额|故障码|旧件)/.test(message)) return INTENT_CODES.DEALER_WARRANTY_QUERY;
  if (/(组织|部门|上级|下级|下属|员工|人员|岗位|汇报|负责人|主管|领导|我们店|门店)/.test(message)) return INTENT_CODES.ORG_EMPLOYEE_QUERY;
  if (/(请假记录|请假历史|请假情况|请假数据|请假统计|休假记录|休假历史|休假情况|休假数据|休假统计|多少次假|我的请假|最近.*请假|谁请假|哪些人请假|哪些员工请假|团队请假|部门请假)/.test(message)) return INTENT_CODES.ATTENDANCE_LEAVE_QUERY;
  if (/(订单|发货|交付)/.test(message)) return INTENT_CODES.BUSINESS_ORDER_QUERY;
  if (/(销售额|成交额|报表|pipeline|业绩)/i.test(message)) return INTENT_CODES.BUSINESS_SALES_REPORT_QUERY;
  if (/(客户|签单|续签|跟进|行业)/.test(message)) return INTENT_CODES.BUSINESS_CUSTOMER_QUERY;

  return intent === INTENTS.MIXED ? INTENT_CODES.KNOWLEDGE_POLICY_QA : INTENT_CODES.UNSUPPORTED;
}

function isDealerAnalysisMessage(message: string): boolean {
  const text = String(message ?? "");
  if (/(谁|哪位).{0,8}(负责人|主管|经理|总经理)|(?:负责人|主管|经理|总经理).{0,8}(是谁|哪位|谁)/.test(text)) return false;
  const hasAnalysisView = /(经营|分析|日报|周报|复盘|最该关注|优先级|看板|总览|汇总|建议|总经理|体系|晨会|行动项|经营计划|负责人|管理动作|协调问题)/.test(text);
  const hasRiskReview = /风险/.test(text) && /(经营|总览|复盘|分析|有哪些|哪里|最该关注|优先级)/.test(text);
  const hasManagementTask = /(晨会|行动项|经营计划|管理动作|协调问题|负责人|总经理视角|经销商体系)/.test(text);
  return (hasAnalysisView || hasRiskReview)
    && (hasManagementTask || /(经销商|门店|销售订单|库存|线索|售后|财务|三包|折让金|华东旗舰店|华南标准店)/.test(text));
}

export function normalizeIntentRoute<T extends Partial<Route> & { query_ir?: QueryIR | null; message?: string }>(route: T): T & { intent_code: string } {
  return {
    ...route,
    intent_code: route.intent_code ?? inferIntentCode({
      intent: route.intent,
      queryIR: route.query_ir,
      message: route.message
    })
  };
}
