import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveProjectPath } from "../data/load-json.js";
import { inspectEvolution, rollbackEvolution } from "../evolution/governance.js";
import { MemoryCompactor } from "../evolution/memory-compactor.js";
import { MemoryLearner } from "../evolution/memory-learner.js";
import { EnterpriseContextProvider } from "../runtime/enterprise-context.js";
import { resolveUserWorkspace } from "../runtime/workspace-context.js";
import { TaskStore } from "../tasks/task-store.js";
import type { UserContext } from "../types/agent-contracts.js";

const user: UserContext = {
  id: `eval_governance_${Date.now()}`,
  name: "Eval Governance",
  role: "eval",
  permissions: [],
  accessible_customer_ids: []
};
const workspace = resolveUserWorkspace(user);

try {
  await new MemoryLearner().apply({
    workspace,
    actions: [{
      op: "upsert",
      type: "preference",
      key: "brief_answer",
      value: "回答要简洁",
      confidence: 0.9
    }]
  });
  const taskStore = new TaskStore();
  await taskStore.upsert(workspace, {
    id: "memory_cleanup",
    subject: "清理记忆",
    status: "in_progress",
    goal: "验证治理视图"
  });
  const skillDir = path.join(workspace.root, ".evolution", "skills", "governance-skill");
  await mkdir(skillDir, { recursive: true });
  await writeFile(path.join(skillDir, "SKILL.md"), "---\nname: governance-skill\ndescription: eval\n---\n\nBody", "utf8");

  await rollbackEvolution(workspace, { target: "memory:brief_answer", reason: "eval disable memory" });
  await rollbackEvolution(workspace, { target: "task:memory_cleanup", reason: "eval disable task" });
  await rollbackEvolution(workspace, { target: "skill:governance-skill", reason: "eval disable skill" });

  const context = await new EnterpriseContextProvider().load({ user, workspace, message: "继续清理记忆" }) as {
    user_memory?: { items?: Array<{ key?: string }> };
    tasks?: { active?: Array<{ id?: string }>; relevant?: Array<{ id?: string }> };
  };
  assert(!context.user_memory?.items?.some((item) => item.key === "brief_answer"), "disabled memory should be filtered from context");
  assert(!context.tasks?.active?.some((task) => task.id === "memory_cleanup"), "disabled task should be filtered from active context");
  assert(!context.tasks?.relevant?.some((task) => task.id === "memory_cleanup"), "disabled task should be filtered from relevant context");

  const inspection = await inspectEvolution(workspace, 10) as {
    summary?: { memory_items?: number; tasks?: number; skill_overrides?: number; disabled_targets?: number };
    memory?: { disabled?: string[] };
    tasks?: { disabled?: string[] };
    skills?: Array<{ id?: string; disabled?: boolean }>;
  };
  assertEqual(inspection.summary?.memory_items, 1, "inspect memory count");
  assertEqual(inspection.summary?.disabled_targets, 3, "inspect disabled count");
  assert(Boolean(inspection.memory?.disabled?.includes("brief_answer")), "inspect should classify disabled memory");
  assert(Boolean(inspection.tasks?.disabled?.includes("memory_cleanup")), "inspect should classify disabled task");
  assert(Boolean(inspection.skills?.some((skill) => skill.id === "governance-skill" && skill.disabled)), "inspect should classify disabled skill");

  const oldKey = process.env.EVOLUTION_LLM_API_KEY;
  const oldDecisionKey = process.env.LLM_DECISION_API_KEY;
  const oldLlmKey = process.env.LLM_API_KEY;
  const oldOpenAiKey = process.env.OPENAI_API_KEY;
  delete process.env.EVOLUTION_LLM_API_KEY;
  delete process.env.LLM_DECISION_API_KEY;
  delete process.env.LLM_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const compaction = await new MemoryCompactor().compact(workspace);
  assertEqual(compaction.status, "applied", "compactor should apply local strategy without key");
  assertEqual(compaction.mode, "local_strategy", "compactor should report local strategy mode");
  restoreEnv("EVOLUTION_LLM_API_KEY", oldKey);
  restoreEnv("LLM_DECISION_API_KEY", oldDecisionKey);
  restoreEnv("LLM_API_KEY", oldLlmKey);
  restoreEnv("OPENAI_API_KEY", oldOpenAiKey);

  assert(existsSync(path.join(workspace.root, ".evolution", "disabled.json")), "disabled registry missing");
  console.log("PASS evolution governance");
} finally {
  await rm(resolveProjectPath("users", workspace.user_id), { recursive: true, force: true });
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}

function restoreEnv(key: string, value: string | undefined): void {
  if (typeof value === "string") process.env[key] = value;
  else delete process.env[key];
}
