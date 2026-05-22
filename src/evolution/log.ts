import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { safeJoinWorkspace, type WorkspaceContext } from "../runtime/workspace-context.js";
import type { EvolutionResult, EvolutionTurnInput } from "./types.js";

export async function appendEvolutionLog(workspace: WorkspaceContext, event: {
  sessionId: string;
  trigger: EvolutionTurnInput["trigger"];
  result: EvolutionResult;
}): Promise<void> {
  const evolutionDir = safeJoinWorkspace(workspace.root, ".evolution");
  await mkdir(evolutionDir, { recursive: true });
  await appendFile(
    path.join(evolutionDir, "evolution-log.jsonl"),
    `${JSON.stringify({
      at: new Date().toISOString(),
      session_id: event.sessionId,
      trigger: event.trigger,
      result: event.result
    })}\n`,
    "utf8"
  );
}
