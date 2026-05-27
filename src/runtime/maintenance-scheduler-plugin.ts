import { resolveUserWorkspace } from "./workspace-context.js";
import type { RuntimePlugin } from "./hooks.js";
import { MaintenanceScheduler } from "./maintenance-scheduler.js";

export function createMaintenanceSchedulerPlugin({ scheduler = new MaintenanceScheduler() }: { scheduler?: MaintenanceScheduler } = {}): RuntimePlugin {
  return {
    name: "maintenance-scheduler",
    register(hooks) {
      hooks.on("session_idle", async (event) => {
        const userId = typeof event.user_id === "string" ? event.user_id : "";
        if (!userId) return;
        await scheduler.runDue(resolveUserWorkspace(userId));
      });
    }
  };
}
