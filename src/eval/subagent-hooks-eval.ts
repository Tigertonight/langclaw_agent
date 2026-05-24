/**
 * Phase 8 eval: subagent-hooks-eval
 *
 * 测试场景：
 *   1. RuntimeHooks 支持 Phase 8 新 hook 名（message_received/before_tool_call/after_tool_call 等）
 *   2. SubagentPlugin 注册后 hooks 有对应 listener
 *   3. subagent_spawn 事件 → 父 task evidence 追加 spawn 记录
 *   4. subagent_finish 事件 → 父 task evidence 追加 result 记录
 *   5. after_tool_call 事件 → active task evidence 自动追踪
 *   6. before_evolution_judge 事件 → 返回 active_task_snapshot
 *   7. after_evolution_apply 事件 → 触发 MemoryIndex 重建（旁路不阻塞）
 *   8. message_received 事件被 hooks.recent() 记录
 *   9. plugin 不重复注册（use() 幂等）
 *  10. hook 失败不抛错（handler 内部异常被 warn 捕获）
 *
 * 全部本地，不联网。
 */

import { rm } from "node:fs/promises";
import { resolveUserWorkspace } from "../runtime/workspace-context.js";
import { resolveProjectPath } from "../data/load-json.js";
import { RuntimeHooks } from "../runtime/hooks.js";
import { createSubagentPlugin } from "../runtime/subagent-plugin.js";
import { TaskStore } from "../tasks/task-store.js";

const TEST_USER = `eval_subagent_hooks_${Date.now()}`;
const workspace = resolveUserWorkspace(TEST_USER);

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string): void {
  if (cond) {
    console.log(`  PASS [${passed + failed + 1}] ${label}`);
    passed++;
  } else {
    console.error(`  FAIL [${passed + failed + 1}] ${label}`);
    failed++;
  }
}

function assertEqual<T>(a: T, b: T, label: string): void {
  if (a === b) {
    console.log(`  PASS [${passed + failed + 1}] ${label}`);
    passed++;
  } else {
    console.error(`  FAIL [${passed + failed + 1}] ${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
    failed++;
  }
}

async function main(): Promise<void> {
  const taskStore = new TaskStore();

  /* ─── Test 1: 新 hook 名枚举可注册 ─── */
  {
    const hooks = new RuntimeHooks();
    let messageReceivedFired = false;
    let beforeToolCallFired = false;
    let afterToolCallFired = false;
    let agentFinishFired = false;
    let sessionEndFired = false;
    let beforePromptBuildFired = false;
    let beforeEvolutionJudgeFired = false;
    let afterEvolutionApplyFired = false;
    let subagentSpawnFired = false;
    let subagentFinishFired = false;

    hooks.on("message_received", () => { messageReceivedFired = true; });
    hooks.on("before_tool_call", () => { beforeToolCallFired = true; });
    hooks.on("after_tool_call", () => { afterToolCallFired = true; });
    hooks.on("agent_finish", () => { agentFinishFired = true; });
    hooks.on("session_end", () => { sessionEndFired = true; });
    hooks.on("before_prompt_build", () => { beforePromptBuildFired = true; });
    hooks.on("before_evolution_judge", () => { beforeEvolutionJudgeFired = true; });
    hooks.on("after_evolution_apply", () => { afterEvolutionApplyFired = true; });
    hooks.on("subagent_spawn", () => { subagentSpawnFired = true; });
    hooks.on("subagent_finish", () => { subagentFinishFired = true; });

    await hooks.emit("message_received", { user_id: TEST_USER });
    await hooks.emit("before_tool_call", { user_id: TEST_USER });
    await hooks.emit("after_tool_call", { user_id: TEST_USER });
    await hooks.emit("agent_finish", { user_id: TEST_USER });
    await hooks.emit("session_end", { user_id: TEST_USER });
    await hooks.emit("before_prompt_build", { user_id: TEST_USER });
    await hooks.emit("before_evolution_judge", { user_id: TEST_USER });
    await hooks.emit("after_evolution_apply", { user_id: TEST_USER });
    await hooks.emit("subagent_spawn", { user_id: TEST_USER });
    await hooks.emit("subagent_finish", { user_id: TEST_USER });

    assert(messageReceivedFired, "message_received hook 触发");
    assert(beforeToolCallFired, "before_tool_call hook 触发");
    assert(afterToolCallFired, "after_tool_call hook 触发");
    assert(agentFinishFired, "agent_finish hook 触发");
    assert(sessionEndFired, "session_end hook 触发");
    assert(beforePromptBuildFired, "before_prompt_build hook 触发");
    assert(beforeEvolutionJudgeFired, "before_evolution_judge hook 触发");
    assert(afterEvolutionApplyFired, "after_evolution_apply hook 触发");
    assert(subagentSpawnFired, "subagent_spawn hook 触发");
    assert(subagentFinishFired, "subagent_finish hook 触发");
  }

  /* ─── Test 2: SubagentPlugin 注册后 hooks 有对应 listener ─── */
  {
    const hooks = new RuntimeHooks();
    const plugin = createSubagentPlugin({ taskStore });
    hooks.use(plugin);
    assert(hooks.listenerCount("subagent_spawn") >= 1, "subagent_spawn 有 listener");
    assert(hooks.listenerCount("subagent_finish") >= 1, "subagent_finish 有 listener");
    assert(hooks.listenerCount("after_tool_call") >= 1, "after_tool_call 有 listener（evidence 追踪）");
    assert(hooks.listenerCount("before_evolution_judge") >= 1, "before_evolution_judge 有 listener");
    assert(hooks.listenerCount("after_evolution_apply") >= 1, "after_evolution_apply 有 listener");
    assert(hooks.listenerCount("message_received") >= 1, "message_received 有 listener");
  }

  /* ─── Test 3: subagent_spawn 事件 → 父 task evidence 追加 spawn 记录 ─── */
  {
    const hooks = new RuntimeHooks();
    const plugin = createSubagentPlugin({ taskStore });
    hooks.use(plugin);

    // 先建父 task
    await taskStore.upsert(workspace, {
      id: "parent_task_001",
      subject: "主 Agent 任务",
      status: "in_progress"
    });

    await hooks.emit("subagent_spawn", {
      user_id: TEST_USER,
      parent_task_id: "parent_task_001",
      subagent_id: "sub_001",
      goal: "查询今日库存风险"
    });

    // 等待异步操作完成
    await new Promise((r) => setTimeout(r, 20));

    const parentTask = await taskStore.get(workspace, taskStore.listIdForUser(workspace), "parent_task_001");
    assert(parentTask !== null, "父 task 存在");
    assert(
      parentTask!.evidence.some((e) => e.kind === "note" && e.summary.includes("sub_001")),
      "spawn 事件写入 evidence（含 subagent_id）"
    );
  }

  /* ─── Test 4: subagent_finish 事件 → 父 task evidence 追加 result 记录 ─── */
  {
    const hooks = new RuntimeHooks();
    const plugin = createSubagentPlugin({ taskStore });
    hooks.use(plugin);

    await hooks.emit("subagent_finish", {
      user_id: TEST_USER,
      parent_task_id: "parent_task_001",
      subagent_id: "sub_001",
      status: "answered",
      summary: "发现 3 辆滞销车型，库龄超 90 天"
    });

    await new Promise((r) => setTimeout(r, 20));

    const parentTask = await taskStore.get(workspace, taskStore.listIdForUser(workspace), "parent_task_001");
    assert(
      parentTask!.evidence.some((e) => e.kind === "tool_result" && e.summary.includes("sub_001")),
      "finish 事件写入 evidence（tool_result 类型）"
    );
    assert(
      parentTask!.evidence.some((e) => e.summary.includes("answered")),
      "finish evidence 包含 status"
    );
  }

  /* ─── Test 5: after_tool_call 事件 → active task evidence 自动追踪 ─── */
  {
    const hooks = new RuntimeHooks();
    const plugin = createSubagentPlugin({ taskStore, enableEvidenceTracking: true });
    hooks.use(plugin);

    // 先建活跃 task
    await taskStore.upsert(workspace, {
      id: "active_task_002",
      subject: "活跃任务（工具调用追踪）",
      status: "in_progress"
    });

    await hooks.emit("after_tool_call", {
      user_id: TEST_USER,
      active_task_id: "active_task_002",
      tool_name: "dealer.query_vehicles",
      result_summary: "返回 50 辆在库车辆"
    });

    await new Promise((r) => setTimeout(r, 20));

    const activeTask = await taskStore.get(workspace, taskStore.listIdForUser(workspace), "active_task_002");
    assert(
      activeTask!.evidence.some((e) => e.kind === "tool_result" && e.ref === "dealer.query_vehicles"),
      "after_tool_call 追踪 evidence（ref=工具名）"
    );
    assert(
      activeTask!.evidence.some((e) => e.summary.includes("dealer.query_vehicles")),
      "evidence summary 包含工具名"
    );
  }

  /* ─── Test 6: before_evolution_judge 事件 → 返回 active_task_snapshot ─── */
  {
    const hooks = new RuntimeHooks();
    const plugin = createSubagentPlugin({ taskStore });
    hooks.use(plugin);

    const result = await hooks.dispatch("before_evolution_judge", { user_id: TEST_USER });
    assert(Array.isArray(result.active_task_snapshot), "before_evolution_judge 返回 active_task_snapshot 数组");
    const snapshot = result.active_task_snapshot as Array<Record<string, unknown>>;
    assert(snapshot.length >= 1, "active_task_snapshot 包含至少 1 个活跃任务");
    assert(snapshot.every((t) => typeof t.id === "string"), "snapshot 每项有 id");
  }

  /* ─── Test 7: after_evolution_apply 事件不抛错（旁路重建） ─── */
  {
    const hooks = new RuntimeHooks();
    const plugin = createSubagentPlugin({ taskStore, enableMemoryIndexRebuild: true });
    hooks.use(plugin);

    let threw = false;
    try {
      await hooks.emit("after_evolution_apply", { user_id: TEST_USER });
    } catch {
      threw = true;
    }
    assert(!threw, "after_evolution_apply 不抛错（旁路）");
  }

  /* ─── Test 8: message_received 事件被 hooks.recent() 记录 ─── */
  {
    const hooks = new RuntimeHooks();
    const plugin = createSubagentPlugin({ taskStore });
    hooks.use(plugin);

    await hooks.emit("message_received", {
      user_id: TEST_USER,
      channel: "web",
      message_id: "msg_eval_001",
      text_length: 42
    });

    const recent = hooks.recent(5);
    assert(recent.some((e) => e.hook === "message_received"), "hooks.recent() 包含 message_received 事件");
    assert(
      recent.some((e) => e.hook === "message_received" && e.message_id === "msg_eval_001"),
      "hooks.recent() 包含正确的 message_id"
    );
  }

  /* ─── Test 9: plugin 不重复注册（use() 幂等） ─── */
  {
    const hooks = new RuntimeHooks();
    const plugin = createSubagentPlugin({ taskStore });
    hooks.use(plugin);
    const count1 = hooks.listenerCount("subagent_spawn");
    hooks.use(plugin); // 第二次注册应该忽略
    const count2 = hooks.listenerCount("subagent_spawn");
    assertEqual(count1, count2, "第二次 use() 不增加 listener（幂等）");
  }

  /* ─── Test 10: hook 失败不抛错 ─── */
  {
    const hooks = new RuntimeHooks();
    hooks.on("message_received", () => {
      throw new Error("故意抛错的 handler");
    });
    let threw = false;
    try {
      await hooks.emit("message_received", { user_id: TEST_USER });
    } catch {
      threw = true;
    }
    assert(!threw, "handler 内抛错时 emit 不向上抛（hooks 是安全旁路）");
  }

  console.log(`\nsubagent-hooks-eval: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => rm(resolveProjectPath("users", TEST_USER), { recursive: true, force: true }));
