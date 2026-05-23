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
 */
export interface PromptAuthorityAlertOptions {
  transcriptStore?: TranscriptStore;
  onAlert?: (alert: PromptAuthorityAlert) => Promise<void> | void;
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
        const alert: PromptAuthorityAlert = {
          user_id: userId,
          session_id: sessionId,
          run_id: typeof event.run_id === "string" ? event.run_id : undefined,
          prompt_authority: "preassembly_may_overflow",
          used_chars: Number(budget.used_chars ?? 0),
          max_chars: Number(budget.max_chars ?? 0),
          pre_trim_chars: Number(budget.pre_trim_chars ?? 0),
          dropped_count: dropped.length,
          dropped_sections: droppedSections
        };
        console.warn(`[prompt-authority-alert] user=${userId} session=${sessionId} dropped=${dropped.length} sections=${droppedSections.join(",")} pre_trim=${alert.pre_trim_chars} max=${alert.max_chars}`);
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
