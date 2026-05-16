import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveProjectPath } from "../data/load-json.js";
import type { JsonObject, JsonValue, ToolDefinition, ToolExecutionContext } from "../types/agent-contracts.js";

const DEFAULT_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 3000;
const MAX_CODE_CHARS = 20_000;
const MAX_STDOUT_CHARS = 64_000;

const workerPath = fileURLToPath(new URL("./sandbox-worker.js", import.meta.url));

type ComputeMode = "expression" | "script";

interface SafeComputeArgs extends JsonObject {
  code?: string;
  mode?: ComputeMode;
  input?: JsonValue;
  timeout_ms?: number;
}

interface WorkerPayload {
  code: string;
  mode: ComputeMode;
  input: JsonValue;
  timeout_ms: number;
}

interface RunWorkerInput {
  cwd: string;
  timeoutMs: number;
  payload: WorkerPayload;
}

interface WorkerProcessResult {
  ok: boolean;
  code?: number | null;
  stdout?: string;
  stderr?: string;
  error?: string;
  message?: string;
}

interface NormalizedWorkerResult extends JsonObject {
  ok: boolean;
  error?: string;
  message?: string;
  value?: JsonValue;
  logs?: JsonValue[];
  duration_ms: number;
}

export function createSandboxTools(): ToolDefinition[] {
  return [
    {
      name: "safe_compute",
      description: "Run deterministic calculations in an isolated per-user sandbox. expression 模式只支持纯数字表达式（+-*/%）。script 模式：『result』已经被运行时声明为 let，你的代码需要用 result = ... 赋值，而不是 const result = ... / let result = ... / var result = ...。最后一行不需要返回。No shell, filesystem, process, imports, require, or network APIs are exposed.",
      metadata: {
        required_permissions: [],
        risk_level: "sandboxed_compute",
        requires_confirmation: false,
        intents: ["data_query", "mixed"],
        // 允许 agentic 跨意图规划器把它当成"算数底座"调用。
        expose_to_agentic: true,
        sandbox: {
          per_user: true,
          shell: false,
          network: false,
          filesystem_api: false,
          timeout_ms: MAX_TIMEOUT_MS,
          memory_mb: 64,
          audited: true
        }
      },
      schema: {
        type: "object",
        required: ["code"],
        properties: {
          code: {
            type: "string",
            description: "expression 模式：纯数字表达式（如 (98+21+37+8)/4）。script 模式：多步 JS，最后把答案赋值给 result（**不要再写 const/let/var result**，运行时已声明）。"
          },
          mode: {
            type: "string",
            enum: ["expression", "script"],
            description: "Use expression for simple formulas and script for multi-step calculations."
          },
          input: {
            description: "Optional JSON-serializable input data available as input inside the sandbox."
          },
          timeout_ms: {
            type: "number",
            description: "Execution timeout, capped at 3000 ms."
          }
        }
      },
      async execute(args, context) {
        return executeSafeCompute(args as SafeComputeArgs | undefined, context);
      }
    }
  ];
}

async function executeSafeCompute(args: SafeComputeArgs = {}, context: ToolExecutionContext = {}) {
  const userId = sanitizeUserId(context.user?.id ?? "anonymous");
  const code = String(args.code ?? "");
  if (!code.trim()) {
    return failure("empty_code", "safe_compute requires non-empty code.");
  }
  if (code.length > MAX_CODE_CHARS) {
    return failure("code_too_large", `Code exceeds ${MAX_CODE_CHARS} characters.`);
  }

  const sandboxDir = resolveProjectPath("workspace", "sandboxes", userId);
  const auditDir = resolveProjectPath("logs", "sandbox", userId);
  await mkdir(sandboxDir, { recursive: true });
  await mkdir(auditDir, { recursive: true });

  const timeoutMs = clamp(Number(args.timeout_ms ?? DEFAULT_TIMEOUT_MS), 50, MAX_TIMEOUT_MS);
  const audit = {
    at: new Date().toISOString(),
    user_id: context.user?.id ?? "anonymous",
    tool: "safe_compute",
    mode: args.mode === "script" ? "script" : "expression",
    timeout_ms: timeoutMs,
    code_preview: code.slice(0, 500),
    sandbox_dir: path.relative(resolveProjectPath(), sandboxDir)
  };

  const startedAt = Date.now();
  const childResult = await runWorker({
    cwd: sandboxDir,
    timeoutMs,
    payload: {
      code,
      mode: args.mode === "script" ? "script" : "expression",
      input: args.input ?? null,
      timeout_ms: timeoutMs
    }
  });
  const durationMs = Date.now() - startedAt;
  const result = normalizeWorkerResult(childResult, durationMs);

  await appendFile(
    path.join(auditDir, "safe_compute.jsonl"),
    `${JSON.stringify({ ...audit, result: summarizeForAudit(result) })}\n`,
    "utf8"
  );

  if (!result.ok) {
    return {
      ok: false,
      tool: "safe_compute",
      error: result.error,
      message: result.message,
      sandbox: sandboxSummary(userId, sandboxDir, timeoutMs),
      duration_ms: result.duration_ms
    };
  }

  return {
    ok: true,
    tool: "safe_compute",
    data: {
      value: result.value,
      logs: result.logs ?? [],
      duration_ms: result.duration_ms,
      sandbox: sandboxSummary(userId, sandboxDir, timeoutMs)
    }
  };
}

function runWorker({ cwd, timeoutMs, payload }: RunWorkerInput): Promise<WorkerProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      "--max-old-space-size=64",
      workerPath
    ], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: {
        PATH: process.env.PATH ?? "",
        SystemRoot: process.env.SystemRoot ?? ""
      }
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs + 250);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > MAX_STDOUT_CHARS) child.kill("SIGKILL");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, error: "spawn_failed", message: error.message, stderr });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({ ok: false, error: "timeout", message: `Sandbox exceeded ${timeoutMs} ms.`, stderr });
        return;
      }
      resolve({ ok: code === 0, code, stdout, stderr });
    });

    child.stdin.end(JSON.stringify(payload));
  });
}

function normalizeWorkerResult(childResult: WorkerProcessResult, durationMs: number): NormalizedWorkerResult {
  if (!childResult.ok) {
    return {
      ok: false,
      error: childResult.error ?? "worker_failed",
      message: childResult.message ?? childResult.stderr ?? `Sandbox worker exited with code ${childResult.code}.`,
      duration_ms: durationMs
    };
  }
  try {
    const parsed = JSON.parse(String(childResult.stdout ?? "").trim()) as Partial<NormalizedWorkerResult>;
    return {
      ...parsed,
      ok: Boolean(parsed.ok),
      duration_ms: parsed.duration_ms ?? durationMs
    };
  } catch {
    return {
      ok: false,
      error: "invalid_worker_output",
      message: "Sandbox worker returned invalid JSON.",
      duration_ms: durationMs
    };
  }
}

function sandboxSummary(userId: string, sandboxDir: string, timeoutMs: number): JsonObject {
  return {
    user_id: userId,
    dir: path.relative(resolveProjectPath(), sandboxDir),
    shell: false,
    network: false,
    filesystem_api: false,
    timeout_ms: timeoutMs,
    memory_mb: 64
  };
}

function summarizeForAudit(result: NormalizedWorkerResult): JsonObject {
  return {
    ok: result.ok,
    error: result.error,
    duration_ms: result.duration_ms,
    value_preview: JSON.stringify(result.value ?? null).slice(0, 500)
  };
}

function failure(error: string, message: string): JsonObject {
  return { ok: false, tool: "safe_compute", error, message };
}

function sanitizeUserId(value: unknown): string {
  return String(value || "anonymous").replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 80) || "anonymous";
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
