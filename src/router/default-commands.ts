import type { CommandDefinition } from "./command-registry.js";
import { getRuntimeRegistry } from "../domains/runtime-registry.js";

/**
 * 默认注册的前置命令集合。
 *
 * 已改为从 DomainRegistry.allCommands 动态获取。
 * app.ts 中直接使用 domainRegistry.allCommands 注入，此处仅为
 * eval 脚本等独立场景提供向后兼容的导出。
 *
 * 注意：此 getter 在 app.init() 之后才返回完整命令列表。
 */
export function getDefaultCommands(): CommandDefinition[] {
  const registry = getRuntimeRegistry();
  // 如果 registry 尚未初始化（如 eval 脚本），返回空数组
  // eval 脚本应自行通过 DomainRegistry 初始化
  return (registry as unknown as { allCommands?: CommandDefinition[] })?.allCommands ?? [];
}

/**
 * @deprecated 使用 getDefaultCommands() 或 domainRegistry.allCommands 替代。
 * 保留此导出仅为向后兼容 eval 脚本。
 */
export const DEFAULT_COMMANDS: CommandDefinition[] = [];
