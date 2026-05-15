import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { buildSystemPrompt, buildUserPrompt } from "./router-prompt.js";
import { EXECUTION_CLASSES, executionClassForHandler, normalizeExecutionClass } from "./execution-class.js";
import { applyPromptCache } from "../llm/prompt-cache.js";

const ROUTER_LOG_PATH = "logs/router.jsonl";
const DEFAULT_TIMEOUT_MS = 10000;
const CONFIDENCE_ORDER = { low: 0, medium: 1, high: 2 };

function readPositiveNumberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * IntentRouter：主入口路由。
 *
 *   1. 调 Intent Router LLM（OpenAI 兼容 chat completions），输出 JSON
 *   2. 只接受 data/intent-codes 中显式注册的 intent_code
 *   3. Router 不可用或输出无效时 fail closed，不再回退旧路由/local/general
 */
export class IntentRouter {
  constructor({ llm, registry, timeoutMs = readPositiveNumberEnv("LLM_DECISION_TIMEOUT_MS", DEFAULT_TIMEOUT_MS) } = {}) {
    this.llm = llm;
    this.registry = registry;
    this.timeoutMs = timeoutMs;
  }

  async route({ message, now, user_context, session_state } = {}) {
    const startedAt = Date.now();
    const apiKey = process.env.LLM_DECISION_API_KEY ?? process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY;
    const nowIso = now ?? new Date().toISOString();
    let result;
    const localControlled = this.tryLocalControlledRoute({ message });
    if (localControlled) {
      this.appendLog({
        ts: new Date().toISOString(),
        message,
        intent_code: localControlled.intent_code,
        execution_class: localControlled.execution_class,
        handler_type: localControlled.handler_type,
        confidence: localControlled.confidence,
        source: localControlled.source,
        latency_ms: Date.now() - startedAt
      });
      return localControlled;
    }
    if (!apiKey) {
      const error = createRouterError("router_unavailable", "Intent Router 未配置模型 API Key。");
      this.appendFailureLog({ message, startedAt, error });
      throw error;
    }
    const deterministic = this.tryShortCorrectionRoute({ message, session_state })
      ?? this.tryDeterministicControlledRoute({ message });
    if (deterministic) {
      this.appendLog({
        ts: new Date().toISOString(),
        message,
        intent_code: deterministic.intent_code,
        execution_class: deterministic.execution_class,
        handler_type: deterministic.handler_type,
        confidence: deterministic.confidence,
        source: deterministic.source,
        latency_ms: Date.now() - startedAt
      });
      return deterministic;
    }
    try {
      result = await this.callLLM({ message, now: nowIso, user_context, session_state, apiKey });
    } catch (err) {
      const error = createRouterError("router_failed", err?.message || String(err));
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

  tryLocalControlledRoute({ message }) {
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

  tryDeterministicControlledRoute({ message }) {
    const text = String(message ?? "").trim();
    if (!text) return null;
    if (looksLikeLeaveRequest(text)) {
      return this.createDeterministicRoute("workflow.leave_request", {
        leave_type: extractLeaveType(text),
        start_time: extractLeaveStartTime(text),
        end_time: null,
        reason: extractLeaveReason(text)
      }, "命中请假申请高确定性本地预路由。");
    }
    if (/(应付|应收|款).*\d+\s*万以上|\d+\s*万以上.*(应付|应收|款)/.test(text)) {
      return this.createDeterministicRoute("dealer.query.finance", {
        store: extractStore(text),
        resource_type: extractFinanceResourceType(text),
        amount_min: extractPriceMin(text)
      }, "命中财务金额阈值高确定性本地预路由。");
    }
    if (/改成\s*\d+\s*万以上|\d+\s*万以上/.test(text)) {
      return this.createDeterministicRoute("dealer.query.sales_orders", {
        store: extractStore(text),
        price_min: extractPriceMin(text)
      }, "命中金额阈值高确定性本地预路由。");
    }
    if (/经营风险|风险总览|经营周报|晨会|最该关注|优先级|财务风险|库存压力|损失风险复盘|三包.*风险|售后.*风险/.test(text)) {
      return this.createDeterministicRoute("dealer.query.metrics", {
        store: extractStore(text),
        category: extractMetricCategory(text),
        severity: /紧急|严重|最高|最该关注/.test(text) ? "critical" : null
      }, "命中经营指标高确定性本地预路由。");
    }
    if (/(三包|索赔|保修|质保)/.test(text)) {
      return this.createDeterministicRoute("dealer.query.warranty_claims", {
        store: extractStore(text),
        series: extractVehicleSeries(text),
        claim_status: extractWarrantyClaimStatus(text),
        fault_category: extractWarrantyFaultCategory(text),
        evidence_status: extractWarrantyEvidenceStatus(text),
        time_range: extractTimeRange(text),
        difference_min: extractAmountMin(text)
      }, "命中三包索赔高确定性本地预路由。");
    }
    if (/(线索.*转化率|转化率|线索数|多少线索|各.*线索|各.*意向等级|各.*来源)/.test(text)) {
      return this.createDeterministicRoute("dealer.aggregate.leads", {
        metric: /转化率/.test(text) ? "conversion_rate" : "lead_count",
        group_by: extractLeadGroupBy(text),
        store: extractStore(text),
        intention_level: /高意向|H\s*级|热单/.test(text) ? "H" : null,
        source: /抖音/.test(text) ? "抖音直播" : null,
        time_range: extractTimeRange(text)
      }, "命中线索聚合高确定性本地预路由。");
    }
    if (/(应付|应收|返利|折让金|款项).*(合计|总额|总共|多少|分别|分布)|各门店.*应付/.test(text)) {
      return this.createDeterministicRoute("dealer.aggregate.finance", {
        metric: /未结清|待结算|没到账|未到账/.test(text) ? "unsettled_amount" : "total_amount",
        group_by: /各门店|每个门店|分布/.test(text) ? "store_name" : null,
        resource_type: extractFinanceResourceType(text),
        store: extractStore(text),
        direction: extractFinanceDirection(text),
        status: /未结清|还没结清|待结算|没到账|未到账/.test(text) ? (/待结算/.test(text) ? "待结算" : "未结清") : null,
        time_range: extractTimeRange(text)
      }, "命中财务聚合高确定性本地预路由。");
    }
    if (/签单状态|订单状态.*(分布|统计|情况)|按订单状态|客户.*签单状态/.test(text)) {
      return this.createDeterministicRoute("dealer.aggregate.sales_orders", {
        metric: "order_count",
        group_by: "order_status",
        store: extractStore(text),
        series: extractVehicleSeries(text),
        time_range: extractTimeRange(text)
      }, "命中订单状态聚合高确定性本地预路由。");
    }
    if (/毛利率|毛利|成交总额|平均成交价|最高.*成交|销售排行榜|卖得最好|卖了多少|各销售顾问|按车系/.test(text)) {
      return this.createDeterministicRoute("dealer.aggregate.sales_orders", {
        metric: extractSalesMetric(text),
        group_by: extractSalesGroupBy(text),
        store: extractStore(text),
        series: extractVehicleSeries(text),
        time_range: extractTimeRange(text)
      }, "命中销售聚合高确定性本地预路由。");
    }
    if (/(工单|维修).*(多少|总共|平均|合计|金额)|平均工时费/.test(text) && !/上周|对比|环比/.test(text)) {
      return this.createDeterministicRoute("dealer.aggregate.repair_orders", {
        metric: extractRepairMetric(text),
        group_by: null,
        store: extractStore(text),
        time_range: extractTimeRange(text)
      }, "命中维修工单聚合高确定性本地预路由。");
    }
    if (/维修工单|工单|超期|逾期|施工|事故维修|常规保养|服务顾问/.test(text) && !/上周|对比|环比/.test(text)) {
      return this.createDeterministicRoute("dealer.query.repair_orders", {
        store: extractStore(text),
        status: /超期|逾期/.test(text) ? "未交付" : /施工/.test(text) ? "施工中" : null,
        order_type: /事故/.test(text) ? "事故维修" : /保养/.test(text) ? "常规保养" : null,
        overdue_only: /超期|逾期/.test(text) ? true : null,
        time_range: extractTimeRange(text)
      }, "命中维修工单高确定性本地预路由。");
    }
    if (/销售订单|成交订单|待交付|未交付|交车|结清款项|按揭|分期|定金|开票|发票/.test(text)) {
      return this.createDeterministicRoute("dealer.query.sales_orders", {
        store: extractStore(text),
        delivery_status: /待交付|未交付|交车/.test(text) ? "待交付" : null,
        payment_status: /定金|还没付完/.test(text) ? "部分收款" : /结清/.test(text) ? "已结清" : null,
        order_type: /按揭|分期|贷款/.test(text) ? "按揭" : null,
        time_range: extractTimeRange(text)
      }, "命中销售订单高确定性本地预路由。");
    }
    if (/折让金|返利|应付|应收|收款|付款|付了|入账|出账|首付|款项|流水/.test(text)) {
      return this.createDeterministicRoute("dealer.query.finance", {
        store: extractStore(text),
        resource_type: extractFinanceResourceType(text),
        category: /首付/.test(text) ? "客户首付" : null,
        direction: extractFinanceDirection(text),
        status: /未结清|还没结清|待结算|没到账|未到账/.test(text) ? (/待结算/.test(text) ? "待结算" : "未结清") : null,
        time_range: extractTimeRange(text)
      }, "命中财务流水高确定性本地预路由。");
    }
    if (/库存|库龄|配额|承诺交期|交期|在途|整车|预警|融资车|有车|订一台|关注级别.*车/.test(text)) {
      return this.createDeterministicRoute("dealer.query.inventory", {
        store: extractStore(text),
        vehicle_model: extractVehicleModel(text),
        warning_level: /紧急/.test(text) ? "紧急" : /关注/.test(text) ? "关注" : null,
        time_range: extractTimeRange(text)
      }, "命中库存高确定性本地预路由。");
    }
    if (/线索|高意向|H\s*级|热单|战败|漏斗|跟进|新进|抖音|自然到店|自然到访/.test(text)) {
      return this.createDeterministicRoute("dealer.query.leads", {
        store: extractStore(text),
        intention_level: /高意向|H\s*级|热单/.test(text) ? "H" : null,
        status: /战败|流失/.test(text) ? "已流失" : /跟进/.test(text) ? "跟进中" : null,
        source: /抖音/.test(text) ? "抖音直播" : /自然到店|自然到访/.test(text) ? "自然到店" : null,
        time_range: extractTimeRange(text)
      }, "命中销售线索高确定性本地预路由。");
    }
    return null;
  }

  tryShortCorrectionRoute({ message, session_state } = {}) {
    const text = String(message ?? "").trim();
    const last = session_state?.last_query_route;
    if (!text || !last?.intent_code) return null;
    if (!isRecentRoute(last)) return null;
    if (!looksLikeShortCorrection(text)) return null;

    const manifest = this.registry.getCode(last.intent_code);
    if (!manifest || manifest.handler_type !== "intent_query") return null;

    const schema = manifest.params_schema ?? {};
    const delta = buildShortCorrectionDelta({ text, schema });
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

  createDeterministicRoute(intentCode, params, reasoning, source = "deterministic_controlled_route") {
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

  async callLLM({ message, now, user_context, session_state, apiKey }) {
    const baseUrl = (process.env.LLM_DECISION_BASE_URL ?? process.env.LLM_BASE_URL ?? process.env.OPENAI_BASE_URL ?? "https://api.minimaxi.com/v1").replace(/\/$/, "");
    const model = process.env.LLM_DECISION_MODEL ?? process.env.LLM_MODEL ?? process.env.OPENAI_MODEL ?? "MiniMax-M2.7";
    const systemPrompt = buildSystemPrompt(this.registry);
    const userPrompt = buildUserPrompt({ message, now, user_context, session_state });

    const body = {
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

  parseLLMResponse(json) {
    const raw = json?.choices?.[0]?.message?.content ?? "";
    const cleaned = stripCodeFence(raw);
    const parsed = tryParseJSON(cleaned);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("router LLM 输出无法解析为 JSON");
    }
    if (typeof parsed.intent_code !== "string" || !parsed.intent_code.trim()) {
      throw new Error("router LLM 输出缺少 intent_code");
    }
    return {
      intent_code: parsed.intent_code.trim(),
      execution_class: normalizeExecutionClass(parsed.execution_class, parsed.handler_type),
      handler_type: typeof parsed.handler_type === "string" ? parsed.handler_type : "agentic",
      params: parsed.params && typeof parsed.params === "object" ? parsed.params : {},
      confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "low",
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
      source: "llm"
    };
  }

  appendLog(entry) {
    try {
      const fullPath = resolve(process.cwd(), ROUTER_LOG_PATH);
      const dir = dirname(fullPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      appendFileSync(fullPath, JSON.stringify(entry) + "\n", "utf8");
    } catch {
      // 日志失败不影响主流程
    }
  }

  appendFailureLog({ message, startedAt, error, result }) {
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

function shouldDowngradeByConfidence(confidence, threshold, handlerType) {
  if (handlerType === "chitchat") return false;
  const current = CONFIDENCE_ORDER[confidence] ?? CONFIDENCE_ORDER.low;
  const required = CONFIDENCE_ORDER[threshold] ?? CONFIDENCE_ORDER.medium;
  return current < required;
}

function downgradeToAgentic({ original, general, reason }) {
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

function normalizeParams(params, schema) {
  const normalized = {};
  const source = params && typeof params === "object" ? params : {};
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

function validateRouteParams({ params, schema }) {
  const errors = [];
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

function isRecentRoute(route) {
  if (!route?.ts) return true;
  const ts = Date.parse(route.ts);
  if (!Number.isFinite(ts)) return true;
  return Date.now() - ts <= 10 * 60 * 1000;
}

function looksLikeShortCorrection(text) {
  if (!text || text.length > 40) return false;
  const bareStore = /^(那)?(华东|华南|华东旗舰店|华南标准店)(呢)?[？?]?$/.test(text);
  const bareTime = /^(那)?(今天|昨天|本周|这周|上周|本月|这个月|上月|上个月|近一个月|最近)(呢)?[？?]?$/.test(text);
  const bareVehicle = /^(那)?(海豹|汉EV|宋L|唐DM-p|唐DM|汉|唐|宋)(呢)?[？?]?$/.test(text);
  return /^(那)?(华东|华南|华东旗舰店|华南标准店)(呢)?[？?]?$/.test(text)
    || /^不是.*是/.test(text)
    || /^(改成|换成|改为|换为|只看|仅看|看|按|按照|再看|再查|加上|不要|去掉|其他|别的)/.test(text)
    || /(呢|以上|以下)$/.test(text)
    || bareStore
    || bareTime
    || bareVehicle;
}

function buildShortCorrectionDelta({ text, schema }) {
  const delta = {};
  const store = extractStore(text);
  if (store) setIfSchema(delta, schema, "store", store);

  const timeRange = extractTimeRange(text);
  if (timeRange) setIfSchema(delta, schema, "time_range", timeRange);

  const vehicle = extractVehicleModel(text);
  if (vehicle) {
    if ("vehicle_model" in schema) delta.vehicle_model = vehicle;
    else if ("model" in schema) delta.model = vehicle;
    else if ("series" in schema) delta.series = normalizeSeries(vehicle);
    else if ("interested_series" in schema) delta.interested_series = normalizeSeries(vehicle);
  }

  const priceMin = extractPriceMin(text);
  const amountMin = extractAmountMin(text);
  if (priceMin != null) {
    if (/(应付|应收|款|金额)/.test(text)) {
      setFirstSchema(delta, schema, ["amount_min", "difference_min", "price_min"], priceMin);
    } else {
      setFirstSchema(delta, schema, ["price_min", "amount_min", "difference_min"], priceMin);
    }
  }
  if (amountMin != null) setFirstSchema(delta, schema, ["amount_min", "difference_min", "price_min"], amountMin);

  const groupBy = extractGroupBy(text);
  if (groupBy) setIfSchema(delta, schema, "group_by", groupBy);

  const metric = extractMetricForSchema(text, schema);
  if (metric) setIfSchema(delta, schema, "metric", metric);

  const status = extractGenericStatus(text);
  if (status) {
    if ("delivery_status" in schema && /交付|交车/.test(text)) delta.delivery_status = status;
    else if ("payment_status" in schema && /结清|定金|收款|付款/.test(text)) delta.payment_status = status;
    else setIfSchema(delta, schema, "status", status);
  }

  const direction = extractFinanceDirection(text);
  if (direction) setIfSchema(delta, schema, "direction", direction);

  const resourceType = extractFinanceResourceType(text);
  if (resourceType) setIfSchema(delta, schema, "resource_type", resourceType);

  const leadLevel = extractLeadIntentionLevel(text);
  if (leadLevel) setIfSchema(delta, schema, "intention_level", leadLevel);

  const source = extractLeadSource(text);
  if (source) setIfSchema(delta, schema, "source", source);

  if (/其他销售|别的销售|换个销售|不要.*林悦/.test(text)) {
    setIfSchema(delta, schema, "owner", null);
    setIfSchema(delta, schema, "owner_name", null);
  }

  return delta;
}

function mergeRouteParams({ base, delta, schema }) {
  const params = {};
  for (const key of Object.keys(schema ?? {})) {
    if (Object.prototype.hasOwnProperty.call(base ?? {}, key)) params[key] = base[key];
    else params[key] = null;
  }
  for (const [key, value] of Object.entries(delta ?? {})) {
    if (key in (schema ?? {})) params[key] = value;
  }
  return normalizeParams(params, schema);
}

function setIfSchema(target, schema, key, value) {
  if (key in (schema ?? {})) target[key] = value;
}

function setFirstSchema(target, schema, keys, value) {
  const key = keys.find((item) => item in (schema ?? {}));
  if (key) target[key] = value;
}

function extractStore(text) {
  if (/华东旗舰店|华东/.test(text)) return "华东旗舰店";
  if (/华南标准店|华南/.test(text)) return "华南标准店";
  return null;
}

function extractTimeRange(text) {
  if (/本月|这个月/.test(text)) return "本月";
  if (/上月|上个月/.test(text)) return "上月";
  if (/本周|这周/.test(text)) return "本周";
  if (/今天|今日/.test(text)) return "今天";
  if (/昨天|昨日/.test(text)) return "昨天";
  if (/最近|近一个月/.test(text)) return "近一个月";
  return null;
}

function extractFinanceResourceType(text) {
  if (/折让金/.test(text)) return "discount_wallet";
  if (/返利/.test(text)) return "rebate";
  if (/应付|付款|付了|付完|款项/.test(text)) return "payable";
  if (/应收/.test(text)) return "receivable";
  if (/收款|收到|入账|到账|首付/.test(text)) return "receipt";
  return null;
}

function extractFinanceDirection(text) {
  if (/出账|付款|付了|付完|扣款|支出/.test(text)) return "出账";
  if (/收款|收到|入账|到账|首付/.test(text)) return "收款";
  return null;
}

function extractPriceMin(text) {
  const match = text.match(/(\d+(?:\.\d+)?)\s*万以上/);
  if (match) return Number(match[1]) * 10000;
  return null;
}

function extractAmountMin(text) {
  const match = text.match(/(?:超过|大于|不少于|至少)\s*(\d+(?:\.\d+)?)\s*万?/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return /万/.test(match[0]) ? value * 10000 : value;
}

function extractGroupBy(text) {
  if (/按车系|各车系|分车系/.test(text)) return "series";
  if (/按门店|各门店|分门店|每个门店/.test(text)) return "store_name";
  if (/按销售|各销售|销售顾问|顾问/.test(text)) return "owner_name";
  if (/按状态|各状态/.test(text)) return "status";
  if (/按来源|各来源/.test(text)) return "source";
  if (/按意向等级|各意向等级/.test(text)) return "intention_level";
  if (/按类型|各类型/.test(text)) return "order_type";
  return null;
}

function extractMetricForSchema(text, schema) {
  const values = schema?.metric?.values ?? [];
  const candidates = [
    [/毛利率|毛利/, "gross_margin"],
    [/成交总额|销售额|总额/, "total_revenue"],
    [/订单数|多少单|卖了多少|数量/, "order_count"],
    [/平均成交价/, "avg_price"],
    [/最高/, "max_price"],
    [/线索数/, "lead_count"],
    [/转化率/, "conversion_rate"],
    [/战败数|流失数/, "lost_count"],
    [/未结清|待结算|没到账|未到账/, "unsettled_amount"],
    [/总金额|合计|多少钱/, "total_amount"],
    [/平均工时费|平均/, "avg_labor"],
    [/应收合计|结算金额|工单金额/, "total_receivable"]
  ];
  for (const [pattern, metric] of candidates) {
    if (pattern.test(text) && values.includes(metric)) return metric;
  }
  return null;
}

function extractGenericStatus(text) {
  if (/待交付|未交付|还没交车|没交车/.test(text)) return "待交付";
  if (/已交付|已经交车/.test(text)) return "已交付";
  if (/整备中/.test(text)) return "整备中";
  if (/已结清|结清/.test(text)) return "已结清";
  if (/未结清|还没结清|欠着/.test(text)) return "未结清";
  if (/部分收款|定金/.test(text)) return "部分收款";
  if (/待结算/.test(text)) return "待结算";
  if (/已到账|到账/.test(text)) return "已到账";
  if (/跟进中|还在跟进/.test(text)) return "跟进中";
  if (/战败|流失/.test(text)) return "已流失";
  if (/施工中|正在施工/.test(text)) return "施工中";
  if (/已核准|核准|通过/.test(text)) return "已核准";
  if (/审核中|厂家审核/.test(text)) return "厂家审核中";
  return null;
}

function extractLeadIntentionLevel(text) {
  if (/高意向|H\s*级|热单/.test(text)) return "H";
  if (/中意向|M\s*级/.test(text)) return "M";
  if (/低意向|L\s*级/.test(text)) return "L";
  return null;
}

function extractLeadSource(text) {
  if (/抖音/.test(text)) return "抖音直播";
  if (/懂车帝/.test(text)) return "懂车帝";
  if (/汽车之家/.test(text)) return "汽车之家";
  if (/自然到店|自然到访|到店/.test(text)) return "自然到店";
  return null;
}

function normalizeSeries(value) {
  if (value === "汉EV") return "汉";
  if (/唐DM/.test(value)) return "唐";
  return value;
}

function extractMetricCategory(text) {
  if (/库存/.test(text) && /线索/.test(text)) return null;
  if (/库存/.test(text)) return "inventory";
  if (/财务|折让金|返利|应付|应收|收款|付款/.test(text)) return "finance";
  if (/三包|索赔|质保|保修/.test(text)) return "warranty";
  if (/售后|维修|工单/.test(text)) return "after_sales";
  return null;
}

function extractLeadGroupBy(text) {
  if (/意向等级/.test(text)) return "intention_level";
  if (/来源/.test(text)) return "source";
  if (/各门店|每个门店/.test(text)) return "store_name";
  if (/销售顾问|顾问/.test(text)) return "owner_name";
  return null;
}

function extractSalesMetric(text) {
  if (/毛利率|毛利/.test(text)) return "gross_margin";
  if (/平均成交价/.test(text)) return "avg_price";
  if (/最高/.test(text)) return "max_price";
  if (/卖了多少|多少台|多少单/.test(text)) return "order_count";
  return "total_revenue";
}

function extractSalesGroupBy(text) {
  if (/车系|按车系/.test(text)) return "series";
  if (/各门店|每个门店/.test(text)) return "store_name";
  if (/销售顾问|排行榜|谁卖得最好/.test(text)) return "owner_name";
  return null;
}

function extractRepairMetric(text) {
  if (/平均工时费|平均/.test(text)) return "avg_labor";
  if (/应收|结算金额|金额|合计/.test(text)) return "total_receivable";
  return "order_count";
}

function extractVehicleSeries(text) {
  const known = ["汉EV", "宋L", "海豹", "秦PLUS", "唐", "汉", "宋"];
  const matched = known.find((item) => text.includes(item));
  if (!matched) return null;
  if (matched === "汉EV") return "汉";
  return matched;
}

function extractWarrantyClaimStatus(text) {
  if (/(被拒|驳回|拒绝)/.test(text)) return "已驳回";
  if (/审核|厂家/.test(text)) return "厂家审核中";
  if (/核准|通过/.test(text)) return "已核准";
  if (/结算/.test(text)) return "已结算";
  if (/待提交|未提交/.test(text)) return "待提交";
  return null;
}

function extractWarrantyFaultCategory(text) {
  if (/三电|电池|电机|电控/.test(text)) return "三电";
  if (/内饰/.test(text)) return "内饰";
  if (/电气/.test(text)) return "电气";
  if (/底盘/.test(text)) return "底盘";
  return null;
}

function extractWarrantyEvidenceStatus(text) {
  if (/证据缺失|缺照片/.test(text)) return "缺照片";
  if (/缺工时单/.test(text)) return "缺工时单";
  if (/照片齐全|证据齐全/.test(text)) return "照片齐全";
  return null;
}

function looksLikeLeaveRequest(text) {
  if (/(请假记录|请假历史|请假情况|请假次数|谁请假|最近请假|查.*请假|看.*请假)/.test(text)) return false;
  return /(想请假|我要请|我想请|帮我请|帮我申请.*假|申请.*假|请个假|休假|走个假勤|请.*年假|请.*病假|请.*事假|请.*调休)/.test(text);
}

function extractLeaveType(text) {
  if (/年假/.test(text)) return "年假";
  if (/病假/.test(text)) return "病假";
  if (/事假|家里有事/.test(text)) return "事假";
  if (/调休/.test(text)) return "调休";
  return null;
}

function extractLeaveStartTime(text) {
  if (/后天/.test(text)) return "后天";
  if (/明天/.test(text)) return "明天";
  if (/今天|下午|上午/.test(text)) return "今天";
  return null;
}

function extractLeaveReason(text) {
  const reasonMatch = text.match(/因为(.+)$/);
  if (reasonMatch?.[1]) return reasonMatch[1].trim();
  if (/家里有事/.test(text)) return "家里有事";
  if (/身体不舒服|不舒服/.test(text)) return "身体不舒服";
  return null;
}

function extractVehicleModel(text) {
  const known = ["汉EV", "唐DM-p", "唐DM", "宋L", "海豹", "汉", "唐", "宋"];
  return known.find((item) => text.includes(item)) ?? null;
}

function stripCodeFence(text) {
  if (typeof text !== "string") return "";
  let trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    trimmed = trimmed.replace(/^```[a-zA-Z]*\n?/, "").replace(/```\s*$/, "");
  }
  // 去 <think>...</think> 块（部分模型会附）
  trimmed = trimmed.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  return trimmed;
}

function tryParseJSON(text) {
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

function createRouterError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
