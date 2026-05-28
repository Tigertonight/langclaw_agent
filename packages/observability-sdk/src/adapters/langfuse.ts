/**
 * LangfuseAdapter —— 默认后端实现。
 *
 * 设计要点：
 *   1. 所有 SDK 调用包 try/catch，失败只 log，不让可观测性影响业务
 *   2. scrub 在进 SDK 之前发生 —— SDK 不知道 PII 规则，scrub 是上游责任
 *   3. trace_id 由 Langfuse 生成，但若调用方传入了 traceId（跨服务串联），优先用传入的
 *   4. 不暴露 langfuse-node 的对象类型 —— 全部裹在我们自己的 Trace/SpanHandle 里
 *
 * 注意 langfuse-node v3 SDK：
 *   - Langfuse.trace() 同步返回 LangfuseTraceClient
 *   - trace.span() / trace.generation() 同步返回 client，end() 时自动 batch 上报
 *   - Langfuse.flushAsync() 等待 buffer 清空
 *   - Langfuse.shutdownAsync(timeoutMs) 进程退出前等
 */

import { Langfuse } from "langfuse";
import type {
  GenerationInput,
  ScoreInput,
  SpanHandle,
  SpanInput,
  TraceEmitter,
  TraceHandle,
  TraceInput
} from "../emitter.js";
import type { ScrubConfig } from "../scrub.js";
import { scrubValue } from "../scrub.js";

export interface LangfuseAdapterOptions {
  publicKey: string;
  secretKey: string;
  baseUrl: string;
  /** flushAt: SDK 内部 batch 大小阈值。默认 20 */
  flushAt?: number;
  /** flushInterval: SDK 内部 flush 周期（ms）。默认 2000 */
  flushInterval?: number;
  /** PII scrub 配置 */
  scrub: ScrubConfig;
  /** 异常 hook —— 默认 console.warn，可注入自定义 logger */
  onError?: (e: unknown, op: string) => void;
}

const safe = (op: string, onError: ((e: unknown, op: string) => void) | undefined, fn: () => void): void => {
  try {
    fn();
  } catch (e) {
    (onError ?? defaultOnError)(e, op);
  }
};

function defaultOnError(e: unknown, op: string): void {
  // eslint-disable-next-line no-console
  console.warn(`[observability] ${op} failed:`, e instanceof Error ? e.message : e);
}

class LangfuseSpan implements SpanHandle {
  constructor(
    private readonly raw: any,
    private readonly opts: LangfuseAdapterOptions
  ) {}

  childSpan(input: SpanInput): SpanHandle {
    let child: any;
    safe("span.childSpan", this.opts.onError, () => {
      child = this.raw.span({
        name: input.name,
        input: scrubValue(input.input, this.opts.scrub),
        metadata: scrubValue(input.metadata, this.opts.scrub),
        startTime: input.startTime
      });
    });
    return child ? new LangfuseSpan(child, this.opts) : new LangfuseSpan(this.raw, this.opts);
  }

  childGeneration(input: GenerationInput): SpanHandle {
    let child: any;
    safe("span.childGeneration", this.opts.onError, () => {
      child = this.raw.generation({
        name: input.name,
        input: scrubValue(input.prompt ?? input.input, this.opts.scrub),
        metadata: scrubValue(input.metadata, this.opts.scrub),
        model: input.model,
        modelParameters: input.modelParameters as any,
        startTime: input.startTime,
        usage: input.usage
      });
    });
    return child ? new LangfuseSpan(child, this.opts) : new LangfuseSpan(this.raw, this.opts);
  }

  update(metadata: Record<string, unknown>): void {
    safe("span.update", this.opts.onError, () => {
      this.raw.update({ metadata: scrubValue(metadata, this.opts.scrub) });
    });
  }

  end(output?: unknown, error?: Error | unknown): void {
    safe("span.end", this.opts.onError, () => {
      this.raw.end({
        output: scrubValue(output, this.opts.scrub),
        level: error ? "ERROR" : undefined,
        statusMessage: error ? extractErrMsg(error) : undefined
      });
    });
  }
}

class LangfuseTrace implements TraceHandle {
  readonly traceId: string;
  constructor(
    private readonly raw: any,
    private readonly opts: LangfuseAdapterOptions
  ) {
    this.traceId = raw.id;
  }

  span(input: SpanInput): SpanHandle {
    let child: any;
    safe("trace.span", this.opts.onError, () => {
      child = this.raw.span({
        name: input.name,
        input: scrubValue(input.input, this.opts.scrub),
        metadata: scrubValue(input.metadata, this.opts.scrub),
        startTime: input.startTime
      });
    });
    return child ? new LangfuseSpan(child, this.opts) : new LangfuseSpan(this.raw, this.opts);
  }

  generation(input: GenerationInput): SpanHandle {
    let child: any;
    safe("trace.generation", this.opts.onError, () => {
      child = this.raw.generation({
        name: input.name,
        input: scrubValue(input.prompt ?? input.input, this.opts.scrub),
        metadata: scrubValue(input.metadata, this.opts.scrub),
        model: input.model,
        modelParameters: input.modelParameters as any,
        startTime: input.startTime,
        usage: input.usage
      });
    });
    return child ? new LangfuseSpan(child, this.opts) : new LangfuseSpan(this.raw, this.opts);
  }

  score(input: ScoreInput): void {
    safe("trace.score", this.opts.onError, () => {
      this.raw.score({ name: input.name, value: input.value, comment: input.comment });
    });
  }

  update(metadata: Record<string, unknown>): void {
    safe("trace.update", this.opts.onError, () => {
      this.raw.update({ metadata: scrubValue(metadata, this.opts.scrub) });
    });
  }

  end(output?: unknown, error?: Error | unknown): void {
    safe("trace.end", this.opts.onError, () => {
      this.raw.update({
        output: scrubValue(output, this.opts.scrub),
        ...(error
          ? { metadata: { __error: extractErrMsg(error) } }
          : {})
      });
    });
  }
}

export class LangfuseAdapter implements TraceEmitter {
  private readonly client: Langfuse;
  constructor(private readonly opts: LangfuseAdapterOptions) {
    this.client = new Langfuse({
      publicKey: opts.publicKey,
      secretKey: opts.secretKey,
      baseUrl: opts.baseUrl,
      flushAt: opts.flushAt ?? 20,
      flushInterval: opts.flushInterval ?? 2000
    });
  }

  startTrace(input: TraceInput): TraceHandle {
    let raw: any;
    try {
      raw = this.client.trace({
        id: input.traceId,
        name: input.name,
        input: scrubValue(input.input, this.opts.scrub),
        tags: tagsToArray(input.tags),
        metadata: scrubValue({ ...input.metadata, ...flattenTagsForMetadata(input.tags) }, this.opts.scrub)
      });
    } catch (e) {
      (this.opts.onError ?? defaultOnError)(e, "startTrace");
    }
    if (!raw) {
      // 创建失败时，回退到一个 stub —— 不抛
      return new StubTrace();
    }
    return new LangfuseTrace(raw, this.opts);
  }

  async flush(): Promise<void> {
    try {
      await this.client.flushAsync();
    } catch (e) {
      (this.opts.onError ?? defaultOnError)(e, "flush");
    }
  }

  async shutdown(timeoutMs = 3000): Promise<void> {
    try {
      const p = this.client.shutdownAsync();
      const t = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
      await Promise.race([p, t]);
    } catch (e) {
      (this.opts.onError ?? defaultOnError)(e, "shutdown");
    }
  }
}

function tagsToArray(tags: TraceInput["tags"]): string[] {
  // Langfuse 的 tags 是 string[]，我们用 "key:value" 的形式编进去，方便 UI 过滤
  const arr: string[] = [];
  arr.push(`business_id:${tags.business_id}`);
  arr.push(`user_id:${tags.user_id}`);
  arr.push(`session:${tags.session_id}`);
  arr.push(`channel:${tags.channel}`);
  arr.push(`env:${tags.env}`);
  if (tags.intent) arr.push(`intent:${tags.intent}`);
  if (tags.agent_role) arr.push(`agent_role:${tags.agent_role}`);
  return arr;
}

function flattenTagsForMetadata(tags: TraceInput["tags"]): Record<string, unknown> {
  // tags 里的关键字段也复制到 metadata，方便 metadata 过滤路径用
  return {
    business_id: tags.business_id,
    user_id: tags.user_id,
    session_id: tags.session_id,
    channel: tags.channel,
    env: tags.env,
    intent: tags.intent,
    agent_role: tags.agent_role,
    parent_trace_id: tags.parent_trace_id
  };
}

function extractErrMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

class StubTrace implements TraceHandle {
  readonly traceId = "stub";
  span(): SpanHandle {
    return STUB_SPAN;
  }
  generation(): SpanHandle {
    return STUB_SPAN;
  }
  score(): void {}
  update(): void {}
  end(): void {}
}

const STUB_SPAN: SpanHandle = {
  childSpan: () => STUB_SPAN,
  childGeneration: () => STUB_SPAN,
  update: () => {},
  end: () => {}
};
