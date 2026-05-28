/**
 * 端到端 trace roundtrip 验证。
 *
 * 流程：
 *   1. 用 SDK LangfuseAdapter 上报 1 个完整 trace（含 span + generation + score + tag）
 *   2. flush 后轮询 Langfuse Public API GET /api/public/traces/:id（v3 异步入库需要等）
 *   3. 校验关键字段：tags / input / spans 数量 / generation 模型字段
 *   4. 顺带验证 business_id tag 过滤：list traces filter by tag
 *
 * 需要先把 Langfuse 起来 + 创建 project + 拿 keys：
 *   LANGFUSE_HOST=http://localhost:3001
 *   LANGFUSE_PUBLIC_KEY=pk-lf-xxx
 *   LANGFUSE_SECRET_KEY=sk-lf-xxx
 *
 * 跑：
 *   cd services/observability
 *   LANGFUSE_HOST=... LANGFUSE_PUBLIC_KEY=... LANGFUSE_SECRET_KEY=... \
 *     npx tsx scripts/smoke-trace-roundtrip.ts
 */

import { LangfuseAdapter } from "../../../packages/observability-sdk/src/index.js";

const HOST = process.env.LANGFUSE_HOST;
const PK = process.env.LANGFUSE_PUBLIC_KEY;
const SK = process.env.LANGFUSE_SECRET_KEY;

if (!HOST || !PK || !SK) {
  console.error(
    "Missing env: LANGFUSE_HOST / LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY"
  );
  process.exit(2);
}

let failed = 0;
const expect = (label: string, ok: boolean, detail?: unknown): void => {
  if (ok) console.log(`  ✓ ${label}`);
  else {
    console.log(`  ✗ ${label}`, detail ?? "");
    failed += 1;
  }
};

const authHeader =
  "Basic " + Buffer.from(`${PK}:${SK}`).toString("base64");

async function fetchTrace(traceId: string): Promise<JsonValue | null> {
  const r = await fetch(`${HOST}/api/public/traces/${traceId}`, {
    headers: { Authorization: authHeader }
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET trace ${traceId} → ${r.status}`);
  return (await r.json()) as JsonValue;
}

async function pollTrace(
  traceId: string,
  timeoutMs = 30_000,
  intervalMs = 1_000
): Promise<JsonValue | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const t = await fetchTrace(traceId);
    if (t) return t;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

async function listTracesByTag(tag: string): Promise<JsonValue[]> {
  // Langfuse Public API: GET /api/public/traces?tags=foo
  const r = await fetch(
    `${HOST}/api/public/traces?tags=${encodeURIComponent(tag)}&limit=10`,
    { headers: { Authorization: authHeader } }
  );
  if (!r.ok) throw new Error(`list traces → ${r.status}`);
  const body = (await r.json()) as { data?: JsonValue[] };
  return body.data ?? [];
}

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [k: string]: JsonValue };

console.log(`\nLangfuse trace roundtrip smoke (host=${HOST})\n`);

const adapter = new LangfuseAdapter({
  baseUrl: HOST,
  publicKey: PK,
  secretKey: SK,
  flushAt: 1,
  flushInterval: 500,
  scrub: { enabled: true }
});

const businessId = `smoke-${Date.now()}`;
const trace = adapter.startTrace({
  name: "turn:smoke",
  tags: {
    business_id: businessId,
    user_id: "smoke-user",
    session_id: "smoke-session",
    channel: "cli" as const,
    env: "dev"
  },
  input: "smoke trace input",
  metadata: { roundtrip: true }
});

const traceId = trace.traceId;
console.log(`  upserted traceId=${traceId}, business_id=${businessId}`);

const span = trace.span({
  name: "smoke.span",
  input: { q: "ping" },
  metadata: { kind: "test" }
});
span.end({ ok: true });

const gen = trace.generation({
  name: "agent.run",
  model: "smoke-model",
  prompt: [{ role: "user", content: "hi" }]
});
gen.end({ content: "hello" });

trace.score({ name: "smoke", value: 1, comment: "auto" });
trace.end({ answer: "smoke ok" });

await adapter.flush();
console.log("  flushed, waiting for Langfuse worker to ingest...");

const got = await pollTrace(traceId);
expect("trace 在 30s 内可查询", got !== null);

if (got && typeof got === "object" && !Array.isArray(got)) {
  const t = got as Record<string, JsonValue>;
  expect(
    "trace.input 等于上报值",
    typeof t.input === "string" && t.input.includes("smoke trace input")
  );
  expect(
    "trace.tags 含 business_id",
    Array.isArray(t.tags) &&
      t.tags.some(
        (v) => typeof v === "string" && v.includes(`business_id:${businessId}`)
      )
  );
  expect(
    "trace.tags 含 channel:console",
    Array.isArray(t.tags) &&
      t.tags.some((v) => typeof v === "string" && v.includes("channel:console"))
  );

  // observations 包含 span + generation
  const obs = t.observations;
  expect("observations 数组非空", Array.isArray(obs) && obs.length >= 2);
  if (Array.isArray(obs)) {
    const names = obs
      .map((o) =>
        o && typeof o === "object" && !Array.isArray(o)
          ? (o as Record<string, JsonValue>).name
          : null
      )
      .filter((n): n is string => typeof n === "string");
    expect("含 smoke.span", names.includes("smoke.span"));
    expect("含 agent.run（generation）", names.includes("agent.run"));
  }
}

// tag 过滤
const filtered = await listTracesByTag(`business_id:${businessId}`);
expect(
  `按 business_id tag 过滤能查到本次 trace（命中 ${filtered.length}）`,
  filtered.some(
    (t) =>
      t &&
      typeof t === "object" &&
      !Array.isArray(t) &&
      (t as Record<string, JsonValue>).id === traceId
  )
);

// 跨 business 隔离：用一个不存在的 tag 应该 0 命中
const wrongFilter = await listTracesByTag(`business_id:nonexistent-${Date.now()}`);
expect(
  `不存在 business_id 0 命中（实际 ${wrongFilter.length}）`,
  wrongFilter.length === 0
);

await adapter.shutdown();

if (failed > 0) {
  console.error(`\n${failed} roundtrip check(s) failed`);
  process.exit(1);
}
console.log("\nPASS trace roundtrip smoke");
