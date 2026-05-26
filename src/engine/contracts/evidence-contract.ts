/**
 * Engine Contract: Evidence
 * Stability: stable
 *
 * 证据推断协议。DomainPack 通过此协议声明如何从用户消息和路由信息推断所需的证据 fact。
 * Engine 的 agent-state 在构建状态时遍历所有注册的 evidence inference 函数。
 */

import type { Route } from "./base-types.js";

/**
 * Evidence Inference 定义。
 * 由 DomainPack 声明，用于从用户消息和路由信息推断所需的证据 fact。
 * runtime 在构建 agent state 时会遍历所有注册的 evidence inference 函数。
 */
export interface EvidenceInferenceDefinition {
  id: string;
  /** 从消息和路由推断所需的 fact key 列表 */
  inferFacts(message: string, route?: Partial<Route> | null): string[];
}
