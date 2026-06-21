import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { buildSystemPrompt, buildUserPrompt } from "./router-prompt.js";
import { CommandRegistry } from "./command-registry.js";
import { EXECUTION_CLASSES, executionClassForHandler, normalizeExecutionClass } from "./execution-class.js";
import { applyPromptCache } from "../llm/prompt-cache.js";
import { DeterministicRuleRegistry } from "./deterministic-rule-registry.js";
import type { DeterministicRuleDefinition, ExtractorFn, CorrectionDeltaRule } from "../domains/types.js";
import { getCorrectionDeltaRules, getShortCorrectionPatterns, getMetricKeywordMappings } from "../domains/runtime-registry.js";
import { domainMismatchMessage, intentDomainId, normalizeSelectedDomain, routeMatchesSelectedDomain } from "../domains/domain-isolation.js";
import type {
  Confidence,
  HandlerType,
  IntentManifest,
  IntentParamSchema,
  IntentRegistry,
  JsonObject,
  Route,
  RouteRequest,
  RouterLLMResult,
  SessionState,
  UserContext
} from "../types/agent-contracts.js";

interface RouterChatBody extends JsonObject {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature: number;
  stream: boolean;
  response_format?: { type: string };
}

interface RouteParamValidation {
  ok: boolean;
  errors: string[];
}

const ROUTER_LOG_PATH = "logs/router.jsonl";
const DEFAULT_TIMEOUT_MS = 10000;
const CONFIDENCE_ORDER: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

function readPositiveNumberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * IntentRouter：主入口路由。
 *
 *   1. 优先执行高确定性的本地受控规则（闲聊、dealer 查询、知识制度问答、短句修参）
 *   2. 其他问题调 Intent Router LLM（OpenAI 兼容 chat completions），输出 JSON
 *   3. 只接受 data/intent-codes 中显式注册的 intent_code
 *   4. Router 不可用或输出无效时 fail closed，不再回退旧业务规则/local/general
 */
export class IntentRouter {
  private readonly llm?: unknown;
  private readonly registry: IntentRegistry;
  private readonly timeoutMs: number;
  private readonly deterministicRules: DeterministicRuleRegistry;
  /** 外部注入的 extractor 注册表（来自 DomainRegistry.allExtractors），供短句修参动态查找 */
  private readonly extractorRegistry: Record<string, ExtractorFn>;
  /**
   * 前置命令注册表。默认空，由外部通过 router.commands.register(...) 注入。
   * 命中即返回 Route，跳过 deterministic_rule 与 LLM。
   */
  readonly commands: CommandRegistry;

  /**
   * @param {{
   *   llm?: unknown,
   *   registry?: import("../types/agent-contracts.js").IntentRegistry,
   *   timeoutMs?: number
   * }} [input]
   */
  constructor({ llm, registry, timeoutMs = readPositiveNumberEnv("LLM_DECISION_TIMEOUT_MS", DEFAULT_TIMEOUT_MS), domainRules, extractorRegistry }: {
    llm?: unknown;
    registry: IntentRegistry;
    timeoutMs?: number;
    /** 外部注入的确定性规则（来自 DomainRegistry.allDeterministicRules） */
    domainRules?: DeterministicRuleDefinition[];
    /** 外部注入的 extractor 注册表（供 manifest rules 引用 + 短句修参动态查找） */
    extractorRegistry?: Record<string, ExtractorFn>;
  }) {
    this.llm = llm;
    this.registry = registry;
    this.timeoutMs = timeoutMs;
    this.extractorRegistry = extractorRegistry ?? {};
    this.deterministicRules = new DeterministicRuleRegistry({
      registry,
      createRoute: (intentCode, params, reasoning) => this.createDeterministicRoute(intentCode, params, reasoning),
      domainRules,
      extractorRegistry,
    });
    this.commands = new CommandRegistry();
  }

  /**
   * @param {import("../types/agent-contracts.js").RouteRequest} [input]
   * @returns {Promise<import("../types/agent-contracts.js").Route>}
   */
  async route({ message, now, user_context, selected_domain, session_state }: RouteRequest = {}): Promise<Route> {
    const startedAt = Date.now();
    const apiKey = process.env.LLM_DECISION_API_KEY ?? process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY;
    const nowIso = now ?? new Date().toISOString();
    let result: RouterLLMResult;
    const localControlled = this.tryLocalControlledRoute({ message });
    if (localControlled) {
      const gated = this.applySelectedDomainGate(localControlled, selected_domain);
      this.appendLog({
        ts: new Date().toISOString(),
        message,
        intent_code: gated.intent_code,
        execution_class: gated.execution_class,
        handler_type: gated.handler_type,
        confidence: gated.confidence,
        source: gated.source,
        latency_ms: Date.now() - startedAt
      });
      return gated;
    }
    const command = this.tryRegisteredCommand({ message });
    if (command) {
      const gated = this.applySelectedDomainGate(command.route, selected_domain);
      this.appendLog({
        ts: new Date().toISOString(),
        message,
        intent_code: gated.intent_code,
        execution_class: gated.execution_class,
        handler_type: gated.handler_type,
        confidence: gated.confidence,
        source: gated.source,
        command_id: command.commandId,
        latency_ms: Date.now() - startedAt
      });
      return gated;
    }
    const deterministic = this.tryShortCorrectionRoute({ message, session_state })
      ?? this.tryDeterministicControlledRoute({ message });
    if (deterministic) {
      const gated = this.applySelectedDomainGate(deterministic, selected_domain);
      this.appendLog({
        ts: new Date().toISOString(),
        message,
        intent_code: gated.intent_code,
        execution_class: gated.execution_class,
        handler_type: gated.handler_type,
        confidence: gated.confidence,
        source: gated.source,
        latency_ms: Date.now() - startedAt
      });
      return gated;
    }
    if (!apiKey) {
      const error = createRouterError("router_unavailable", "Intent Router 未配置模型 API Key。");
      this.appendFailureLog({ message, startedAt, error });
      throw error;
    }
    try {
      result = await this.callLLM({ message, now: nowIso, user_context, selected_domain, session_state, apiKey });
    } catch (err) {
      const error = createRouterError("router_failed", err instanceof Error ? err.message : String(err));
      this.appendFailureLog({ message, startedAt, error });
      throw error;
    }

    // manifest 校验：只接受显式注册的 intent_code，不再回退 general。
    const manifest = this.registry.getCode(result.intent_code);
    if (!manifest) {
      const error = createRouterError("unknown_intent_code", `Router 返回了未注册 intent_code：${result.intent_code}`);
      this.appendFailureLog({ message, startedAt, error, result });
      throw error;
    }
    result.handler_type = manifest.handler_type;
    result.execution_class = manifest.execution_class ?? executionClassForHandler(result.handler_type);
    result.execution_class = normalizeExecutionClass(result.execution_class, result.handler_type);
    result.params = normalizeParams(result.params, manifest.params_schema ?? {});

    const validation = validateRouteParams({ params: result.params, schema: manifest.params_schema ?? {} });
    result.param_validation = validation;
    if (!validation.ok) {
      const general = this.registry.getCode("general");
      if (general && manifest.handler_type !== "chitchat") {
        result = downgradeToAgentic({
          original: result,
          general,
          reason: `参数校验未通过：${validation.errors.join("；")}`
        });
      }
    }

    const threshold = manifest.confidence_threshold ?? "medium";
    if (shouldDowngradeByConfidence(result.confidence, threshold, manifest.handler_type)) {
      const general = this.registry.getCode("general");
      if (general) {
        result = downgradeToAgentic({
          original: result,
          general,
          reason: `置信度 ${result.confidence} 低于 ${threshold}，转入自主规划。`
        });
      }
    }
    result = this.applySelectedDomainGate(result, selected_domain) as RouterLLMResult;

    const latency = Date.now() - startedAt;
    this.appendLog({
      ts: new Date().toISOString(),
      message,
      intent_code: result.intent_code,
      execution_class: result.execution_class,
      handler_type: result.handler_type,
      confidence: result.confidence,
      source: result.source,
      latency_ms: latency
    });
    return result;
  }

  /**
   * @param {{ message?: string }} input
   * @returns {import("../types/agent-contracts.js").Route | null}
   */
  tryLocalControlledRoute({ message }: { message?: string }): Route | null {
    const text = String(message ?? "").trim();
    if (!text) return null;
    const smalltalk = this.registry.getCode("system.smalltalk");
    if (!smalltalk) return null;
    if (/^(你好|您好|嗨|hi|hello|谢谢|多谢|再见|拜拜)$/i.test(text) || /你.*(能干嘛|可以做什么|能做什么|会什么|都会什么|有什么能力)|你是谁|功能|能力介绍/.test(text)) {
      return {
        intent_code: smalltalk.intent_code,
        execution_class: smalltalk.execution_class ?? executionClassForHandler(smalltalk.handler_type),
        handler_type: smalltalk.handler_type,
        params: {},
        confidence: "high",
        reasoning: "命中低风险小聊/能力介绍本地预路由。",
        source: "local_controlled_route"
      };
    }
    return null;
  }

  /** @param {{ message?: string }} input */
  tryDeterministicControlledRoute({ message }: { message?: string }): Route | null {
    return this.deterministicRules.match({ message });
  }

  /**
   * 尝试外部注册的前置命令（registerCommand 风格）。命中即生成 Route，跳过 deterministic_rule 与 LLM。
   * 默认无注册项，纯旁路。返回 null 表示未命中。
   */
  tryRegisteredCommand({ message }: { message?: string }): { route: Route; commandId: string } | null {
    const text = String(message ?? "").trim();
    if (!text) return null;
    return this.commands.tryMatch({ message: text }, (intentCode, params, reasoning, source) =>
      this.createDeterministicRoute(intentCode, params, reasoning, source ?? "registered_command")
    );
  }

  /** @param {{ message?: string, session_state?: import("../types/agent-contracts.js").SessionState }} [input] */
  tryShortCorrectionRoute({ message, session_state }: { message?: string; session_state?: SessionState } = {}): Route | null {
    const text = String(message ?? "").trim();
    const last = session_state?.last_query_route;
    if (!text || !last?.intent_code) return null;
    if (!isRecentRoute(last)) return null;
    if (!looksLikeShortCorrection(text)) return null;

    const manifest = this.registry.getCode(last.intent_code);
    if (!manifest || manifest.handler_type !== "intent_query") return null;

    const schema = manifest.params_schema ?? {};
    const delta = buildShortCorrectionDelta({ text, schema, extractorRegistry: this.extractorRegistry });
    if (!Object.keys(delta).length) return null;

    const merged = mergeRouteParams({
      base: last.params ?? {},
      delta,
      schema
    });
    const validation = validateRouteParams({ params: merged, schema });
    if (!validation.ok) return null;

    return this.createDeterministicRoute(
      manifest.intent_code,
      merged,
      `基于 last_query_route 合并短修参数：${Object.keys(delta).join(", ")}。`,
      "deterministic_short_correction"
    );
  }

  /**
   * @param {string} intentCode
   * @param {import("../types/agent-contracts.js").JsonObject} params
   * @param {string} reasoning
   * @param {string} [source]
   * @returns {import("../types/agent-contracts.js").Route | null}
   */
  createDeterministicRoute(intentCode: string, params: JsonObject, reasoning: string, source = "deterministic_controlled_route"): Route | null {
    const manifest = this.registry.getCode(intentCode);
    if (!manifest) return null;
    return {
      intent_code: manifest.intent_code,
      execution_class: manifest.execution_class ?? executionClassForHandler(manifest.handler_type),
      handler_type: manifest.handler_type,
      params: normalizeParams(params, manifest.params_schema ?? {}),
      confidence: "high",
      reasoning,
      source
    };
  }

  applySelectedDomainGate<T extends Route | RouterLLMResult>(route: T, selectedDomain: unknown): T {
    const selected = normalizeSelectedDomain(selectedDomain);
    if (!selected || routeMatchesSelectedDomain(route, selected)) return route;
    const general = this.registry.getCode("general");
    if (!general) return route;
    const actual = intentDomainId(route.intent_code);
    return {
      ...route,
      intent_code: general.intent_code,
      execution_class: general.execution_class ?? executionClassForHandler(general.handler_type),
      handler_type: general.handler_type,
      params: {
        original_intent_code: route.intent_code,
        original_params: route.params ?? {},
        selected_domain: selected,
        actual_domain: actual ?? undefined,
        domain_mismatch: true,
      },
      confidence: "medium",
      reasoning: domainMismatchMessage({ selectedDomain: selected, actualDomain: actual, subject: route.intent_code }),
      source: `${route.source ?? "router"}:domain_gate`
    } as T;
  }

  /**
   * @param {{
   *   message?: string,
   *   now: string,
   *   user_context?: import("../types/agent-contracts.js").UserContext,
   *   session_state?: import("../types/agent-contracts.js").SessionState,
   *   apiKey: string
   * }} input
   * @returns {Promise<import("../types/agent-contracts.js").RouterLLMResult>}
   */
  async callLLM({ message, now, user_context, selected_domain, session_state, apiKey }: {
    message?: string;
    now: string;
    user_context?: UserContext;
    selected_domain?: string;
    session_state?: SessionState;
    apiKey: string;
  }): Promise<RouterLLMResult> {
    const baseUrl = (process.env.LLM_DECISION_BASE_URL ?? process.env.LLM_BASE_URL ?? process.env.OPENAI_BASE_URL ?? "https://api.minimaxi.com/v1").replace(/\/$/, "");
    const model = process.env.LLM_DECISION_MODEL ?? process.env.LLM_MODEL ?? process.env.OPENAI_MODEL ?? "MiniMax-M2.7";
    const systemPrompt = buildSystemPrompt(this.registry);
    const userPrompt = buildUserPrompt({ message, now, user_context, selected_domain, session_state });

    const body: RouterChatBody = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0,
      stream: false
    };
    // OpenAI 兼容：优先请求 json_object；部分服务端不接受时会剥掉该参数重试一次。
    body.response_format = { type: "json_object" };
    applyPromptCache(body, { baseUrl, model, scope: "router.intent_manifest" });

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      // 部分服务端不接受 response_format，剥掉重试一次。
      delete body.response_format;
      const retry = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        signal: AbortSignal.timeout(this.timeoutMs),
        body: JSON.stringify(body)
      });
      if (!retry.ok) throw new Error(`router LLM HTTP ${retry.status}`);
      return this.parseLLMResponse(await retry.json());
    }
    return this.parseLLMResponse(await response.json());
  }

  /** @param {unknown} json */
  parseLLMResponse(json: unknown): RouterLLMResult {
    const response = json as { choices?: Array<{ message?: { content?: string } }> };
    const raw = response?.choices?.[0]?.message?.content ?? "";
    const cleaned = stripCodeFence(raw);
    const parsed = tryParseJSON(cleaned);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("router LLM 输出无法解析为 JSON");
    }
    const record = parsed as Record<string, unknown>;
    if (typeof record.intent_code !== "string" || !record.intent_code.trim()) {
      throw new Error("router LLM 输出缺少 intent_code");
    }
    return {
      intent_code: record.intent_code.trim(),
      execution_class: normalizeExecutionClass(record.execution_class, typeof record.handler_type === "string" ? record.handler_type : "agentic"),
      handler_type: (typeof record.handler_type === "string" ? record.handler_type : "agentic") as HandlerType,
      params: record.params && typeof record.params === "object" ? record.params as JsonObject : {},
      confidence: ["high", "medium", "low"].includes(String(record.confidence)) ? record.confidence as Confidence : "low",
      reasoning: typeof record.reasoning === "string" ? record.reasoning : "",
      source: "llm"
    };
  }

  appendLog(entry: Record<string, unknown>): void {
    try {
      const fullPath = resolve(process.cwd(), ROUTER_LOG_PATH);
      const dir = dirname(fullPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      appendFileSync(fullPath, JSON.stringify(entry) + "\n", "utf8");
    } catch {
      // 日志失败不影响主流程
    }
  }

  /**
   * @param {{
   *   message?: string,
   *   startedAt: number,
   *   error: Error & { code?: string },
   *   result?: Partial<import("../types/agent-contracts.js").RouterLLMResult>
   * }} input
   */
  appendFailureLog({ message, startedAt, error, result }: {
    message?: string;
    startedAt: number;
    error: Error & { code?: string };
    result?: Partial<RouterLLMResult>;
  }): void {
    this.appendLog({
      ts: new Date().toISOString(),
      message,
      intent_code: result?.intent_code ?? null,
      execution_class: result?.execution_class ?? null,
      handler_type: result?.handler_type ?? null,
      confidence: result?.confidence ?? null,
      source: result?.source ?? "router_error",
      latency_ms: Date.now() - startedAt,
      error_code: error.code,
      error_message: error.message
    });
  }
}

function shouldDowngradeByConfidence(confidence: Confidence, threshold: Confidence, handlerType: HandlerType): boolean {
  if (handlerType === "chitchat") return false;
  const current = CONFIDENCE_ORDER[confidence] ?? CONFIDENCE_ORDER.low;
  const required = CONFIDENCE_ORDER[threshold] ?? CONFIDENCE_ORDER.medium;
  return current < required;
}

/**
 * @param {{
 *   original: import("../types/agent-contracts.js").RouterLLMResult,
 *   general: import("../types/agent-contracts.js").IntentManifest,
 *   reason: string
 * }} input
 * @returns {import("../types/agent-contracts.js").RouterLLMResult}
 */
function downgradeToAgentic({ original, general, reason }: { original: RouterLLMResult; general: IntentManifest; reason: string }): RouterLLMResult {
  return {
    ...original,
    intent_code: general.intent_code,
    execution_class: general.execution_class ?? executionClassForHandler(general.handler_type),
    handler_type: general.handler_type,
    params: {
      original_intent_code: original.intent_code,
      original_params: original.params ?? {},
      original_reasoning: original.reasoning ?? ""
    },
    confidence: original.confidence ?? "low",
    reasoning: reason,
    source: `${original.source ?? "llm"}:downgraded`
  };
}

/**
 * @param {unknown} params
 * @param {import("../types/agent-contracts.js").IntentParamSchema} schema
 * @returns {import("../types/agent-contracts.js").JsonObject}
 */
function normalizeParams(params: unknown, schema: IntentParamSchema): JsonObject {
  const normalized: JsonObject = {};
  const source = params && typeof params === "object" && !Array.isArray(params) ? params as JsonObject : {};
  for (const [key, spec] of Object.entries(schema ?? {})) {
    const raw = source[key];
    if (raw === undefined || raw === null || raw === "") {
      normalized[key] = null;
      continue;
    }
    if (spec?.type === "number") {
      const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[,，]/g, ""));
      normalized[key] = Number.isFinite(n) ? n : raw;
      continue;
    }
    if (spec?.type === "boolean") {
      if (typeof raw === "boolean") {
        normalized[key] = raw;
      } else if (/^(true|是|对|仅|只看|yes|1)$/i.test(String(raw).trim())) {
        normalized[key] = true;
      } else if (/^(false|否|不|no|0)$/i.test(String(raw).trim())) {
        normalized[key] = false;
      } else {
        normalized[key] = raw;
      }
      continue;
    }
    normalized[key] = typeof raw === "string" ? raw.trim() : raw;
  }
  for (const [key, value] of Object.entries(source)) {
    if (!(key in normalized)) normalized[key] = value;
  }
  return normalized;
}

function validateRouteParams({ params, schema }: { params: JsonObject; schema: IntentParamSchema }): RouteParamValidation {
  const errors: string[] = [];
  for (const [key, spec] of Object.entries(schema ?? {})) {
    const value = params?.[key];
    const missing = value === undefined || value === null || value === "";
    if (spec?.required && missing) {
      errors.push(`${key} 缺失`);
      continue;
    }
    if (missing) continue;
    if (spec?.type === "enum" && Array.isArray(spec.values) && !spec.values.includes(value)) {
      errors.push(`${key}=${value} 不在枚举范围内`);
    }
    if (spec?.type === "number" && typeof value !== "number") {
      errors.push(`${key} 不是 number`);
    }
    if (spec?.type === "boolean" && typeof value !== "boolean") {
      errors.push(`${key} 不是 boolean`);
    }
    if (spec?.type === "string" && typeof value !== "string") {
      errors.push(`${key} 不是 string`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function isRecentRoute(route: { ts?: string } | null | undefined): boolean {
  if (!route?.ts) return true;
  const ts = Date.parse(route.ts);
  if (!Number.isFinite(ts)) return true;
  return Date.now() - ts <= 10 * 60 * 1000;
}

function looksLikeShortCorrection(text: string): boolean {
  if (!text || text.length > 40) return false;
  // 通用修正模式（域无关）
  const corePatterns = [
    /^不是.*是/,
    /^(改成|换成|改为|换为|只看|仅看|看|具体看|按|按照|再看|再查|加上|不要|去掉|其他|别的)/,
    /(呢|以上|以下)$/,
    /^(那)?(今天|昨天|本周|这周|上周|本月|这个月|上月|上个月|近一个月|最近)(呢)?[？?]?$/,
  ];
  if (corePatterns.some((p) => p.test(text))) return true;
  // 域特定模式（从 DomainPack.shortCorrectionPatterns 动态获取）
  const domainPatterns = getShortCorrectionPatterns();
  return domainPatterns.some((p) => p.test(text));
}

function buildShortCorrectionDelta({ text, schema, extractorRegistry }: { text: string; schema: IntentParamSchema; extractorRegistry: Record<string, ExtractorFn> }): JsonObject {
  const delta: JsonObject = {};

  // metric 提取依赖 schema.metric.values，不是简单的 extractor→field 映射，保留在此
  const metric = extractMetricForSchema(text, schema);
  if (metric) setIfSchema(delta, schema, "metric", metric);

  // 所有 extractor→field 映射规则均由 DomainPack.correctionDeltaRules 声明，registry 驱动
  applyCorrectionDeltaRules(delta, text, schema, extractorRegistry);

  return delta;
}

/**
 * 从 registry 获取域特定的修正 delta 规则并应用。
 * 替代硬编码的 vehicle_model 别名、status 消歧、owner 重置等逻辑。
 */
function applyCorrectionDeltaRules(delta: JsonObject, text: string, schema: IntentParamSchema, extractorRegistry: Record<string, ExtractorFn>): void {
  const rules = getCorrectionDeltaRules();
  for (const rule of rules) {
    // 文本模式匹配规则（如 "其他销售|别的销售"）
    if (rule.textPattern && rule.setFields?.length) {
      if (new RegExp(rule.textPattern).test(text)) {
        for (const field of rule.setFields) {
          setIfSchema(delta, schema, field, rule.setValue ?? null);
        }
      }
      continue;
    }

    // extractor 输出映射规则
    if (!rule.extractor) continue;
    const value = extractorRegistry[rule.extractor]?.(text);
    if (value == null) continue;

    // 消歧逻辑：根据文本内容选择目标字段
    if (rule.disambiguate?.length) {
      let matched = false;
      for (const { pattern, field } of rule.disambiguate) {
        if (field in schema && new RegExp(pattern).test(text)) {
          delta[field] = value;
          matched = true;
          break;
        }
      }
      if (!matched) {
        setFirstSchema(delta, schema, rule.targetFields, value);
      }
      continue;
    }

    // 字段别名映射：按优先级尝试目标字段
    if (rule.targetFields.length > 0) {
      const normalizer = rule.normalizeExtractor ? extractorRegistry[rule.normalizeExtractor] : null;
      for (const field of rule.targetFields) {
        if (field in schema) {
          // 对后续字段使用归一化值
          const useNormalized = normalizer && field !== rule.targetFields[0];
          delta[field] = useNormalized ? (normalizer(String(value)) ?? value) : value;
          break;
        }
      }
    }
  }
}

function mergeRouteParams({ base, delta, schema }: { base?: JsonObject | null; delta?: JsonObject | null; schema: IntentParamSchema }): JsonObject {
  const params: JsonObject = {};
  for (const key of Object.keys(schema ?? {})) {
    if (Object.prototype.hasOwnProperty.call(base ?? {}, key)) params[key] = base[key];
    else params[key] = null;
  }
  for (const [key, value] of Object.entries(delta ?? {})) {
    if (key in (schema ?? {})) params[key] = value;
  }
  return normalizeParams(params, schema);
}

function setIfSchema(target: JsonObject, schema: IntentParamSchema, key: string, value: JsonObject[string]): void {
  if (key in (schema ?? {})) target[key] = value;
}

function setFirstSchema(target: JsonObject, schema: IntentParamSchema, keys: string[], value: JsonObject[string]): void {
  const key = keys.find((item) => item in (schema ?? {}));
  if (key) target[key] = value;
}

// extractMetricForSchema 依赖 schema.metric.values，不是简单的 text→value extractor，保留在本地
function extractMetricForSchema(text: string, schema: IntentParamSchema): string | null {
  const values = schema?.metric?.values ?? [];
  // 从 DomainPack.metricKeywordMappings 动态获取 metric 关键词映射
  const candidates = getMetricKeywordMappings();
  for (const [pattern, metric] of candidates) {
    if (pattern.test(text) && values.includes(metric)) return metric;
  }
  return null;
}


function stripCodeFence(text: unknown): string {
  if (typeof text !== "string") return "";
  let trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    trimmed = trimmed.replace(/^```[a-zA-Z]*\n?/, "").replace(/```\s*$/, "");
  }
  // 去 <think>...</think> 块（部分模型会附）
  trimmed = trimmed.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  return trimmed;
}

function tryParseJSON(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // 尝试找第一个 { ... } 子串
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

/**
 * @param {string} code
 * @param {string} message
 * @returns {Error & { code: string }}
 */
function createRouterError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}
