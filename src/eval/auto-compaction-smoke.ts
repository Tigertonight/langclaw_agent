import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AutoCompactionTrigger } from "../evolution/auto-compaction.js";
import { EvolutionRuntime } from "../evolution/runtime.js";
import { MemoryLearner } from "../evolution/memory-learner.js";
import { MemoryCompactor } from "../evolution/memory-compactor.js";
import type { WorkspaceContext } from "../runtime/workspace-context.js";
import type { EvolutionTurnInput } from "../evolution/types.js";

/**
 * Capability 3 smoke：自动 compaction 接入 EvolutionRuntime
 *
 * Section A：AutoCompactionTrigger 单元
 *   1) 全新 workspace + 0 items：第一次触发会跑（cooldown=Infinity 视为冷却已过）
 *   2) 同一 workspace 立刻第二次：reason=under_threshold + skipped
 *   3) item 数 ≥ 阈值 → 强制再跑一次（绕过冷却）
 *   4) state 文件落盘：compaction.state.json 存在并含 last_run_at
 *
 * Section B：EvolutionRuntime 集成
 *   1) reviewTurn 跑一轮（流程会进 finish → autoCompaction.maybeRun）
 *   2) compaction.state.json 出现 last_run_at
 *
 * Section C：env disable
 *   1) EVOLUTION_AUTO_COMPACT_ENABLED=0 → action="disabled"，state 文件不应被写
 */
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function main(): Promise<void> {
  const tmpRootHost = path.join(PROJECT_ROOT, ".tmp");
  await mkdir(tmpRootHost, { recursive: true });
  try {
    await runTriggerSection(tmpRootHost);
    await runRuntimeSection(tmpRootHost);
    await runEnvDisableSection(tmpRootHost);
    console.log("PASS auto-compaction smoke (trigger / runtime integration / env disable)");
  } finally {
    // 不删 tmpRootHost 整体，下个 smoke 还会用；只清自己造的子目录
  }
}

async function runTriggerSection(tmpRootHost: string): Promise<void> {
  const workspace = await makeFreshWorkspace(tmpRootHost, "auto-compact-trigger");
  try {
    // 用 fake clock 来精确控制冷却判定
    let now = Date.parse("2026-05-23T10:00:00Z");
    // 阈值设很低，方便观察"item 数触发"路径
    const trigger = new AutoCompactionTrigger({
      itemThreshold: 5,
      cooldownMs: 60_000, // 60s 冷却
      now: () => now
    });

    // case 1：全新 workspace
    const r1 = await trigger.maybeRun(workspace);
    assert(r1.action === "ran", `first run should fire (cooldown=Infinity), got ${JSON.stringify(r1)}`);
    const state1 = await trigger.readState(workspace);
    assert(typeof state1.last_run_at === "string" && state1.last_run_at.length > 0, `state should record last_run_at, got ${JSON.stringify(state1)}`);

    // case 2：同一 workspace 立刻第二次
    now += 5_000; // 才过 5s
    const r2 = await trigger.maybeRun(workspace);
    assert(r2.action === "skipped", `second run within cooldown should skip, got ${JSON.stringify(r2)}`);
    assert(String(r2.reason).startsWith("under_threshold"), `skip reason should be under_threshold, got ${r2.reason}`);

    // case 3：写够 itemThreshold 个 memory items，强制再跑（item 触发优先于冷却）
    await seedMemoryItems(workspace, 6);
    const r3 = await trigger.maybeRun(workspace);
    assert(r3.action === "ran", `over-threshold should fire even within cooldown, got ${JSON.stringify(r3)}`);
    assert(String(r3.reason).startsWith("items_over_threshold"), `reason should be items_over_threshold, got ${r3.reason}`);
    assert(typeof r3.item_count === "number" && r3.item_count >= 6, `item_count should reflect seeded count, got ${r3.item_count}`);

    // case 4：冷却跨过去后即使没到 item 阈值也能再跑
    await seedMemoryItems(workspace, 0); // 清掉
    now += 120_000; // 跨过 60s 冷却
    const r4 = await trigger.maybeRun(workspace);
    assert(r4.action === "ran", `after cooldown elapsed run should fire, got ${JSON.stringify(r4)}`);
    assert(String(r4.reason).startsWith("cooldown_elapsed"), `reason should be cooldown_elapsed, got ${r4.reason}`);
  } finally {
    await rm(workspace.root, { recursive: true, force: true });
  }
}

async function runRuntimeSection(tmpRootHost: string): Promise<void> {
  const workspace = await makeFreshWorkspace(tmpRootHost, "auto-compact-runtime");
  try {
    // 用极低阈值的 trigger，确保 reviewTurn 跑一遍就会触发
    const autoCompaction = new AutoCompactionTrigger({ itemThreshold: 1, cooldownMs: 1 });
    const runtime = new EvolutionRuntime({ autoCompaction });

    // 不依赖真 LLM：把 EVOLUTION_ENABLED 关掉走 finish 的 disabled 分支，依然会进 finish 钩子
    const prevEnabled = process.env.EVOLUTION_ENABLED;
    process.env.EVOLUTION_ENABLED = "0";
    try {
      const input = makeTurnInput(workspace);
      const result = await runtime.reviewTurn(input);
      assert(result.status === "disabled", `EVOLUTION_ENABLED=0 should yield status=disabled, got ${result.status}`);
    } finally {
      if (prevEnabled === undefined) delete process.env.EVOLUTION_ENABLED;
      else process.env.EVOLUTION_ENABLED = prevEnabled;
    }

    const state = await autoCompaction.readState(workspace);
    assert(typeof state.last_run_at === "string", `runtime.finish should hit autoCompaction → state has last_run_at, got ${JSON.stringify(state)}`);
  } finally {
    await rm(workspace.root, { recursive: true, force: true });
  }
}

async function runEnvDisableSection(tmpRootHost: string): Promise<void> {
  const workspace = await makeFreshWorkspace(tmpRootHost, "auto-compact-disabled");
  try {
    const prev = process.env.EVOLUTION_AUTO_COMPACT_ENABLED;
    process.env.EVOLUTION_AUTO_COMPACT_ENABLED = "0";
    try {
      const trigger = new AutoCompactionTrigger();
      const r = await trigger.maybeRun(workspace);
      assert(r.action === "disabled", `disabled env should short-circuit, got ${JSON.stringify(r)}`);
      const state = await trigger.readState(workspace);
      assert(!state.last_run_at, `disabled run should not write state.last_run_at, got ${JSON.stringify(state)}`);
    } finally {
      if (prev === undefined) delete process.env.EVOLUTION_AUTO_COMPACT_ENABLED;
      else process.env.EVOLUTION_AUTO_COMPACT_ENABLED = prev;
    }
  } finally {
    await rm(workspace.root, { recursive: true, force: true });
  }
}

async function makeFreshWorkspace(tmpRootHost: string, name: string): Promise<WorkspaceContext> {
  const root = path.join(tmpRootHost, name);
  await rm(root, { recursive: true, force: true });
  await mkdir(path.join(root, "memory"), { recursive: true });
  return {
    user_id: name,
    business_id: "default",
    root,
    memory_dir: path.join(root, "memory"),
    sessions_dir: path.join(root, "sessions"),
    artifacts_dir: path.join(root, "artifacts"),
    skills_dir: path.join(root, "skills"),
    sandboxes_dir: path.join(root, "sandboxes"),
    logs_dir: path.join(root, "logs")
  };
}

async function seedMemoryItems(workspace: WorkspaceContext, count: number): Promise<void> {
  const items = Array.from({ length: count }, (_, i) => ({
    key: `seed_item_${i}`,
    type: "fact",
    value: `seed value ${i}`,
    confidence: 0.8,
    source: "smoke",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }));
  await new MemoryLearner().save(workspace, {
    owner_user_id: workspace.user_id,
    scope: "user",
    readonly_for_users: false,
    items,
    updated_at: new Date().toISOString()
  });
}

function makeTurnInput(workspace: WorkspaceContext): EvolutionTurnInput {
  return {
    trigger: "manual",
    user: { id: workspace.user_id, role: "user", permissions: [] },
    workspace,
    sessionId: `${workspace.user_id}:smoke`,
    message: "smoke compact",
    answer: "smoke",
    route: { intent_code: "smoke" },
    toolPlan: { calls: [] },
    toolResults: []
  } as EvolutionTurnInput;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
