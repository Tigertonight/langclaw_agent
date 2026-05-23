import { runTerminal } from "../sandbox/terminal-runner.js";
import { resolveUserWorkspace, type WorkspaceContext } from "../runtime/workspace-context.js";
import type { JsonObject, ToolDefinition, UserContext } from "../types/agent-contracts.js";

/**
 * terminal.exec 工具：让 agent 跑沙箱内的 bash 命令。
 *
 * 核心约束（写在 description 里给 LLM 看，写在代码里强制执行）：
 *   - 仅 macOS 可用（sandbox-exec），Linux/Windows 调用会返回 platform_unsupported
 *   - 默认禁网；不能 curl / wget / ssh 等
 *   - 工作目录强制 workspace.root，写也只能写到这个子树
 *   - 5s 默认超时，最长 30s
 *   - 黑名单命中即拒（rm -rf / / sudo / pipe-to-shell）
 *
 * 这是个高风险工具：metadata.risk_level=write，并显式 expose_to_agentic=true 让主 agent 可见
 * （子 agent 的白名单由调用方在 cron / spawn 时控制）。
 */

export function createTerminalTools(): ToolDefinition[] {
  return [
    {
      name: "terminal.exec",
      description: [
        "在受限沙箱里跑一条 bash 命令，cwd 锁在用户工作区根，写也只能写到这里。",
        "默认禁网（curl/wget/ssh 都会 fail）。允许 ls/cat/grep/jq/python/node/awk/sed/find 等本地工具。",
        "返回 stdout/stderr/exit_code/status；status 取值 ok/blacklisted/timeout/non_zero_exit/platform_unsupported/spawn_failed/exec_unavailable。",
        "硬上限：超时 30s、stdout 256KB、stderr 64KB。"
      ].join(" "),
      schema: {
        type: "object",
        required: ["command"],
        properties: {
          command: {
            type: "string",
            description: "完整 bash 命令字符串（会以 bash -c 跑）。例：grep ERROR logs/app.log | head -20"
          },
          timeout_ms: {
            type: "number",
            description: "毫秒；默认 5000，最大 30000"
          },
          cwd: {
            type: "string",
            description: "可选，相对 workspace.root 的子路径；不传就在 workspace.root 跑。"
          }
        }
      },
      metadata: {
        required_permissions: [],
        risk_level: "write",
        expose_to_agentic: true,
        source: "terminal",
        sandbox: {
          per_user: true,
          shell: true,
          network: false,
          filesystem_api: "workspace_only",
          timeout_ms: 30_000,
          audited: true
        }
      },
      async execute(args, context) {
        const a = (args ?? {}) as JsonObject;
        const command = typeof a.command === "string" ? a.command : "";
        const user = context?.user as UserContext | undefined;
        const ws = resolveWorkspaceFromContext(context, user);

        const result = await runTerminal({
          command,
          workspace: ws,
          user_id: user?.id,
          timeout_ms: typeof a.timeout_ms === "number" ? a.timeout_ms : undefined,
          cwd: typeof a.cwd === "string" ? a.cwd : undefined
        });

        if (result.status === "ok") {
          return {
            ok: true,
            tool: "terminal.exec",
            data: {
              exit_code: result.exit_code,
              stdout: result.stdout,
              stderr: result.stderr,
              duration_ms: result.duration_ms,
              truncated_stdout: result.truncated_stdout,
              truncated_stderr: result.truncated_stderr
            }
          };
        }
        return {
          ok: false,
          tool: "terminal.exec",
          error: result.status,
          message: result.reason ?? `exit ${result.exit_code}`,
          data: {
            exit_code: result.exit_code,
            stdout: result.stdout,
            stderr: result.stderr,
            duration_ms: result.duration_ms,
            truncated_stdout: result.truncated_stdout,
            truncated_stderr: result.truncated_stderr,
            ...(result.matched ? { matched: result.matched } : {})
          }
        };
      }
    }
  ];
}

function resolveWorkspaceFromContext(
  context: { workspace?: unknown } | undefined,
  user: UserContext | undefined
): WorkspaceContext {
  const candidate = context?.workspace as Partial<WorkspaceContext> | undefined;
  if (candidate && typeof candidate.root === "string" && typeof candidate.logs_dir === "string") {
    return candidate as WorkspaceContext;
  }
  return resolveUserWorkspace(user?.id ?? "anonymous");
}
