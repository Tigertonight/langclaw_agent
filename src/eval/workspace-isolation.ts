import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { UserWorkspaceSessionStore, createSession } from "../agent/session-store.js";
import { resolveProjectPath } from "../data/load-json.js";
import { MemoryLearner } from "../evolution/memory-learner.js";
import { EnterpriseContextProvider } from "../runtime/enterprise-context.js";
import { resolveUserWorkspace } from "../runtime/workspace-context.js";
import { createSandboxTools } from "../tools/sandbox-tools.js";
import type { UserContext } from "../types/agent-contracts.js";

const userA = createUser(`eval_user_a_${Date.now()}`);
const userB = createUser(`eval_user_b_${Date.now()}`);
const workspaceA = resolveUserWorkspace(userA);
const workspaceB = resolveUserWorkspace(userB);

try {
  await assertSessionIsolation();
  await assertMemoryIsolation();
  await assertSandboxIsolation();
  console.log("PASS workspace isolation");
} finally {
  await rm(resolveProjectPath("users", workspaceA.user_id), { recursive: true, force: true });
  await rm(resolveProjectPath("users", workspaceB.user_id), { recursive: true, force: true });
}

async function assertSessionIsolation(): Promise<void> {
  const store = new UserWorkspaceSessionStore();
  const sessionId = "shared-session-id";
  const sessionA = createSession(sessionId);
  sessionA.owner_user_id = userA.id;
  sessionA.state = { marker: "A" };
  const sessionB = createSession(sessionId);
  sessionB.owner_user_id = userB.id;
  sessionB.state = { marker: "B" };

  await store.save(sessionA, workspaceA);
  await store.save(sessionB, workspaceB);

  const recoveredA = await store.get(sessionId, workspaceA);
  const recoveredB = await store.get(sessionId, workspaceB);
  assertEqual(recoveredA.state.marker, "A", "user A session marker");
  assertEqual(recoveredB.state.marker, "B", "user B session marker");
  assert(existsSync(path.join(workspaceA.sessions_dir, "shared-session-id.json")), "user A session file missing");
  assert(existsSync(path.join(workspaceB.sessions_dir, "shared-session-id.json")), "user B session file missing");
}

async function assertMemoryIsolation(): Promise<void> {
  const learner = new MemoryLearner();
  const provider = new EnterpriseContextProvider();
  await learner.apply({
    workspace: workspaceA,
    actions: [{
      op: "upsert",
      type: "preference",
      key: "answer_style_preference",
      value: "以后回答我简短一点，用列表展示",
      confidence: 0.9
    }]
  });

  const contextA = await provider.load({ user: userA, workspace: workspaceA }) as { user_memory?: { items?: Array<{ key?: string }> } };
  const contextB = await provider.load({ user: userB, workspace: workspaceB }) as { user_memory?: { items?: Array<{ key?: string }> } };
  assert(Boolean(contextA.user_memory?.items?.some((item) => item.key === "answer_style_preference")), "user A memory missing");
  assert(!contextB.user_memory?.items?.some((item) => item.key === "answer_style_preference"), "user B should not see user A memory");
}

async function assertSandboxIsolation(): Promise<void> {
  const safeCompute = createSandboxTools().find((tool) => tool.name === "safe_compute");
  if (!safeCompute) throw new Error("safe_compute tool missing");

  const result = await safeCompute.execute?.(
    { code: "1 + 2 * 3", mode: "expression" },
    { user: userA, workspace: workspaceA }
  ) as { ok?: boolean; data?: { value?: unknown } };

  assert(result?.ok === true, "safe_compute should succeed");
  assertEqual(result.data?.value, 7, "safe_compute result");
  assert(existsSync(workspaceA.sandboxes_dir), "user A sandbox dir missing");
  const auditFile = path.join(workspaceA.logs_dir, "sandbox", "safe_compute.jsonl");
  assert(existsSync(auditFile), "user A sandbox audit missing");
  const audit = await readFile(auditFile, "utf8");
  assert(audit.includes(userA.id), "sandbox audit should include user A id");
  assert(!existsSync(path.join(workspaceB.logs_dir, "sandbox", "safe_compute.jsonl")), "user B should not have sandbox audit");
}

function createUser(id: string): UserContext {
  return {
    id,
    name: id,
    role: "eval",
    permissions: [],
    accessible_customer_ids: []
  };
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}
