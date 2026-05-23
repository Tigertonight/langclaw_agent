import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { safeJoinWorkspace, safeUserId, type WorkspaceContext } from "../runtime/workspace-context.js";
import { defaultJsonFileStore, type JsonFileStore } from "../runtime/store-adapter.js";
import type { AgentTask, TaskStatus, TaskUpsertInput } from "./task-types.js";

const ACTIVE_STATUSES: TaskStatus[] = ["pending", "in_progress", "waiting_user", "blocked"];

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
  }

  async setStatus(workspace: WorkspaceContext, taskListId: string, taskId: string, status: TaskStatus): Promise<AgentTask | null> {
    const existing = await this.get(workspace, taskListId, taskId);
    if (!existing) return null;
    const next = { ...existing, status, updated_at: new Date().toISOString() };
    await this.save(workspace, next);
    await this.updateActiveIndex(workspace);
    return next;
  }

  async remove(workspace: WorkspaceContext, taskListId: string, taskId: string): Promise<void> {
    await rm(this.taskPath(workspace, taskListId, taskId), { force: true });
    await this.updateActiveIndex(workspace);
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
