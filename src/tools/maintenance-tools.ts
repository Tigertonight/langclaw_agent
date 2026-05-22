import { MaintenanceScheduler } from "../runtime/maintenance-scheduler.js";
import { resolveUserWorkspace, type WorkspaceContext } from "../runtime/workspace-context.js";
import type { ToolDefinition, ToolExecutionContext } from "../types/agent-contracts.js";

export function createMaintenanceTools({ scheduler = new MaintenanceScheduler() }: { scheduler?: MaintenanceScheduler } = {}): ToolDefinition[] {
  return [
    {
      name: "maintenance.scheduler.list",
      description: "List active maintenance scheduler jobs and their last/next run state for the current user workspace.",
      metadata: { required_permissions: [], risk_level: "read", expose_to_agentic: true },
      schema: { type: "object", properties: {} },
      async execute(_args, context) {
        return { ok: true, tool: "maintenance.scheduler.list", data: await scheduler.list(getWorkspace(context)) };
      }
    },
    {
      name: "maintenance.scheduler.run_due",
      description: "Run due cron-like maintenance jobs for the current user workspace.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      schema: { type: "object", properties: {} },
      async execute(_args, context) {
        return { ok: true, tool: "maintenance.scheduler.run_due", data: await scheduler.runDue(getWorkspace(context)) };
      }
    },
    {
      name: "maintenance.scheduler.enqueue",
      description: "Queue one maintenance job for retryable background execution.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      schema: {
        type: "object",
        properties: {
          job: { type: "string" },
          max_attempts: { type: "number" }
        },
        required: ["job"]
      },
      async execute(args, context) {
        const job = typeof args?.job === "string" ? args.job : "";
        if (!job) return { ok: false, tool: "maintenance.scheduler.enqueue", error: "missing_job" };
        return { ok: true, tool: "maintenance.scheduler.enqueue", data: await scheduler.enqueue(getWorkspace(context), job, { maxAttempts: Number(args?.max_attempts) || 3 }) };
      }
    },
    {
      name: "maintenance.scheduler.process_queue",
      description: "Process due queued maintenance jobs, applying retry and notification policy.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      schema: { type: "object", properties: {} },
      async execute(_args, context) {
        return { ok: true, tool: "maintenance.scheduler.process_queue", data: await scheduler.processQueue(getWorkspace(context)) };
      }
    },
    {
      name: "maintenance.scheduler.run",
      description: "Run one maintenance job now. The default demo job is nightly.dependency_vulnerability_scan.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      schema: {
        type: "object",
        properties: {
          job: { type: "string" },
          execute_audit: { type: "boolean", description: "When true, run npm audit --json; default false uses local baseline only." }
        },
        required: ["job"]
      },
      async execute(args, context) {
        const job = typeof args?.job === "string" ? args.job : "";
        if (!job) return { ok: false, tool: "maintenance.scheduler.run", error: "missing_job" };
        return {
          ok: true,
          tool: "maintenance.scheduler.run",
          data: await scheduler.runJob(getWorkspace(context), job, { executeAudit: args?.execute_audit === true })
        };
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
