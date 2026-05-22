import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveProjectPath } from "../data/load-json.js";
import { EvolutionRuntime } from "../evolution/runtime.js";
import { SkillLearner } from "../evolution/skill-learner.js";
import { EnterpriseContextProvider } from "../runtime/enterprise-context.js";
import { resolveUserWorkspace } from "../runtime/workspace-context.js";
import { AgenticSkillView } from "../skills/agentic-skill-view.js";
import type { EvolutionDecision, EvolutionTurnInput } from "../evolution/types.js";
import type { UserContext } from "../types/agent-contracts.js";

const user: UserContext = {
  id: `eval_evolution_${Date.now()}`,
  name: "Eval Evolution",
  role: "eval",
  permissions: [],
  accessible_customer_ids: []
};
const workspace = resolveUserWorkspace(user);

try {
  const runtime = new EvolutionRuntime({
    debounceMs: 60_000,
    judge: {
      async decide(input: EvolutionTurnInput): Promise<{ ok: true; decision: EvolutionDecision }> {
        if (input.trigger === "session_idle") {
          assert(Boolean(input.sessionTrace?.turns?.length), "judge should receive session trace");
        }
        return {
          ok: true,
          decision: {
            should_evolve: true,
            confidence: 0.91,
            reason: "用户给出了稳定偏好和长程任务信号",
            memory_actions: [{
              op: "upsert",
              type: "preference",
              key: "answer_style_preference",
              value: "回答简短，用列表",
              confidence: 0.9
            }],
            task_actions: [{
              op: "upsert",
              task_id: "margin_watch",
              title: "毛利持续跟踪",
              goal: "持续跟踪重点车型毛利问题",
              status: "active",
              known_facts: ["用户关心汉EV毛利"],
              next_action: "下次继续按销售顾问拆分",
              confidence: 0.86
            }],
            skill_actions: [{
              op: "preference",
              skill_id: "dealer-analysis",
              value: "优先输出管理动作",
              confidence: 0.82
            }]
          }
        };
      }
    } as never
  });

  const result = await runtime.reviewTurn({
    trigger: "agent_finish",
    user,
    workspace,
    sessionId: `${user.id}:default`,
    message: "以后都简短点，汉EV毛利这个持续跟一下",
    answer: "好的。",
    route: { intent_code: "general" },
    toolPlan: { calls: [] },
    toolResults: []
  });

  assertEqual(result.status, "applied", "evolution status");
  assert(existsSync(path.join(workspace.memory_dir, "memory.json")), "memory file missing");
  assert(existsSync(path.join(workspace.root, "tasks", "active.json")), "active task index missing");
  const activeTasks = await readFile(path.join(workspace.root, "tasks", "active.json"), "utf8");
  assert(activeTasks.includes("margin_watch"), "active task index should include margin_watch");
  assert(existsSync(path.join(workspace.root, ".evolution", "skills", "dealer-analysis", "evolution_preferences.md")), "skill preference missing");
  assert(existsSync(path.join(workspace.memory_dir, "episodes.jsonl")), "episodes log missing");
  const log = await readFile(path.join(workspace.root, ".evolution", "evolution-log.jsonl"), "utf8");
  assert(log.includes("\"status\":\"applied\""), "evolution log should record applied result");
  await assertSignalCollectorDebounce(runtime);
  await assertEvolutionPreferencesLoaded();
  await assertEvolutionSkillOverride();
  console.log("PASS evolution runtime");
} finally {
  await rm(resolveProjectPath("users", workspace.user_id), { recursive: true, force: true });
}

async function assertSignalCollectorDebounce(runtime: EvolutionRuntime): Promise<void> {
  runtime.collectTurn({
    trigger: "agent_finish",
    user,
    workspace,
    sessionId: `${user.id}:debounce`,
    message: "继续记一下，我喜欢短答案",
    answer: "收到。",
    route: { intent_code: "general" },
    toolPlan: { calls: [] },
    toolResults: []
  });
  await runtime.flushSession(workspace.user_id, `${user.id}:debounce`);
  const episodes = await readFile(path.join(workspace.memory_dir, "episodes.jsonl"), "utf8");
  assert(episodes.includes(`${user.id}:debounce`), "debounced session should create episode");
}

async function assertEvolutionPreferencesLoaded(): Promise<void> {
  const learner = new SkillLearner();
  await learner.apply({
    workspace,
    actions: [{
      op: "preference",
      skill_id: "general",
      value: "默认回答先给结论",
      confidence: 0.9
    }]
  });
  const context = await new EnterpriseContextProvider().load({ user, workspace }) as { evolution?: { preferences?: string }; tasks?: { active?: Array<{ id?: string }> } };
  assert(String(context.evolution?.preferences ?? "").includes("默认回答先给结论"), "general evolution preference should load into enterprise context");
  assert(Boolean(context.tasks?.active?.some((task) => task.id === "margin_watch")), "active tasks should load into enterprise context");
}

async function assertEvolutionSkillOverride(): Promise<void> {
  const skillRoot = path.join(resolveProjectPath("skills", "agentic"), "eval-base-skill");
  const evolutionRoot = path.join(workspace.root, ".evolution", "skills", "eval-base-skill");
  await mkdir(skillRoot, { recursive: true });
  await mkdir(evolutionRoot, { recursive: true });
  await writeFile(path.join(skillRoot, "SKILL.md"), "---\nname: eval-base-skill\ndescription: base description\n---\n\nBase body", "utf8");
  await writeFile(path.join(evolutionRoot, "SKILL.md"), "---\nname: eval-base-skill\ndescription: evolved description\n---\n\nEvolved body", "utf8");
  await writeFile(path.join(evolutionRoot, "evolution_preferences.md"), "- Prefer evolved style\n", "utf8");
  try {
    const view = new AgenticSkillView();
    const listed = view.listForAgent({ user, workspace }).find((skill) => skill.id === "eval-base-skill");
    assertEqual(listed?.description, "evolved description", "evolution skill should override base skill");
    const injected = await view.loadForInjection({ id: "eval-base-skill", user, workspace }) as { injection_text?: string };
    assert(String(injected.injection_text ?? "").includes("Evolved body"), "evolved skill body should inject");
    assert(String(injected.injection_text ?? "").includes("Prefer evolved style"), "evolution skill preference should inject");
  } finally {
    await rm(skillRoot, { recursive: true, force: true });
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}
