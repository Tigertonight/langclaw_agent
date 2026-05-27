import type { CommandDefinition } from "./command-registry.js";

/**
 * 默认注册的前置命令集合。
 *
 * 设计原则：
 * - 命中即跳过 LLM，零延迟、零 token 消耗
 * - 每条命令绑定到已存在的 intent_code（不引入新 handler）
 * - 同时支持斜杠命令（/help）与中文短语（"帮助"），匹配尽量保守，避免误命中
 *
 * 这是"用户能立即看到效果"的能力——在聊天框里输入 /help、/库存预警 这些
 * 短指令，秒响应而不走 LLM 路由。
 *
 * intentCode / title / triggers 是给 /api/commands 看的元数据，不参与 match 逻辑。
 */
export const DEFAULT_COMMANDS: CommandDefinition[] = [
  {
    id: "help",
    intentCode: "system.smalltalk",
    title: "查看帮助",
    triggers: ["/help", "/?", "/帮助", "帮助"],
    match: ({ message }) => {
      const text = message.trim().toLowerCase();
      if (text === "/help" || text === "/?" || text === "帮助" || text === "/帮助") {
        return {
          intentCode: "system.smalltalk",
          params: {},
          reasoning: "命中预注册命令 /help，转入闲聊 handler 由其响应能力介绍。",
          source: "registered_command:help"
        };
      }
      return null;
    }
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
          source: "registered_command:today_orders"
        };
      }
      return null;
    }
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
          source: "registered_command:inventory_alert"
        };
      }
      return null;
    }
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
          source: "registered_command:my_leads"
        };
      }
      return null;
    }
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
          source: "registered_command:warranty_claims"
        };
      }
      return null;
    }
  }
];
