import { resolveUserWorkspace, type WorkspaceContext } from "../runtime/workspace-context.js";
import type { JsonObject, ToolDefinition, ToolExecutionContext } from "../types/agent-contracts.js";
import { TaskRetriever } from "./task-retriever.js";
import { TaskStore, summarizeTask } from "./task-store.js";
import type { TaskStatus } from "./task-types.js";

const taskStore = new TaskStore();
const taskRetriever = new TaskRetriever({ taskStore });

export function createTaskTools(): ToolDefinition[] {
  return [
    {
      name: "task.list",
      description: "List active or filtered user-workspace tasks.",
      metadata: { required_permissions: [], expose_to_agentic: true, risk_level: "read" },
      schema: { type: "object", properties: { status: { type: "string" }, limit: { type: "number" } } },
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const statuses = typeof args?.status === "string" ? [args.status as TaskStatus] : undefined;
        const tasks = (await taskStore.list(workspace, { statuses })).slice(0, readLimit(args?.limit, 20)).map(summarizeTask);
        return { ok: true, tool: "task.list", data: { tasks } };
      }
    },
    {
      name: "task.retrieve",
      description: "Retrieve tasks relevant to the current user message, including continue-last-task requests.",
      metadata: { required_permissions: [], expose_to_agentic: true, risk_level: "read" },
      schema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] },
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const tasks = await taskRetriever.retrieve(workspace, String(args?.query ?? ""), readLimit(args?.limit, 5));
        return { ok: true, tool: "task.retrieve", data: { tasks } };
      }
    },
    {
      name: "task.create",
      description: "Create a structured long-running task in the current user workspace.",
      metadata: { required_permissions: [], expose_to_agentic: true, risk_level: "write" },
      schema: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, goal: { type: "string" }, next_action: { type: "string" }, priority: { type: "string" } }, required: ["title"] },
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const task = await taskStore.upsert(workspace, {
          id: stringOrUndefined(args?.id),
          subject: String(args?.title ?? args?.goal ?? "task"),
          goal: stringOrUndefined(args?.goal),
          next_action: stringOrUndefined(args?.next_action),
          priority: args?.priority === "high" || args?.priority === "low" ? args.priority : "medium",
          status: "in_progress",
          metadata: { source: "task_tool" }
        });
        return { ok: true, tool: "task.create", data: { task: summarizeTask(task) } };
      }
    },
    {
      name: "task.update",
      description: "Update task state, next action, facts, or open questions.",
      metadata: { required_permissions: [], expose_to_agentic: true, risk_level: "write" },
      schema: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, status: { type: "string" }, next_action: { type: "string" }, known_facts: { type: "array" }, open_questions: { type: "array" } }, required: ["id"] },
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const task = await taskStore.upsert(workspace, {
          id: String(args?.id ?? "task"),
          subject: stringOrUndefined(args?.title),
          status: normalizeStatus(args?.status),
          next_action: stringOrUndefined(args?.next_action),
          open_questions: normalizeStringArray(args?.open_questions),
          evidence: normalizeStringArray(args?.known_facts).map((fact, index) => ({
            id: `tool_fact_${Date.now()}_${index + 1}`,
            kind: "note",
            summary: fact,
            created_at: new Date().toISOString()
          })),
          metadata: { source: "task_tool" }
        });
        return { ok: true, tool: "task.update", data: { task: summarizeTask(task) } };
      }
    },
    {
      name: "task.complete",
      description: "Mark a task as completed.",
      metadata: { required_permissions: [], expose_to_agentic: true, risk_level: "write" },
      schema: { type: "object", properties: { id: { type: "string" }, task_list_id: { type: "string" } }, required: ["id"] },
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const taskListId = String(args?.task_list_id ?? taskStore.listIdForUser(workspace));
        const task = await taskStore.setStatus(workspace, taskListId, String(args?.id ?? "task"), "completed");
        return { ok: Boolean(task), tool: "task.complete", data: { task: task ? summarizeTask(task) : null } };
      }
    },
    {
      name: "task.link_artifact",
      description: "Link an artifact path or URL to an existing task.",
      metadata: { required_permissions: [], expose_to_agentic: true, risk_level: "write" },
      schema: { type: "object", properties: { id: { type: "string" }, artifact: { type: "string" } }, required: ["id", "artifact"] },
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const task = await taskStore.upsert(workspace, {
          id: String(args?.id ?? "task"),
          artifacts: [String(args?.artifact ?? "")].filter(Boolean),
          metadata: { source: "task_tool" }
        });
        return { ok: true, tool: "task.link_artifact", data: { task: summarizeTask(task) } };
      }
    }
  ];
}

function getWorkspace(context: ToolExecutionContext = {}): WorkspaceContext {
  const workspace = context.workspace;
  if (workspace && typeof workspace === "object" && !Array.isArray(workspace) && typeof (workspace as { root?: unknown }).root === "string") {
    return workspace as WorkspaceContext;
  }
  return resolveUserWorkspace(context.user?.id ?? "anonymous");
}

function readLimit(value: unknown, fallback: number): number {
  const limit = Number(value);
  return Number.isFinite(limit) && limit > 0 ? Math.min(limit, 50) : fallback;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
}

function normalizeStatus(value: unknown): TaskStatus | undefined {
  const text = String(value ?? "");
  return ["pending", "in_progress", "waiting_user", "blocked", "completed", "archived"].includes(text) ? text as TaskStatus : undefined;
}
