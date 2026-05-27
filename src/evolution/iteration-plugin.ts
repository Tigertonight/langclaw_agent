import type { RuntimePlugin } from "../runtime/hooks.js";
import { resolveUserWorkspace } from "../runtime/workspace-context.js";
import { EvolutionIterationLoop } from "./iteration-loop.js";

export function createEvolutionIterationPlugin({ loop = new EvolutionIterationLoop() }: { loop?: EvolutionIterationLoop } = {}): RuntimePlugin {
  return {
    name: "evolution-iteration-loop",
    register(hooks) {
      hooks.on("evolution_applied", async (event) => {
        const userId = typeof event.user_id === "string" ? event.user_id : "";
        if (!userId || event.status !== "applied") return;
        const decision = event.decision && typeof event.decision === "object" && !Array.isArray(event.decision)
          ? event.decision as { skill_actions?: unknown }
          : {};
        const actions = Array.isArray(decision.skill_actions) ? decision.skill_actions : [];
        for (const action of actions) {
          const record = action && typeof action === "object" && !Array.isArray(action) ? action as Record<string, unknown> : {};
          const skillId = typeof record.skill_id === "string" ? record.skill_id : "";
          const value = typeof record.value === "string" ? record.value : "";
          if (!skillId || !value) continue;
          await loop.propose(resolveUserWorkspace(userId), {
            targetType: "skill",
            targetId: skillId,
            goal: `Turn learned a durable skill preference: ${value.slice(0, 500)}`,
            evidence: { source: "evolution_applied", session_id: event.session_id, action: record }
          });
        }
      });
    }
  };
}
