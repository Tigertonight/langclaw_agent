import { TaskRetriever } from "./task-retriever.js";
import { TaskStore, summarizeTask } from "./task-store.js";
import type { RuntimePlugin } from "../runtime/hooks.js";
import { resolveUserWorkspace } from "../runtime/workspace-context.js";

export function createTaskContinuityPlugin({
  taskStore = new TaskStore(),
  taskRetriever = new TaskRetriever({ taskStore })
}: {
  taskStore?: TaskStore;
  taskRetriever?: TaskRetriever;
} = {}): RuntimePlugin {
  return {
    name: "task-continuity",
    register(hooks) {
      hooks.on("agentic_prepare", async (event) => {
        const userId = typeof event.user_id === "string" ? event.user_id : "";
        const message = typeof event.message === "string" ? event.message : "";
        if (!userId || !message.trim()) return { relevant_tasks: [], claimed_task: null };
        const workspace = resolveUserWorkspace(userId);
        const relevant = await taskRetriever.retrieve(workspace, message, 5);
        const top = relevant[0];
        if (!top || top.relevance < 0.2) return { relevant_tasks: relevant, claimed_task: null };
        const task = await taskStore.upsert(workspace, {
          id: String(top.id),
          task_list_id: String(top.task_list_id),
          status: "in_progress",
          metadata: {
            claimed_by: "task_continuity_plugin",
            claimed_at: new Date().toISOString(),
            claim_reason: top.reason,
            route_hint: typeof event.route_hint === "string" ? event.route_hint : null
          },
          evidence: [{
            id: `claim_${Date.now()}`,
            kind: "note",
            summary: `Agent resumed this task for message: ${message.slice(0, 240)}`,
            created_at: new Date().toISOString()
          }]
        });
        return { relevant_tasks: relevant, claimed_task: { ...summarizeTask(task), relevance: top.relevance, reason: top.reason } };
      });

      hooks.on("agentic_complete", async (event) => {
        const userId = typeof event.user_id === "string" ? event.user_id : "";
        const claimed = event.claimed_task && typeof event.claimed_task === "object" && !Array.isArray(event.claimed_task)
          ? event.claimed_task as Record<string, unknown>
          : null;
        if (!userId || !claimed?.id || !claimed.task_list_id) return;
        const plannerState = event.planner_state && typeof event.planner_state === "object" && !Array.isArray(event.planner_state)
          ? event.planner_state as { plan?: unknown[]; completed?: unknown[]; missing?: unknown[] }
          : {};
        const nextAction = readFirstString(plannerState.missing) ?? readLastString(plannerState.plan);
        await taskStore.upsert(resolveUserWorkspace(userId), {
          id: String(claimed.id),
          task_list_id: String(claimed.task_list_id),
          next_action: nextAction,
          evidence: [{
            id: `agentic_answer_${Date.now()}`,
            kind: "note",
            summary: `Agent answer preview: ${String(event.answer ?? "").slice(0, 400)}`,
            created_at: new Date().toISOString()
          }],
          metadata: {
            last_agentic_progress_at: new Date().toISOString(),
            planner_completed_count: plannerState.completed?.length ?? 0,
            planner_missing_count: plannerState.missing?.length ?? 0
          }
        });
      });
    }
  };
}

function readFirstString(value: unknown): string | undefined {
  return Array.isArray(value) ? value.find((item): item is string => typeof item === "string") : undefined;
}

function readLastString(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (typeof value[index] === "string") return value[index] as string;
  }
  return undefined;
}
