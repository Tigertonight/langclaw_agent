import { TaskStore } from "../tasks/task-store.js";
import type { WorkspaceContext } from "../runtime/workspace-context.js";
import type { TaskAction } from "./types.js";
import type { TaskStatus } from "../tasks/task-types.js";
import { loadDisabledEvolutionTargets } from "./governance.js";

export class TaskLearner {
  private readonly taskStore: TaskStore;

  constructor({ taskStore = new TaskStore() }: { taskStore?: TaskStore } = {}) {
    this.taskStore = taskStore;
  }

  async apply({ workspace, actions }: { workspace: WorkspaceContext; actions?: TaskAction[] }): Promise<number> {
    const normalized = Array.isArray(actions) ? actions : [];
    if (!normalized.length) return 0;
    const disabled = await loadDisabledEvolutionTargets(workspace);
    let changed = 0;
    for (const action of normalized) {
      const taskId = action.task_id ?? action.title ?? action.goal ?? "task";
      if (disabled.has(taskId) || disabled.has(`task:${taskId}`)) continue;
      const taskListId = this.taskStore.listIdForUser(workspace);
      if (action.op === "remove") {
        await this.taskStore.remove(workspace, taskListId, taskId);
        changed += 1;
        continue;
      }
      if (action.op === "complete" || action.op === "archive") {
        const status: TaskStatus = action.op === "complete" ? "completed" : "archived";
        const existing = await this.taskStore.setStatus(workspace, taskListId, taskId, status);
        if (existing) {
          changed += 1;
          continue;
        }
      }
      await this.taskStore.upsert(workspace, {
        id: taskId,
        task_list_id: taskListId,
        subject: action.title ?? action.goal ?? taskId,
        description: action.goal,
        active_form: action.next_action ?? action.title ?? action.goal,
        owner: "agent",
        status: normalizeStatus(action.status) ?? "in_progress",
        priority: "medium",
        goal: action.goal,
        open_questions: action.open_questions,
        next_action: action.next_action,
        metadata: {
          source: "evolution",
          confidence: action.confidence
        },
        evidence: (action.known_facts ?? []).map((fact, index) => ({
          id: `fact_${index + 1}`,
          kind: "note",
          summary: fact,
          created_at: new Date().toISOString()
        }))
      });
      changed += 1;
    }
    return changed;
  }
}

function normalizeStatus(value: unknown): TaskStatus | null {
  if (["pending", "in_progress", "waiting_user", "blocked", "completed", "archived"].includes(String(value))) {
    return value as TaskStatus;
  }
  if (value === "active") return "in_progress";
  return null;
}
