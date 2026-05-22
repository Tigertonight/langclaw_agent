import { resolveUserWorkspace } from "../runtime/workspace-context.js";
import type { RuntimePlugin } from "../runtime/hooks.js";
import { SkillCurator } from "./skill-curator.js";

export function createSkillCuratorPlugin(): RuntimePlugin {
  const curator = new SkillCurator();
  return {
    name: "skill-curator",
    register(hooks) {
      hooks.on("turn_end", async (event) => {
        const userId = typeof event.user_id === "string" ? event.user_id : "";
        if (!userId) return;
        await curator.refresh(resolveUserWorkspace(userId));
      });
      hooks.on("evolution_applied", async (event) => {
        const userId = typeof event.user_id === "string" ? event.user_id : "";
        const skillId = typeof event.skill_id === "string" ? event.skill_id : "";
        if (!userId || !skillId) return;
        await curator.recordUsage(resolveUserWorkspace(userId), skillId, "patched");
      });
    }
  };
}
