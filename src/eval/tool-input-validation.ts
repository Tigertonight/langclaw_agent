import { rm } from "node:fs/promises";
import { resolveProjectPath } from "../data/load-json.js";
import { resolveUserWorkspace } from "../runtime/workspace-context.js";
import { ToolRegistry } from "../tools/registry.js";
import { createSandboxTools } from "../tools/sandbox-tools.js";
import { createPluginTools } from "../tools/plugin-tools.js";
import { createTaskTools } from "../tasks/tools.js";
import { createKnowledgeTools } from "../tools/knowledge-tools.js";
import { createMaintenanceTools } from "../tools/maintenance-tools.js";
import { createMemoryTools } from "../memory/tools.js";
import { createBusinessTools } from "../tools/business-tools.js";
import { createPendingActionTools } from "../tools/pending-action-tools.js";
import type { ToolResult } from "../types/agent-contracts.js";

const workspace = resolveUserWorkspace(`eval_zod_${Date.now()}`);
const failures: string[] = [];

try {
  const registry: ToolRegistry = new ToolRegistry([
    ...createSandboxTools(),
    ...createPluginTools(),
    ...createTaskTools(),
    ...createKnowledgeTools({ knowledgeBase: { search: async () => [] } }),
    ...createMaintenanceTools(),
    ...createMemoryTools(),
    ...createBusinessTools(),
    ...createPendingActionTools({ toolRegistry: { execute: async () => ({ ok: true }) } })
  ]);

  const context = {
    user: {
      id: workspace.user_id,
      role: "employee",
      permissions: ["policy:read", "customer:read", "order:read", "sales_report:read", "leave:submit"],
      accessible_customer_ids: []
    },
    workspace
  };

  // safe_compute: missing required `code`
  await expectInvalid(
    "safe_compute missing code",
    await registry.execute({ name: "safe_compute", args: {} }, context),
    "code"
  );

  // safe_compute: timeout_ms out of range
  await expectInvalid(
    "safe_compute timeout_ms above max",
    await registry.execute({ name: "safe_compute", args: { code: "1+1", timeout_ms: 99999 } }, context),
    "timeout_ms"
  );

  // safe_compute: extra unknown property (strict mode)
  await expectInvalid(
    "safe_compute extra prop rejected",
    await registry.execute({ name: "safe_compute", args: { code: "1+1", evil: true } }, context),
    "evil"
  );

  // runtime.plugin.config: invalid plugin id (regex)
  await expectInvalid(
    "runtime.plugin.config bad plugin id",
    await registry.execute({ name: "runtime.plugin.config", args: { plugin: "has space!", config: {} } }, context),
    "plugin"
  );

  // runtime.plugin.config: missing config
  await expectInvalid(
    "runtime.plugin.config missing config",
    await registry.execute({ name: "runtime.plugin.config", args: { plugin: "demo.plugin" } }, context),
    "config"
  );

  // task.create: missing title
  await expectInvalid(
    "task.create missing title",
    await registry.execute({ name: "task.create", args: { goal: "hello" } }, context),
    "title"
  );

  // task.create: invalid priority enum
  await expectInvalid(
    "task.create bad priority",
    await registry.execute({ name: "task.create", args: { title: "x", priority: "urgent" } }, context),
    "priority"
  );

  // task.update: missing id
  await expectInvalid(
    "task.update missing id",
    await registry.execute({ name: "task.update", args: { status: "completed" } }, context),
    "id"
  );

  // task.update: invalid status enum
  await expectInvalid(
    "task.update bad status",
    await registry.execute({ name: "task.update", args: { id: "tsk_1", status: "DONE" } }, context),
    "status"
  );

  // sanity: knowledge-tools — query too long
  await expectInvalid(
    "retrieve_knowledge query empty",
    await registry.execute({ name: "retrieve_knowledge", args: { query: "" } }, context),
    "query"
  );

  // sanity: maintenance-tools — bad job pattern
  await expectInvalid(
    "maintenance.scheduler.run bad job",
    await registry.execute({ name: "maintenance.scheduler.run", args: { job: "bad job!" } }, context),
    "job"
  );

  // sanity: memory tools — missing required query
  await expectInvalid(
    "memory.retrieve missing query",
    await registry.execute({ name: "memory.retrieve", args: {} }, context),
    "query"
  );

  // sanity: business-tools — bad filter op (zod enum)
  await expectInvalid(
    "query_business_data bad filter op",
    await registry.execute({ name: "query_business_data", args: { resource: "customers", filters: [{ field: "tier", op: "regex", value: "x" }] } }, context),
    "op"
  );

  // sanity: pending-action-tools — bad id pattern
  await expectInvalid(
    "runtime.pending_action.reject bad id",
    await registry.execute({ name: "runtime.pending_action.reject", args: { id: "has space" } }, context),
    "id"
  );

  // Positive control: legal task.create succeeds
  await expectOk(
    "task.create legal input",
    await registry.execute({ name: "task.create", args: { title: "legal task", priority: "high" } }, context)
  );

  if (failures.length > 0) {
    console.error(`FAIL tool input validation: ${failures.length} failures`);
    for (const message of failures) console.error(` - ${message}`);
    process.exitCode = 1;
  } else {
    console.log("PASS tool input validation");
  }
} finally {
  await rm(resolveProjectPath("users", workspace.user_id), { recursive: true, force: true });
}

async function expectInvalid(label: string, result: unknown, pathFragment: string): Promise<void> {
  const r = result as ToolResult | undefined;
  if (!r || r.ok !== false || r.error !== "invalid_input") {
    failures.push(`${label}: expected invalid_input, got ${JSON.stringify(r)}`);
    return;
  }
  const issues = (r.data as { issues?: Array<{ path?: string; message?: string }> } | undefined)?.issues ?? [];
  const matched = issues.some((issue) => (issue.path ?? "").includes(pathFragment) || (issue.message ?? "").includes(pathFragment));
  if (!matched) {
    failures.push(`${label}: invalid_input did not flag '${pathFragment}': ${JSON.stringify(issues)}`);
  }
}

async function expectOk(label: string, result: unknown): Promise<void> {
  const r = result as ToolResult | undefined;
  if (!r || r.ok === false) {
    failures.push(`${label}: expected ok=true, got ${JSON.stringify(r)}`);
  }
}
