import { rm } from "node:fs/promises";
import { resolveProjectPath } from "../data/load-json.js";
import { BusinessQueryEngine } from "../runtime/business-query-engine.js";
import { ContextAssembler } from "../runtime/context-assembler.js";
import { resolveUserWorkspace } from "../runtime/workspace-context.js";
import { PendingActionStore } from "../runtime/pending-action-store.js";
import { createTaskTools } from "../tasks/tools.js";
import { createPendingActionTools } from "../tools/pending-action-tools.js";
import { ToolRegistry } from "../tools/registry.js";
import type { ToolDefinition, UserContext } from "../types/agent-contracts.js";

const user: UserContext = { id: `eval_business_runtime_${Date.now()}`, role: "eval", permissions: [] };
const workspace = resolveUserWorkspace(user);

try {
  await assertQueryEngineAndContext();
  await assertTaskLoopTools();
  await assertToolGovernance();
  console.log("PASS business agent runtime");
} finally {
  await rm(resolveProjectPath("users", workspace.user_id), { recursive: true, force: true });
}

async function assertQueryEngineAndContext(): Promise<void> {
  const engine = new BusinessQueryEngine({
    agent: {
      async run(input) {
        return { session_id: input.sessionId, answer: `ok:${input.message}` };
      }
    },
    userContextResolver: {
      async resolve() {
        return user;
      }
    },
    enterpriseContextProvider: {
      async load() {
        return {
          admin: [{ name: "POLICY.md", content: "A".repeat(2000) }],
          user_memory: { items: [{ key: "brief", value: "回答简洁" }] },
          memory: { relevant: [{ source: "memory", id: "brief" }] },
          tasks: { active: [{ id: "followup", status: "in_progress" }] },
          policy: { admin_managed: true }
        };
      }
    }
  });
  const result = await engine.submitMessage({ userId: user.id, message: "继续跟进客户", sessionId: "eval-session" });
  assertEqual(result.answer, "ok:继续跟进客户", "query engine answer");
  assertEqual(result.session_id, "eval-session", "query engine session");
  assert(Boolean(result.run_id), "query engine should return run_id");
  assert(Boolean(result.context_budget?.used_chars), "query engine should return context budget");

  const assembled = new ContextAssembler().assemble({
    user,
    workspace,
    message: "x",
    enterpriseContext: { admin: [{ content: "A".repeat(5000) }], tasks: { active: [] } },
    budget: { adminChars: 1000, maxChars: 2500 }
  });
  assert(Boolean(assembled.dropped.length), "context assembler should report dropped sections");
}

async function assertTaskLoopTools(): Promise<void> {
  const tools = createTaskTools();
  const create = tools.find((tool) => tool.name === "task.create");
  const claim = tools.find((tool) => tool.name === "task.claim");
  const block = tools.find((tool) => tool.name === "task.block");
  const unblock = tools.find((tool) => tool.name === "task.unblock");
  const busy = tools.find((tool) => tool.name === "task.busy");
  assert(Boolean(create && claim && block && unblock && busy), "task loop tools should register");
  await create?.execute({ id: "biz_task", title: "跟进重点客户" }, { user, workspace });
  const claimed = await claim?.execute({ id: "biz_task", owner: "agent" }, { user, workspace }) as { data?: { task?: { status?: string } } };
  assertEqual(claimed.data?.task?.status, "in_progress", "task claim status");
  const blocked = await block?.execute({ id: "biz_task", reason: "等待客户回复" }, { user, workspace }) as { data?: { task?: { status?: string } } };
  assertEqual(blocked.data?.task?.status, "blocked", "task block status");
  const unblocked = await unblock?.execute({ id: "biz_task", next_action: "发送提醒" }, { user, workspace }) as { data?: { task?: { status?: string } } };
  assertEqual(unblocked.data?.task?.status, "in_progress", "task unblock status");
  const busyResult = await busy?.execute({}, { user, workspace }) as { data?: { busy?: boolean } };
  assertEqual(busyResult.data?.busy, true, "task busy should detect active work");
}

async function assertToolGovernance(): Promise<void> {
  const dangerous: ToolDefinition = {
    name: "submit_leave_request",
    description: "submit leave request",
    metadata: { risk_level: "write", requires_confirmation: true },
    execute() {
      return { ok: true };
    }
  };
  const pendingActionStore = new PendingActionStore();
  const registry = new ToolRegistry([dangerous], { pendingActionStore });
  for (const tool of createPendingActionTools({ pendingActionStore, toolRegistry: registry })) registry.register(tool);
  const userWithPermission = { ...user, permissions: ["leave:submit"] };
  const denied = await registry.execute({ name: "submit_leave_request", args: {} }, { user: userWithPermission, workspace, session_id: "eval-session" });
  assertEqual((denied as { error?: string }).error, "confirmation_required", "confirmation should be required");
  const pendingId = ((denied as { data?: { pending_action_id?: string } }).data?.pending_action_id);
  assert(Boolean(pendingId), "confirmation should create pending action");
  const confirmedPending = await registry.execute({ name: "runtime.pending_action.confirm", args: { id: pendingId } }, { user: userWithPermission, workspace, session_id: "eval-session", confirmed: true });
  assertEqual((confirmedPending as { ok?: boolean }).ok, true, "pending action confirm should execute original tool");
  const allowed = await registry.execute({ name: "submit_leave_request", args: {} }, { user: userWithPermission, confirmed: true });
  assertEqual((allowed as { ok?: boolean }).ok, true, "confirmed tool should run");
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}
