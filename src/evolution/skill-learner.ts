import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { safeJoinWorkspace, safeUserId, type WorkspaceContext } from "../runtime/workspace-context.js";
import type { SkillAction } from "./types.js";
import { loadDisabledEvolutionTargets } from "./governance.js";

export class SkillLearner {
  async apply({ workspace, actions }: { workspace: WorkspaceContext; actions?: SkillAction[] }): Promise<number> {
    const normalized = Array.isArray(actions) ? actions : [];
    if (!normalized.length) return 0;
    const disabled = await loadDisabledEvolutionTargets(workspace);
    let changed = 0;
    const generalPreferences: string[] = [];
    for (const action of normalized) {
      const skillId = safeUserId(action.skill_id ?? "general");
      if (disabled.has(skillId) || disabled.has(`skill:${skillId}`)) continue;
      if (!action.skill_id || action.skill_id === "general") {
        generalPreferences.push(action.value.trim());
      }
      const dir = safeJoinWorkspace(workspace.root, ".evolution", "skills", skillId);
      await mkdir(dir, { recursive: true });
      await appendFile(
        path.join(dir, "evolution_preferences.md"),
        `\n- ${new Date().toISOString()} ${action.value.trim()}\n`,
        "utf8"
      );
      changed += 1;
    }
    if (generalPreferences.length) {
      const rootDir = safeJoinWorkspace(workspace.root, ".evolution");
      await mkdir(rootDir, { recursive: true });
      await appendFile(
        path.join(rootDir, "preferences.md"),
        generalPreferences.map((item) => `\n- ${new Date().toISOString()} ${item}\n`).join(""),
        "utf8"
      );
    }
    return changed;
  }
}
