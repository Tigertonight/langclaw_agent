/**
 * Lightweight in-process metrics. Prometheus text-exposition format.
 *
 * We deliberately avoid prom-client for Phase 1: the surface is small (request
 * counts + latency histograms by route), and the overhead of an extra runtime
 * dep isn't justified yet. If/when we need cardinality controls or summary
 * quantiles, swap to prom-client behind this same shape.
 */

interface RouteStats {
  count: number;
  errors: number;
  latencyMs: number[];
}

const HIST_CAP = 1000; // keep last N samples per route to bound memory
const stats = new Map<string, RouteStats>();

export function recordRequest(method: string, route: string, statusCode: number, latencyMs: number): void {
  const key = `${method} ${route}`;
  let s = stats.get(key);
  if (!s) {
    s = { count: 0, errors: 0, latencyMs: [] };
    stats.set(key, s);
  }
  s.count += 1;
  if (statusCode >= 500) s.errors += 1;
  if (s.latencyMs.length >= HIST_CAP) s.latencyMs.shift();
  s.latencyMs.push(latencyMs);
}

export function resetMetrics(): void {
  stats.clear();
}

export function renderPrometheus(): string {
  const lines: string[] = [
    "# HELP memory_service_requests_total Total HTTP requests",
    "# TYPE memory_service_requests_total counter"
  ];
  for (const [key, s] of stats) {
    const [method, route] = key.split(" ", 2);
    lines.push(`memory_service_requests_total{method="${method}",route="${escapeLabel(route ?? "")}"} ${s.count}`);
  }
  lines.push(
    "# HELP memory_service_request_errors_total Total HTTP 5xx responses",
    "# TYPE memory_service_request_errors_total counter"
  );
  for (const [key, s] of stats) {
    const [method, route] = key.split(" ", 2);
    lines.push(`memory_service_request_errors_total{method="${method}",route="${escapeLabel(route ?? "")}"} ${s.errors}`);
  }
  lines.push(
    "# HELP memory_service_request_latency_ms_p50 Median request latency (ms) over last 1000 samples",
    "# TYPE memory_service_request_latency_ms_p50 gauge",
    "# HELP memory_service_request_latency_ms_p95 p95 request latency (ms) over last 1000 samples",
    "# TYPE memory_service_request_latency_ms_p95 gauge"
  );
  for (const [key, s] of stats) {
    const [method, route] = key.split(" ", 2);
    if (s.latencyMs.length === 0) continue;
    const sorted = [...s.latencyMs].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    lines.push(`memory_service_request_latency_ms_p50{method="${method}",route="${escapeLabel(route ?? "")}"} ${p50.toFixed(2)}`);
    lines.push(`memory_service_request_latency_ms_p95{method="${method}",route="${escapeLabel(route ?? "")}"} ${p95.toFixed(2)}`);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Group routes by template, not raw URL, so cardinality stays bounded.
 * /v1/memories/123-uuid → /v1/memories/:id
 */
export function templatize(url: string): string {
  const path = url.split("?")[0] ?? "";
  return path.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:id");
}

function escapeLabel(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}
