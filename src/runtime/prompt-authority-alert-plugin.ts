import type { JsonObject } from "../types/agent-contracts.js";
import type { RuntimePlugin } from "./hooks.js";
import { resolveUserWorkspace } from "./workspace-context.js";
import { TranscriptStore } from "../transcript/transcript-store.js";

/**
 * 监听 context_assembly，发现 prompt_authority="preassembly_may_overflow"
 * （即提示在装配前已超预算、被 ContextAssembler 主动裁剪）时：
 *   1. console.warn，让运维/开发立即看到；
 *   2. 写一条 prompt_authority_alert 到 transcript，便于事后回溯；
 *   3. 可选 onAlert 回调，给上层接 sentry / 飞书机器人。
 *
 * 设计原则：纯监听、零反向依赖，不改动 assembler 行为。
 *
 * 阈值与去重：
 * - minDroppedCount: 丢弃 section 数 < 阈值时不告警（避免噪音，1-2 个 section
 *   被裁是正常的）。环境变量 PROMPT_AUTHORITY_MIN_DROPPED 覆盖，默认 3
 * - minOverflowRatio: pre_trim_chars / max_chars 必须 ≥ 该比例才告警。
 *   PROMPT_AUTHORITY_MIN_OVERFLOW_RATIO 覆盖，默认 1.05
 * - cooldownMs: 同一 (user,session) 在窗口内最多触发一次。
 *   PROMPT_AUTHORITY_COOLDOWN_MS 覆盖，默认 60000（1 分钟）
 */
export interface PromptAuthorityAlertOptions {
  transcriptStore?: TranscriptStore;
  onAlert?: (alert: PromptAuthorityAlert) => Promise<void> | void;
  minDroppedCount?: number;
  minOverflowRatio?: number;
  cooldownMs?: number;
  now?: () => number;
}

export interface PromptAuthorityAlert extends JsonObject {
  user_id: string;
  session_id: string;
  run_id?: string;
  prompt_authority: "preassembly_may_overflow";
  used_chars: number;
  max_chars: number;
  pre_trim_chars: number;
  dropped_count: number;
  dropped_sections: string[];
}

export function createPromptAuthorityAlertPlugin(options: PromptAuthorityAlertOptions = {}): RuntimePlugin {
  const transcriptStore = options.transcriptStore ?? new TranscriptStore();
  const minDroppedCount = options.minDroppedCount ?? readPositiveIntEnv("PROMPT_AUTHORITY_MIN_DROPPED", 3);
  const minOverflowRatio = options.minOverflowRatio ?? readPositiveNumberEnv("PROMPT_AUTHORITY_MIN_OVERFLOW_RATIO", 1.05);
  const cooldownMs = options.cooldownMs ?? readPositiveIntEnv("PROMPT_AUTHORITY_COOLDOWN_MS", 60_000);
  const now = options.now ?? (() => Date.now());
  const lastAlertAt = new Map<string, number>();
  return {
    name: "prompt-authority-alert",
    register(hooks) {
      hooks.on("context_assembly", async (event) => {
        if (event.prompt_authority !== "preassembly_may_overflow") return;
        const userId = typeof event.user_id === "string" ? event.user_id : "";
        const sessionId = typeof event.session_id === "string" ? event.session_id : "";
        if (!userId || !sessionId) return;
        const budget = event.budget && typeof event.budget === "object" && !Array.isArray(event.budget) ? event.budget as JsonObject : {};
        const dropped = Array.isArray(event.dropped) ? event.dropped as JsonObject[] : [];
        const droppedSections = Array.from(new Set(dropped.map((entry) => String(entry.section ?? "")).filter(Boolean)));
        const maxChars = Number(budget.max_chars ?? 0);
        const preTrimChars = Number(budget.pre_trim_chars ?? 0);
        const overflowRatio = maxChars > 0 ? preTrimChars / maxChars : 0;
        if (dropped.length < minDroppedCount && overflowRatio < minOverflowRatio) return;
        const key = `${userId}::${sessionId}`;
        const last = lastAlertAt.get(key);
        const ts = now();
        if (typeof last === "number" && ts - last < cooldownMs) return;
        lastAlertAt.set(key, ts);
        gcCooldown(lastAlertAt, ts, cooldownMs);
        const alert: PromptAuthorityAlert = {
          user_id: userId,
          session_id: sessionId,
          run_id: typeof event.run_id === "string" ? event.run_id : undefined,
          prompt_authority: "preassembly_may_overflow",
          used_chars: Number(budget.used_chars ?? 0),
          max_chars: maxChars,
          pre_trim_chars: preTrimChars,
          dropped_count: dropped.length,
          dropped_sections: droppedSections
        };
        console.warn(`[prompt-authority-alert] user=${userId} session=${sessionId} dropped=${dropped.length} sections=${droppedSections.join(",")} pre_trim=${preTrimChars} max=${maxChars} ratio=${overflowRatio.toFixed(2)}`);
        await transcriptStore.append(resolveUserWorkspace(userId), sessionId, "prompt_authority_alert", alert);
        if (options.onAlert) {
          try { await options.onAlert(alert); } catch (err) {
            console.warn(`[prompt-authority-alert] onAlert failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      });
    }
  };
}

function gcCooldown(map: Map<string, number>, now: number, cooldownMs: number): void {
  if (map.size < 256) return;
  for (const [key, ts] of map) {
    if (now - ts >= cooldownMs * 4) map.delete(key);
  }
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

function readPositiveNumberEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}
