import { TranscriptStore } from "../transcript/transcript-store.js";
import type { JsonObject, ToolResult } from "../types/agent-contracts.js";
import type { RuntimePlugin } from "./hooks.js";
import { resolveUserWorkspace } from "./workspace-context.js";

export function createTranscriptPlugin({ transcriptStore = new TranscriptStore() }: { transcriptStore?: TranscriptStore } = {}): RuntimePlugin {
  return {
    name: "transcript-store",
    register(hooks) {
      hooks.on("turn_end", async (event) => {
        const userId = typeof event.user_id === "string" ? event.user_id : "";
        const sessionId = typeof event.session_id === "string" ? event.session_id : "";
        if (!userId || !sessionId) return;
        await transcriptStore.appendTurn(resolveUserWorkspace(userId), sessionId, {
          message: String(event.message ?? ""),
          answer: String(event.answer ?? ""),
          route: event.route && typeof event.route === "object" ? event.route as JsonObject : {},
          toolCalls: Array.isArray(event.tool_calls) ? event.tool_calls as never : [],
          toolResults: Array.isArray(event.tool_results) ? event.tool_results as ToolResult[] : [],
          agentSteps: Array.isArray(event.agent_steps) ? event.agent_steps as Array<Record<string, unknown>> : []
        });
      });
    }
  };
}
