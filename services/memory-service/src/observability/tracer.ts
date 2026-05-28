/**
 * memory-service 侧的 trace emitter + 上游 trace 提取。
 *
 * 启用语义复用 SDK 的 getEmitter()（OBSERVABILITY_ENABLED + LANGFUSE_*）。
 *
 * 上游 trace 续接：
 *   - 调用方在 HTTP headers 里带 x-trace-id / x-parent-span-id / x-run-id
 *   - 本服务用同一 traceId 调 startTrace，把 memory.search.* span 挂到 agent 的 trace 下
 *   - 没带 trace-id → 起独立 root trace（开发/直连场景）
 *
 * 为什么用相对路径 import：repo 没配 npm workspaces，agent 主项目自己也是
 * 这么引 packages/observability-sdk/src 的（见 src/runtime/observability-plugin.ts）
 */

import type { FastifyRequest } from "fastify";
import {
  getEmitter,
  type TraceEmitter,
  type TraceHandle
} from "../../../../packages/observability-sdk/src/index.js";

let emitter: TraceEmitter | null = null;

export function tracer(): TraceEmitter {
  if (!emitter) emitter = getEmitter();
  return emitter;
}

export interface UpstreamTraceContext {
  trace_id?: string;
  parent_span_id?: string;
  run_id?: string;
}

export function extractUpstreamTrace(req: FastifyRequest): UpstreamTraceContext {
  const h = req.headers;
  const pick = (name: string): string | undefined => {
    const v = h[name];
    if (Array.isArray(v)) return v[0];
    return typeof v === "string" ? v : undefined;
  };
  return {
    trace_id: pick("x-trace-id"),
    parent_span_id: pick("x-parent-span-id"),
    run_id: pick("x-run-id")
  };
}

/**
 * 包一个写路径 handler，自动起 trace + 顶层 span，捕获错误。
 * 用法：
 *   app.post("/v1/entities", async (req) => {
 *     return withTraceSpan(req, "memory.entity.upsert", async (span) => {
 *       const result = await client.upsertEntity(req.body);
 *       span.update({ entity_id: result.id });
 *       return { ok: true, entity: result };
 *     });
 *   });
 *
 * span 的 input/output 会自动从 req.body / 返回值取（若需要可在 handler 内
 * 调 span.update 增补）。trace 自动 end，错误会同时挂到 span + trace。
 */
export async function withTraceSpan<T>(
  req: FastifyRequest,
  spanName: string,
  fn: (span: import("../../../../packages/observability-sdk/src/index.js").SpanHandle) => Promise<T>
): Promise<T> {
  const trace = startRequestTrace(req, spanName);
  const span = trace.span({ name: spanName, input: req.body ?? null });
  try {
    const out = await fn(span);
    span.end(out);
    trace.end({ ok: true });
    return out;
  } catch (err) {
    span.end(undefined, err);
    trace.end(undefined, err);
    throw err;
  }
}

/**
 * 起一个 trace handle 给当前请求用。
 * - 若 upstream 带 trace_id → 用同一 traceId 续接（agent trace 下挂 memory span）
 * - 否则起本服务自己的 root trace
 *
 * tags 必填字段在 memory-service 侧只有 business_id/user_id 是确定的，channel 用 "cli"
 * 占位（memory-service 不属于任何渠道），env 走 NODE_ENV 推断。
 */
export function startRequestTrace(
  req: FastifyRequest,
  name: string
): TraceHandle {
  const upstream = extractUpstreamTrace(req);
  const id = req.identity;
  const env = (process.env.NODE_ENV === "production" ? "prod" : "dev") as
    | "dev"
    | "prod";
  return tracer().startTrace({
    name,
    traceId: upstream.trace_id,
    tags: {
      business_id: id?.business_id ?? "unknown",
      user_id: id?.user_id ?? "unknown",
      session_id: upstream.run_id ?? req.id,
      channel: "cli",
      env
    },
    metadata: {
      service: "memory-service",
      upstream_run_id: upstream.run_id,
      upstream_parent_span_id: upstream.parent_span_id
    }
  });
}
