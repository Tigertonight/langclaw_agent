/**
 * Engine Contract: Evolution Extraction
 * Stability: experimental
 *
 * 描述 evolution 阶段从一段会话 trace 中抽取「记忆 + 实体 + 关系」的协议。
 *
 * 分层约定：
 * - Engine 层：拥有 prompt 骨架、结构化 schema、抽取流水线；不知道任何业务词表。
 * - DomainPack 层：通过本协议向 Engine 注入业务词表（实体类型 / 谓词 / few-shot），
 *   完全不参与运行流程。
 *
 * 当 vocabulary 字段为空数组时，Engine 仍可工作（退化为通用抽取），但抽取质量
 * 取决于 LLM 的先验。生产场景应由 DomainPack 显式注入业务词表。
 */
export interface EvolutionExtractionContract {
  /**
   * DomainPack 标识，仅用于 prompt 中向模型说明所处业务领域。
   * 留空表示通用领域。
   */
  domainLabel?: string;

  /**
   * 允许出现在抽取结果里的实体类型白名单。每条目是单个 token，例如 "customer"、
   * "product"、"order"。空数组表示不限制类型。
   */
  entityTypes: string[];

  /**
   * 允许出现在 relation.predicate 里的谓词白名单。每条目是单个 token，例如
   * "ordered"、"prefers"、"complained_about"。空数组表示不限制谓词。
   */
  predicates: string[];

  /**
   * 强属性键（用于 entity_resolve）。例如 ["phone", "email", "id_card"]。
   * Engine 在 resolve 阶段会优先读取这些键作为 strong_attributes。
   */
  strongAttributeKeys: string[];

  /**
   * Few-shot 示例。Engine 会原样拼接进 prompt，DomainPack 自行决定示例形态。
   * 每条 example 必须是合法 JSON 字符串（用户消息→结构化抽取结果）。
   * 空数组表示不附带示例。
   */
  fewShotExamples: ExtractionFewShotExample[];
}

export interface ExtractionFewShotExample {
  /** 简短描述这个示例覆盖的场景，仅作 prompt 注释。 */
  label: string;
  /** 模拟的用户消息（多轮可用 \n 分隔）。 */
  userMessage: string;
  /** 模拟的助手回答。 */
  assistantAnswer: string;
  /** 期望模型返回的 JSON（必须符合 ExtractionResultSchema）。 */
  expectedJson: string;
}

/**
 * Engine 默认契约：所有词表为空，可在 DomainPack 未就绪时跑通流水线。
 * DomainPack 实现时通常用 spread 复写：
 *
 *   { ...EMPTY_EXTRACTION_CONTRACT, entityTypes: ["customer", ...] }
 */
export const EMPTY_EXTRACTION_CONTRACT: EvolutionExtractionContract = {
  domainLabel: undefined,
  entityTypes: [],
  predicates: [],
  strongAttributeKeys: [],
  fewShotExamples: []
};
