/**
 * Dealer 业务域斜杠命令。
 *
 * 从 src/router/default-commands.ts 迁出的 dealer 专属命令。
 * 命中即跳过 LLM，零延迟、零 token 消耗。
 */

import type { CommandDefinition } from "../../router/command-registry.js";

export const DEALER_COMMANDS: CommandDefinition[] = [
  {
    id: "store_kpi",
    intentCode: "dealer.query.metrics",
    title: "门店业绩",
    triggers: ["/门店业绩", "/经营指标", "/store-kpi"],
    match: ({ message }) => {
      const text = message.trim();
      if (text === "/门店业绩" || text === "/经营指标" || text === "/store-kpi") {
        return {
          intentCode: "dealer.query.metrics",
          params: { category: "sales" },
          reasoning: "命中预注册命令 /门店业绩，直接查询经销商经营指标（category=sales）。",
          source: "registered_command:store_kpi",
        };
      }
      return null;
    },
  },
  {
    id: "store_kpi_sales_orders",
    intentCode: "dealer.aggregate.sales_orders",
    title: "门店成交指标",
    triggers: ["/成交指标", "/订单指标"],
    match: ({ message }) => {
      const text = message.trim();
      if (text === "/成交指标" || text === "/订单指标") {
        return {
          intentCode: "dealer.aggregate.sales_orders",
          params: { metric: "order_count", time_range: "本月" },
          reasoning: "命中预注册命令 /成交指标，直接统计本月成交订单数。",
          source: "registered_command:store_kpi_sales_orders",
        };
      }
      return null;
    },
  },
  {
    id: "today_orders",
    intentCode: "dealer.query.sales_orders",
    title: "今日订单",
    triggers: ["/今日订单", "/今天的订单", "/today"],
    match: ({ message }) => {
      const text = message.trim();
      if (text === "/今日订单" || text === "/今天的订单" || text === "/today") {
        return {
          intentCode: "dealer.query.sales_orders",
          params: { time_range: "今天" },
          reasoning: "命中预注册命令 /今日订单，直接查询销售订单（time_range=今天）。",
          source: "registered_command:today_orders",
        };
      }
      return null;
    },
  },
  {
    id: "inventory_alert",
    intentCode: "dealer.query.inventory",
    title: "库存预警",
    triggers: ["/库存预警", "/inventory-alert"],
    match: ({ message }) => {
      const text = message.trim();
      if (text === "/库存预警" || text === "/inventory-alert") {
        return {
          intentCode: "dealer.query.inventory",
          params: { warning_level: "预警" },
          reasoning: "命中预注册命令 /库存预警，直接查询库存预警明细。",
          source: "registered_command:inventory_alert",
        };
      }
      return null;
    },
  },
  {
    id: "my_leads",
    intentCode: "dealer.query.leads",
    title: "我的销售线索",
    triggers: ["/我的线索", "/我的客户线索", "/leads"],
    match: ({ message }) => {
      const text = message.trim();
      if (text === "/我的线索" || text === "/我的客户线索" || text === "/leads") {
        return {
          intentCode: "dealer.query.leads",
          params: {},
          reasoning: "命中预注册命令 /我的线索，直接查询当前用户名下销售线索。",
          source: "registered_command:my_leads",
        };
      }
      return null;
    },
  },
  {
    id: "warranty_claims",
    intentCode: "dealer.query.warranty_claims",
    title: "三包索赔",
    triggers: ["/三包", "/三包索赔", "/warranty"],
    match: ({ message }) => {
      const text = message.trim();
      if (text === "/三包" || text === "/三包索赔" || text === "/warranty") {
        return {
          intentCode: "dealer.query.warranty_claims",
          params: {},
          reasoning: "命中预注册命令 /三包，直接查询三包索赔记录。",
          source: "registered_command:warranty_claims",
        };
      }
      return null;
    },
  },
];
