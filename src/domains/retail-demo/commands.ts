/**
 * retail-demo 斜杠命令。
 *
 * 纯声明式：命中即跳过 LLM，零延迟、零 token 消耗。
 */

import type { CommandDefinition } from "../../router/command-registry.js";

export const RETAIL_COMMANDS: CommandDefinition[] = [
  {
    id: "retail_sales",
    intentCode: "retail.query.sales",
    title: "门店销量",
    triggers: ["/门店销量", "/retail-sales"],
    match: ({ message }) => {
      const text = message.trim();
      if (text === "/门店销量" || text === "/retail-sales") {
        return {
          intentCode: "retail.query.sales",
          params: {},
          reasoning: "命中预注册命令 /门店销量，直接查询零售门店销量。",
          source: "registered_command:retail_sales",
        };
      }
      return null;
    },
  },
  {
    id: "retail_inventory_alerts",
    intentCode: "retail.query.inventory_alerts",
    title: "库存告警",
    triggers: ["/库存告警", "/retail-alerts"],
    match: ({ message }) => {
      const text = message.trim();
      if (text === "/库存告警" || text === "/retail-alerts") {
        return {
          intentCode: "retail.query.inventory_alerts",
          params: { alert_level: "紧急" },
          reasoning: "命中预注册命令 /库存告警，直接查询紧急库存告警。",
          source: "registered_command:retail_inventory_alerts",
        };
      }
      return null;
    },
  },
];
