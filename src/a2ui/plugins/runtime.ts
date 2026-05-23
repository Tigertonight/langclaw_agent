import { businessSurface } from "../openui-bridge.js";
import { card, list, text, toRecord } from "../builders/components.js";
import type { SurfacePlugin } from "./types.js";
import type { A2UIComponentInstance } from "../types.js";
import type { JsonObject } from "../../types/agent-contracts.js";

interface RuntimeData {
  route: JsonObject | null;
  taskRetrieval: JsonObject | null;
}

export const runtimePlugin: SurfacePlugin<RuntimeData> = {
  kind: "runtime",
  extract: (ctx) => {
    const trace = toRecord(ctx.record.trace) ?? {};
    const debug = toRecord(ctx.record.debug) ?? toRecord(toRecord(ctx.record.output)?.debug) ?? {};
    const route = toRecord(trace.route_summary) ?? toRecord(debug.route);
    const taskRetrieval = toRecord(trace.task_retrieval);
    if (!route && !taskRetrieval) return null;
    return { route: route ?? null, taskRetrieval: taskRetrieval ?? null };
  },
  build: (data, ctx) => ({
    surfaceId: `${ctx.surfacePrefix}_${ctx.runId}_runtime`,
    root: "runtime_root",
    data: {
      route: data.route,
      task_retrieval: data.taskRetrieval,
      ...businessSurface("runtime_summary", "本轮执行摘要", { route: data.route, task_retrieval: data.taskRetrieval })
    },
    components: runtimeComponents(data)
  })
};

function runtimeComponents({ route, taskRetrieval }: RuntimeData): A2UIComponentInstance[] {
  const taskTop = Array.isArray(taskRetrieval?.top) ? taskRetrieval.top as JsonObject[] : [];
  const children = ["runtime_title", "runtime_route"];
  if (taskTop.length) children.push("runtime_tasks");
  return [
    card("runtime_root", children),
    text("runtime_title", "### 本轮执行摘要"),
    text("runtime_route", [
      `路由：${String(route?.intent_code ?? "unknown")}`,
      `执行：${String(route?.execution_class ?? "-")} / ${String(route?.handler_type ?? "-")}`,
      `置信度：${String(route?.confidence ?? "-")}`
    ].join("\n")),
    ...(taskTop.length ? [
      list("runtime_tasks", taskTop.map((_, index) => `runtime_task_${index}`)),
      ...taskTop.map((task, index) => text(`runtime_task_${index}`, `${String(task.id ?? "")} · ${String(task.status ?? "")} · relevance=${String(task.relevance ?? "-")}`))
    ] : [])
  ];
}
