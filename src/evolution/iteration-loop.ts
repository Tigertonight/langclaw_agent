import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { resolveProjectPath } from "../data/load-json.js";
import { safeJoinWorkspace, safeUserId, type WorkspaceContext } from "../runtime/workspace-context.js";
import type { JsonObject } from "../types/agent-contracts.js";
import { rollbackEvolution } from "./governance.js";
import { SkillPatchSubagent, selectSkillPatchTests } from "./skill-patch-subagent.js";

const execFileAsync = promisify(execFile);

export type EvolutionIterationStatus =
  | "proposed"
  | "patch_generated"
  | "approved"
  | "applied"
  | "observing"
  | "accepted"
  | "rolled_back"
  | "failed";

export interface EvolutionIteration extends JsonObject {
  id: string;
  target_type: "skill" | "memory" | "task" | "runtime";
  target_id: string;
  goal: string;
  status: EvolutionIterationStatus;
  evidence?: JsonObject;
  created_at: string;
  updated_at: string;
  patch_path?: string;
  test_commands?: string[];
  test_results?: JsonObject[];
  approval_recommendation?: "approve" | "needs_review" | "reject";
  applied_at?: string;
  observed_at?: string;
  outcome?: string;
  rollback_reason?: string;
  error?: string;
}

interface EvolutionIterationState {
  version: 1;
  updated_at: string;
  iterations: EvolutionIteration[];
}

export class EvolutionIterationLoop {
  private readonly patchSubagent: SkillPatchSubagent;

  constructor({ patchSubagent = new SkillPatchSubagent() }: { patchSubagent?: SkillPatchSubagent } = {}) {
    this.patchSubagent = patchSubagent;
  }

  async list(workspace: WorkspaceContext, status?: string): Promise<EvolutionIteration[]> {
    const state = await this.readState(workspace);
    return state.iterations
      .filter((item) => !status || item.status === status)
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  }

  async propose(workspace: WorkspaceContext, input: { targetType: EvolutionIteration["target_type"]; targetId: string; goal: string; evidence?: unknown }): Promise<EvolutionIteration> {
    const state = await this.readState(workspace);
    const now = new Date().toISOString();
    const item: EvolutionIteration = {
      id: `iter_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      target_type: input.targetType,
      target_id: safeUserId(input.targetId),
      goal: input.goal.trim(),
      status: "proposed",
      evidence: sanitizeEvidence(input.evidence),
      created_at: now,
      updated_at: now
    };
    state.iterations.push(item);
    await this.writeState(workspace, state);
    return item;
  }

  async dryRunPatch(workspace: WorkspaceContext, id: string): Promise<EvolutionIteration> {
    const state = await this.readState(workspace);
    const item = findIteration(state, id);
    if (!item) throw new Error("iteration_not_found");
    if (item.target_type !== "skill") throw new Error("dry_run_patch_only_supports_skill");
    const result = await this.patchSubagent.generate({
      workspace,
      skillId: item.target_id,
      goal: item.goal,
      evidence: item.evidence,
      dryRun: true
    });
    item.updated_at = new Date().toISOString();
    if (result.ok === true) {
      item.status = "patch_generated";
      item.patch_path = typeof result.patch_path === "string" ? result.patch_path : undefined;
      item.test_commands = Array.isArray(result.test_commands) ? result.test_commands.map(String) : selectSkillPatchTests(item.target_id);
      item.approval_recommendation = "needs_review";
    } else {
      item.status = "failed";
      item.error = String(result.error ?? "patch_generation_failed");
    }
    await this.writeState(workspace, state);
    return item;
  }

  async runTests(workspace: WorkspaceContext, id: string): Promise<EvolutionIteration> {
    const state = await this.readState(workspace);
    const item = findIteration(state, id);
    if (!item) throw new Error("iteration_not_found");
    const commands = item.test_commands?.length ? item.test_commands : item.target_type === "skill" ? selectSkillPatchTests(item.target_id) : ["npm run typecheck"];
    const results: JsonObject[] = [];
    for (const command of commands) {
      results.push(await runAllowedTest(command));
    }
    item.test_commands = commands;
    item.test_results = results;
    item.approval_recommendation = results.every((result) => result.ok === true) ? "approve" : "needs_review";
    item.updated_at = new Date().toISOString();
    await this.writeState(workspace, state);
    return item;
  }

  async approveAndApply(workspace: WorkspaceContext, id: string, approvedBy?: string): Promise<EvolutionIteration> {
    const state = await this.readState(workspace);
    const item = findIteration(state, id);
    if (!item) throw new Error("iteration_not_found");
    if (item.target_type !== "skill") throw new Error("approve_apply_only_supports_skill");
    const approval = await this.patchSubagent.approve({ workspace, skillId: item.target_id, approvedBy });
    if (approval.ok !== true) {
      item.status = "failed";
      item.error = String(approval.error ?? "patch_approval_failed");
      item.updated_at = new Date().toISOString();
      await this.writeState(workspace, state);
      return item;
    }
    item.status = "approved";
    const applied = await this.patchSubagent.apply({ workspace, skillId: item.target_id, approvedBy });
    item.updated_at = new Date().toISOString();
    if (applied.ok === true) {
      item.status = "applied";
      item.applied_at = item.updated_at;
    } else {
      item.status = "failed";
      item.error = String(applied.error ?? "patch_apply_failed");
    }
    await this.writeState(workspace, state);
    return item;
  }

  async observe(workspace: WorkspaceContext, id: string, outcome: string, accepted = false): Promise<EvolutionIteration> {
    const state = await this.readState(workspace);
    const item = findIteration(state, id);
    if (!item) throw new Error("iteration_not_found");
    item.status = accepted ? "accepted" : "observing";
    item.outcome = outcome;
    item.observed_at = new Date().toISOString();
    item.updated_at = item.observed_at;
    await this.writeState(workspace, state);
    return item;
  }

  async rollback(workspace: WorkspaceContext, id: string, reason?: string): Promise<EvolutionIteration> {
    const state = await this.readState(workspace);
    const item = findIteration(state, id);
    if (!item) throw new Error("iteration_not_found");
    await rollbackEvolution(workspace, { target: `skill:${item.target_id}`, reason: reason ?? "evolution_iteration_rollback" });
    item.status = "rolled_back";
    item.rollback_reason = reason ?? "evolution_iteration_rollback";
    item.updated_at = new Date().toISOString();
    await this.writeState(workspace, state);
    return item;
  }

  private async readState(workspace: WorkspaceContext): Promise<EvolutionIterationState> {
    const file = statePath(workspace);
    if (!existsSync(file)) return { version: 1, updated_at: new Date(0).toISOString(), iterations: [] };
    try {
      const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<EvolutionIterationState>;
      return {
        version: 1,
        updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : new Date(0).toISOString(),
        iterations: Array.isArray(parsed.iterations) ? parsed.iterations.filter(isIteration) : []
      };
    } catch {
      return { version: 1, updated_at: new Date(0).toISOString(), iterations: [] };
    }
  }

  private async writeState(workspace: WorkspaceContext, state: EvolutionIterationState): Promise<void> {
    state.updated_at = new Date().toISOString();
    const file = statePath(workspace);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(state, null, 2), "utf8");
  }
}

function findIteration(state: EvolutionIterationState, id: string): EvolutionIteration | null {
  return state.iterations.find((item) => item.id === id) ?? null;
}

function statePath(workspace: WorkspaceContext): string {
  return safeJoinWorkspace(workspace.root, ".evolution", "iterations.json");
}

function isIteration(value: unknown): value is EvolutionIteration {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && typeof (value as { id?: unknown }).id === "string"
    && typeof (value as { target_id?: unknown }).target_id === "string";
}

function sanitizeEvidence(value: unknown): JsonObject {
  if (!value) return {};
  try {
    return JSON.parse(JSON.stringify(value).slice(0, 10000)) as JsonObject;
  } catch {
    return { value: String(value).slice(0, 10000) };
  }
}

async function runAllowedTest(command: string): Promise<JsonObject> {
  const allowed = new Set([
    "npm run typecheck",
    "npm run memory:evolution-stack",
    "npm run task:smoke",
    "npm run evolution:smoke",
    "npm run skill:curator",
    "npm run hook:evolution-loop"
  ]);
  if (!allowed.has(command)) {
    return { ok: false, command, error: "test_command_not_allowed" };
  }
  const npm = existsSync("/opt/homebrew/bin/npm") ? "/opt/homebrew/bin/npm" : "npm";
  const script = command.replace(/^npm run\s+/, "");
  const startedAt = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(npm, ["run", script], {
      cwd: resolveProjectPath(),
      timeout: 120000,
      maxBuffer: 2 * 1024 * 1024
    });
    return {
      ok: true,
      command,
      latency_ms: Date.now() - startedAt,
      stdout_tail: stdout.slice(-2000),
      stderr_tail: stderr.slice(-2000)
    };
  } catch (error) {
    return {
      ok: false,
      command,
      latency_ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000)
    };
  }
}
