import { ToolRegistry } from "../tools/registry.js";
import { ToolPolicyStore } from "../tools/tool-policy.js";
import type { ToolCall, ToolDefinition, ToolExecutionContext, ToolResult, UserContext } from "../types/agent-contracts.js";

/**
 * 验证 ToolRegistry 的 retry：
 *   1. timeout 错误：retries=2 时会重试到第 3 次成功
 *   2. network 错误：同样重试
 *   3. internal_error 错误：不重试，立刻返回 failed
 *   4. permission_denied 早于 retry：不重试
 *   5. retries=0：失败一次就返回，不重试
 *   6. metadata.timeout_ms 覆盖 policy.timeout_ms
 */
async function main(): Promise<void> {
  const user: UserContext = { id: "ops_runtime", role: "admin", permissions: ["runtime:inspect"], accessible_customer_ids: [] };

  // case 1: 前两次抛 timeout，第三次成功
  let attemptsCase1 = 0;
  const flakyTimeoutTool: ToolDefinition = {
    name: "runtime.flaky_timeout",
    description: "fails with timeout twice then succeeds",
    schema: { type: "object", properties: {} },
    async execute(): Promise<ToolResult> {
      attemptsCase1 += 1;
      if (attemptsCase1 < 3) {
        const err = new Error("upstream timed out");
        err.name = "TimeoutError";
        throw err;
      }
      return { ok: true, isError: false, tool: "runtime.flaky_timeout", data: { attempts: attemptsCase1 } };
    }
  };

  // case 2: network 错误
  let attemptsCase2 = 0;
  const flakyNetworkTool: ToolDefinition = {
    name: "runtime.flaky_network",
    description: "fails with network once",
    schema: { type: "object", properties: {} },
    async execute(): Promise<ToolResult> {
      attemptsCase2 += 1;
      if (attemptsCase2 < 2) throw new Error("ECONNRESET while contacting upstream");
      return { ok: true, isError: false, tool: "runtime.flaky_network", data: { attempts: attemptsCase2 } };
    }
  };

  // case 3: internal_error
  let attemptsCase3 = 0;
  const internalErrorTool: ToolDefinition = {
    name: "runtime.fake_internal",
    description: "throws non-retriable",
    schema: { type: "object", properties: {} },
    async execute(): Promise<ToolResult> {
      attemptsCase3 += 1;
      throw new Error("undefined is not a function");
    }
  };

  // case 5: retries=0 → 单次失败
  let attemptsCase5 = 0;
  const noRetryTool: ToolDefinition = {
    name: "runtime.fake_noretry",
    description: "timeout but policy retries=0",
    schema: { type: "object", properties: {} },
    async execute(): Promise<ToolResult> {
      attemptsCase5 += 1;
      const err = new Error("timed out");
      err.name = "TimeoutError";
      throw err;
    }
  };

  // case 6: metadata override
  let observedTimeoutCase6 = 0;
  const metadataOverrideTool: ToolDefinition = {
    name: "runtime.fake_meta_override",
    description: "always succeeds, but slow",
    schema: { type: "object", properties: {} },
    metadata: { timeout_ms: 50, risk_level: "read" },
    async execute(_args, ctx?: ToolExecutionContext): Promise<ToolResult> {
      observedTimeoutCase6 += 1;
      void ctx;
      // 故意 sleep 200ms，触发 50ms 超时
      await new Promise((resolve) => setTimeout(resolve, 200));
      return { ok: true, isError: false, tool: "runtime.fake_meta_override" };
    }
  };

  const policyStore = new ToolPolicyStore({
    defaults: { timeout_ms: 5000, retries: 0, retry_backoff_ms: 5 },
    tools: {
      "runtime.flaky_timeout": { retries: 2, retry_backoff_ms: 5 },
      "runtime.flaky_network": { retries: 2, retry_backoff_ms: 5 },
      "runtime.fake_internal": { retries: 3, retry_backoff_ms: 5 },
      "runtime.fake_noretry": { retries: 0 },
      "runtime.fake_meta_override": { timeout_ms: 5000, retries: 0 }
    }
  });

  const registry = new ToolRegistry(
    [flakyTimeoutTool, flakyNetworkTool, internalErrorTool, noRetryTool, metadataOverrideTool],
    { policyStore }
  );

  const ctx: ToolExecutionContext = { user };

  // case 1
  const r1 = await registry.execute({ name: "runtime.flaky_timeout", args: {} } satisfies ToolCall, ctx) as ToolResult;
  assert(r1.ok === true, `case1 should eventually succeed, got ${JSON.stringify(r1)}`);
  assert(attemptsCase1 === 3, `case1 should run 3 attempts, got ${attemptsCase1}`);

  // case 2
  const r2 = await registry.execute({ name: "runtime.flaky_network", args: {} } satisfies ToolCall, ctx) as ToolResult;
  assert(r2.ok === true, `case2 should succeed after retry, got ${JSON.stringify(r2)}`);
  assert(attemptsCase2 === 2, `case2 should run 2 attempts, got ${attemptsCase2}`);

  // case 3: internal_error 不重试
  const r3 = await registry.execute({ name: "runtime.fake_internal", args: {} } satisfies ToolCall, ctx) as ToolResult;
  assert(r3.ok === false && r3.code === "internal_error", `case3 should fail with internal_error, got ${JSON.stringify(r3)}`);
  assert(attemptsCase3 === 1, `case3 should run only 1 attempt despite retries=3, got ${attemptsCase3}`);

  // case 4: permission_denied → 工具压根没跑（user 没 perms 的工具）
  const restrictedTool: ToolDefinition = {
    name: "runtime.fake_restricted",
    description: "needs perm",
    schema: { type: "object", properties: {} },
    metadata: { required_permissions: ["secret:admin"] },
    async execute(): Promise<ToolResult> { throw new Error("should not run"); }
  };
  registry.register(restrictedTool);
  const r4 = await registry.execute({ name: "runtime.fake_restricted", args: {} } satisfies ToolCall, ctx) as ToolResult;
  // 注意：required_permissions 走 isToolAvailable → tool_unavailable，不是 permission_denied
  assert(r4.ok === false, `case4 should fail (perm/unavailable), got ${JSON.stringify(r4)}`);
  assert(r4.error === "tool_unavailable" || r4.error === "permission_denied", `case4 should reject before execute, got ${r4.error}`);

  // case 5: 单次失败
  const r5 = await registry.execute({ name: "runtime.fake_noretry", args: {} } satisfies ToolCall, ctx) as ToolResult;
  assert(r5.ok === false && r5.code === "timeout", `case5 should fail with timeout, got ${JSON.stringify(r5)}`);
  assert(attemptsCase5 === 1, `case5 should run only 1 attempt, got ${attemptsCase5}`);

  // case 6: metadata.timeout_ms=50 覆盖 policy.timeout_ms=5000，必然超时
  const r6 = await registry.execute({ name: "runtime.fake_meta_override", args: {} } satisfies ToolCall, ctx) as ToolResult;
  assert(r6.ok === false && r6.code === "timeout", `case6 should hit metadata 50ms timeout, got ${JSON.stringify(r6)}`);
  assert(observedTimeoutCase6 >= 1, "case6 tool should have been invoked at least once");

  console.log("PASS tool-retry (timeout-recovers / network-recovers / internal-no-retry / pre-exec-reject / retries=0 / metadata-override)");
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
