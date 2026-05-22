import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { safeJoinWorkspace, type WorkspaceContext } from "../runtime/workspace-context.js";
import type { JsonObject } from "../types/agent-contracts.js";
import type { EvolutionResult, EvolutionTurnInput } from "./types.js";

export class EpisodeStore {
  async append(input: EvolutionTurnInput, result: EvolutionResult): Promise<void> {
    await mkdir(input.workspace.memory_dir, { recursive: true });
    await appendFile(this.filePath(input.workspace), `${JSON.stringify({
      id: `episode_${Date.now()}`,
      at: new Date().toISOString(),
      session_id: input.sessionId,
      trigger: input.trigger,
      user_message: input.message,
      assistant_answer_preview: input.answer.slice(0, 1200),
      turn_count: input.sessionTrace?.turns.length ?? 1,
      route: input.route ?? null,
      result_status: result.status,
      result_reason: result.reason,
      applied: result.applied ?? null
    })}\n`, "utf8");
  }

  async recent(workspace: WorkspaceContext, limit = 20): Promise<JsonObject[]> {
    const file = this.filePath(workspace);
    if (!existsSync(file)) return [];
    const lines = (await readFile(file, "utf8")).trim().split("\n").filter(Boolean);
    return lines.slice(-limit).map((line) => {
      try {
        return JSON.parse(line) as JsonObject;
      } catch {
        return { invalid: true, raw: line.slice(0, 200) };
      }
    });
  }

  async compact(workspace: WorkspaceContext, keep = 200): Promise<number> {
    const file = this.filePath(workspace);
    if (!existsSync(file)) return 0;
    const lines = (await readFile(file, "utf8")).trim().split("\n").filter(Boolean);
    if (lines.length <= keep) return 0;
    await writeFile(file, `${lines.slice(-keep).join("\n")}\n`, "utf8");
    return lines.length - keep;
  }

  filePath(workspace: WorkspaceContext): string {
    return safeJoinWorkspace(workspace.root, "memory", "episodes.jsonl");
  }
}
