import { approvalPlugin } from "./approval.js";
import { expenseEstimatePlugin } from "./expense-estimate.js";
import { genericOpenUIPlugin } from "./generic-openui.js";
import { runtimePlugin } from "./runtime.js";
import { sourcesPlugin } from "./sources.js";
import { taskResumePlugin } from "./task-resume.js";
import { getSurfacePlugins } from "../../domains/runtime-registry.js";
import type { SurfacePlugin } from "./types.js";

export { approvalPlugin, expenseEstimatePlugin, genericOpenUIPlugin, runtimePlugin, sourcesPlugin, taskResumePlugin };
export type { SurfacePlugin, SurfaceBuildOutput, SurfacePluginContext } from "./types.js";

/**
 * 默认插件注册表。
 *
 * 通用插件（approval / task_resume / expense / sources / runtime）在此硬编码，
 * 域特定插件（vehicle_progress / leave_request_form 等）从 DomainRegistry 动态收集。
 *
 * 渲染顺序（上 → 下）：
 * 1. approval（最高优先级 — 阻塞用户后续操作）
 * 2. task_resume（任务恢复入口）
 * 3. 域特定业务卡片（从 DomainPack.surfacePlugins 注册）
 * 4. expense（通用费用估算）
 * 5. sources（引用来源）
 * 6. runtime（执行摘要 / debug 可观测性）
 */
export function defaultSurfacePlugins(): SurfacePlugin<unknown>[] {
  const domainPlugins = getSurfacePlugins();
  return [
    approvalPlugin as SurfacePlugin<unknown>,
    taskResumePlugin as SurfacePlugin<unknown>,
    ...domainPlugins,
    genericOpenUIPlugin as SurfacePlugin<unknown>,
    expenseEstimatePlugin as SurfacePlugin<unknown>,
    sourcesPlugin as SurfacePlugin<unknown>,
    runtimePlugin as SurfacePlugin<unknown>
  ];
}
