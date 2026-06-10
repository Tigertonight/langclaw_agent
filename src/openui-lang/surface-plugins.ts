import { getSurfacePlugins } from "../domains/runtime-registry.js";
import type { SurfacePlugin } from "./compat.js";
import { approvalPlugin } from "./plugins/approval.js";
import { expenseEstimatePlugin } from "./plugins/expense-estimate.js";
import { genericOpenUIPlugin } from "./plugins/generic-openui.js";
import { runtimePlugin } from "./plugins/runtime.js";
import { sourcesPlugin } from "./plugins/sources.js";
import { taskResumePlugin } from "./plugins/task-resume.js";

/**
 * Default OpenUI Lang surface plugins.
 *
 * Some plugin implementations still live in the legacy compatibility folder
 * while the project migrates file ownership. This OpenUI entrypoint is the
 * protocol-facing registry used by new code.
 */
export function defaultOpenUILangSurfacePlugins(): SurfacePlugin<unknown>[] {
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

export type { SurfacePlugin };
