import { TranscriptStore } from "../transcript/transcript-store.js";
import type { JsonObject, ToolResult } from "../types/agent-contracts.js";
import type { RuntimePlugin } from "./hooks.js";
import { resolveUserWorkspace } from "./workspace-context.js";

export function createTranscriptPlugin({ transcriptStore = new TranscriptStore() }: { transcriptStore?: TranscriptStore } = {}): RuntimePlugin {
  return {
    name: "transcript-store",
    register(hooks) {
      hooks.on("turn_start", async (event) => {
        const userId = typeof event.user_id === "string" ? event.user_id : "";
        const sessionId = typeof event.session_id === "string" ? event.session_id : "";
        if (!userId || !sessionId) return;
        await transcriptStore.append(resolveUserWorkspace(userId), sessionId, "turn_start", {
          run_id: typeof event.run_id === "string" ? event.run_id : undefined,
          message_preview: String(event.message ?? "").slice(0, 300)
        });
      });
      hooks.on("context_ingest", async (event) => {
        const userId = typeof event.user_id === "string" ? event.user_id : "";
        const sessionId = typeof event.session_id === "string" ? event.session_id : "";
        if (!userId || !sessionId) return;
        await transcriptStore.append(resolveUserWorkspace(userId), sessionId, "context_ingest", {
          run_id: typeof event.run_id === "string" ? event.run_id : undefined,
          stage: typeof event.stage === "string" ? event.stage : "ingest",
          sources: event.sources && typeof event.sources === "object" && !Array.isArray(event.sources) ? event.sources as JsonObject : {}
        });
      });
      hooks.on("context_assembly", async (event) => {
        const userId = typeof event.user_id === "string" ? event.user_id : "";
        const sessionId = typeof event.session_id === "string" ? event.session_id : "";
        if (!userId || !sessionId) return;
        await transcriptStore.append(resolveUserWorkspace(userId), sessionId, "context_assembly", {
          run_id: typeof event.run_id === "string" ? event.run_id : undefined,
          budget: event.budget && typeof event.budget === "object" && !Array.isArray(event.budget) ? event.budget as JsonObject : {},
          sections: Array.isArray(event.sections) ? event.sections as never : [],
          dropped: Array.isArray(event.dropped) ? event.dropped as never : []
        });
      });
      hooks.on("route_decision", async (event) => {
        const userId = typeof event.user_id === "string" ? event.user_id : "";
        const sessionId = typeof event.session_id === "string" ? event.session_id : "";
        if (!userId || !sessionId) return;
        await transcriptStore.append(resolveUserWorkspace(userId), sessionId, "route_decision", {
          run_id: typeof event.run_id === "string" ? event.run_id : undefined,
          message: String(event.message ?? ""),
          route: event.route && typeof event.route === "object" && !Array.isArray(event.route) ? event.route as JsonObject : {}
        });
      });
      hooks.on("tool_result", async (event) => {
        const userId = typeof event.user_id === "string" ? event.user_id : "";
        const sessionId = typeof event.session_id === "string" ? event.session_id : "";
        if (!userId || !sessionId) return;
        await transcriptStore.append(resolveUserWorkspace(userId), sessionId, "tool_governance", {
          run_id: typeof event.run_id === "string" ? event.run_id : undefined,
          tool: String(event.tool ?? ""),
          decision: String(event.decision ?? ""),
          code: typeof event.code === "string" ? event.code : undefined,
          message: typeof event.message === "string" ? event.message : undefined,
          risk_level: typeof event.risk_level === "string" ? event.risk_level : "read",
          requires_confirmation: event.requires_confirmation === true
        });
      });
      hooks.on("turn_end", async (event) => {
        const userId = typeof event.user_id === "string" ? event.user_id : "";
        const sessionId = typeof event.session_id === "string" ? event.session_id : "";
        if (!userId || !sessionId) return;
        await transcriptStore.appendTurn(resolveUserWorkspace(userId), sessionId, {
          runId: typeof event.run_id === "string" ? event.run_id : undefined,
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
