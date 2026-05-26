/**
 * Core 域斜杠命令。
 *
 * 业务无关的通用命令，如 /help。
 */

import type { CommandDefinition } from "../../router/command-registry.js";

export const CORE_COMMANDS: CommandDefinition[] = [
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
          source: "registered_command:help",
        };
      }
      return null;
    },
  },
];
