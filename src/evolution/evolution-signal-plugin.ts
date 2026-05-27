import type { EvolutionRuntime } from "./runtime.js";
import type { RuntimePlugin } from "../runtime/hooks.js";
import { resolveUserWorkspace } from "../runtime/workspace-context.js";
import type { JsonObject, ToolResult, UserContext } from "../types/agent-contracts.js";

export function createEvolutionSignalPlugin({ evolutionRuntime }: { evolutionRuntime: EvolutionRuntime }): RuntimePlugin {
  return {
    name: "evolution-signal",
    register(hooks) {
      hooks.on("turn_end", (event) => {
        const userId = typeof event.user_id === "string" ? event.user_id : "";
        const sessionId = typeof event.session_id === "string" ? event.session_id : "";
        if (!userId || !sessionId) return;
        const user = readUser(event, userId);
        evolutionRuntime.collectTurn({
          trigger: "agent_finish",
          user,
          workspace: resolveUserWorkspace(user),
          sessionId,
          message: String(event.message ?? ""),
          answer: String(event.answer ?? ""),
          route: event.route && typeof event.route === "object" ? event.route as JsonObject : {},
          toolPlan: { calls: Array.isArray(event.tool_calls) ? event.tool_calls as never : [] },
          toolResults: Array.isArray(event.tool_results) ? event.tool_results as ToolResult[] : [],
          enterpriseContext: event.enterprise_context,
          conversationContext: event.conversation_context,
          agentSteps: Array.isArray(event.agent_steps) ? event.agent_steps as Array<Record<string, unknown>> : []
        });
      });
    }
  };
}

function readUser(event: JsonObject, fallbackId: string): UserContext {
  const user = event.user && typeof event.user === "object" && !Array.isArray(event.user) ? event.user as Partial<UserContext> : {};
  return {
    ...user,
    id: typeof user.id === "string" ? user.id : fallbackId,
    role: typeof user.role === "string" ? user.role : "user"
  };
}
