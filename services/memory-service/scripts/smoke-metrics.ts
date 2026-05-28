/**
 * Phase 1.13 — observability smoke. Boots the server, hits public endpoints,
 * then asserts /metrics returns Prometheus text with the expected counters
 * and that route templating collapses /v1/memories/<uuid> to /v1/memories/:id.
 */

import { buildServer } from "../src/http/server.js";
import { signIdentity } from "../src/http/identity.js";
import { loadConfig } from "../src/config/env.js";
import { pool } from "../src/db/pool.js";
import { resetMetrics, templatize } from "../src/observability/metrics.js";

let failed = 0;
const expect = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`  ✓ ${label}`);
  else { console.log(`  ✗ ${label}`, detail ?? ""); failed += 1; }
};

// Pure unit: templatize collapses UUIDs
expect("templatize collapses uuid path",
  templatize("/v1/memories/00000000-0000-0000-0000-000000000001") === "/v1/memories/:id");
expect("templatize keeps non-uuid paths", templatize("/v1/memories") === "/v1/memories");
expect("templatize strips query string", templatize("/v1/memories?category=fact") === "/v1/memories");
expect("templatize handles multiple uuids",
  templatize("/v1/documents/00000000-0000-0000-0000-000000000001/chunks") === "/v1/documents/:id/chunks");

resetMetrics();
loadConfig();
// Use stub repos so we don't depend on DB
const stubMemoryRepo = {
  list: () => Promise.resolve({ items: [], nextCursor: null })
};
const app = await buildServer({ memoryRoutes: { repo: stubMemoryRepo as never } });

const identity = signIdentity({
  business_id: "biz", user_id: "u",
  issued_at: Math.floor(Date.now() / 1000), scope: []
});

// healthz (public)
const healthRes = await app.inject({ method: "GET", url: "/healthz" });
expect("healthz → 200", healthRes.statusCode === 200);
expect("healthz body alive", healthRes.json().status === "alive");

// authenticated request
const listRes = await app.inject({
  method: "GET", url: "/v1/memories",
  headers: { "x-memory-identity": identity }
});
expect("list memories → 200", listRes.statusCode === 200, listRes.body);

// metrics public
const metricsRes = await app.inject({ method: "GET", url: "/metrics" });
expect("metrics → 200", metricsRes.statusCode === 200);
expect("metrics is text", metricsRes.headers["content-type"]?.toString().includes("text/plain"));

const body = metricsRes.body;
expect("metrics has requests_total", body.includes("memory_service_requests_total"));
expect("metrics has request_errors_total", body.includes("memory_service_request_errors_total"));
expect("metrics has p50 gauge", body.includes("memory_service_request_latency_ms_p50"));
expect("metrics has p95 gauge", body.includes("memory_service_request_latency_ms_p95"));
expect("metrics counted /healthz", body.includes('route="/healthz"'));
expect("metrics counted /v1/memories", body.includes('route="/v1/memories"'));

await app.close();
await pool.end().catch(() => undefined);

if (failed > 0) {
  console.error(`\n${failed} metrics smoke check(s) failed`);
  process.exit(1);
}
console.log("\nall metrics smoke checks passed");
