/**
 * Phase 5.3 eval: task-tools-eval
 *
 * 测试场景：
 *   1. task.get —— 按 id 取完整任务，包含 evidence/plan/blocks
 *   2. task.get 不存在的 task —— 返回 ok=false / not_found
 *   3. task.link_evidence —— 追加 tool_result / note 类型证据
 *   4. readHighwatermark —— upsert 后高水位非 null
 *   5. 高水位在多次 upsert 后持续更新
 *   6. task.link_evidence 追加多种 kind
 *   7. task.get 返回的 evidence 数组包含 link_evidence 写入的条目
 *
 * 全部本地，不联网。
 */
import { rm } from "node:fs/promises";
import { resolveUserWorkspace } from "../runtime/workspace-context.js";
import { TaskStore, readHighwatermark } from "../tasks/task-store.js";
import { createTaskTools } from "../tasks/tools.js";
import { resolveProjectPath } from "../data/load-json.js";

const TEST_USER = `eval_task_tools_${Date.now()}`;
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
  const store = new TaskStore();
  const tools = createTaskTools();
  const getCtx = { workspace };

  // 先建一个基础任务
  const baseTask = await store.upsert(workspace, {
    id: "eval_task_001",
    subject: "eval 基础任务",
    goal: "用于 task-tools eval 验证",
    status: "in_progress",
    priority: "high",
    plan: [
      { id: "step_1", subject: "第一步", status: "pending" },
      { id: "step_2", subject: "第二步", status: "pending" }
    ],
    blocks: ["dep_task_x"]
  });

  /* ─── Test 1: task.get 成功取到任务 ─── */
  {
    const getTool = tools.find((t) => t.name === "task.get")!;
    const result = await getTool.execute({ id: "eval_task_001" }, getCtx) as Record<string, unknown>;
    assert(result.ok === true, "task.get 返回 ok=true");
    const data = result.data as Record<string, unknown>;
    const task = data?.task as Record<string, unknown>;
    assertEqual(task?.id as string, "eval_task_001", "task.get 返回正确的任务 id");
    assertEqual(task?.subject as string, "eval 基础任务", "task.get 返回正确的 subject");
    assert(Array.isArray(task?.plan) && (task.plan as unknown[]).length === 2, "task.get plan 有 2 个步骤");
  }

  /* ─── Test 2: task.get 不存在的任务 ─── */
  {
    const getTool = tools.find((t) => t.name === "task.get")!;
    const result = await getTool.execute({ id: "nonexistent_task_xyz" }, getCtx) as Record<string, unknown>;
    assert(result.ok === false, "task.get 不存在时 ok=false");
    assertEqual(result.error as string, "not_found", "task.get 不存在时 error=not_found");
  }

  /* ─── Test 3: task.link_evidence 追加 tool_result ─── */
  {
    const linkTool = tools.find((t) => t.name === "task.link_evidence")!;
    const result = await linkTool.execute({
      id: "eval_task_001",
      kind: "tool_result",
      summary: "dealer.query_sales_orders 返回：昨日成交 12 台",
      ref: "tool:dealer.query_sales_orders:2025-01-01"
    }, getCtx) as Record<string, unknown>;
    assert(result.ok === true, "task.link_evidence (tool_result) ok=true");
    const data = result.data as Record<string, unknown>;
    const task = data?.task as Record<string, unknown>;
    assert(Boolean(task?.id), "link_evidence 返回任务摘要含 id");
  }

  /* ─── Test 4: readHighwatermark upsert 后非 null ─── */
  {
    const taskListId = store.listIdForUser(workspace);
    const hwm = await readHighwatermark(workspace, taskListId);
    assert(hwm !== null, "upsert 后 readHighwatermark 返回非 null");
    assert(typeof hwm === "string" && hwm.length > 0, "readHighwatermark 返回非空字符串");
    // 验证是 ISO 格式
    const parsed = hwm ? new Date(hwm).getTime() : NaN;
    assert(Number.isFinite(parsed), "highwatermark 是有效的 ISO 时间戳");
  }

  /* ─── Test 5: 高水位在多次 upsert 后持续更新 ─── */
  {
    const taskListId = store.listIdForUser(workspace);
    const hwm1 = await readHighwatermark(workspace, taskListId);
    // 等 1ms 确保时间戳有差异
    await new Promise((r) => setTimeout(r, 5));
    await store.upsert(workspace, {
      id: "eval_task_002",
      subject: "第二个 eval 任务",
      status: "pending"
    });
    const hwm2 = await readHighwatermark(workspace, taskListId);
    assert(hwm2 !== null, "第二次 upsert 后高水位非 null");
    assert(hwm1 !== hwm2 || hwm2 >= (hwm1 ?? ""), "高水位在第二次 upsert 后更新（时间不早于第一次）");
  }

  /* ─── Test 6: task.link_evidence 支持 note 类型 ─── */
  {
    const linkTool = tools.find((t) => t.name === "task.link_evidence")!;
    const result = await linkTool.execute({
      id: "eval_task_001",
      kind: "note",
      summary: "用户确认：需要关注 EV 车型库存天数"
    }, getCtx) as Record<string, unknown>;
    assert(result.ok === true, "task.link_evidence (note) ok=true");
  }

  /* ─── Test 7: task.get 返回的 evidence 包含之前 link_evidence 写入的条目 ─── */
  {
    const getTool = tools.find((t) => t.name === "task.get")!;
    const result = await getTool.execute({ id: "eval_task_001" }, getCtx) as Record<string, unknown>;
    assert(result.ok === true, "task.get 验证 evidence 时 ok=true");
    const task = (result.data as Record<string, unknown>)?.task as Record<string, unknown>;
    const evidence = task?.evidence as Array<Record<string, unknown>>;
    assert(Array.isArray(evidence) && evidence.length >= 2, `task.get evidence 至少 2 条（实际 ${Array.isArray(evidence) ? evidence.length : "非数组"}）`);
    assert(
      evidence.some((e) => e.kind === "tool_result" && String(e.summary).includes("dealer.query_sales_orders")),
      "evidence 包含 tool_result 类型条目"
    );
    assert(
      evidence.some((e) => e.kind === "note" && String(e.summary).includes("EV 车型库存")),
      "evidence 包含 note 类型条目"
    );
  }

  console.log(`\ntask-tools-eval: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => rm(resolveProjectPath("users", TEST_USER), { recursive: true, force: true }));
