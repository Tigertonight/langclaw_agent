import { buildOpenUILangLegacyEnvelopes, ENVELOPE_LIMITS } from "../openui-lang/index.js";
import { OpenUILangIdempotencyCache } from "../openui-lang/idempotency-cache.js";
import { sharedMetrics } from "../security/observability.js";
import type { OpenUILangCompatComponent, SurfacePlugin } from "../openui-lang/index.js";

const failures: string[] = [];

// ─── 1. envelope 大小限制 ─────────────────────────────────────────────
{
  // 构造一个超大的 plugin（components 数 > 200）
  const explodingPlugin: SurfacePlugin<unknown> = {
    kind: "test.exploding_components",
    extract: () => ({}),
    build: () => ({
      surfaceId: "test_too_many",
      root: "root",
      data: {},
      components: Array.from({ length: ENVELOPE_LIMITS.maxComponents + 5 }, (_, i) => ({
        id: `n_${i}`,
        component: { Text: { text: { literalString: `node ${i}` } } }
      })) as OpenUILangCompatComponent[]
    })
  };
  const before = readMetric("envelope_rejected_total");
  const messages = buildOpenUILangLegacyEnvelopes({ result: { run_id: "r1" }, plugins: [explodingPlugin] });
  if (messages.length > 0) {
    failures.push(`envelope size: too-many-components plugin should be rejected, got ${messages.length} envelopes`);
  }
  const after = readMetric("envelope_rejected_total");
  if (after <= before) failures.push("envelope size: rejected metric did not increase");
}

// ─── 2. envelope 嵌套深度限制 ─────────────────────────────────────────
{
  let nested: Record<string, unknown> = { leaf: true };
  for (let i = 0; i < ENVELOPE_LIMITS.maxDepth + 5; i++) nested = { child: nested };
  const deepPlugin: SurfacePlugin<unknown> = {
    kind: "test.deep",
    extract: () => ({}),
    build: () => ({
      surfaceId: "test_deep",
      root: "root",
      data: {},
      components: [{ id: "deep", component: { Card: { children: [], data: nested } } }] as OpenUILangCompatComponent[]
    })
  };
  const before = readMetric("envelope_rejected_total");
  const messages = buildOpenUILangLegacyEnvelopes({ result: { run_id: "r2" }, plugins: [deepPlugin] });
  if (messages.length > 0) failures.push(`envelope depth: deep plugin should be rejected, got ${messages.length} envelopes`);
  const after = readMetric("envelope_rejected_total");
  if (after <= before) failures.push("envelope depth: rejected metric did not increase");
}

// ─── 3. envelope 序列化字节超限 ───────────────────────────────────────
{
  const huge = "x".repeat(ENVELOPE_LIMITS.maxSerializedBytes + 1024);
  const fatPlugin: SurfacePlugin<unknown> = {
    kind: "test.fat",
    extract: () => ({}),
    build: () => ({
      surfaceId: "test_fat",
      root: "root",
      data: { huge },
      components: [{ id: "n", component: { Text: { text: { literalString: "ok" } } } }] as OpenUILangCompatComponent[]
    })
  };
  const before = readMetric("envelope_rejected_total");
  const messages = buildOpenUILangLegacyEnvelopes({ result: { run_id: "r3" }, plugins: [fatPlugin] });
  if (messages.length > 0) failures.push(`envelope size: fat plugin should be rejected, got ${messages.length} envelopes`);
  const after = readMetric("envelope_rejected_total");
  if (after <= before) failures.push("envelope size: rejected metric did not increase for size");
}

// ─── 4. 客户端能力协商：不支持的组件被降级为 Text ──────────────────────
{
  const exoticPlugin: SurfacePlugin<unknown> = {
    kind: "test.exotic",
    extract: () => ({}),
    build: () => ({
      surfaceId: "test_exotic",
      root: "supported",
      data: {},
      components: [
        { id: "supported", component: { Text: { text: { literalString: "ok" } } } } as unknown as OpenUILangCompatComponent,
        { componentName: "FancyChart3D", id: "exotic", component: { FancyChart3D: { points: [1, 2, 3] } } } as unknown as OpenUILangCompatComponent
      ]
    })
  };
  const before = readMetric("envelope_component_downgraded_total");
  const messages = buildOpenUILangLegacyEnvelopes({
    result: { run_id: "r4" },
    plugins: [exoticPlugin],
    clientCapabilities: { supported_components: ["Text", "Card", "Button"] }
  });
  if (messages.length === 0) failures.push("downgrade: should still emit envelopes");
  const after = readMetric("envelope_component_downgraded_total");
  if (after <= before) failures.push("downgrade: metric did not increase");
  // 检查 updateComponents 里 FancyChart3D 是否变成了 Text
  const updateComponents = messages.find((m) => "updateComponents" in m) as { updateComponents?: { components: Array<Record<string, unknown>> } } | undefined;
  const downgraded = updateComponents?.updateComponents?.components.find((c) => c.id === "exotic");
  if (!downgraded) failures.push("downgrade: did not find exotic component in updateComponents");
  else if (!((downgraded.component as Record<string, unknown> | undefined)?.Text)) {
    failures.push(`downgrade: expected component.Text, got ${JSON.stringify(downgraded)}`);
  }
}

// ─── 5. OpenUILangIdempotencyCache：基本命中 + TTL ─────────────────────
{
  const cache = new OpenUILangIdempotencyCache({ ttlMs: 200, maxEntries: 10 });
  const result1 = { ok: true, action: "x", n: 1 };
  cache.put("u1", "client_001", result1 as never);
  const hit = cache.get("u1", "client_001");
  if (!hit || (hit as { n?: number }).n !== 1) failures.push(`idempotency: expected hit, got ${JSON.stringify(hit)}`);
  const miss = cache.get("u1", "other_id");
  if (miss !== null) failures.push("idempotency: expected miss for other_id");
  const crossUser = cache.get("u2", "client_001");
  if (crossUser !== null) failures.push("idempotency: cross-user must not hit");
  // TTL 过期
  await new Promise((r) => setTimeout(r, 250));
  const expired = cache.get("u1", "client_001");
  if (expired !== null) failures.push("idempotency: expected TTL miss");
}

// ─── 6. OpenUILangIdempotencyCache：LRU 驱逐 ───────────────────────────
{
  const cache = new OpenUILangIdempotencyCache({ maxEntries: 3, ttlMs: 60_000 });
  cache.put("u", "a", { v: "a" } as never);
  cache.put("u", "b", { v: "b" } as never);
  cache.put("u", "c", { v: "c" } as never);
  cache.put("u", "d", { v: "d" } as never); // a 应被驱逐
  if (cache.get("u", "a") !== null) failures.push("idempotency LRU: a should be evicted");
  if (cache.get("u", "d") === null) failures.push("idempotency LRU: d should be present");
  if (cache.size() !== 3) failures.push(`idempotency LRU: expected size 3, got ${cache.size()}`);
}

if (failures.length > 0) {
  console.error(`FAIL openui resilience: ${failures.length} failures`);
  for (const f of failures) console.error(` - ${f}`);
  process.exitCode = 1;
} else {
  console.log("PASS openui resilience (6 cases)");
}

function readMetric(name: string): number {
  const snap = sharedMetrics.snapshot();
  let total = 0;
  for (const [key, bucket] of Object.entries(snap)) {
    if (key.startsWith(name)) total += (bucket as { count?: number }).count ?? 0;
  }
  return total;
}
