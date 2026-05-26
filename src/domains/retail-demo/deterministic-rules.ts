/**
 * retail-demo 确定性路由规则。
 *
 * 纯声明式：只使用 patterns / negativePatterns / params，
 * 不使用 match() 逃生口，验证声明式接口的表达力。
 */

import type { DeterministicRuleDefinition } from "../types.js";

export const RETAIL_DETERMINISTIC_RULES: DeterministicRuleDefinition[] = [
  {
    id: "retail.query.sales",
    intentCode: "retail.query.sales",
    priority: 100,
    patterns: [
      "门店销量",
      "门店.*销售",
      "卖了多少",
      "门店.*销售额",
      "商品.*销售额",
      "零售.*销售额",
      "销售情况",
      "今[天日].*卖",
      "哪个.*卖得好",
      "销量排[行名]",
    ],
    negativePatterns: [
      "库存",
      "补货",
      "告警",
    ],
    params: {},
  },
  {
    id: "retail.query.inventory_alerts",
    intentCode: "retail.query.inventory_alerts",
    priority: 100,
    patterns: [
      "库存告警",
      "库存预警",
      "缺货",
      "补货",
      "库存不足",
      "快没了",
      "要断货",
      "库存.*紧急",
      "原料.*不够",
    ],
    params: {},
  },
];
