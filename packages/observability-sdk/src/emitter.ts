/**
 * TraceEmitter —— 可观测性的薄抽象层。
 *
 * 设计原则（参见 ADR-4）：
 *   - 业务代码只依赖 TraceEmitter / TraceHandle / SpanHandle 接口
 *   - 具体后端实现（Langfuse / Noop / 未来的别家）替换不影响业务
 *   - 所有方法 fire-and-forget：不抛异常、不阻塞、出错只 log
 *   - end() 之后再调 child / score 视为 no-op
 */

import type { TraceTags } from "./tags.js";

export interface TraceInput {
  /** trace 名字。Langfuse 列表页主要看它。建议用 "<channel>:<intent_or_action>" */
  name: string;
  /** 用户消息原文（可被 scrub） */
  input?: unknown;
  tags: TraceTags;
  metadata?: Record<string, unknown>;
  /** 用于跨服务串联：上游传过来的 traceId（典型场景：subagent / memory-service） */
  traceId?: string;
}

export interface SpanInput {
  name: string;
  input?: unknown;
  metadata?: Record<string, unknown>;
  /** ISO 时间戳；不传用 now() */
  startTime?: Date;
}

export interface GenerationInput extends SpanInput {
  model?: string;
  modelParameters?: Record<string, unknown>;
  prompt?: unknown;
  completion?: unknown;
  usage?: {
    input?: number;
    output?: number;
    total?: number;
    unit?: "TOKENS" | "CHARACTERS" | "MILLISECONDS";
  };
}

/** trace.score 的取值范围与含义建议在调用方文档中约定 */
export interface ScoreInput {
  name: string;
  /** 0-1 / 1-5 都可，但 name 相同时 value 取值范围必须一致 */
  value: number;
  comment?: string;
}

export interface SpanHandle {
  /** 嵌套子 span */
  childSpan(input: SpanInput): SpanHandle;
  /** 嵌套 LLM generation（child of span） */
  childGeneration(input: GenerationInput): SpanHandle;
  /** 加 metadata（合并） */
  update(metadata: Record<string, unknown>): void;
  /** 结束 span。output 可选；error 存在则 status=ERROR */
  end(output?: unknown, error?: Error | unknown): void;
}

export interface TraceHandle {
  /** Langfuse trace_id —— 用于跨服务/跨 trace 关联 */
  readonly traceId: string;
  span(input: SpanInput): SpanHandle;
  generation(input: GenerationInput): SpanHandle;
  /** 给整个 trace 打分（人工或自动） */
  score(input: ScoreInput): void;
  /** 加 metadata（合并） */
  update(metadata: Record<string, unknown>): void;
  /** 结束 trace。output 可选；error 存在则 status=ERROR */
  end(output?: unknown, error?: Error | unknown): void;
}

export interface TraceEmitter {
  startTrace(input: TraceInput): TraceHandle;
  /** 强制 flush 缓冲；返回 promise resolve 时表示已发出。失败仍 resolve（不抛） */
  flush(): Promise<void>;
  /** 进程退出前调用，等待 buffer 清空。最多等 timeoutMs */
  shutdown(timeoutMs?: number): Promise<void>;
}
