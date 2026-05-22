import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { resolveProjectPath } from "../data/load-json.js";
import { createEvolutionTools } from "../evolution/tools.js";
import { SkillCurator } from "../evolution/skill-curator.js";
import { createSkillCuratorPlugin } from "../evolution/skill-curator-plugin.js";
import { EvolutionRuntime } from "../evolution/runtime.js";
import { AgenticSkillView } from "../skills/agentic-skill-view.js";
import { RuntimeHooks } from "../runtime/hooks.js";
import { MaintenanceScheduler } from "../runtime/maintenance-scheduler.js";
import { createMaintenanceSchedulerPlugin } from "../runtime/maintenance-scheduler-plugin.js";
import { PluginGovernanceStore } from "../runtime/plugin-governance.js";
import { resolveUserWorkspace } from "../runtime/workspace-context.js";
import { createMaintenanceTools } from "../tools/maintenance-tools.js";

const workspace = resolveUserWorkspace(`eval_curator_${Date.now()}`);

try {
  await assertSkillCuratorLifecycle();
  await assertSkillCuratorToolsAndView();
  await assertMaintenanceScheduler();
  console.log("PASS skill curator maintenance");
} finally {
  await rm(resolveProjectPath("users", workspace.user_id), { recursive: true, force: true });
}

async function assertSkillCuratorLifecycle(): Promise<void> {
  const curator = new SkillCurator();
  await curator.recordUsage(workspace, "summarize-alert", "used", { staleAfterDays: 1, archiveAfterDays: 2 });
  let entry = curator.get(workspace, "summarize-alert");
  assertEqual(entry?.usage_count, 1, "usage count");
  await curator.refresh(workspace, new Date(Date.now() + 36 * 60 * 60 * 1000));
  entry = curator.get(workspace, "summarize-alert");
  assertEqual(entry?.status, "stale", "skill should become stale");
  await curator.pin(workspace, "summarize-alert", true);
  await curator.refresh(workspace, new Date(Date.now() + 4 * 24 * 60 * 60 * 1000));
  entry = curator.get(workspace, "summarize-alert");
  assertEqual(entry?.status, "active", "pinned skill should remain active");
  await curator.pin(workspace, "summarize-alert", false);
  await curator.refresh(workspace, new Date(Date.now() + 4 * 24 * 60 * 60 * 1000));
  entry = curator.get(workspace, "summarize-alert");
  assertEqual(entry?.status, "archived", "unpinned expired skill should archive");
}

async function assertSkillCuratorToolsAndView(): Promise<void> {
  const view = new AgenticSkillView();
  const curator = new SkillCurator();
  await curator.restore(workspace, "summarize-alert");
  await curator.pin(workspace, "gross-margin-attribution", true);
  const listed = view.listForAgent({ workspace });
  assertEqual(listed[0]?.id, "gross-margin-attribution", "pinned skill should sort first");
  const injected = await view.loadForInjection({ id: "gross-margin-attribution", workspace });
  assert(Boolean(injected.ok), "skill injection should succeed");
  assertEqual(curator.get(workspace, "gross-margin-attribution")?.usage_count, 1, "injection should record usage");

  await curator.archive(workspace, "gross-margin-attribution", "eval");
  const listedAfterArchive = view.listForAgent({ workspace });
  assert(!listedAfterArchive.some((item) => item.id === "gross-margin-attribution"), "archived skill should be hidden");

  const tools = createEvolutionTools({ evolutionRuntime: new EvolutionRuntime() });
  const listTool = tools.find((tool) => tool.name === "skill.curator.list");
  const restoreTool = tools.find((tool) => tool.name === "skill.curator.restore");
  assert(Boolean(listTool && restoreTool), "skill curator tools should register");
  const restored = await restoreTool?.execute({ skill_id: "gross-margin-attribution" }, { workspace });
  assert(Boolean((restored as { ok?: boolean })?.ok), "skill.curator.restore should succeed");
  const listedByTool = await listTool?.execute({}, { workspace });
  assert(Boolean((listedByTool as { data?: { entries?: unknown[] } })?.data?.entries?.length), "skill.curator.list should return entries");

  const hooks = new RuntimeHooks();
  hooks.use(createSkillCuratorPlugin());
  await hooks.emit("turn_end", { user_id: workspace.user_id, session_id: "eval" });
  assert((hooks.inspect().plugins as string[]).includes("skill-curator"), "skill curator plugin should register");
}

async function assertMaintenanceScheduler(): Promise<void> {
  const scheduler = new MaintenanceScheduler();
  const listBefore = await scheduler.list(workspace);
  assert(Boolean((listBefore.jobs as unknown[])?.find((job) => (job as { name?: string }).name === "nightly.dependency_vulnerability_scan")), "scheduler should list nightly scan");
  const run = await scheduler.runJob(workspace, "nightly.dependency_vulnerability_scan");
  assert(Boolean(run.ok), "nightly dependency scan should run");
  const stateFile = path.join(workspace.root, ".evolution", "maintenance", "scheduler.json");
  assert(existsSync(stateFile), "scheduler state should be persisted");
  const state = await readFile(stateFile, "utf8");
  assert(state.includes("nightly.dependency_vulnerability_scan"), "scheduler state should include scan job");
  const enqueued = await scheduler.enqueue(workspace, "nightly.dependency_vulnerability_scan");
  assert(Boolean(enqueued.ok), "scheduler enqueue should succeed");
  const processed = await scheduler.processQueue(workspace);
  assert(Boolean(processed.ok), "scheduler process queue should succeed");
  const listedAfterQueue = await scheduler.list(workspace) as { queue?: Array<{ status?: string }>; notifications?: unknown[] };
  assert(Boolean(listedAfterQueue.queue?.some((item) => item.status === "succeeded")), "scheduler queue should record succeeded item");
  assert(Boolean(listedAfterQueue.notifications?.length), "scheduler should create notifications");

  const tools = createMaintenanceTools({ scheduler });
  const runTool = tools.find((tool) => tool.name === "maintenance.scheduler.run");
  assert(Boolean(runTool), "maintenance tool should register");
  const toolRun = await runTool?.execute({ job: "nightly.dependency_vulnerability_scan" }, { workspace });
  assert(Boolean((toolRun as { ok?: boolean })?.ok), "maintenance.scheduler.run should succeed");

  const hooks = new RuntimeHooks();
  hooks.use(createMaintenanceSchedulerPlugin({ scheduler }));
  await hooks.emit("session_idle", { user_id: workspace.user_id, session_id: "eval" });
  assert((hooks.inspect().plugins as string[]).includes("maintenance-scheduler"), "maintenance scheduler plugin should register");

  const governance = new PluginGovernanceStore();
  await governance.setEnabled(workspace, "eval-governed-plugin", false);
  let governedSeen = false;
  const governedHooks = new RuntimeHooks();
  governedHooks.use({
    name: "eval-governed-plugin",
    register(runtimeHooks) {
      runtimeHooks.on("turn_end", () => { governedSeen = true; });
    }
  });
  await governedHooks.emit("turn_end", { user_id: workspace.user_id });
  assert(!governedSeen, "disabled plugin should not run");
  await governance.setEnabled(workspace, "eval-governed-plugin", true);
  await governedHooks.emit("turn_end", { user_id: workspace.user_id });
  assert(governedSeen, "enabled plugin should run");
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}
