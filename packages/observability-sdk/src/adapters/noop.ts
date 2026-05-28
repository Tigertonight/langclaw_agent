/**
 * NoopAdapter —— 未启用可观测性时的占位实现。
 *
 * 用途：
 *   - OBSERVABILITY_ENABLED=false / 缺配置 时返回这个，业务代码不需要判空
 *   - 单元测试默认用这个，避免依赖真实 Langfuse
 *
 * 实现：所有 trace handle / span handle 行为都是 no-op，但保留 traceId（随机生成），
 * 让业务代码用了 traceId 做日志关联也不会拿到 undefined。
 */

import { randomUUID } from "node:crypto";
import type {
  GenerationInput,
  ScoreInput,
  SpanHandle,
  SpanInput,
  TraceEmitter,
  TraceHandle,
  TraceInput
} from "../emitter.js";

class NoopSpan implements SpanHandle {
  childSpan(_: SpanInput): SpanHandle {
    return this;
  }
  childGeneration(_: GenerationInput): SpanHandle {
    return this;
  }
  update(_: Record<string, unknown>): void {
    /* noop */
  }
  end(_?: unknown, __?: unknown): void {
    /* noop */
  }
}

class NoopTrace implements TraceHandle {
  readonly traceId: string;
  private readonly span_ = new NoopSpan();
  constructor(seedTraceId?: string) {
    this.traceId = seedTraceId ?? randomUUID();
  }
  span(_: SpanInput): SpanHandle {
    return this.span_;
  }
  generation(_: GenerationInput): SpanHandle {
    return this.span_;
  }
  score(_: ScoreInput): void {
    /* noop */
  }
  update(_: Record<string, unknown>): void {
    /* noop */
  }
  end(_?: unknown, __?: unknown): void {
    /* noop */
  }
}

export class NoopAdapter implements TraceEmitter {
  startTrace(input: TraceInput): TraceHandle {
    return new NoopTrace(input.traceId);
  }
  async flush(): Promise<void> {
    /* noop */
  }
  async shutdown(_?: number): Promise<void> {
    /* noop */
  }
}
