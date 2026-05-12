import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { buildSystemPrompt, buildUserPrompt } from "./router-prompt.js";
import { INTENTS } from "../agent/ports.js";

const ROUTER_LOG_PATH = "logs/router.jsonl";
const DEFAULT_TIMEOUT_MS = 12000;

/**
 * IntentRouter：v2 入口路由。
 *
 *   1. 优先调 LLM（OpenAI 兼容 chat completions），输出 JSON
 *   2. LLM 不可用 / 解析失败 → 退到 localLLM.recognizeIntent，做粗映射
 *   3. 仍失败 → general / agentic 兜底
 */
export class IntentRouter {
  constructor({ llm, registry, localLLM, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.llm = llm;
    this.registry = registry;
    this.localLLM = localLLM;
    this.timeoutMs = timeoutMs;
  }

  async route({ message, now, user_context, session_state } = {}) {
    const startedAt = Date.now();
    const apiKey = process.env.LLM_DECISION_API_KEY ?? process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY;
    const nowIso = now ?? new Date().toISOString();
    let result;
    let llmError = null;
    if (apiKey) {
      try {
        result = await this.callLLM({ message, now: nowIso, user_context, session_state, apiKey });
      } catch (err) {
        llmError = err?.message || String(err);
        result = null;
      }
    }

    if (!result && this.localLLM) {
      try {
        const local = await this.localLLM.recognizeIntent({
          user: user_context ?? {},
          question: message,
          history: [],
          conversationContext: null
        });
        result = this.mapLocalToRouterOutput(local, message);
      } catch (err) {
        result = null;
      }
    }

    if (!result) {
      result = {
        intent_code: "general",
        handler_type: "agentic",
        params: {},
        confidence: "low",
        reasoning: "Router 与 local 都不可用，使用 general/agentic 兜底。",
        source: "fallback"
      };
    }

    // manifest 校验：以 manifest 为准；置信度低强制走 agentic
    const manifest = this.registry.getCode(result.intent_code);
    if (!manifest) {
      result = {
        ...result,
        intent_code: "general",
        handler_type: "agentic",
        source: result.source === "llm" ? "fallback" : result.source,
        reasoning: `${result.reasoning ?? ""}（manifest 未找到 intent_code，回退 general）`.trim()
      };
    } else {
      result.handler_type = manifest.handler_type;
    }
    if (result.confidence === "low" && result.handler_type !== "chitchat") {
      result.handler_type = "agentic";
    }

    const latency = Date.now() - startedAt;
    this.appendLog({
      ts: new Date().toISOString(),
      message,
      intent_code: result.intent_code,
      handler_type: result.handler_type,
      confidence: result.confidence,
      source: result.source,
      latency_ms: latency,
      llm_error: llmError
    });
    return result;
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
    // OpenAI 兼容：尝试请求 json_object，部分服务端支持，失败也无所谓——下面会兜底解析。
    body.response_format = { type: "json_object" };

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
    return {
      intent_code: typeof parsed.intent_code === "string" ? parsed.intent_code : "general",
      handler_type: typeof parsed.handler_type === "string" ? parsed.handler_type : "agentic",
      params: parsed.params && typeof parsed.params === "object" ? parsed.params : {},
      confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "low",
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
      source: "llm"
    };
  }

  mapLocalToRouterOutput(local, message) {
    const intent = local?.intent;
    if (intent === INTENTS.SMALLTALK) {
      return {
        intent_code: "system.smalltalk",
        handler_type: "chitchat",
        params: {},
        confidence: "medium",
        reasoning: "本地兜底命中 smalltalk。",
        source: "local"
      };
    }
    if (intent === INTENTS.DATA_QUERY) {
      // PoC 范围：dealer 关键词 → dealer.query.inventory；其他 DATA_QUERY → general
      if (/(经销商|门店|库存|库龄|在途|配额|VIN|整车|车辆|汉EV|汉|宋L|海豹|秦PLUS|腾势|元PLUS|展车|试驾)/i.test(message)) {
        return {
          intent_code: "dealer.query.inventory",
          handler_type: "intent_query",
          params: {
            vehicle_model: extractVehicleHint(message),
            store: extractStoreHint(message),
            time_range: extractTimeRangeHint(message),
            warning_level: extractWarningLevelHint(message)
          },
          confidence: "medium",
          reasoning: "本地兜底命中 dealer 关键词。",
          source: "local"
        };
      }
    }
    return {
      intent_code: "general",
      handler_type: "agentic",
      params: {},
      confidence: "low",
      reasoning: `本地兜底未识别为 PoC 范围内的 intent (${intent ?? "?"})，走 agentic。`,
      source: "local"
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

function extractVehicleHint(message) {
  // 极简启发式，仅在本地兜底时使用，不影响 LLM 主路径
  const candidates = ["汉EV", "宋L DM-i", "宋L Plus", "宋L", "海豹", "秦PLUS", "腾势N7", "元PLUS"];
  for (const candidate of candidates) {
    if (message.includes(candidate)) return candidate;
  }
  return null;
}

function extractStoreHint(message) {
  const match = message.match(/(华东旗舰店|华南标准店|华北旗舰店|华西旗舰店)/);
  return match ? match[1] : null;
}

function extractTimeRangeHint(message) {
  const match = message.match(/(近一个月|近三个月|最近一个月|最近三个月|本月|上月|Q[1-4])/);
  return match ? match[1] : null;
}

function extractWarningLevelHint(message) {
  const match = message.match(/(关注|预警|紧急)/);
  return match ? match[1] : null;
}
