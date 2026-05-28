/**
 * Trace Source
 *
 * 输入是若干条会话片段（user_message + assistant_answer），
 * 输出是模型从中归纳出的实体类型 / 谓词候选。
 *
 * Curator 调用方负责把素材准备好（episodes.jsonl 切片、对话日志、工单等），
 * 这一路只关心：「给我一段对话，请你列出值得入库的实体类型和动作」。
 *
 * LLM 不可用（无 API key 或调用失败）时，降级为基于词频的极简兜底：
 * 只把高频名词短语过一遍粗筛，输出 frequency 但不做归一。
 */

import type { CandidateBatch, CandidateTerm } from "../types.js";

export interface TraceSnippet {
  user_message: string;
  assistant_answer?: string;
  /** 自由标签，便于人工审核时回溯。 */
  tag?: string;
}

export interface TraceSourceOptions {
  /** 每批最多送给 LLM 的 snippet 数。超出会切多 batch 并发跑。 */
  batchSize?: number;
  /** LLM 调用器：注入便于 stub。返回 JSON 字符串即可。 */
  llm?: TraceLlmCaller;
}

export type TraceLlmCaller = (prompt: TracePromptPayload) => Promise<string>;

export interface TracePromptPayload {
  system: string;
  snippets: TraceSnippet[];
}

const SYSTEM_PROMPT = [
  "你在帮一个企业 agent 抽取业务词表。我会给你一组真实会话片段。",
  "请你从中归纳：",
  "  1. 反复出现的业务实体类型（名词，建议英文 snake_case，例如 customer / product / order）。",
  "  2. 反复出现的实体间动作或关系（动词，建议英文 snake_case，例如 ordered / prefers / complained_about）。",
  "  3. 反复出现的强属性键（用于唯一识别实体的字段，例如 phone / email / id_card）。",
  "",
  "硬规则：",
  "- 只输出真正在 snippet 中出现过的概念，不要凭空发挥。",
  "- 同义词请折叠到同一个 canonical（aliases 列出原文出现形式）。",
  "- frequency 给一个粗略的出现次数即可。",
  "- 输出严格符合下方 JSON schema，不要任何额外文本。",
  "",
  "输出形态：",
  JSON.stringify({
    entity_types: [{ canonical: "customer", aliases: ["客户", "买家"], frequency: 5, example: "原文片段" }],
    predicates: [{ canonical: "ordered", aliases: ["买了", "下单"], frequency: 3, example: "原文片段" }],
    strong_attribute_keys: [{ canonical: "phone", aliases: ["手机号"], frequency: 2, example: "原文片段" }]
  }, null, 2)
].join("\n");

/** LLM 返回的形态。Curator 内部 schema，不对外暴露。 */
interface TraceLlmResponse {
  entity_types?: Array<{ canonical: string; aliases?: string[]; frequency?: number; example?: string }>;
  predicates?: Array<{ canonical: string; aliases?: string[]; frequency?: number; example?: string }>;
  strong_attribute_keys?: Array<{ canonical: string; aliases?: string[]; frequency?: number; example?: string }>;
}

export async function collectFromTrace(
  snippets: TraceSnippet[],
  options: TraceSourceOptions = {}
): Promise<CandidateBatch> {
  const warnings: string[] = [];
  const candidates: CandidateTerm[] = [];

  if (!snippets.length) {
    return { source: "trace", candidates, warnings: ["trace_no_snippets"] };
  }

  const llm = options.llm ?? defaultTraceLlm();
  if (!llm) {
    warnings.push("trace_llm_unavailable_fallback_to_frequency");
    return { source: "trace", candidates: frequencyFallback(snippets), warnings };
  }

  const batchSize = options.batchSize ?? 30;
  for (let i = 0; i < snippets.length; i += batchSize) {
    const batch = snippets.slice(i, i + batchSize);
    let raw: string;
    try {
      raw = await llm({ system: SYSTEM_PROMPT, snippets: batch });
    } catch (err) {
      warnings.push(`trace_llm_call_failed:${err instanceof Error ? err.message : "unknown"}`);
      continue;
    }
    let parsed: TraceLlmResponse;
    try {
      parsed = JSON.parse(raw) as TraceLlmResponse;
    } catch (err) {
      warnings.push(`trace_llm_json_parse_failed:${err instanceof Error ? err.message : "unknown"}`);
      continue;
    }
    appendKind(candidates, "entity_type", parsed.entity_types);
    appendKind(candidates, "predicate", parsed.predicates);
    appendKind(candidates, "strong_attribute_key", parsed.strong_attribute_keys);
  }

  return { source: "trace", candidates, warnings };
}

function appendKind(
  out: CandidateTerm[],
  kind: CandidateTerm["kind"],
  items: Array<{ canonical: string; aliases?: string[]; frequency?: number; example?: string }> | undefined
): void {
  if (!items) return;
  for (const item of items) {
    if (typeof item.canonical !== "string" || !item.canonical.trim()) continue;
    out.push({
      kind,
      canonical: item.canonical.trim().toLowerCase(),
      aliases: item.aliases?.map((a) => a.trim()).filter(Boolean),
      examples: item.example ? [item.example.slice(0, 300)] : undefined,
      source: "trace",
      weight: typeof item.frequency === "number" ? item.frequency : 1
    });
  }
}

/**
 * LLM 不可用时的降级：基于 snippet 文本里的简单 token 统计，
 * 输出最常见的几个 ASCII 词作为 entity_type 候选。
 * 不归一同义词，仅保证 curator 能跑通流水线。
 */
function frequencyFallback(snippets: TraceSnippet[]): CandidateTerm[] {
  const freq = new Map<string, number>();
  for (const s of snippets) {
    const text = `${s.user_message} ${s.assistant_answer ?? ""}`;
    const tokens = text.toLowerCase().match(/[a-z][a-z0-9_]{2,}/g) ?? [];
    for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  return Array.from(freq.entries())
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([token, n]) => ({
      kind: "entity_type" as const,
      canonical: token,
      source: "trace" as const,
      weight: n
    }));
}

/**
 * 默认 LLM 调用器。沿用 evolution judge 的环境变量，无 key 时返回 null
 * 让 collectFromTrace 走频次兜底。
 */
function defaultTraceLlm(): TraceLlmCaller | null {
  const apiKey = process.env.EVOLUTION_LLM_API_KEY
    ?? process.env.LLM_DECISION_API_KEY
    ?? process.env.LLM_API_KEY
    ?? process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const baseUrl = (process.env.EVOLUTION_LLM_BASE_URL
    ?? process.env.LLM_DECISION_BASE_URL
    ?? process.env.LLM_BASE_URL
    ?? process.env.OPENAI_BASE_URL
    ?? "https://api.minimaxi.com/v1").replace(/\/$/, "");
  const model = process.env.EVOLUTION_LLM_MODEL
    ?? process.env.LLM_DECISION_MODEL
    ?? process.env.LLM_MODEL
    ?? process.env.OPENAI_MODEL
    ?? "MiniMax-M2.7";
  const timeoutMs = Number(process.env.EVOLUTION_LLM_TIMEOUT_MS) > 0
    ? Number(process.env.EVOLUTION_LLM_TIMEOUT_MS)
    : 30000;

  return async ({ system, snippets }) => {
    const userContent = JSON.stringify({ snippets }, null, 2);
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userContent }
        ],
        temperature: 0,
        stream: false,
        response_format: { type: "json_object" }
      })
    });
    if (!response.ok) throw new Error(`http_${response.status}`);
    const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error("empty_content");
    return content;
  };
}
