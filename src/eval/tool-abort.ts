import { ToolRegistry } from "../tools/registry.js";
import type { ToolDefinition, UserContext } from "../types/agent-contracts.js";

/**
 * 验证 AbortController 透传：
 *   1. 工具超时 → ToolRegistry 触发 controller.abort，工具内监听 signal 能收到取消
 *   2. 上层 context.signal abort → 同样级联到工具
 *   3. 工具忽略 signal 也能正常完成（向后兼容）
 */
async function main(): Promise<void> {
  const user: UserContext = { id: "u_abort", role: "ops_admin", permissions: [], accessible_customer_ids: [] };

  // case 1: timeout aborts the tool
  let case1Aborted = false;
  const slowTool: ToolDefinition = {
    name: "runtime.fake_slow_tool",
    description: "test",
    metadata: { risk_level: "read", timeout_ms: 50 },
    execute: async (_args, ctx) => {
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ ok: true }), 5000);
        ctx?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          case1Aborted = true;
          // tool 自己抛出来表示已经停下了
          resolve({ ok: false, isError: true, code: "aborted_by_signal", message: "tool released resources" });
        });
      });
    }
  };
  const registry1 = forceWhitelistRegistry([slowTool]);
  const start = Date.now();
  await registry1.execute({ name: "runtime.fake_slow_tool", args: {} }, { user });
  const elapsed = Date.now() - start;
  assert(case1Aborted, "tool should observe abort signal when registry times out");
  assert(elapsed < 1000, `tool should release within ~timeout window, took ${elapsed}ms`);

  // case 2: upstream signal abort cascades down
  let case2Aborted = false;
  const watchTool: ToolDefinition = {
    name: "runtime.fake_watch_tool",
    description: "test",
    metadata: { risk_level: "read", timeout_ms: 5000 },
    execute: async (_args, ctx) => {
      return new Promise((resolve) => {
        ctx?.signal?.addEventListener("abort", () => {
          case2Aborted = true;
          resolve({ ok: false, isError: true, code: "aborted_by_signal" });
        });
      });
    }
  };
  const registry2 = forceWhitelistRegistry([watchTool]);
  const upstream = new AbortController();
  setTimeout(() => upstream.abort(new Error("user_cancelled")), 30);
  await registry2.execute({ name: "runtime.fake_watch_tool", args: {} }, { user, signal: upstream.signal });
  assert(case2Aborted, "upstream abort should cascade to tool signal");

  // case 3: backward-compat — tool that ignores signal completes normally
  const naiveTool: ToolDefinition = {
    name: "runtime.fake_naive_tool",
    description: "test",
    metadata: { risk_level: "read", timeout_ms: 5000 },
    execute: async () => ({ ok: true, data: { value: "done" } })
  };
  const registry3 = forceWhitelistRegistry([naiveTool]);
  const result = await registry3.execute({ name: "runtime.fake_naive_tool", args: {} }, { user }) as { ok?: boolean };
  assert(result.ok === true, `naive tool ignoring signal should still succeed, got ${JSON.stringify(result)}`);

  console.log("PASS tool abort signal (timeout-cancels-tool / upstream-cascades / naive-tool-still-works)");
}

/**
 * 当前 permission 系统会在 checkToolPermission 阶段挡掉 unknown 工具名，
 * 测试里直接 monkey-patch 注入：把工具放进 registry 并通过 metadata.allowed_roles
 * 让权限通过。
 */
function forceWhitelistRegistry(tools: ToolDefinition[]): ToolRegistry {
  const registry = new ToolRegistry(tools);
  return registry;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
