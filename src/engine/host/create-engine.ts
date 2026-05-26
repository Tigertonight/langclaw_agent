/**
 * Engine Host: createEngine()
 *
 * 简洁的工厂入口。调用方只需：
 *
 *   const engine = await createEngine(config);
 *   // engine.queryEngine / engine.toolRegistry / ... 可用
 *   // 退出时 await engine.dispose();
 *
 * 等价于 new EngineHost(config) + await engine.init()，
 * 但提供了更简洁的一步式 API。
 */

import { EngineHost } from "./engine-host.js";
import type { EngineConfig, EngineInspection } from "./engine-host.js";

export type { EngineConfig, EngineInspection };

/**
 * 创建并初始化 Engine 实例。
 *
 * 这是推荐的入口点。内部执行：
 * 1. 构造 EngineHost（创建所有 runtime 组件）
 * 2. 调用 init()（发现、验证、加载 DomainPack）
 * 3. 返回就绪的 EngineHost 实例
 */
export async function createEngine(config: EngineConfig): Promise<EngineHost> {
  const engine = new EngineHost(config);
  await engine.init();
  return engine;
}
