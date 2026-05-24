import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { safeJoinWorkspace, type WorkspaceContext } from "../runtime/workspace-context.js";
import type { JsonObject } from "../types/agent-contracts.js";
import { EpisodeStore } from "./episode-store.js";
import { MemoryLearner } from "./memory-learner.js";
import { TaskStore, summarizeTask } from "../tasks/task-store.js";
import { ConflictStore } from "../memory/conflict-store.js";

export async function inspectEvolution(workspace: WorkspaceContext, limit = 20): Promise<JsonObject> {
  const log = await readJsonl(logPath(workspace), limit);
  const disabled = await readJson(disabledPath(workspace));
  const disabledTargets = new Set((Array.isArray(disabled?.items) ? disabled.items as JsonObject[] : []).map((item) => String(item.target ?? "")));
  const memory = await new MemoryLearner().load(workspace);
  const episodes = await new EpisodeStore().recent(workspace, limit);
  const tasks = (await new TaskStore().list(workspace)).slice(0, limit).map(summarizeTask);
  const skills = await listEvolutionSkills(workspace, disabledTargets);
  const conflicts = await new ConflictStore().list(workspace);
  const compaction = await readIfExists(safeJoinWorkspace(workspace.root, "memory", "compaction.md"), 6000);
  return {
    summary: {
      log_entries: log.length,
      memory_items: memory.items.length,
      episodes: episodes.length,
      tasks: tasks.length,
      skill_overrides: skills.length,
      conflicts: conflicts.length,
      disabled_targets: disabledTargets.size
    },
    memory: {
      items: memory.items
        .filter((item) => !isDisabled(disabledTargets, "memory", item.key))
        .map((item) => ({ ...item, disabled: false })),
      disabled: memory.items.filter((item) => isDisabled(disabledTargets, "memory", item.key)).map((item) => item.key)
    },
    episodes,
    tasks: {
      items: tasks.filter((task) => !isDisabled(disabledTargets, "task", String(task.id ?? ""))),
      disabled: tasks.filter((task) => isDisabled(disabledTargets, "task", String(task.id ?? ""))).map((task) => task.id)
    },
    skills,
    conflicts,
    compaction,
    log,
    disabled: Array.isArray(disabled?.items) ? disabled.items : []
  };
}

export async function loadDisabledEvolutionTargets(workspace: WorkspaceContext): Promise<Set<string>> {
  const disabled = await readJson(disabledPath(workspace));
  const items = Array.isArray(disabled?.items) ? disabled.items as JsonObject[] : [];
  return new Set(items.map((item) => String(item.target ?? "")).filter(Boolean));
}

export async function rollbackEvolution(workspace: WorkspaceContext, input: { target: string; reason?: string }): Promise<JsonObject> {
  const current = await readJson(disabledPath(workspace));
  const items = Array.isArray(current?.items) ? current.items as JsonObject[] : [];
  const entry = {
    target: input.target,
    reason: input.reason ?? "manual_rollback",
    disabled_at: new Date().toISOString()
  };
  await mkdir(safeJoinWorkspace(workspace.root, ".evolution"), { recursive: true });
  await writeFile(disabledPath(workspace), JSON.stringify({ updated_at: new Date().toISOString(), items: [...items, entry] }, null, 2), "utf8");
  return entry;
}

export async function restoreEvolution(workspace: WorkspaceContext, input: { target: string; reason?: string }): Promise<JsonObject> {
  const current = await readJson(disabledPath(workspace));
  const items = Array.isArray(current?.items) ? current.items as JsonObject[] : [];
  const nextItems = items.filter((item) => String(item.target ?? "") !== input.target);
  await mkdir(safeJoinWorkspace(workspace.root, ".evolution"), { recursive: true });
  await writeFile(disabledPath(workspace), JSON.stringify({
    updated_at: new Date().toISOString(),
    restored: {
      target: input.target,
      reason: input.reason ?? "manual_restore",
      restored_at: new Date().toISOString()
    },
    items: nextItems
  }, null, 2), "utf8");
  return { target: input.target, restored: items.length !== nextItems.length, reason: input.reason ?? "manual_restore" };
}

/**
 * Phase 6: diffEvolutionSkill —— 读取某个 skill 的 patch.md 或原 SKILL.md + override 对比。
 * 返回 { skill_id, original, override, patch_report, candidate } 供 evolution.diff 工具展示。
 */
export async function diffEvolutionSkill(workspace: WorkspaceContext, skillId: string): Promise<JsonObject> {
  const safeId = skillId.replace(/[^A-Za-z0-9_.\-:/]/g, "_").slice(0, 120);
  const skillsRoot = safeJoinWorkspace(workspace.root, ".evolution", "skills");
  const dir = path.join(skillsRoot, safeId);

  // 原始 SKILL.md（来自项目 skills/ 目录）
  const projectSkillFile = path.join(process.cwd(), "skills", safeId, "SKILL.md");
  const original = await readIfExists(projectSkillFile, 8000);

  // override（已应用的）
  const overrideFile = path.join(dir, "SKILL.md");
  const override = await readIfExists(overrideFile, 8000);

  // candidate（待审批）
  const candidateFile = path.join(dir, "candidate.SKILL.md");
  const candidate = await readIfExists(candidateFile, 8000);

  // patch 报告
  const patchFile = path.join(dir, "patch.md");
  const patchReport = await readIfExists(patchFile, 6000);

  // approval 元数据
  const approvalFile = path.join(dir, "approval.json");
  const approvalMeta = await readJson(approvalFile);

  const hasDiff = !!(override || candidate);
  return {
    skill_id: safeId,
    has_diff: hasDiff,
    original: original || "(原始 SKILL.md 未找到)",
    override: override || null,
    candidate: candidate || null,
    patch_report: patchReport || null,
    approval: approvalMeta
  };
}

async function readJsonl(file: string, limit: number): Promise<JsonObject[]> {
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

async function readJson(file: string): Promise<JsonObject | null> {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(await readFile(file, "utf8")) as JsonObject;
  } catch {
    return null;
  }
}

function logPath(workspace: WorkspaceContext): string {
  return safeJoinWorkspace(workspace.root, ".evolution", "evolution-log.jsonl");
}

function disabledPath(workspace: WorkspaceContext): string {
  return path.join(safeJoinWorkspace(workspace.root, ".evolution"), "disabled.json");
}

async function listEvolutionSkills(workspace: WorkspaceContext, disabled: Set<string>): Promise<JsonObject[]> {
  const root = safeJoinWorkspace(workspace.root, ".evolution", "skills");
  if (!existsSync(root)) return [];
  const out: JsonObject[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillId = entry.name;
    const skillFile = path.join(root, skillId, "SKILL.md");
    const preferencesFile = path.join(root, skillId, "evolution_preferences.md");
    out.push({
      id: skillId,
      disabled: isDisabled(disabled, "skill", skillId) || disabled.has(`.evolution/skills/${skillId}/SKILL.md`),
      has_override: existsSync(skillFile),
      has_preferences: existsSync(preferencesFile),
      override_preview: await readIfExists(skillFile, 800),
      preferences_preview: await readIfExists(preferencesFile, 800)
    });
  }
  return out;
}

function isDisabled(disabled: Set<string>, kind: string, id: string): boolean {
  return disabled.has(id) || disabled.has(`${kind}:${id}`);
}

async function readIfExists(file: string, max: number): Promise<string> {
  if (!existsSync(file)) return "";
  return (await readFile(file, "utf8")).slice(0, max);
}
