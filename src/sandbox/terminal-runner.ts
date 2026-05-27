import { spawn } from "node:child_process";
import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { buildSandboxProfile } from "./sandbox-profile.js";
import { checkCommandBlacklist } from "./command-blacklist.js";
import { resolveProjectPath } from "../data/load-json.js";
import type { WorkspaceContext } from "../runtime/workspace-context.js";

/**
 * Terminal runner —— spawn `sandbox-exec` 包 `bash -c '<command>'`，加超时 / stdout 截断 / 审计落盘。
 *
 * 三道关：
 *   1. checkCommandBlacklist —— 静态拒掉 curl/wget/sudo/rm -rf / 等
 *   2. macOS sandbox-exec —— 运行时禁网 + 写仅 workspace.root（兜底）
 *   3. timeout + stdout cap —— 防卡死 / 防输出洪水
 *
 * 工作目录强制设在 workspace.root（cwd），不许调用方覆盖。
 *
 * 运行平台：仅 macOS。其他平台返回 platform_unsupported；不做兜底执行（裸跑 bash 太危险）。
 */

const DEFAULT_TIMEOUT_MS = 5_000;
const HARD_TIMEOUT_MS = 30_000;
const MAX_STDOUT_BYTES = 256 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const MAX_COMMAND_CHARS = 4_000;

export interface TerminalRunRequest {
  command: string;
  workspace: WorkspaceContext;
  /** 单位毫秒，硬上限 30s。 */
  timeout_ms?: number;
  /** 用户上下文 ID，仅用于审计。 */
  user_id?: string;
  /** 覆盖默认 cwd。必须是 workspace.root 内的子路径，否则报错。 */
  cwd?: string;
}

export interface TerminalRunResult {
  ok: boolean;
  /** "ok" | "blacklisted" | "timeout" | "non_zero_exit" | "platform_unsupported" | "spawn_failed" | "exec_unavailable" */
  status: string;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  duration_ms: number;
  truncated_stdout: boolean;
  truncated_stderr: boolean;
  reason?: string;
  matched?: string;
}

export async function runTerminal(req: TerminalRunRequest): Promise<TerminalRunResult> {
  const startedAt = Date.now();
  const baseResult = (
    extra: Partial<TerminalRunResult>
  ): TerminalRunResult => ({
    ok: false,
    status: "error",
    exit_code: null,
    stdout: "",
    stderr: "",
    duration_ms: Date.now() - startedAt,
    truncated_stdout: false,
    truncated_stderr: false,
    ...extra
  });

  if (process.platform !== "darwin") {
    return baseResult({ status: "platform_unsupported", reason: "terminal.exec 暂只支持 macOS（sandbox-exec）" });
  }
  if (!req.command || req.command.length > MAX_COMMAND_CHARS) {
    return baseResult({ status: "blacklisted", reason: req.command ? "command_too_long" : "empty_command" });
  }

  // 静态黑名单
  const check = checkCommandBlacklist(req.command);
  if (!check.ok) {
    return baseResult({ status: "blacklisted", reason: check.reason, matched: check.matched });
  }

  // 决定 cwd —— 必须 workspace.root 内
  const cwd = resolveCwd(req);
  if (cwd.error) {
    return baseResult({ status: "blacklisted", reason: cwd.error });
  }

  // 准备 audit 目录
  const auditDir = path.join(req.workspace.logs_dir, "terminal");
  await mkdir(auditDir, { recursive: true }).catch(() => undefined);

  const timeoutMs = clamp(req.timeout_ms ?? DEFAULT_TIMEOUT_MS, 100, HARD_TIMEOUT_MS);
  const profile = buildSandboxProfile({ workspaceRoot: req.workspace.root });

  const result = await spawnSandboxed({
    cwd: cwd.value,
    profile,
    command: req.command,
    timeoutMs
  });

  // 审计：每次落一行 jsonl
  try {
    await appendFile(
      path.join(auditDir, "exec.jsonl"),
      `${JSON.stringify({
        at: new Date().toISOString(),
        user_id: req.user_id ?? null,
        cwd: path.relative(resolveProjectPath(), cwd.value),
        command_preview: req.command.slice(0, 500),
        timeout_ms: timeoutMs,
        status: result.status,
        exit_code: result.exit_code,
        duration_ms: result.duration_ms,
        stdout_bytes: result.stdout.length,
        stderr_bytes: result.stderr.length
      })}\n`,
      "utf8"
    );
  } catch {
    // 审计失败不影响主流程
  }

  return result;
}

interface SpawnInput {
  cwd: string;
  profile: string;
  command: string;
  timeoutMs: number;
}

function spawnSandboxed(input: SpawnInput): Promise<TerminalRunResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn("/usr/bin/sandbox-exec", ["-p", input.profile, "/bin/bash", "-c", input.command], {
      cwd: input.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        // 极简 env：不带继承的 SSH_AUTH_SOCK / AWS_* 之类敏感变量
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin",
        HOME: input.cwd,
        LANG: process.env.LANG ?? "en_US.UTF-8"
      }
    });

    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let truncOut = false;
    let truncErr = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, input.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length + chunk.length > MAX_STDOUT_BYTES) {
        const room = Math.max(0, MAX_STDOUT_BYTES - stdout.length);
        if (room > 0) stdout = Buffer.concat([stdout, chunk.slice(0, room)]);
        truncOut = true;
        child.kill("SIGKILL");
      } else {
        stdout = Buffer.concat([stdout, chunk]);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length + chunk.length > MAX_STDERR_BYTES) {
        const room = Math.max(0, MAX_STDERR_BYTES - stderr.length);
        if (room > 0) stderr = Buffer.concat([stderr, chunk.slice(0, room)]);
        truncErr = true;
      } else {
        stderr = Buffer.concat([stderr, chunk]);
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      const message = err instanceof Error ? err.message : String(err);
      resolve({
        ok: false,
        status: message.includes("ENOENT") ? "exec_unavailable" : "spawn_failed",
        exit_code: null,
        stdout: stdout.toString("utf8"),
        stderr: `${stderr.toString("utf8")}\n${message}`.trim(),
        duration_ms: Date.now() - startedAt,
        truncated_stdout: truncOut,
        truncated_stderr: truncErr,
        reason: message
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const duration = Date.now() - startedAt;
      if (timedOut) {
        resolve({
          ok: false,
          status: "timeout",
          exit_code: code,
          stdout: stdout.toString("utf8"),
          stderr: stderr.toString("utf8"),
          duration_ms: duration,
          truncated_stdout: truncOut,
          truncated_stderr: truncErr,
          reason: `exceeded ${input.timeoutMs}ms`
        });
        return;
      }
      const success = code === 0;
      resolve({
        ok: success,
        status: success ? "ok" : "non_zero_exit",
        exit_code: code,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
        duration_ms: duration,
        truncated_stdout: truncOut,
        truncated_stderr: truncErr
      });
    });
  });
}

function resolveCwd(req: TerminalRunRequest): { value: string; error?: undefined } | { value: string; error: string } {
  const root = path.resolve(req.workspace.root);
  if (!req.cwd) return { value: root };
  const target = path.resolve(root, req.cwd);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    return { value: root, error: "cwd_outside_workspace" };
  }
  return { value: target };
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}
