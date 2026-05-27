import { approvalPlugin } from "./approval.js";
import { expenseEstimatePlugin } from "./expense-estimate.js";
import { leaveRequestPlugin } from "./leave-request.js";
import { runtimePlugin } from "./runtime.js";
import { sourcesPlugin } from "./sources.js";
import { taskResumePlugin } from "./task-resume.js";
import { vehicleProgressPlugin } from "./vehicle-progress.js";
import type { SurfacePlugin } from "./types.js";

export { approvalPlugin, expenseEstimatePlugin, leaveRequestPlugin, runtimePlugin, sourcesPlugin, taskResumePlugin, vehicleProgressPlugin };
export type { SurfacePlugin, SurfaceBuildOutput, SurfacePluginContext } from "./types.js";

/**
 * 默认插件注册表。顺序决定了渲染顺序（上 → 下）：
 * 1. approval（最高优先级 — 阻塞用户后续操作）
 * 2. task_resume（任务恢复入口）
 * 3. vehicle_progress / expense / leave（业务卡片）
 * 4. sources（引用来源）
 * 5. runtime（执行摘要 / debug 可观测性）
 */
export function defaultSurfacePlugins(): SurfacePlugin<unknown>[] {
  return [
    approvalPlugin as SurfacePlugin<unknown>,
    taskResumePlugin as SurfacePlugin<unknown>,
    vehicleProgressPlugin as SurfacePlugin<unknown>,
    expenseEstimatePlugin as SurfacePlugin<unknown>,
    leaveRequestPlugin as SurfacePlugin<unknown>,
    sourcesPlugin as SurfacePlugin<unknown>,
    runtimePlugin as SurfacePlugin<unknown>
  ];
}
