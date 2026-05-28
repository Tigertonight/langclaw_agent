/**
 * EvolutionExtractor — Phase 2.5。
 *
 * 在 EvolutionJudge 决定 should_evolve 之后，按 EvolutionExtractionContract
 * 调一次结构化抽取，得到 ExtractionResult（memory_actions + entities + relations）。
 * 解析失败时返回 ok:false，runtime 回退到 Phase 1 的 plain memory_actions 路径。
 *
 * 与 judge 同款的可注入 LLM：测试可传 fakeLlm({contract, payload}) → string。
 * 生产用 EVOLUTION_LLM_API_KEY / OPENAI_API_KEY 走 OpenAI 兼容 endpoint。
 */

import { resolveExtractionContract } from "../engine/vocabulary/resolver.js";
import {
  buildExtractionSystemPrompt,
} from "./extraction-prompt.js";
import {
  parseExtractionResult,
  type ExtractionResult,
} from "./structured-output.js";
import type { EvolutionTurnInput } from "./types.js";

const DEFAULT_TIMEOUT_MS = 20000;

export type ExtractorLlm = (req: { system: string; user: string }) => Promise<string>;

export interface EvolutionExtractorOptions {
  /** 注入 LLM，主要给测试用。不传则按 env 解析 OpenAI 兼容 endpoint。 */
  llm?: ExtractorLlm;
  /** 注入 packId 推断器；默认从 input.route.intent_code 取 "<pack>." 前缀。 */
  packIdResolver?: (input: EvolutionTurnInput) => string | undefined;
}

export class EvolutionExtractor {
  constructor(private readonly options: EvolutionExtractorOptions = {}) {}

  async extract(input: EvolutionTurnInput): Promise<{ ok: true; data: ExtractionResult } | { ok: false; reason: string }> {
    const packId = this.options.packIdResolver?.(input) ?? defaultPackIdResolver(input);
    const contract = await resolveExtractionContract(packId);
    const system = buildExtractionSystemPrompt({ contract });
    const user = JSON.stringify(buildExtractionPayload(input));

    const llm = this.options.llm ?? defaultExtractorLlm();
    if (!llm) return { ok: false, reason: "extractor_unavailable:no_llm" };

    let raw: string;
    try {
      raw = await llm({ system, user });
    } catch (err) {
      return { ok: false, reason: `extractor_unavailable:${err instanceof Error ? err.message : "unknown"}` };
    }
    return parseExtractionResult(raw);
  }
}

/* ── pack id 推断 ─────────────────────────────────────────────────────────── */

function defaultPackIdResolver(input: EvolutionTurnInput): string | undefined {
  const route = input.route as { intent_code?: unknown } | undefined;
  const code = typeof route?.intent_code === "string" ? route.intent_code : "";
  if (!code.includes(".")) return undefined;
  return code.split(".")[0] || undefined;
}

/* ── payload ─────────────────────────────────────────────────────────────── */

function buildExtractionPayload(input: EvolutionTurnInput) {
  return {
    user: { id: input.user.id, role: input.user.role },
    session_id: input.sessionId,
    current_turn: {
      user_message: input.message,
      assistant_answer: input.answer,
      tool_calls: input.toolPlan?.calls ?? [],
      tool_results: (input.toolResults ?? []).slice(-12).map((r) => ({
        ok: r.ok,
        tool: r.tool,
        data_preview: JSON.stringify(r.data ?? null).slice(0, 800)
      }))
    },
    session_trace: {
      turns: input.sessionTrace?.turns?.slice(-8).map((t) => ({
        user_message: t.user_message,
        assistant_answer: t.assistant_answer
      })) ?? []
    }
  };
}

/* ── 默认 LLM（OpenAI 兼容） ───────────────────────────────────────────── */

function defaultExtractorLlm(): ExtractorLlm | undefined {
  const apiKey = process.env.EVOLUTION_LLM_API_KEY
    ?? process.env.LLM_DECISION_API_KEY
    ?? process.env.LLM_API_KEY
    ?? process.env.OPENAI_API_KEY;
  if (!apiKey) return undefined;

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
  const timeoutMs = readPositiveNumberEnv("EVOLUTION_LLM_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);

  return async ({ system, user }) => {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        temperature: 0,
        stream: false,
        response_format: { type: "json_object" }
      })
    });
    if (!response.ok) throw new Error(`http_${response.status}`);
    const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content ?? "";
    if (!content) throw new Error("empty_content");
    return content;
  };
}

function readPositiveNumberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
