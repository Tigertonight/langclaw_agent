/**
 * Core 域确定性路由规则。
 *
 * 业务无关的通用规则，如知识制度问答。
 */

import type { DeterministicRuleDefinition } from "../types.js";

export const CORE_DETERMINISTIC_RULES: DeterministicRuleDefinition[] = [
  {
    id: "core.knowledge_policy",
    intentCode: "knowledge.policy_qa",
    priority: 30,
    match: ({ message }) => {
      const text = message;
      if (!/(制度|政策|规则|手册|报销|试用期|年假|病假|权限|审批|流程)/.test(text)) return null;
      return {
        intentCode: "knowledge.policy_qa",
        params: {},
        reasoning: "命中知识制度问答高确定性本地预路由。",
      };
    },
  },
  {
    id: "core.business_order_query",
    intentCode: "business.order_query",
    priority: 80,
    match: ({ message }) => {
      const text = message;
      if (/(订单|发货|交付|订单状态)/.test(text) && !/(销售订单|成交订单|维修工单|工单|整车|车主|VIN|车系|车型|门店|待交付|未交付|交车|按揭|分期|定金|开票|发票)/.test(text)) {
        return {
          intentCode: "business.order_query",
          params: {},
          reasoning: "命中核心客户订单查询规则。",
        };
      }
      return null;
    },
  },
  {
    id: "core.business_sales_report_query",
    intentCode: "business.sales_report_query",
    priority: 35,
    match: ({ message }) => {
      const text = message;
      if (/(销售额|成交额|pipeline|业绩|部门报表|销售报表)/i.test(text)) {
        return {
          intentCode: "business.sales_report_query",
          params: {},
          reasoning: "命中核心销售报表查询规则。",
        };
      }
      return null;
    },
  },
  {
    id: "core.org_department_query",
    intentCode: "org.department_query",
    priority: 35,
    match: ({ message }) => {
      const text = message;
      if (/(组织架构|有哪些部门|部门列表|本地组织)/.test(text)) {
        return {
          intentCode: "org.department_query",
          params: {},
          reasoning: "命中核心组织部门查询规则。",
        };
      }
      return null;
    },
  },
  {
    id: "core.org_employee_query",
    intentCode: "org.employee_query",
    priority: 36,
    match: ({ message }) => {
      const text = message;
      if (/(上级|下级|下属|员工|人员|多少人|同学|汇报|主管|领导|行政部|人事部|销售部|部门)/.test(text)) {
        return {
          intentCode: "org.employee_query",
          params: {},
          reasoning: "命中核心员工组织查询规则。",
        };
      }
      return null;
    },
  },
];
