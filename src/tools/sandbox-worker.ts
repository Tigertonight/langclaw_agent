import vm from "node:vm";
import type { JsonObject, JsonValue } from "../types/agent-contracts.js";

const MAX_OUTPUT_CHARS = 12_000;
const MAX_INPUT_CHARS = 64_000;

const payload = JSON.parse(await readStdin()) as SandboxPayload;
const timeoutMs = clamp(Number(payload.timeout_ms ?? 1000), 50, 3000);
const input = sanitizeInput(payload.input);
const code = String(payload.code ?? "");
const mode = payload.mode === "script" ? "script" : "expression";

const context = vm.createContext({
  input,
  console: {
    log: (...items: unknown[]) => appendLog(items),
    error: (...items: unknown[]) => appendLog(items),
    warn: (...items: unknown[]) => appendLog(items)
  }
}, {
  codeGeneration: {
    strings: false,
    wasm: false
  }
});

const logs: string[] = [];
const startedAt = Date.now();

try {
  validateCode({ code, mode });
  const wrapped = mode === "script"
    ? `"use strict";\nlet result;\n${code}\n;typeof result === "undefined" ? null : result`
    : `(${code})`;
  const script = new vm.Script(wrapped, { filename: "sandbox-input.js" });
  const value = script.runInContext(context, {
    timeout: timeoutMs,
    displayErrors: false,
    breakOnSigint: false
  });

  writeResult({
    ok: true,
    value: truncateJsonSafe(value),
    logs: truncateJsonSafe(logs),
    duration_ms: Date.now() - startedAt
  });
} catch (error) {
  writeResult({
    ok: false,
    error: error instanceof Error ? error.name : "SandboxError",
    message: error instanceof Error ? error.message : String(error),
    logs: truncateJsonSafe(logs),
    duration_ms: Date.now() - startedAt
  });
}

interface SandboxPayload extends JsonObject {
  timeout_ms?: number;
  input?: JsonValue;
  code?: string;
  mode?: string;
}

type SandboxMode = "expression" | "script";

function validateCode({ code, mode }: { code: string; mode: SandboxMode }): void {
  if (mode === "expression") {
    if (!/^[0-9+\-*/%().,\s*]+$/.test(code)) {
      throw new Error("expression mode only allows numeric math operators");
    }
    return;
  }

  const forbidden = [
    "constructor",
    "__proto__",
    "prototype",
    "process",
    "require",
    "import",
    "globalThis",
    "Function",
    "eval",
    "this",
    "module",
    "Reflect",
    "Proxy",
    "WebAssembly",
    "fetch",
    "XMLHttpRequest",
    "setTimeout",
    "setInterval"
  ];
  const matched = forbidden.find((token) => new RegExp(`\\b${escapeRegExp(token)}\\b`).test(code));
  if (matched) {
    throw new Error(`forbidden token in sandbox code: ${matched}`);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function appendLog(items: unknown[]): void {
  const text = items.map((item) => {
    try {
      return typeof item === "string" ? item : JSON.stringify(item);
    } catch {
      return String(item);
    }
  }).join(" ");
  logs.push(text.slice(0, 1000));
}

function sanitizeInput(value: unknown): JsonValue {
  const text = JSON.stringify(value ?? null);
  if (text.length > MAX_INPUT_CHARS) {
    throw new Error(`input is too large: ${text.length} chars`);
  }
  return JSON.parse(text);
}

function truncateJsonSafe(value: unknown): JsonValue {
  const raw = JSON.stringify(value ?? null);
  if (raw.length <= MAX_OUTPUT_CHARS) return JSON.parse(raw) as JsonValue;
  return {
    truncated: true,
    preview: raw.slice(0, MAX_OUTPUT_CHARS)
  };
}

function writeResult(payload: JsonObject): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}
