import { businessSurface } from "../openui-bridge.js";
import { button, card, list, row, text } from "../builders/components.js";
import type { SurfacePlugin } from "./types.js";
import type { A2UIComponentInstance } from "../types.js";
import type { JsonObject } from "../../types/agent-contracts.js";

interface TaskResumeData {
  tasks: JsonObject[];
  taskRetrieval: JsonObject | null;
}

export const taskResumePlugin: SurfacePlugin<TaskResumeData> = {
  kind: "task_resume",
  extract: (ctx) => {
    const trace = toRecord(ctx.record.trace) ?? {};
    const taskRetrieval = toRecord(trace.task_retrieval);
    const top = readArray(taskRetrieval?.top).filter(shouldShowTaskResume);
    if (!top.length) return null;
    return { tasks: top, taskRetrieval: taskRetrieval ?? null };
  },
  build: (data, ctx) => ({
    surfaceId: `${ctx.surfacePrefix}_${ctx.runId}_task_resume`,
    root: "task_resume_root",
    data: {
      task_retrieval: data.taskRetrieval,
      tasks: data.tasks,
      ...businessSurface("task_resume", data.tasks.length > 1 ? "你想继续哪个任务？" : "继续这个任务？", { tasks: data.tasks }, taskResumeActions(data.tasks))
    },
    components: taskResumeComponents(data.tasks)
  })
};

export function taskResumeActions(tasks: JsonObject[]): JsonObject[] {
  return tasks.flatMap((task) => {
    const taskId = String(task.id ?? "");
    const taskListId = String(task.task_list_id ?? "");
    if (!taskId) return [];
    return [
      { name: "task.resume.select", label: "继续这个", context: { task_id: taskId, task_list_id: taskListId } },
      { name: "task.resume.ignore", label: "先不继续", context: { task_id: taskId, task_list_id: taskListId } }
    ];
  });
}

function taskResumeComponents(tasks: JsonObject[]): A2UIComponentInstance[] {
  const multi = tasks.length > 1;
  return [
    card("task_resume_root", ["task_resume_title", "task_resume_list"]),
    text("task_resume_title", multi ? "### 你想继续哪个任务？" : "### 继续这个任务？"),
    list("task_resume_list", tasks.map((_, index) => `task_resume_${index}`)),
    ...tasks.flatMap((task, index) => {
      const taskId = String(task.id ?? "");
      const taskListId = String(task.task_list_id ?? "");
      const subject = String(task.subject ?? task.active_form ?? taskId ?? "未命名任务");
      const detail = [
        `**${subject}**`,
        task.status ? `状态：${String(task.status)}` : "",
        task.next_action ? `下一步：${String(task.next_action)}` : "",
        task.goal ? `目标：${String(task.goal)}` : "",
        `相关度：${String(task.relevance ?? "-")}`,
        task.reason ? `召回原因：${String(task.reason)}` : ""
      ].filter(Boolean).join("\n\n");
      return [
        card(`task_resume_${index}`, [`task_resume_${index}_text`, `task_resume_${index}_actions`]),
        text(`task_resume_${index}_text`, detail),
        row(`task_resume_${index}_actions`, [`task_resume_${index}_select`, `task_resume_${index}_ignore`]),
        button(`task_resume_${index}_select`, "继续这个", "task.resume.select", { task_id: taskId, task_list_id: taskListId }),
        button(`task_resume_${index}_ignore`, "先不继续", "task.resume.ignore", { task_id: taskId, task_list_id: taskListId })
      ];
    })
  ];
}

function shouldShowTaskResume(task: JsonObject): boolean {
  const reason = String(task.reason ?? "");
  const relevance = typeof task.relevance === "number" ? task.relevance : 0;
  return relevance >= 0.3 || reason.includes("continue") || reason.includes("keyword");
}

function toRecord(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function readArray(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.map(toRecord).filter((item): item is JsonObject => Boolean(item)) : [];
}
