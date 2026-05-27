export const INTENTS = {
  KNOWLEDGE_QA: "knowledge_qa",
  DATA_QUERY: "data_query",
  MIXED: "mixed",
  SMALLTALK: "smalltalk",
  UNSUPPORTED: "unsupported"
} as const;

/**
 * Intent code 常量。
 *
 * 仅包含核心（域无关）的 intent codes。
 * 域特定 intent codes（如 business.customer_query、org.employee_query 等）
 * 由各 DomainPack 的 intentCodeMappings / intentCodeInferenceFns 声明，
 * 通过 DomainRegistry 自动注册，runtime 通过 registry 动态获取。
 */
export const INTENT_CODES = {
  KNOWLEDGE_POLICY_QA: "knowledge.policy_qa",
  SMALLTALK: "chat.smalltalk",
  UNSUPPORTED: "system.unsupported",
} as const;

export type Intent = typeof INTENTS[keyof typeof INTENTS];
export type IntentCode = typeof INTENT_CODES[keyof typeof INTENT_CODES];
