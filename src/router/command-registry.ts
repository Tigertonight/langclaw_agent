import type { JsonObject, Route } from "../types/agent-contracts.js";

/**
 * 前置命中（registerCommand 风格），灵感来自 OpenClaw 的 registerCommand。
 *
 * IntentRouter 当前已有 tryLocalControlledRoute / tryDeterministicControlledRoute
 * 两条本地预路由通道，但匹配规则全写死在路由器内部，外部代码或 hook 想加一个
 * "exact prefix → 跳过 LLM 直发某 intent" 的小捷径，必须改路由器。
 *
 * 这里提供一个轻量注册表：插件 / 测试代码 / 后续渠道可以在不修改 IntentRouter
 * 主流程的前提下，注册自己的命令匹配器。
 *
 * 设计原则（参考 docs/orchestrator-handler-hook-refactor-retrospective.md）：
 * - 旁路、可选、零默认实例：不影响现有路由结果
 * - 一条命令命中即直接产出 Route，跳过后续 deterministic_rule 与 LLM
 * - 匹配函数纯函数、无副作用，便于测试
 */

export interface CommandMatchInput {
  message: string;
}

export interface CommandMatch {
  intentCode: string;
  params?: JsonObject;
  reasoning?: string;
  source?: string;
}

export interface CommandDefinition {
  /** 唯一标识，便于日志/调试定位是哪条命令命中 */
  id: string;
  /**
   * 静态声明：该命令最终会路由到哪个 intent_code，以及面向用户的标题/触发词。
   * 仅用于 /api/commands 这类"展示给前端"的清单渲染——不影响 match 逻辑。
   * 命令可以不声明（动态路由的命令仍能通过 match 正常工作）。
   */
  intentCode?: string;
  title?: string;
  triggers?: string[];
  /**
   * 匹配函数：返回 CommandMatch 表示命中、null 表示跳过。
   * 把"是否命中 + 命中后的参数"放在同一个函数里，避免 prefix 匹配 + 二次 parse 的拆分。
   */
  match(input: CommandMatchInput): CommandMatch | null;
}

export interface CommandRouteFactory {
  (intentCode: string, params: JsonObject, reasoning: string, source?: string): Route | null;
}

export class CommandRegistry {
  private readonly commands: CommandDefinition[] = [];

  register(command: CommandDefinition): void {
    if (!command.id || typeof command.match !== "function") return;
    if (this.commands.some((existing) => existing.id === command.id)) return;
    this.commands.push(command);
  }

  registerAll(commands: CommandDefinition[]): void {
    for (const command of commands) this.register(command);
  }

  list(): ReadonlyArray<CommandDefinition> {
    return this.commands;
  }

  /**
   * 顺序匹配，先注册先尝试。第一条命中即返回。
   * 任何匹配函数抛错都会被吞掉，不影响后续命令——前置命中只是优化路径，不能阻断主流程。
   */
  tryMatch(input: CommandMatchInput, factory: CommandRouteFactory): { route: Route; commandId: string } | null {
    for (const command of this.commands) {
      let match: CommandMatch | null = null;
      try {
        match = command.match(input);
      } catch {
        continue;
      }
      if (!match || !match.intentCode) continue;
      const route = factory(
        match.intentCode,
        match.params ?? {},
        match.reasoning ?? `命中预注册命令：${command.id}。`,
        match.source ?? "registered_command"
      );
      if (route) return { route, commandId: command.id };
    }
    return null;
  }
}
