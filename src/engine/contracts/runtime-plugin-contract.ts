/**
 * Engine Contract: RuntimePlugin Definition
 * Stability: stable
 *
 * DomainPack 通过 runtimePlugins 声明要挂载到 RuntimeHooks 的插件。
 * EngineHost 在 init() 末尾统一收集、按 priority 排序、按 id 去重后挂载。
 *
 * 设计意图：
 * 1. 业务侧增加 runtime plugin 不需要修改 engine-adapters.ts
 * 2. 引擎层只内置真正通用的插件（transcript / metrics / promptAuthority / evolution）
 * 3. 跨域共享但带业务语义的插件（task / skill / maintenance）由 corePack 声明
 */

import type { RuntimePlugin } from "../../runtime/hooks.js";

export interface RuntimePluginDefinition {
  /**
   * 唯一标识。
   * 用于去重（同 id 出现多次时仅挂载第一个并打 warn 日志）和诊断输出。
   * 建议命名格式：<domain>.<plugin-purpose>，如 "core.task-continuity"。
   */
  id: string;

  /**
   * 挂载优先级。数字越小越早挂载。
   * 默认 100。引擎内置插件通常使用 0-50，业务插件通常使用 100+。
   */
  priority?: number;

  /** 已实例化的 RuntimePlugin。DomainPack 在声明时直接调用对应的 createXxxPlugin() 工厂。 */
  plugin: RuntimePlugin;
}
