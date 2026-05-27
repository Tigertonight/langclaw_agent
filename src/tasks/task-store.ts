import { mkdir, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { safeJoinWorkspace, safeUserId, type WorkspaceContext } from "../runtime/workspace-context.js";
import { defaultJsonFileStore, type JsonFileStore } from "../runtime/store-adapter.js";
import type { AgentTask, TaskStatus, TaskUpsertInput } from "./task-types.js";

const ACTIVE_STATUSES: TaskStatus[] = ["pending", "in_progress", "waiting_user", "blocked"];

/**
 * Phase 5: 高水位标记
 *
 * tasks/lists/{taskListId}/.highwatermark 文件记录该 taskList 最后一次 active index 更新时间，
 * 供下游（ContextAssembler / Evolution）判断是否需要重新加载任务列表，避免频繁全量扫描。
 */
async function updateHighwatermark(workspace: WorkspaceContext, taskListId: string): Promise<void> {
  try {
    const listDir = safeJoinWorkspace(workspace.root, "tasks", "lists", safeUserId(taskListId));
    await mkdir(listDir, { recursive: true });
    await writeFile(path.join(listDir, ".highwatermark"), new Date().toISOString(), "utf8");
  } catch {
    /* 高水位更新失败不阻塞主流程 */
  }
}

/**
 * Phase 5: 读取高水位时间戳。
 * 返回 null 表示从未更新（应全量重建）。
 */
export async function readHighwatermark(workspace: WorkspaceContext, taskListId: string): Promise<string | null> {
  try {
    const file = safeJoinWorkspace(workspace.root, "tasks", "lists", safeUserId(taskListId), ".highwatermark");
    if (!existsSync(file)) return null;
    return (await readFile(file, "utf8")).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Phase 5 并发防护：文件级 .lock
 *
 * 使用"先写后读-校验"协议（spin lock）保护同一 taskList 的并发写入：
 *  1. 写入 .lock 文件（内容 = 当前 holder UUID + 时间戳）
 *  2. 短暂等待后重新读取 .lock，如果仍是自己的 UUID，则持有锁成功
 *  3. 如果不是自己的 UUID，则等待后重试（最多 LOCK_MAX_RETRIES 次）
 *  4. 操作完成后删除 .lock 文件
 *
 * 注意：这是基于文件系统的软性保护，适用于单机/单进程多协程场景。
 * 分布式场景需要替换为 Redis / Zookeeper 等外部锁。
 */
const LOCK_ACQUIRE_WAIT_MS = 80;    // 每次重试等待
const LOCK_MAX_RETRIES = 25;        // 最多重试次数（约 2 秒）
const LOCK_STALE_MS = 10_000;       // 锁文件超过此时限视为残留（自动清理）

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 尝试获取 taskList 目录的文件锁，返回 holderId（用于后续释放）。
 * 失败时抛出 Error("lock_timeout")。
 */
async function acquireLock(workspace: WorkspaceContext, taskListId: string): Promise<string> {
  const listDir = safeJoinWorkspace(workspace.root, "tasks", "lists", safeUserId(taskListId));
  await mkdir(listDir, { recursive: true });
  const lockFile = path.join(listDir, ".lock");
  const holderId = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const payload = JSON.stringify({ holder: holderId, ts: Date.now() });

  for (let attempt = 0; attempt < LOCK_MAX_RETRIES; attempt++) {
    // 先检查是否已有锁
    if (existsSync(lockFile)) {
      try {
        const existing = JSON.parse(await readFile(lockFile, "utf8")) as { holder?: string; ts?: number };
        const age = Date.now() - (existing.ts ?? 0);
        if (age > LOCK_STALE_MS) {
          // 残留锁：直接清理
          await unlink(lockFile).catch(() => {});
        } else {
          // 锁被其他持有者持有，等待后重试
          await sleep(LOCK_ACQUIRE_WAIT_MS);
          continue;
        }
      } catch {
        // 读取失败（并发写入中）：等待后重试
        await sleep(LOCK_ACQUIRE_WAIT_MS);
        continue;
      }
    }
    // 写入自己的锁
    await writeFile(lockFile, payload, "utf8");
    // 短暂等待后重新校验：确保没有 race condition
    await sleep(20);
    try {
      const verify = JSON.parse(await readFile(lockFile, "utf8")) as { holder?: string };
      if (verify.holder === holderId) {
        return holderId; // 成功持有
      }
    } catch {
      // 校验失败，重试
    }
    await sleep(LOCK_ACQUIRE_WAIT_MS);
  }
  throw new Error("lock_timeout");
}

/**
 * 释放文件锁（只有当前 holder 才能释放）。
 */
async function releaseLock(workspace: WorkspaceContext, taskListId: string, holderId: string): Promise<void> {
  const lockFile = path.join(
    safeJoinWorkspace(workspace.root, "tasks", "lists", safeUserId(taskListId)),
    ".lock"
  );
  try {
    if (!existsSync(lockFile)) return;
    const existing = JSON.parse(await readFile(lockFile, "utf8")) as { holder?: string };
    if (existing.holder === holderId) {
      await unlink(lockFile);
    }
  } catch {
    /* 释放失败不阻塞主流程 */
  }
}

/**
 * 在持有 taskList 文件锁期间执行 fn，自动获取和释放锁。
 * 如果 taskListId 为 undefined（全局 active index 等），直接执行不加锁。
 */
async function withTaskListLock<T>(
  workspace: WorkspaceContext,
  taskListId: string | undefined,
  fn: () => Promise<T>
): Promise<T> {
  if (!taskListId) return fn();
  let holderId: string | null = null;
  try {
    holderId = await acquireLock(workspace, taskListId);
    return await fn();
  } finally {
    if (holderId) {
      await releaseLock(workspace, taskListId, holderId);
    }
  }
}

export class TaskStore {
  private readonly store: JsonFileStore;

  constructor(store: JsonFileStore = defaultJsonFileStore()) {
    this.store = store;
  }

  listIdForUser(workspace: WorkspaceContext, sessionId = "default"): string {
    return safeUserId(`${workspace.user_id}_${sessionId}`.slice(0, 120));
  }

  async upsert(workspace: WorkspaceContext, input: TaskUpsertInput): Promise<AgentTask> {
    const taskListId = safeUserId(input.task_list_id ?? this.listIdForUser(workspace));
    const id = safeTaskId(input.id ?? input.subject ?? input.goal ?? "task");
    return withTaskListLock(workspace, taskListId, async () => {
      const existing = await this.get(workspace, taskListId, id);
      const now = new Date().toISOString();
      const next: AgentTask = {
        id,
        task_list_id: taskListId,
        subject: input.subject ?? existing?.subject ?? input.goal ?? id,
        description: input.description ?? existing?.description,
        active_form: input.active_form ?? existing?.active_form ?? input.subject ?? existing?.subject,
        owner: input.owner ?? existing?.owner ?? "agent",
        status: input.status ?? existing?.status ?? "pending",
        priority: input.priority ?? existing?.priority ?? "medium",
        blocks: mergeList(existing?.blocks, input.blocks),
        blocked_by: mergeList(existing?.blocked_by, input.blocked_by),
        goal: input.goal ?? existing?.goal,
        plan: input.plan ?? existing?.plan ?? [],
        artifacts: mergeList(existing?.artifacts, input.artifacts),
        evidence: mergeEvidence(existing?.evidence, input.evidence),
        open_questions: mergeList(existing?.open_questions, input.open_questions),
        next_action: input.next_action ?? existing?.next_action,
        metadata: { ...(existing?.metadata ?? {}), ...(input.metadata ?? {}) },
        created_at: existing?.created_at ?? now,
        updated_at: now
      };
      await this.save(workspace, next);
      await this.updateActiveIndex(workspace);
      return next;
    });
  }

  async setStatus(workspace: WorkspaceContext, taskListId: string, taskId: string, status: TaskStatus): Promise<AgentTask | null> {
    return withTaskListLock(workspace, taskListId, async () => {
      const existing = await this.get(workspace, taskListId, taskId);
      if (!existing) return null;
      const next = { ...existing, status, updated_at: new Date().toISOString() };
      await this.save(workspace, next);
      await this.updateActiveIndex(workspace);
      return next;
    });
  }

  async remove(workspace: WorkspaceContext, taskListId: string, taskId: string): Promise<void> {
    await withTaskListLock(workspace, taskListId, async () => {
      await rm(this.taskPath(workspace, taskListId, taskId), { force: true });
      await this.updateActiveIndex(workspace);
    });
  }

  async get(workspace: WorkspaceContext, taskListId: string, taskId: string): Promise<AgentTask | null> {
    const file = this.taskPath(workspace, taskListId, taskId);
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(await readFile(file, "utf8")) as AgentTask;
    } catch {
      return null;
    }
  }

  async list(workspace: WorkspaceContext, { statuses }: { statuses?: TaskStatus[] } = {}): Promise<AgentTask[]> {
    const listsRoot = this.listsRoot(workspace);
    if (!existsSync(listsRoot)) return [];
    const tasks: AgentTask[] = [];
    for (const listDir of await readdir(listsRoot, { withFileTypes: true })) {
      if (!listDir.isDirectory()) continue;
      const dir = path.join(listsRoot, listDir.name);
      for (const file of await readdir(dir, { withFileTypes: true })) {
        if (!file.isFile() || !file.name.endsWith(".json")) continue;
        const task = await this.get(workspace, listDir.name, file.name.replace(/\.json$/, ""));
        if (!task) continue;
        if (statuses?.length && !statuses.includes(task.status)) continue;
        tasks.push(task);
      }
    }
    return tasks.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async active(workspace: WorkspaceContext, limit = 8): Promise<AgentTask[]> {
    return (await this.list(workspace, { statuses: ACTIVE_STATUSES })).slice(0, limit);
  }

  async updateActiveIndex(workspace: WorkspaceContext): Promise<void> {
    const active = await this.active(workspace, 20);
    const indexPath = safeJoinWorkspace(workspace.root, "tasks", "active.json");
    await this.store.mutate<{ updated_at: string; tasks: ReturnType<typeof summarizeTask>[] }>(
      indexPath,
      { updated_at: new Date().toISOString(), tasks: [] },
      () => ({ updated_at: new Date().toISOString(), tasks: active.map(summarizeTask) })
    );
    // Phase 5: 高水位标记 — 按每个 task_list_id 更新
    const listIds = new Set(active.map((t) => t.task_list_id));
    for (const listId of listIds) {
      await updateHighwatermark(workspace, listId);
    }
    // 更新全局高水位（无 list_id 范围时使用）
    await updateHighwatermark(workspace, "default");
  }

  async save(workspace: WorkspaceContext, task: AgentTask): Promise<void> {
    await mkdir(this.listDir(workspace, task.task_list_id), { recursive: true });
    await writeFile(this.taskPath(workspace, task.task_list_id, task.id), JSON.stringify(task, null, 2), "utf8");
  }

  root(workspace: WorkspaceContext): string {
    return safeJoinWorkspace(workspace.root, "tasks");
  }

  listsRoot(workspace: WorkspaceContext): string {
    return safeJoinWorkspace(workspace.root, "tasks", "lists");
  }

  listDir(workspace: WorkspaceContext, taskListId: string): string {
    return safeJoinWorkspace(workspace.root, "tasks", "lists", safeUserId(taskListId));
  }

  taskPath(workspace: WorkspaceContext, taskListId: string, taskId: string): string {
    return path.join(this.listDir(workspace, taskListId), `${safeTaskId(taskId)}.json`);
  }
}

export function summarizeTask(task: AgentTask) {
  return {
    id: task.id,
    task_list_id: task.task_list_id,
    subject: task.subject,
    active_form: task.active_form,
    owner: task.owner,
    status: task.status,
    priority: task.priority,
    blocks: task.blocks,
    blocked_by: task.blocked_by,
    goal: task.goal,
    next_action: task.next_action,
    open_questions: task.open_questions,
    updated_at: task.updated_at
  };
}

function mergeList(left?: string[], right?: string[]): string[] {
  const values = [...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])]
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
  return [...new Set(values)].slice(-100);
}

function mergeEvidence(left: AgentTask["evidence"] = [], right: AgentTask["evidence"] = []): AgentTask["evidence"] {
  const map = new Map<string, AgentTask["evidence"][number]>();
  for (const item of left.concat(right)) map.set(item.id, item);
  return Array.from(map.values()).slice(-100);
}

function safeTaskId(value: unknown): string {
  return safeUserId(String(value ?? "task").slice(0, 100)) || `task_${Date.now()}`;
}

// 导出锁工具函数，供 eval / 外部模块复用
export { acquireLock, releaseLock, withTaskListLock };
