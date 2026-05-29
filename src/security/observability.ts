import { randomUUID } from "node:crypto";

export type MetricName =
  | "chat_request_total"
  | "chat_stream_total"
  | "chat_request_failed"
  | "auth_failed_total"
  | "rate_limited_total"
  | "envelope_emitted_total"
  | "envelope_rejected_total"
  | "envelope_component_downgraded_total"
  | "action_idempotent_replay_total"
  | "action_invoked_total"
  | "action_forbidden_total"
  | "finalize_latency_ms"
  | "stream_duration_ms"
  | "tool_input_invalid"
  | "tool_output_invalid"
  | "tool_execute_failed"
  | "tool_execute_timeout"
  | "plugin_extract_failed"
  | "plugin_build_failed"
  | "plugin_extract_skipped"
  | "attachment_upload_total"
  | "attachment_upload_failed";

interface MetricBucket {
  count: number;
  sum: number;
  /** sorted samples for percentile estimation */
  samples: number[];
}

const HISTOGRAM_METRICS = new Set<MetricName>(["finalize_latency_ms", "stream_duration_ms"]);
const SAMPLE_CAP = 1000;

export class Metrics {
  private readonly buckets = new Map<string, MetricBucket>();

  inc(name: MetricName, labels: Record<string, string | undefined> = {}, by = 1): void {
    const key = makeKey(name, labels);
    const b = this.buckets.get(key) ?? { count: 0, sum: 0, samples: [] };
    b.count += by;
    b.sum += by;
    this.buckets.set(key, b);
  }

  observe(name: MetricName, value: number, labels: Record<string, string | undefined> = {}): void {
    const key = makeKey(name, labels);
    const b = this.buckets.get(key) ?? { count: 0, sum: 0, samples: [] };
    b.count += 1;
    b.sum += value;
    if (HISTOGRAM_METRICS.has(name)) {
      b.samples.push(value);
      if (b.samples.length > SAMPLE_CAP) b.samples.splice(0, b.samples.length - SAMPLE_CAP);
    }
    this.buckets.set(key, b);
  }

  snapshot(): Record<string, { count: number; sum: number; p50?: number; p95?: number; p99?: number }> {
    const out: Record<string, { count: number; sum: number; p50?: number; p95?: number; p99?: number }> = {};
    for (const [key, b] of this.buckets.entries()) {
      const entry: { count: number; sum: number; p50?: number; p95?: number; p99?: number } = { count: b.count, sum: b.sum };
      if (b.samples.length) {
        const sorted = [...b.samples].sort((a, b) => a - b);
        entry.p50 = percentile(sorted, 0.5);
        entry.p95 = percentile(sorted, 0.95);
        entry.p99 = percentile(sorted, 0.99);
      }
      out[key] = entry;
    }
    return out;
  }

  /**
   * 输出 Prometheus 文本格式（v0.0.4），供 scraper 抓取。
   * Counter 输出 *_total，Histogram 额外输出 quantile 0.5/0.95/0.99 + sum/count。
   */
  toPrometheus(): string {
    const lines: string[] = [];
    const seenMetricNames = new Set<string>();
    const grouped = new Map<string, Array<{ labels: Record<string, string>; bucket: MetricBucket }>>();

    for (const [key, bucket] of this.buckets.entries()) {
      const { name, labels } = parseKey(key);
      const list = grouped.get(name) ?? [];
      list.push({ labels, bucket });
      grouped.set(name, list);
    }

    for (const [name, entries] of grouped.entries()) {
      const isHistogram = HISTOGRAM_METRICS.has(name as MetricName);
      const promName = isHistogram ? name : (name.endsWith("_total") ? name : `${name}_total`);
      if (!seenMetricNames.has(promName)) {
        lines.push(`# TYPE ${promName} ${isHistogram ? "summary" : "counter"}`);
        seenMetricNames.add(promName);
      }
      for (const { labels, bucket } of entries) {
        const labelStr = formatLabels(labels);
        if (isHistogram) {
          const sorted = [...bucket.samples].sort((a, b) => a - b);
          if (sorted.length) {
            for (const q of [0.5, 0.95, 0.99]) {
              const ext = formatLabels({ ...labels, quantile: String(q) });
              lines.push(`${promName}${ext} ${percentile(sorted, q)}`);
            }
          }
          lines.push(`${promName}_sum${labelStr} ${bucket.sum}`);
          lines.push(`${promName}_count${labelStr} ${bucket.count}`);
        } else {
          lines.push(`${promName}${labelStr} ${bucket.count}`);
        }
      }
    }

    return lines.join("\n") + "\n";
  }
}

function parseKey(key: string): { name: string; labels: Record<string, string> } {
  const [name, ...rest] = key.split("|");
  const labels: Record<string, string> = {};
  for (const part of rest) {
    const eq = part.indexOf("=");
    if (eq > 0) labels[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return { name, labels };
}

function formatLabels(labels: Record<string, string>): string {
  const keys = Object.keys(labels).sort();
  if (!keys.length) return "";
  const inner = keys.map((k) => `${k}="${escapeLabelValue(labels[k])}"`).join(",");
  return `{${inner}}`;
}

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

function makeKey(name: MetricName, labels: Record<string, string | undefined>): string {
  const parts: string[] = [name];
  const keys = Object.keys(labels).sort();
  for (const k of keys) {
    const v = labels[k];
    if (v !== undefined && v !== "") parts.push(`${k}=${v}`);
  }
  return parts.join("|");
}

/**
 * 进程级 Metrics 单例：用于不方便依赖注入的模块（如 ToolRegistry / a2ui adapter）
 * 共享同一个 Metrics 实例，使 /api/metrics 能同时反映所有路径。
 */
export const sharedMetrics = new Metrics();

export function newTraceId(): string {
  return `tr_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export interface RequestContext {
  traceId: string;
  startedAt: number;
}

export function startRequest(): RequestContext {
  return { traceId: newTraceId(), startedAt: Date.now() };
}

export function logEvent(level: "info" | "warn" | "error", message: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg: message, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
