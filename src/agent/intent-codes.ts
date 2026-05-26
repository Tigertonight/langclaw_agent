import { INTENT_CODES, INTENTS } from "./ports.js";
import { getIntentCodeFromRegistry, inferIntentCodeFromRegistry, getIntentCodeForIntent } from "../domains/runtime-registry.js";
import type { QueryIR, Route } from "../types/agent-contracts.js";

interface InferIntentCodeInput {
  intent?: string;
  queryIR?: Pick<QueryIR, "target"> | null;
  message?: string;
}

export function inferIntentCode({ intent, queryIR, message = "" }: InferIntentCodeInput): string {
  // 核心（域无关）intent → intentCode 映射
  if (intent === INTENTS.SMALLTALK) return INTENT_CODES.SMALLTALK;
  if (intent === INTENTS.UNSUPPORTED) return INTENT_CODES.UNSUPPORTED;
  if (intent === INTENTS.KNOWLEDGE_QA) return INTENT_CODES.KNOWLEDGE_POLICY_QA;

  // 域特定 intent → intentCode 映射（从 DomainPack.intentMappings 动态获取）
  if (intent) {
    const registryIntentCode = getIntentCodeForIntent(intent);
    if (registryIntentCode) return registryIntentCode;
  }

  // 通过 registry 动态查找 resource → intent_code 映射
  if (queryIR?.target) {
    const registryCode = getIntentCodeFromRegistry(queryIR.target);
    if (registryCode) return registryCode;
  }

  // 通过 registry 动态推断 intent code（所有域的 intentCodeInferenceFns）
  const registryInferred = inferIntentCodeFromRegistry(message);
  if (registryInferred) return registryInferred;

  return intent === INTENTS.MIXED ? INTENT_CODES.KNOWLEDGE_POLICY_QA : INTENT_CODES.UNSUPPORTED;
}

export function normalizeIntentRoute<T extends Partial<Route> & { query_ir?: QueryIR | null; message?: string }>(route: T): T & { intent_code: string } {
  return {
    ...route,
    intent_code: route.intent_code ?? inferIntentCode({
      intent: route.intent,
      queryIR: route.query_ir,
      message: route.message
    })
  };
}
