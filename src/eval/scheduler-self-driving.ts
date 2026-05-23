import { mkdir, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { MaintenanceScheduler, createLongTaskProgressionJob, createDependencyVulnerabilityScanJob } from "../runtime/maintenance-scheduler.js";
import { TaskStore } from "../tasks/task-store.js";
import { safeJoinWorkspace, type WorkspaceContext } from "../runtime/workspace-context.js";

/**
 * Capability 4 smoke：自驱调度 + 长任务推进 job
 *
 * Section A：长任务推进 job
 *   1) 准备一个 active task，updated_at 写成 2 天前 → run 一次 → stuck_count=1, pinged_count=1
 *   2) task.metadata.progress_pings 有一条新记录
 *   3) 准备一个新鲜 task → 不被 ping
 *
 * Section B：自驱心跳
 *   1) startHeartbeat({ intervalMs: 80 }) 让 scheduler 自己跑 runDue
 *   2) 等几个 tick 后停下来，验证 scheduler.json 里 long_task_progression 的 last_run_at 被写过
 *   3) stop() 之后 timer 不再 tick
 *
 * Section C：心跳容错
 *   1) getWorkspaces 抛错 → onError 收到通知，timer 不挂
 */
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function main(): Promise<void> {
  const tmpRootHost = path.join(PROJECT_ROOT, ".tmp");
  await mkdir(tmpRootHost, { recursive: true });
  await runProgressionJobSection(tmpRootHost);
  await runHeartbeatSection(tmpRootHost);
  await runHeartbeatErrorSection(tmpRootHost);
  console.log("PASS scheduler self-driving (long-task progression / heartbeat / error tolerance)");
}

async function runProgressionJobSection(tmpRootHost: string): Promise<void> {
  const workspace = await makeFreshWorkspace(tmpRootHost, "sched-progression");
  try {
    const taskStore = new TaskStore();
    // 一个明显 stuck 的任务（updated_at = 48h 前）
    const stuckId = "stuck_task_smoke";
    const stale = await taskStore.upsert(workspace, {
      id: stuckId,
      subject: "Stuck task",
      goal: "test stuck path",
      status: "in_progress"
    });
    // hack updated_at to 2 天前：直接覆写文件
    const stuckFile = taskStore.taskPath(workspace, stale.task_list_id, stuckId);
    const taskJson = JSON.parse(await readFile(stuckFile, "utf8")) as { updated_at: string };
    taskJson.updated_at = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    await mkdir(path.dirname(stuckFile), { recursive: true });
    await (await import("node:fs/promises")).writeFile(stuckFile, JSON.stringify(taskJson, null, 2), "utf8");

    // 一个新鲜任务
    await taskStore.upsert(workspace, {
      id: "fresh_task_smoke",
      subject: "Fresh task",
      goal: "test fresh path",
      status: "in_progress"
    });

    // 跑 job
    const job = createLongTaskProgressionJob({ stuckMs: 6 * 3600 * 1000 });
    const result = await job.run({ workspace }) as {
      ok: boolean;
      scanned: number;
      stuck_count: number;
      pinged_count: number;
      stuck: Array<{ id: string }>;
      pinged: Array<{ id: string }>;
    };
    assert(result.ok === true, `progression job should ok, got ${JSON.stringify(result)}`);
    assert(result.scanned >= 2, `should scan at least 2 tasks, got scanned=${result.scanned}`);
    assert(result.stuck_count === 1, `exactly 1 stuck task, got ${result.stuck_count}: ${JSON.stringify(result.stuck)}`);
    assert(result.pinged_count === 1, `exactly 1 pinged task, got ${result.pinged_count}`);
    assert(result.pinged[0].id === stuckId, `pinged should be the stuck task, got ${result.pinged[0]?.id}`);

    // 验证 metadata.progress_pings 实际写入
    const pingedTask = await taskStore.get(workspace, stale.task_list_id, stuckId);
    assert(pingedTask !== null, "pinged task should still exist");
    const pings = (pingedTask!.metadata as { progress_pings?: Array<{ source: string }> })?.progress_pings ?? [];
    assert(pings.length === 1, `expected 1 ping, got ${pings.length}`);
    assert(pings[0].source === "scheduler.long_task_progression", `ping source mismatch: ${pings[0].source}`);
  } finally {
    await rm(workspace.root, { recursive: true, force: true });
  }
}

async function runHeartbeatSection(tmpRootHost: string): Promise<void> {
  const workspace = await makeFreshWorkspace(tmpRootHost, "sched-heartbeat");
  try {
    // 心跳跑得快但不依赖真 npm audit；只用 long_task_progression（无外部依赖）
    const scheduler = new MaintenanceScheduler([
      createLongTaskProgressionJob({ stuckMs: 1, intervalMs: 1 })
    ]);
    let errorCount = 0;
    const handle = scheduler.startHeartbeat({
      intervalMs: 50,
      getWorkspaces: () => [workspace],
      onError: () => { errorCount += 1; }
    });
    // 等几个 tick
    await delay(220);
    handle.stop();

    // 验证 scheduler.json 写过 long_task_progression 的 last_run_at
    const stateFile = safeJoinWorkspace(workspace.root, ".evolution", "maintenance", "scheduler.json");
    assert(existsSync(stateFile), `scheduler.json should be written by heartbeat, missing at ${stateFile}`);
    const state = JSON.parse(await readFile(stateFile, "utf8")) as {
      jobs: Record<string, { last_run_at?: string; last_status?: string }>;
    };
    const jobState = state.jobs["recurring.long_task_progression"];
    assert(!!jobState, `long_task_progression job should be tracked in scheduler state, got jobs=${Object.keys(state.jobs).join(",")}`);
    assert(typeof jobState.last_run_at === "string", `last_run_at should be set, got ${jobState.last_run_at}`);
    assert(jobState.last_status === "ok", `last_status should be ok, got ${jobState.last_status}`);
    assert(errorCount === 0, `heartbeat should not record errors in happy path, got ${errorCount}`);

    // 心跳停了之后等 in-flight 完成 → 取一个 settled 的 last_run_at 作为基线
    await delay(150);
    const settled = JSON.parse(await readFile(stateFile, "utf8")) as { jobs: Record<string, { last_run_at?: string }> };
    const settledLastRun = settled.jobs["recurring.long_task_progression"].last_run_at;
    await delay(300); // 再等一段时间——比 intervalMs(50) 多很多倍
    const after = JSON.parse(await readFile(stateFile, "utf8")) as { jobs: Record<string, { last_run_at?: string }> };
    assert(after.jobs["recurring.long_task_progression"].last_run_at === settledLastRun, "stop() should halt heartbeat ticks (last_run_at frozen)");
  } finally {
    await rm(workspace.root, { recursive: true, force: true });
  }
}

async function runHeartbeatErrorSection(tmpRootHost: string): Promise<void> {
  // getWorkspaces 抛错 → onError 收到，timer 仍继续；之后 stop 干净退出
  const errors: unknown[] = [];
  const scheduler = new MaintenanceScheduler([createDependencyVulnerabilityScanJob()]);
  const handle = scheduler.startHeartbeat({
    intervalMs: 30,
    getWorkspaces: () => { throw new Error("smoke_simulated_workspace_lookup_failure"); },
    onError: (err) => { errors.push(err); }
  });
  await delay(120);
  handle.stop();
  assert(errors.length >= 1, `heartbeat should funnel errors to onError, got ${errors.length}`);
  const message = errors[0] instanceof Error ? errors[0].message : String(errors[0]);
  assert(message.includes("smoke_simulated"), `error message should pass through, got ${message}`);
  // tmpRootHost 在这条分支没造目录，无需清理
  void tmpRootHost;
}

async function makeFreshWorkspace(tmpRootHost: string, name: string): Promise<WorkspaceContext> {
  const root = path.join(tmpRootHost, name);
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  return {
    user_id: name,
    root,
    memory_dir: path.join(root, "memory"),
    sessions_dir: path.join(root, "sessions"),
    artifacts_dir: path.join(root, "artifacts"),
    skills_dir: path.join(root, "skills"),
    sandboxes_dir: path.join(root, "sandboxes"),
    logs_dir: path.join(root, "logs")
  };
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
