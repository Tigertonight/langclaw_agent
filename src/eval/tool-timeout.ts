import { buildToolErrorResult } from "../tools/registry.js";

/**
 * 验证 buildToolErrorResult + 超时分类逻辑：超时被折叠成
 * ToolResult(isError, code="timeout")，不向上抛异常。
 *
 * ToolRegistry.execute 的端到端集成依赖权限系统识别工具名（unknown 工具会被
 * 在 checkToolPermission 阶段就拦掉），所以这里直接验证错误折叠 + classify
 * 路径，覆盖率与 registry 一致。
 */
async function main(): Promise<void> {
  // case 1: TimeoutError 应被分类为 code="timeout"
  const timeoutErr = new Error('tool "slow_tool" timed out after 50ms');
  timeoutErr.name = "TimeoutError";
  const timeoutFolded = buildToolErrorResult("slow_tool", timeoutErr);
  assert(timeoutFolded.ok === false, "timeout should produce ok=false");
  assert(timeoutFolded.isError === true, "timeout should set isError=true");
  assert(timeoutFolded.code === "timeout", `timeout code expected, got ${timeoutFolded.code}`);
  assert(typeof timeoutFolded.message === "string" && timeoutFolded.message.includes("50ms"), "timeout message should preserve original window");

  // case 2: 普通 Error 仍归为 internal_error
  const generalErr = new Error("数据库连接失败");
  const generalFolded = buildToolErrorResult("query_tool", generalErr);
  assert(generalFolded.code === "internal_error", `general error should classify as internal_error, got ${generalFolded.code}`);

  // case 3: 包含 timeout 关键字的 Error 也走 timeout 分支
  const messageTimeoutErr = new Error("Request timed out after 5000ms");
  const messageTimeoutFolded = buildToolErrorResult("slow_tool", messageTimeoutErr);
  assert(messageTimeoutFolded.code === "timeout", `error mentioning "timed out" should classify as timeout, got ${messageTimeoutFolded.code}`);

  // case 4: AbortError → aborted
  const abortErr = new Error("operation was aborted");
  abortErr.name = "AbortError";
  const abortFolded = buildToolErrorResult("any_tool", abortErr);
  assert(abortFolded.code === "aborted", `aborted error should classify as aborted, got ${abortFolded.code}`);

  // case 5: network error
  const networkErr = new Error("ECONNREFUSED 127.0.0.1:5432");
  const networkFolded = buildToolErrorResult("any_tool", networkErr);
  assert(networkFolded.code === "network", `ECONNREFUSED should classify as network, got ${networkFolded.code}`);

  console.log("PASS tool timeout/error classification (5 categories: timeout / internal_error / timeout-by-message / aborted / network)");
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
