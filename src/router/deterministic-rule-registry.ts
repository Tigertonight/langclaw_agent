import type {
  DeterministicRuleManifest,
  IntentManifest,
  JsonObject,
  JsonValue,
  Route
} from "../types/agent-contracts.js";
import type { DeterministicRuleDefinition, RuleInput, ExtractorFn, ExtractorSpec } from "../domains/types.js";

interface DeterministicRuleRegistryInput {
  registry?: { listCodes?: () => IntentManifest[] };
  createRoute?: (intentCode: string, params: JsonObject, reasoning: string) => Route | null;
  /**
   * 外部注入的确定性规则（来自 DomainRegistry.allDeterministicRules）。
   * 已按 priority ASC → domainOrder ASC → declarationIndex ASC 排序。
   */
  domainRules?: DeterministicRuleDefinition[];
  /**
   * 外部注入的 extractor 注册表（来自各 DomainPack 的 extractors）。
   * key 为 extractor 名称（如 "store"、"vehicle_model"），value 为提取函数。
   * 供 manifest deterministic_rules 中的 extractors 字段引用。
   */
  extractorRegistry?: Record<string, ExtractorFn>;
}

interface ManifestRule extends DeterministicRuleManifest {
  intent_code: string;
  manifest_description?: string;
}

interface MatchedRule {
  intent_code: string;
  params: JsonObject;
  reasoning: string;
}

export class DeterministicRuleRegistry {
  private readonly createRoute?: DeterministicRuleRegistryInput["createRoute"];
  private readonly manifestRules: ManifestRule[];
  private readonly domainRules: DeterministicRuleDefinition[];
  private readonly extractorRegistry: Record<string, ExtractorFn>;

  constructor({ registry, createRoute, domainRules, extractorRegistry }: DeterministicRuleRegistryInput = {}) {
    this.createRoute = createRoute;
    this.manifestRules = buildManifestRules(registry);
    this.domainRules = domainRules ?? [];
    this.extractorRegistry = extractorRegistry ?? {};
  }

  match({ message }: { message?: string } = {}): Route | null {
    const text = String(message ?? "").trim();
    if (!text || typeof this.createRoute !== "function") return null;

    // 1. manifest rules（来自 intent-codes JSON 中的 deterministic_rules 字段）
    for (const rule of this.manifestRules) {
      const matched = matchManifestRule(rule, text, this.extractorRegistry);
      if (!matched) continue;
      return this.createRoute(matched.intent_code, matched.params, matched.reasoning);
    }

    // 2. domain rules（来自 DomainPack.deterministicRules，已按 priority 排序）
    for (const rule of this.domainRules) {
      const matched = matchDomainRule(rule, text, this.extractorRegistry);
      if (!matched) continue;
      return this.createRoute(matched.intent_code, matched.params, matched.reasoning);
    }

    return null;
  }
}

function buildManifestRules(registry?: { listCodes?: () => IntentManifest[] }): ManifestRule[] {
  if (!registry || typeof registry.listCodes !== "function") return [];
  return registry.listCodes()
    .flatMap((manifest) => (manifest.deterministic_rules ?? []).map((rule) => ({
      ...rule,
      intent_code: rule.intent_code ?? manifest.intent_code,
      manifest_description: manifest.description
    })))
    .filter((rule) => rule.enabled !== false && typeof rule.intent_code === "string" && Array.isArray(rule.patterns))
    .map((rule) => rule as ManifestRule)
    .sort((a, b) => Number(a.priority ?? 100) - Number(b.priority ?? 100));
}

function matchManifestRule(rule: ManifestRule, text: string, extractorRegistry: Record<string, ExtractorFn>): MatchedRule | null {
  const positive = rule.patterns.some((pattern) => new RegExp(pattern).test(text));
  if (!positive) return null;
  if ((rule.negative_patterns ?? []).some((pattern) => new RegExp(pattern).test(text))) return null;
  const params: JsonObject = { ...(rule.params ?? {}) };
  for (const [paramName, extractorName] of Object.entries(rule.extractors ?? {})) {
    params[paramName] = runExtractor(extractorName, text, extractorRegistry);
  }
  return {
    intent_code: rule.intent_code,
    params,
    reasoning: rule.reasoning ?? `命中 manifest 确定性规则：${rule.name ?? rule.intent_code}。`
  };
}

/**
 * 匹配 DomainPack 注入的确定性规则。
 *
 * 如果规则提供了 match() 逃生口，直接调用；
 * 否则使用 patterns / negativePatterns 声明式匹配。
 *
 * extractors 支持三种形式：
 * - ExtractorFn（函数）：直接调用
 * - string：从 extractorRegistry 查找同名 extractor 并调用
 * - ExtractorSpec：从 extractorRegistry 查找 spec.use 指定的 extractor，传入 spec.args，应用 spec.default
 */
function matchDomainRule(rule: DeterministicRuleDefinition, text: string, extractorRegistry: Record<string, ExtractorFn> = {}): MatchedRule | null {
  // 逃生口：自定义 match 函数
  if (typeof rule.match === "function") {
    const result = rule.match({ message: text });
    if (!result) return null;
    return {
      intent_code: result.intentCode,
      params: result.params ?? {},
      reasoning: result.reasoning ?? `命中 domain 确定性规则：${rule.id}。`
    };
  }

  // 声明式匹配
  if (!rule.patterns?.length) return null;
  const positive = rule.patterns.some((pattern) => new RegExp(pattern).test(text));
  if (!positive) return null;
  if (rule.negativePatterns?.some((pattern) => new RegExp(pattern).test(text))) return null;

  const params: JsonObject = { ...(rule.params ?? {}) };
  if (rule.extractors) {
    for (const [paramName, extractor] of Object.entries(rule.extractors)) {
      params[paramName] = resolveExtractor(extractor, text, extractorRegistry);
    }
  }

  return {
    intent_code: rule.intentCode,
    params,
    reasoning: `命中 domain 确定性规则：${rule.id}。`
  };
}

/**
 * 解析并执行 extractor，支持三种形式：
 * 1. ExtractorFn（函数）：直接调用
 * 2. string：从 extractorRegistry 查找同名 extractor 并调用
 * 3. ExtractorSpec：从 extractorRegistry 查找 spec.use 指定的 extractor，
 *    传入 spec.args 作为 ExtractorContext.args，结果为 undefined 时应用 spec.default
 */
function resolveExtractor(
  extractor: string | ExtractorSpec | ExtractorFn,
  text: string,
  extractorRegistry: Record<string, ExtractorFn>,
): JsonValue | undefined {
  // 1. 函数：直接调用
  if (typeof extractor === "function") {
    return extractor(text) ?? null;
  }

  // 2. string：从 registry 查找
  if (typeof extractor === "string") {
    return runExtractor(extractor, text, extractorRegistry);
  }

  // 3. ExtractorSpec：组合式引用
  if (extractor && typeof extractor === "object" && typeof extractor.use === "string") {
    const fn = extractorRegistry[extractor.use];
    if (!fn) return extractor.default ?? null;
    const ctx = { message: text, args: extractor.args };
    const result = fn(text, ctx);
    return result !== undefined ? result : (extractor.default ?? null);
  }

  return null;
}

function runExtractor(name: string, text: string, extractorRegistry: Record<string, ExtractorFn>): JsonValue | undefined {
  return extractorRegistry[name]?.(text) ?? null;
}
