import vm from "node:vm";

const MAX_OUTPUT_CHARS = 12_000;
const MAX_INPUT_CHARS = 64_000;

const payload = JSON.parse(await readStdin());
const timeoutMs = clamp(Number(payload.timeout_ms ?? 1000), 50, 3000);
const input = sanitizeInput(payload.input);
const code = String(payload.code ?? "");
const mode = payload.mode === "script" ? "script" : "expression";

const context = vm.createContext({
  input,
  console: {
    log: (...items) => appendLog(items),
    error: (...items) => appendLog(items),
    warn: (...items) => appendLog(items)
  }
}, {
  codeGeneration: {
    strings: false,
    wasm: false
  }
});

const logs = [];
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
    error: error?.name ?? "SandboxError",
    message: error instanceof Error ? error.message : String(error),
    logs: truncateJsonSafe(logs),
    duration_ms: Date.now() - startedAt
  });
}

function validateCode({ code, mode }) {
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function appendLog(items) {
  const text = items.map((item) => {
    try {
      return typeof item === "string" ? item : JSON.stringify(item);
    } catch {
      return String(item);
    }
  }).join(" ");
  logs.push(text.slice(0, 1000));
}

function sanitizeInput(value) {
  const text = JSON.stringify(value ?? null);
  if (text.length > MAX_INPUT_CHARS) {
    throw new Error(`input is too large: ${text.length} chars`);
  }
  return JSON.parse(text);
}

function truncateJsonSafe(value) {
  const raw = JSON.stringify(value ?? null);
  if (raw.length <= MAX_OUTPUT_CHARS) return value;
  return {
    truncated: true,
    preview: raw.slice(0, MAX_OUTPUT_CHARS)
  };
}

function writeResult(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}
