import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { resolveProjectPath } from "../data/load-json.js";
import { AgenticHandler } from "../handlers/agentic-handler.js";
import { RuntimeHooks } from "../runtime/hooks.js";
import { resolveUserWorkspace } from "../runtime/workspace-context.js";
import { createTaskContinuityPlugin } from "../tasks/task-continuity-plugin.js";
import { createTaskTools } from "../tasks/tools.js";
import { TaskRetriever } from "../tasks/task-retriever.js";
import { TaskStore } from "../tasks/task-store.js";

const workspace = resolveUserWorkspace(`eval_task_${Date.now()}`);

try {
  const store = new TaskStore();
  const task = await store.upsert(workspace, {
    id: "margin_watch",
    subject: "跟踪汉EV毛利",
    goal: "持续跟踪汉EV毛利偏低问题",
    status: "in_progress",
    next_action: "按销售顾问拆分"
  });
  assertEqual(task.id, "margin_watch", "task id");
  assert(existsSync(store.taskPath(workspace, store.listIdForUser(workspace), "margin_watch")), "task file missing");
  assert(existsSync(path.join(workspace.root, "tasks", "active.json")), "active index missing");
  await store.setStatus(workspace, store.listIdForUser(workspace), "margin_watch", "completed");
  const activeIndex = await readFile(path.join(workspace.root, "tasks", "active.json"), "utf8");
  assert(!activeIndex.includes("margin_watch"), "completed task should not remain active");
  await assertTaskRetrieverAndTools(store);
  console.log("PASS task store");
} finally {
  await rm(resolveProjectPath("users", workspace.user_id), { recursive: true, force: true });
}

async function assertTaskRetrieverAndTools(store: TaskStore): Promise<void> {
  await store.upsert(workspace, {
    id: "memory_plan",
    subject: "优化记忆能力",
    goal: "完善 memory evolution 主线",
    status: "in_progress",
    next_action: "实现 TaskRetriever"
  });
  const retriever = new TaskRetriever({ taskStore: store });
  const retrieved = await retriever.retrieve(workspace, "继续上次那个记忆优化", 3);
  assert(Boolean(retrieved.find((task) => task.id === "memory_plan")), "task retriever should recover continue-last-task intent");

  const tools = createTaskTools();
  const create = tools.find((tool) => tool.name === "task.create");
  const link = tools.find((tool) => tool.name === "task.link_artifact");
  assert(Boolean(create && link), "task tools should register");
  const created = await create?.execute({ id: "tool_task", title: "工具创建任务" }, { workspace });
  assert(Boolean((created as { ok?: boolean })?.ok), "task.create should succeed");
  const linked = await link?.execute({ id: "tool_task", artifact: "docs/example.md" }, { workspace });
  assert(Boolean((linked as { ok?: boolean })?.ok), "task.link_artifact should succeed");

  const hooks = new RuntimeHooks();
  hooks.use(createTaskContinuityPlugin({ taskStore: store }));
  const handler = new AgenticHandler({ hooks });
  const prepared = await handler.prepareTaskContext({ user: { id: workspace.user_id, role: "eval" }, message: "继续上次那个记忆优化", answerHint: "general" });
  assertEqual(prepared.claimed?.id, "memory_plan", "agentic handler should claim relevant task");
  const claimed = await store.get(workspace, store.listIdForUser(workspace), "memory_plan");
  assert(Boolean(claimed?.evidence.some((item) => item.id.startsWith("claim_"))), "claimed task should record claim evidence");
  await handler.recordTaskProgress({ user: { id: workspace.user_id, role: "eval" }, claimedTask: prepared.claimed, answer: "已经继续推进。", plannerState: { objective: "", plan: ["继续压缩"], completed: ["恢复任务"], missing: [], evidence: [] } });
  const progressed = await store.get(workspace, store.listIdForUser(workspace), "memory_plan");
  assert(Boolean(progressed?.evidence.some((item) => item.id.startsWith("agentic_answer_"))), "task progress should record answer evidence");
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}
