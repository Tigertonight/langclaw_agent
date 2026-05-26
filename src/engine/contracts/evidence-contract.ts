/**
 * Engine Contract: Evidence
 * Stability: stable
 *
 * 证据推断协议。DomainPack 通过此协议声明如何从用户消息和路由信息推断所需的证据 fact。
 * Engine 的 agent-state 在构建状态时遍历所有注册的 evidence inference 函数。
 */

import type { JsonObject, Route } from "./base-types.js";

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

/**
 * Fact 提取的输入。data 是 query_business_data 工具返回的 result.data。
 */
export interface FactExtractionInput {
  /** query_business_data 返回的 data 对象 */
  data: JsonObject;
  /** data.resource，便于 extractor 直接读取 */
  resource: string;
}

/**
 * 单个 fact 提取结果。
 *
 * 继承 JsonObject 以便消费方可以直接将其塞进 known_facts（AgentFact 也是
 * JsonObject 的派生）。
 */
export interface ExtractedFact extends JsonObject {
  key: string;
  text: string;
}

/**
 * Fact Extractor 定义。
 * 由 DomainPack 声明，用于从特定 resource 的工具返回数据中提取多个 fact。
 *
 * 与 factKeyMappings（resource → 单个 factKey）互补：FactExtractor 处理那些
 * 一次工具调用要派生多个 fact 的 resource（例如 employees 同时产出
 * direct_leader / direct_reports / org_profile）。
 *
 * runtime 的 agent-state / agent-task-state 在收到 query_business_data 结果时，
 * 优先按 resource 查找已注册的 FactExtractor；找不到再走通用 factKeyMappings 路径。
 */
export interface FactExtractorDefinition {
  /** 适用的 resource id（如 "employees"） */
  resource: string;
  /** 从 data 中提取多个 fact */
  extract(input: FactExtractionInput): ExtractedFact[];
}
