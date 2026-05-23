import { MaintenanceScheduler } from "../runtime/maintenance-scheduler.js";
import { resolveUserWorkspace, type WorkspaceContext } from "../runtime/workspace-context.js";
import type { ToolDefinition, ToolExecutionContext } from "../types/agent-contracts.js";
import { defineTool, z, ToolResultBaseSchema } from "./zod-helpers.js";

const jobNameSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.\-]+$/);

export function createMaintenanceTools({ scheduler = new MaintenanceScheduler() }: { scheduler?: MaintenanceScheduler } = {}): ToolDefinition[] {
  return [
    defineTool({
      name: "maintenance.scheduler.list",
      description: "List active maintenance scheduler jobs and their last/next run state for the current user workspace.",
      metadata: { required_permissions: [], risk_level: "read", expose_to_agentic: true },
      inputSchema: z.object({}).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(_args, context) {
        return { ok: true, tool: "maintenance.scheduler.list", data: await scheduler.list(getWorkspace(context)) };
      }
    }),
    defineTool({
      name: "maintenance.scheduler.run_due",
      description: "Run due cron-like maintenance jobs for the current user workspace.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      inputSchema: z.object({}).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(_args, context) {
        return { ok: true, tool: "maintenance.scheduler.run_due", data: await scheduler.runDue(getWorkspace(context)) };
      }
    }),
    defineTool({
      name: "maintenance.scheduler.enqueue",
      description: "Queue one maintenance job for retryable background execution.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      inputSchema: z.object({
        job: jobNameSchema,
        max_attempts: z.number().int().min(1).max(10).optional()
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        return { ok: true, tool: "maintenance.scheduler.enqueue", data: await scheduler.enqueue(getWorkspace(context), args.job, { maxAttempts: args.max_attempts ?? 3 }) };
      }
    }),
    defineTool({
      name: "maintenance.scheduler.process_queue",
      description: "Process due queued maintenance jobs, applying retry and notification policy.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      inputSchema: z.object({}).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(_args, context) {
        return { ok: true, tool: "maintenance.scheduler.process_queue", data: await scheduler.processQueue(getWorkspace(context)) };
      }
    }),
    defineTool({
      name: "maintenance.scheduler.run",
      description: "Run one maintenance job now. The default demo job is nightly.dependency_vulnerability_scan.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      inputSchema: z.object({
        job: jobNameSchema,
        execute_audit: z.boolean().optional().describe("When true, run npm audit --json; default false uses local baseline only.")
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        return {
          ok: true,
          tool: "maintenance.scheduler.run",
          data: await scheduler.runJob(getWorkspace(context), args.job, { executeAudit: args.execute_audit === true })
        };
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
