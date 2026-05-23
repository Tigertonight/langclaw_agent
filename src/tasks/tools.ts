import { resolveUserWorkspace, type WorkspaceContext } from "../runtime/workspace-context.js";
import type { ToolDefinition, ToolExecutionContext } from "../types/agent-contracts.js";
import { TaskRetriever } from "./task-retriever.js";
import { TaskStore, summarizeTask } from "./task-store.js";
import type { TaskStatus } from "./task-types.js";
import { defineTool, z, ToolResultBaseSchema } from "../tools/zod-helpers.js";

const taskStore = new TaskStore();
const taskRetriever = new TaskRetriever({ taskStore });

const TASK_STATUSES = ["pending", "in_progress", "waiting_user", "blocked", "completed", "archived"] as const;
const TASK_PRIORITIES = ["high", "medium", "low"] as const;
const TASK_OWNERS = ["agent", "user", "system"] as const;
const idSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.\-:]+$/);

export function createTaskTools(): ToolDefinition[] {
  return [
    defineTool({
      name: "task.list",
      description: "List active or filtered user-workspace tasks.",
      metadata: { required_permissions: [], expose_to_agentic: true, risk_level: "read" },
      inputSchema: z.object({
        status: z.enum(TASK_STATUSES).optional(),
        limit: z.number().int().min(1).max(50).optional()
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const statuses = args.status ? [args.status as TaskStatus] : undefined;
        const tasks = (await taskStore.list(workspace, { statuses })).slice(0, args.limit ?? 20).map(summarizeTask);
        return { ok: true, tool: "task.list", data: { tasks } };
      }
    }),
    defineTool({
      name: "task.retrieve",
      description: "Retrieve tasks relevant to the current user message, including continue-last-task requests.",
      metadata: { required_permissions: [], expose_to_agentic: true, risk_level: "read" },
      inputSchema: z.object({
        query: z.string().min(1).max(500),
        limit: z.number().int().min(1).max(50).optional()
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const tasks = await taskRetriever.retrieve(workspace, args.query, args.limit ?? 5);
        return { ok: true, tool: "task.retrieve", data: { tasks } };
      }
    }),
    defineTool({
      name: "task.create",
      description: "Create a structured long-running task in the current user workspace.",
      metadata: { required_permissions: [], expose_to_agentic: true, risk_level: "write" },
      inputSchema: z.object({
        id: idSchema.optional(),
        title: z.string().min(1).max(200),
        goal: z.string().max(1000).optional(),
        next_action: z.string().max(500).optional(),
        priority: z.enum(TASK_PRIORITIES).optional()
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const task = await taskStore.upsert(workspace, {
          id: args.id,
          subject: args.title,
          goal: args.goal,
          next_action: args.next_action,
          priority: args.priority ?? "medium",
          status: "in_progress",
          metadata: { source: "task_tool" }
        });
        return { ok: true, tool: "task.create", data: { task: summarizeTask(task) } };
      }
    }),
    defineTool({
      name: "task.update",
      description: "Update task state, next action, facts, or open questions.",
      metadata: { required_permissions: [], expose_to_agentic: true, risk_level: "write" },
      inputSchema: z.object({
        id: idSchema,
        title: z.string().min(1).max(200).optional(),
        status: z.enum(TASK_STATUSES).optional(),
        next_action: z.string().max(500).optional(),
        known_facts: z.array(z.string().max(500)).max(50).optional(),
        open_questions: z.array(z.string().max(500)).max(50).optional()
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const task = await taskStore.upsert(workspace, {
          id: args.id,
          subject: args.title,
          status: args.status,
          next_action: args.next_action,
          open_questions: args.open_questions ?? [],
          evidence: (args.known_facts ?? []).map((fact, index) => ({
            id: `tool_fact_${Date.now()}_${index + 1}`,
            kind: "note",
            summary: fact,
            created_at: new Date().toISOString()
          })),
          metadata: { source: "task_tool" }
        });
        return { ok: true, tool: "task.update", data: { task: summarizeTask(task) } };
      }
    }),
    defineTool({
      name: "task.complete",
      description: "Mark a task as completed.",
      metadata: { required_permissions: [], expose_to_agentic: true, risk_level: "write" },
      inputSchema: z.object({
        id: idSchema,
        task_list_id: idSchema.optional()
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const taskListId = args.task_list_id ?? taskStore.listIdForUser(workspace);
        const task = await taskStore.setStatus(workspace, taskListId, args.id, "completed");
        return { ok: Boolean(task), tool: "task.complete", data: { task: task ? summarizeTask(task) : null } };
      }
    }),
    defineTool({
      name: "task.claim",
      description: "Claim a task for active business-agent work and mark it in progress.",
      metadata: { required_permissions: [], expose_to_agentic: true, risk_level: "write" },
      inputSchema: z.object({
        id: idSchema,
        task_list_id: idSchema.optional(),
        owner: z.enum(TASK_OWNERS).optional()
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const task = await taskStore.upsert(workspace, {
          id: args.id,
          task_list_id: args.task_list_id,
          owner: args.owner ?? "agent",
          status: "in_progress",
          metadata: {
            claimed_at: new Date().toISOString(),
            claimed_by: args.owner ?? context.user?.id ?? "agent"
          }
        });
        return { ok: true, tool: "task.claim", data: { task: summarizeTask(task) } };
      }
    }),
    defineTool({
      name: "task.release",
      description: "Release a claimed task back to pending or waiting_user.",
      metadata: { required_permissions: [], expose_to_agentic: true, risk_level: "write" },
      inputSchema: z.object({
        id: idSchema,
        task_list_id: idSchema.optional(),
        status: z.enum(TASK_STATUSES).optional()
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const task = await taskStore.upsert(workspace, {
          id: args.id,
          task_list_id: args.task_list_id,
          status: (args.status as TaskStatus | undefined) ?? "pending",
          metadata: {
            released_at: new Date().toISOString(),
            released_by: context.user?.id ?? "agent"
          }
        });
        return { ok: true, tool: "task.release", data: { task: summarizeTask(task) } };
      }
    }),
    defineTool({
      name: "task.block",
      description: "Mark a task as blocked and link blocker task ids or an open question.",
      metadata: { required_permissions: [], expose_to_agentic: true, risk_level: "write" },
      inputSchema: z.object({
        id: idSchema,
        blocked_by: z.array(idSchema).max(20).optional(),
        reason: z.string().max(500).optional(),
        task_list_id: idSchema.optional()
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const reason = args.reason?.trim() || undefined;
        const task = await taskStore.upsert(workspace, {
          id: args.id,
          task_list_id: args.task_list_id,
          status: "blocked",
          blocked_by: args.blocked_by ?? [],
          open_questions: reason ? [reason] : [],
          metadata: {
            blocked_at: new Date().toISOString(),
            block_reason: reason
          }
        });
        return { ok: true, tool: "task.block", data: { task: summarizeTask(task) } };
      }
    }),
    defineTool({
      name: "task.unblock",
      description: "Unblock a task and move it back to in_progress.",
      metadata: { required_permissions: [], expose_to_agentic: true, risk_level: "write" },
      inputSchema: z.object({
        id: idSchema,
        task_list_id: idSchema.optional(),
        next_action: z.string().max(500).optional()
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const task = await taskStore.upsert(workspace, {
          id: args.id,
          task_list_id: args.task_list_id,
          status: "in_progress",
          next_action: args.next_action,
          blocked_by: [],
          metadata: {
            unblocked_at: new Date().toISOString(),
            unblocked_by: context.user?.id ?? "agent"
          }
        });
        task.blocked_by = [];
        await taskStore.save(workspace, task);
        await taskStore.updateActiveIndex(workspace);
        return { ok: true, tool: "task.unblock", data: { task: summarizeTask(task) } };
      }
    }),
    defineTool({
      name: "task.busy",
      description: "Check whether this workspace has in-progress or blocked business tasks.",
      metadata: { required_permissions: [], expose_to_agentic: true, risk_level: "read" },
      inputSchema: z.object({}).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(_args, context) {
        const workspace = getWorkspace(context);
        const tasks = await taskStore.active(workspace, 20);
        return {
          ok: true,
          tool: "task.busy",
          data: {
            busy: tasks.some((task) => task.status === "in_progress" || task.status === "blocked"),
            tasks: tasks.map(summarizeTask)
          }
        };
      }
    }),
    defineTool({
      name: "task.link_artifact",
      description: "Link an artifact path or URL to an existing task.",
      metadata: { required_permissions: [], expose_to_agentic: true, risk_level: "write" },
      inputSchema: z.object({
        id: idSchema,
        artifact: z.string().min(1).max(1000)
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const task = await taskStore.upsert(workspace, {
          id: args.id,
          artifacts: [args.artifact],
          metadata: { source: "task_tool" }
        });
        return { ok: true, tool: "task.link_artifact", data: { task: summarizeTask(task) } };
      }
    })
  ];
}

function getWorkspace(context: ToolExecutionContext = {}): WorkspaceContext {
  const workspace = context.workspace;
  if (workspace && typeof workspace === "object" && !Array.isArray(workspace) && typeof (workspace as { root?: unknown }).root === "string") {
    return workspace as WorkspaceContext;
  }
  return resolveUserWorkspace(context.user?.id ?? "anonymous");
}
