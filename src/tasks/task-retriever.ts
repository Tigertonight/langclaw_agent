import { TaskStore, summarizeTask } from "./task-store.js";
import type { WorkspaceContext } from "../runtime/workspace-context.js";
import type { AgentTask, TaskStatus } from "./task-types.js";

const ACTIVE: TaskStatus[] = ["pending", "in_progress", "waiting_user", "blocked"];
const CONTINUE_PATTERNS = [/继续/, /上次/, /刚才/, /那个/, /\bcontinue\b/i, /\blast\b/i, /\bresume\b/i];

export class TaskRetriever {
  private readonly taskStore: TaskStore;

  constructor({ taskStore = new TaskStore() }: { taskStore?: TaskStore } = {}) {
    this.taskStore = taskStore;
  }

  async retrieve(workspace: WorkspaceContext, message: string, limit = 5): Promise<Array<ReturnType<typeof summarizeTask> & { relevance: number; reason: string }>> {
    const tasks = await this.taskStore.list(workspace, { statuses: ACTIVE });
    const scored = tasks
      .map((task) => scoreTask(task, message))
      .filter((item) => item.relevance > 0 || isContinueRequest(message))
      .sort((a, b) => b.relevance - a.relevance || b.task.updated_at.localeCompare(a.task.updated_at))
      .slice(0, limit);
    if (!scored.length && isContinueRequest(message)) {
      return tasks.slice(0, limit).map((task) => ({ ...summarizeTask(task), relevance: 0.2, reason: "continue_request_recent_active" }));
    }
    return scored.map(({ task, relevance, reason }) => ({ ...summarizeTask(task), relevance, reason }));
  }
}

function scoreTask(task: AgentTask, message: string): { task: AgentTask; relevance: number; reason: string } {
  const tokens = tokenize(message);
  const haystack = [
    task.id,
    task.subject,
    task.active_form,
    task.goal,
    task.description,
    task.next_action,
    ...task.open_questions,
    ...task.artifacts,
    ...task.evidence.map((item) => item.summary)
  ].join(" ").toLowerCase();
  let overlap = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) overlap += 1;
  }
  const recency = Math.max(0, 1 - ((Date.now() - Date.parse(task.updated_at)) / (7 * 24 * 60 * 60 * 1000)));
  const continueBoost = isContinueRequest(message) ? 0.35 : 0;
  const relevance = Math.min(1, (tokens.length ? overlap / tokens.length : 0) + continueBoost + recency * 0.15);
  return { task, relevance, reason: overlap ? "keyword_overlap" : continueBoost ? "continue_request" : "recent_active" };
}

function tokenize(value: string): string[] {
  const raw = String(value ?? "")
    .toLowerCase()
    .split(/[^a-z0-9_\u4e00-\u9fa5]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
    .slice(0, 40);
  const expanded = new Set(raw);
  for (const token of raw) {
    if (!/[\u4e00-\u9fa5]/u.test(token) || token.length <= 2) continue;
    for (let index = 0; index < token.length - 1; index += 1) {
      expanded.add(token.slice(index, index + 2));
    }
  }
  return Array.from(expanded).slice(0, 80);
}

function isContinueRequest(message: string): boolean {
  return CONTINUE_PATTERNS.some((pattern) => pattern.test(message));
}
