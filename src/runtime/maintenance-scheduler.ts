import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { resolveProjectPath } from "../data/load-json.js";
import { safeJoinWorkspace, type WorkspaceContext } from "./workspace-context.js";
import { TaskStore } from "../tasks/task-store.js";
import type { AgentTask } from "../tasks/task-types.js";
import type { JsonObject } from "../types/agent-contracts.js";

const execFileAsync = promisify(execFile);

export interface MaintenanceJobDefinition {
  name: string;
  description: string;
  intervalMs: number;
  run(input: { workspace: WorkspaceContext; executeAudit?: boolean }): Promise<JsonObject>;
}

interface MaintenanceJobState extends JsonObject {
  name: string;
  enabled: boolean;
  interval_ms: number;
  last_run_at?: string;
  next_run_at?: string;
  last_status?: string;
  last_summary?: string;
  failure_count?: number;
}

interface MaintenanceQueueItem extends JsonObject {
  id: string;
  job: string;
  status: "queued" | "running" | "succeeded" | "failed";
  attempts: number;
  max_attempts: number;
  queued_at: string;
  updated_at: string;
  run_after?: string;
  last_error?: string;
}

interface MaintenanceNotification extends JsonObject {
  id: string;
  level: "info" | "warning" | "error";
  title: string;
  message: string;
  created_at: string;
  read: boolean;
  job?: string;
  queue_item_id?: string;
}

interface MaintenanceSchedulerState {
  version: 1;
  updated_at: string;
  jobs: Record<string, MaintenanceJobState>;
  queue: MaintenanceQueueItem[];
  notifications: MaintenanceNotification[];
}

export class MaintenanceScheduler {
  private readonly jobs: MaintenanceJobDefinition[];
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(jobs: MaintenanceJobDefinition[] = [createDependencyVulnerabilityScanJob(), createLongTaskProgressionJob()]) {
    this.jobs = jobs;
  }

  /**
   * 自驱心跳：每 intervalMs 跑一次 runDue。不依赖 session_idle 钩子。
   * 入参可以是单个 workspace，或一个返回 workspace 列表的函数（多用户场景）。
   * 失败永远兜底——心跳不能因为单次报错就停。
   * 返回的 stop() 用于显式停止；timer 内部已 unref，不会阻塞进程退出。
   */
  startHeartbeat({ intervalMs, getWorkspaces, onError }: {
    intervalMs: number;
    getWorkspaces: () => WorkspaceContext[] | Promise<WorkspaceContext[]>;
    onError?: (err: unknown) => void;
  }): { stop: () => void } {
    if (this.heartbeatTimer) this.stopHeartbeat();
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new Error("heartbeat_interval_invalid");
    }
    const tick = async () => {
      try {
        const workspaces = await getWorkspaces();
        for (const workspace of workspaces) {
          try {
            await this.runDue(workspace);
          } catch (err) {
            onError?.(err);
          }
        }
      } catch (err) {
        onError?.(err);
      }
    };
    this.heartbeatTimer = setInterval(() => { void tick(); }, intervalMs);
    if (typeof this.heartbeatTimer === "object" && this.heartbeatTimer && typeof (this.heartbeatTimer as { unref?: () => void }).unref === "function") {
      (this.heartbeatTimer as { unref: () => void }).unref();
    }
    return { stop: () => this.stopHeartbeat() };
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  async list(workspace: WorkspaceContext): Promise<JsonObject> {
    const state = await this.readState(workspace);
    return {
      jobs: this.jobs.map((job) => this.publicJob(job, state.jobs[job.name])),
      queue: state.queue.slice(-50),
      notifications: state.notifications.slice(-50)
    };
  }

  async runDue(workspace: WorkspaceContext, now = new Date()): Promise<JsonObject> {
    const queued: JsonObject[] = [];
    for (const job of this.jobs) {
      const current = (await this.readState(workspace)).jobs[job.name];
      if (isDue(job, current, now)) {
        queued.push(await this.enqueue(workspace, job.name, { runAfter: now }));
      }
    }
    const processed = await this.processQueue(workspace, now);
    return { ok: true, queued, processed };
  }

  async enqueue(workspace: WorkspaceContext, name: string, { runAfter = new Date(), maxAttempts = 3 }: { runAfter?: Date; maxAttempts?: number } = {}): Promise<JsonObject> {
    if (!this.jobs.some((item) => item.name === name)) return { ok: false, error: "unknown_job", job: name };
    const state = await this.readState(workspace);
    const item: MaintenanceQueueItem = {
      id: `mq_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      job: name,
      status: "queued",
      attempts: 0,
      max_attempts: Math.max(1, maxAttempts),
      queued_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      run_after: runAfter.toISOString()
    };
    state.queue.push(item);
    await this.writeState(workspace, state);
    return { ok: true, item };
  }

  async processQueue(workspace: WorkspaceContext, now = new Date()): Promise<JsonObject> {
    const state = await this.readState(workspace);
    const processed: JsonObject[] = [];
    for (const item of state.queue) {
      if (item.status !== "queued") continue;
      const runAfter = Date.parse(item.run_after ?? item.queued_at);
      if (Number.isFinite(runAfter) && runAfter > now.getTime()) continue;
      item.status = "running";
      item.updated_at = new Date().toISOString();
      item.attempts += 1;
      await this.writeState(workspace, state);
      const result = await this.runJob(workspace, item.job);
      const nextState = await this.readState(workspace);
      const nextItem = nextState.queue.find((candidate) => candidate.id === item.id);
      if (!nextItem) continue;
      nextItem.updated_at = new Date().toISOString();
      if (result.ok === true) {
        nextItem.status = "succeeded";
        nextState.notifications.push(createNotification("info", "Maintenance job succeeded", `${item.job} completed.`, item.job, item.id));
      } else if (nextItem.attempts < nextItem.max_attempts) {
        nextItem.status = "queued";
        nextItem.last_error = String(result.result && typeof result.result === "object" ? (result.result as JsonObject).error ?? result.result : result.error ?? "job_failed").slice(0, 500);
        nextItem.run_after = new Date(Date.now() + Math.min(60_000 * Math.pow(2, nextItem.attempts - 1), 30 * 60_000)).toISOString();
        nextState.notifications.push(createNotification("warning", "Maintenance job retry scheduled", `${item.job} failed and will retry.`, item.job, item.id));
      } else {
        nextItem.status = "failed";
        nextItem.last_error = String(result.result && typeof result.result === "object" ? (result.result as JsonObject).error ?? result.result : result.error ?? "job_failed").slice(0, 500);
        nextState.notifications.push(createNotification("error", "Maintenance job failed", `${item.job} failed after ${nextItem.attempts} attempts.`, item.job, item.id));
      }
      nextState.queue = nextState.queue.slice(-200);
      nextState.notifications = nextState.notifications.slice(-200);
      await this.writeState(workspace, nextState);
      processed.push({ item: nextItem, result });
    }
    return { ok: true, processed };
  }

  async runJob(workspace: WorkspaceContext, name: string, options: { executeAudit?: boolean } = {}): Promise<JsonObject> {
    const job = this.jobs.find((item) => item.name === name);
    if (!job) return { ok: false, error: "unknown_job", job: name };
    const startedAt = new Date();
    const result = await job.run({ workspace, executeAudit: options.executeAudit === true });
    const state = await this.readState(workspace);
    state.jobs[job.name] = {
      name: job.name,
      enabled: true,
      interval_ms: job.intervalMs,
      last_run_at: startedAt.toISOString(),
      next_run_at: new Date(startedAt.getTime() + job.intervalMs).toISOString(),
      last_status: result.ok === false ? "failed" : "ok",
      last_summary: summarizeJobResult(result),
      failure_count: result.ok === false ? (state.jobs[job.name]?.failure_count ?? 0) + 1 : 0
    };
    await this.writeState(workspace, state);
    return { ok: result.ok !== false, job: job.name, result, state: this.publicJob(job, state.jobs[job.name]) };
  }

  private publicJob(job: MaintenanceJobDefinition, state?: MaintenanceJobState): JsonObject {
    return {
      name: job.name,
      description: job.description,
      enabled: state?.enabled ?? true,
      interval_ms: state?.interval_ms ?? job.intervalMs,
      last_run_at: state?.last_run_at,
      next_run_at: state?.next_run_at,
      last_status: state?.last_status,
      last_summary: state?.last_summary,
      failure_count: state?.failure_count ?? 0
    };
  }

  private async readState(workspace: WorkspaceContext): Promise<MaintenanceSchedulerState> {
    const file = statePath(workspace);
    if (!existsSync(file)) return createEmptyState();
    try {
      const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<MaintenanceSchedulerState>;
      return {
        version: 1,
        updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : new Date(0).toISOString(),
        jobs: parsed.jobs && typeof parsed.jobs === "object" ? parsed.jobs as Record<string, MaintenanceJobState> : {},
        queue: Array.isArray(parsed.queue) ? parsed.queue.filter(isQueueItem) : [],
        notifications: Array.isArray(parsed.notifications) ? parsed.notifications.filter(isNotification) : []
      };
    } catch {
      return createEmptyState();
    }
  }

  private async writeState(workspace: WorkspaceContext, state: MaintenanceSchedulerState): Promise<void> {
    state.updated_at = new Date().toISOString();
    const file = statePath(workspace);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(state, null, 2), "utf8");
  }
}

export function createDependencyVulnerabilityScanJob(): MaintenanceJobDefinition {
  return {
    name: "nightly.dependency_vulnerability_scan",
    description: "Nightly dependency baseline and optional npm audit check for the current project.",
    intervalMs: 24 * 60 * 60 * 1000,
    async run({ executeAudit = false }) {
      const packageJsonPath = resolveProjectPath("package.json");
      const packageLockPath = resolveProjectPath("package-lock.json");
      const manifest = existsSync(packageJsonPath)
        ? JSON.parse(await readFile(packageJsonPath, "utf8")) as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> }
        : {};
      const dependencyCount = Object.keys(manifest.dependencies ?? {}).length;
      const devDependencyCount = Object.keys(manifest.devDependencies ?? {}).length;
      const base: JsonObject = {
        ok: true,
        mode: executeAudit ? "npm_audit" : "local_baseline",
        package_json: path.relative(resolveProjectPath(), packageJsonPath),
        package_lock_present: existsSync(packageLockPath),
        dependency_count: dependencyCount,
        dev_dependency_count: devDependencyCount,
        recommended_command: "npm audit --json"
      };
      if (!executeAudit) return base;
      try {
        const npm = existsSync("/opt/homebrew/bin/npm") ? "/opt/homebrew/bin/npm" : "npm";
        const { stdout } = await execFileAsync(npm, ["audit", "--json"], {
          cwd: resolveProjectPath(),
          timeout: 60000,
          maxBuffer: 2 * 1024 * 1024
        });
        const audit = JSON.parse(stdout) as { metadata?: { vulnerabilities?: Record<string, unknown>; dependencies?: Record<string, unknown> } };
        return {
          ...base,
          vulnerabilities: normalizeJsonObject(audit.metadata?.vulnerabilities),
          audit_dependency_summary: normalizeJsonObject(audit.metadata?.dependencies)
        };
      } catch (error) {
        return {
          ...base,
          ok: false,
          error: "npm_audit_failed",
          message: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000)
        };
      }
    }
  };
}

/**
 * 长任务推进 job：扫描当前 workspace 的 active 任务，把"长时间没进展"的标记一笔进展信号
 *   - stuck 判定：updated_at 距 now 超过 stuckMs（默认 6h）
 *   - 推进动作（无 LLM）：把 task.metadata.progress_pings 数组追加一条 {at, source}
 *   - 同时往 metadata.last_progress_ping_at 写时间戳，便于 UI / handler 后续读取
 *
 * 这里不直接发起新的 agentic 调用——把"哪条任务该 ping"和"怎么 ping"解耦，
 * 后续把 ping 转成新消息塞进 agenticHandler 是 plugin/handler 层的事。
 */
export function createLongTaskProgressionJob({
  taskStore = new TaskStore(),
  stuckMs = 6 * 60 * 60 * 1000,
  intervalMs = 30 * 60 * 1000,
  now = () => Date.now()
}: {
  taskStore?: TaskStore;
  stuckMs?: number;
  intervalMs?: number;
  now?: () => number;
} = {}): MaintenanceJobDefinition {
  return {
    name: "recurring.long_task_progression",
    description: "Scan active long-running tasks and emit a progress ping for ones that have been idle past stuckMs.",
    intervalMs,
    async run({ workspace }) {
      const tasks = await taskStore.active(workspace, 50);
      const stuck: Array<{ id: string; subject?: string; idle_ms: number }> = [];
      const pinged: Array<{ id: string; subject?: string }> = [];
      const nowMs = now();
      for (const task of tasks) {
        const updatedAt = Date.parse(task.updated_at ?? task.created_at ?? "");
        if (!Number.isFinite(updatedAt)) continue;
        const idleMs = nowMs - updatedAt;
        if (idleMs < stuckMs) continue;
        stuck.push({ id: task.id, subject: task.subject, idle_ms: idleMs });
        try {
          const updatedTask = await markProgressPing(taskStore, workspace, task, nowMs);
          if (updatedTask) pinged.push({ id: updatedTask.id, subject: updatedTask.subject });
        } catch {
          // 单条 ping 失败不阻塞批次
        }
      }
      return {
        ok: true,
        scanned: tasks.length,
        stuck_count: stuck.length,
        pinged_count: pinged.length,
        stuck,
        pinged,
        stuck_threshold_ms: stuckMs
      };
    }
  };
}

async function markProgressPing(taskStore: TaskStore, workspace: WorkspaceContext, task: AgentTask, nowMs: number): Promise<AgentTask | null> {
  const existingPings = Array.isArray((task.metadata as JsonObject | undefined)?.progress_pings)
    ? ((task.metadata as JsonObject).progress_pings as JsonObject[])
    : [];
  const ping: JsonObject = {
    at: new Date(nowMs).toISOString(),
    source: "scheduler.long_task_progression"
  };
  return taskStore.upsert(workspace, {
    id: task.id,
    task_list_id: task.task_list_id,
    metadata: {
      ...(task.metadata ?? {}),
      progress_pings: [...existingPings, ping].slice(-50),
      last_progress_ping_at: ping.at
    }
  });
}

function isDue(job: MaintenanceJobDefinition, state: MaintenanceJobState | undefined, now: Date): boolean {
  if (state?.enabled === false) return false;
  if (!state?.last_run_at) return true;
  const lastRun = Date.parse(state.last_run_at);
  return !Number.isFinite(lastRun) || now.getTime() - lastRun >= (state.interval_ms || job.intervalMs);
}

function summarizeJobResult(result: JsonObject): string {
  if (result.ok === false) return String(result.error ?? "failed");
  if (typeof result.mode === "string") return `${result.mode}: dependencies=${result.dependency_count ?? 0}, dev=${result.dev_dependency_count ?? 0}`;
  return "ok";
}

function createEmptyState(): MaintenanceSchedulerState {
  return { version: 1, updated_at: new Date(0).toISOString(), jobs: {}, queue: [], notifications: [] };
}

function createNotification(level: MaintenanceNotification["level"], title: string, message: string, job?: string, queueItemId?: string): MaintenanceNotification {
  return {
    id: `mn_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    level,
    title,
    message,
    job,
    queue_item_id: queueItemId,
    created_at: new Date().toISOString(),
    read: false
  };
}

function isQueueItem(value: unknown): value is MaintenanceQueueItem {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && typeof (value as { id?: unknown }).id === "string";
}

function isNotification(value: unknown): value is MaintenanceNotification {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && typeof (value as { id?: unknown }).id === "string";
}

function statePath(workspace: WorkspaceContext): string {
  return safeJoinWorkspace(workspace.root, ".evolution", "maintenance", "scheduler.json");
}

function normalizeJsonObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === null || ["string", "number", "boolean"].includes(typeof item)) out[key] = item as never;
  }
  return out;
}
