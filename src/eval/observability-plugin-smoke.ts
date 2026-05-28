/**
 * 验证 ObservabilityPlugin：
 *   1. turn_start → trace 创建
 *   2. 各 hook 都能产出对应 span，不抛
 *   3. turn_end 关闭 trace + 清理 run 状态
 *   4. emitter 失败时业务 hook emit 不受影响（hook.emit 自己包了 try/catch，
 *      但我们要进一步验证 plugin handler 内部异常也不抛出来）
 *   5. 多个并发 run_id 互不干扰
 *   6. 缺 run_id / 未配置 emitter 时不崩
 *
 * 不依赖真实 Langfuse —— 用 NoopAdapter（默认行为）+ 一个 SpyEmitter 验证调用。
 */

import { RuntimeHooks } from "../runtime/hooks.js";
import { createObservabilityPlugin } from "../runtime/observability-plugin.js";
import type {
  GenerationInput,
  ScoreInput,
  SpanHandle,
  SpanInput,
  TraceEmitter,
  TraceHandle,
  TraceInput
} from "../../packages/observability-sdk/src/index.js";

let failed = 0;
const expect = (label: string, ok: boolean, detail?: unknown): void => {
  if (ok) console.log(`  ✓ ${label}`);
  else {
    console.log(`  ✗ ${label}`, detail ?? "");
    failed += 1;
  }
};

/* ───── SpyEmitter ───── */

interface SpyTrace {
  id: string;
  input?: TraceInput;
  spans: SpySpan[];
  metadataUpdates: Record<string, unknown>[];
  outputAtEnd?: unknown;
  scores: ScoreInput[];
  ended: boolean;
}

interface SpySpan {
  parentTraceId: string;
  input: SpanInput | GenerationInput;
  kind: "span" | "generation";
  ended: boolean;
  outputAtEnd?: unknown;
  errorAtEnd?: unknown;
  metadataUpdates: Record<string, unknown>[];
}

class SpyEmitter implements TraceEmitter {
  traces: SpyTrace[] = [];
  failOnNthCall: number | null = null;
  callCount = 0;

  startTrace(input: TraceInput): TraceHandle {
    this.callCount += 1;
    if (this.failOnNthCall !== null && this.callCount === this.failOnNthCall) {
      throw new Error("simulated emitter failure");
    }
    const tr: SpyTrace = {
      id: `spy-${this.traces.length + 1}`,
      input,
      spans: [],
      metadataUpdates: [],
      scores: [],
      ended: false
    };
    this.traces.push(tr);
    const self = this;
    const traceHandle: TraceHandle = {
      traceId: tr.id,
      span(input: SpanInput): SpanHandle {
        return self.makeSpan(tr, input, "span");
      },
      generation(input: GenerationInput): SpanHandle {
        return self.makeSpan(tr, input, "generation");
      },
      score(input: ScoreInput): void {
        tr.scores.push(input);
      },
      update(metadata: Record<string, unknown>): void {
        tr.metadataUpdates.push(metadata);
      },
      end(output?: unknown): void {
        tr.ended = true;
        tr.outputAtEnd = output;
      }
    };
    return traceHandle;
  }

  private makeSpan(
    parent: SpyTrace,
    input: SpanInput | GenerationInput,
    kind: "span" | "generation"
  ): SpanHandle {
    const sp: SpySpan = {
      parentTraceId: parent.id,
      input,
      kind,
      ended: false,
      metadataUpdates: []
    };
    parent.spans.push(sp);
    const self = this;
    return {
      childSpan(input: SpanInput): SpanHandle {
        return self.makeSpan(parent, input, "span");
      },
      childGeneration(input: GenerationInput): SpanHandle {
        return self.makeSpan(parent, input, "generation");
      },
      update(metadata: Record<string, unknown>): void {
        sp.metadataUpdates.push(metadata);
      },
      end(output?: unknown, error?: unknown): void {
        sp.ended = true;
        sp.outputAtEnd = output;
        sp.errorAtEnd = error;
      }
    };
  }

  async flush(): Promise<void> {}
  async shutdown(): Promise<void> {}

  reset(): void {
    this.traces = [];
    this.callCount = 0;
    this.failOnNthCall = null;
  }
}

/* ───── tests ───── */

async function emitTurnSequence(
  hooks: RuntimeHooks,
  opts: { runId: string; userId?: string; sessionId?: string; businessId?: string; intent?: string }
): Promise<void> {
  const userId = opts.userId ?? "u1";
  const sessionId = opts.sessionId ?? "s1";
  const runId = opts.runId;
  const businessId = opts.businessId ?? "biz-default";

  await hooks.emit("turn_start", {
    user_id: userId,
    session_id: sessionId,
    run_id: runId,
    message: "客户咨询凯美瑞 2024 款保养周期",
    business_id: businessId
  });

  await hooks.emit("context_ingest", {
    user_id: userId,
    session_id: sessionId,
    run_id: runId,
    stage: "ingest",
    sources: { transcript: 3, memory: 5 }
  });

  await hooks.emit("context_assembly", {
    user_id: userId,
    session_id: sessionId,
    run_id: runId,
    budget: { total: 8000, used: 6234 },
    sections: [{ name: "context" }, { name: "tools" }],
    dropped: []
  });

  await hooks.emit("route_decision", {
    user_id: userId,
    session_id: sessionId,
    run_id: runId,
    message: "客户咨询凯美瑞 2024 款保养周期",
    route: {
      intent: opts.intent ?? "knowledge_lookup",
      candidates: ["knowledge_lookup", "intent_query"],
      score: 0.83,
      reason: "命中 knowledge_qa 关键词"
    }
  });

  await hooks.emit("before_tool_call", {
    user_id: userId,
    session_id: sessionId,
    run_id: runId,
    tool: "memory.search",
    input: { query: "凯美瑞 保养周期" },
    risk_level: "read"
  });

  await hooks.emit("after_tool_call", {
    user_id: userId,
    session_id: sessionId,
    run_id: runId,
    tool: "memory.search",
    output: { hits: 3 },
    duration_ms: 142,
    ok: true
  });

  await hooks.emit("agentic_prepare", {
    user_id: userId,
    session_id: sessionId,
    run_id: runId,
    model: "MiniMax-M2.7",
    tools_available: ["memory.search", "knowledge_lookup"]
  });

  await hooks.emit("agentic_complete", {
    user_id: userId,
    session_id: sessionId,
    run_id: runId,
    answer: "凯美瑞 2024 款建议每 10000 公里或 12 个月保养一次。",
    steps: [{ thought: "find policy" }, { tool: "memory.search" }],
    stop_reason: "stop"
  });

  await hooks.emit("turn_end", {
    user_id: userId,
    session_id: sessionId,
    run_id: runId,
    message: "客户咨询凯美瑞 2024 款保养周期",
    answer: "凯美瑞 2024 款建议每 10000 公里或 12 个月保养一次。",
    answer_preview: "凯美瑞 2024 款建议每 10000 公里或 12 个月保养一次。",
    tool_count: 1
  });
}

console.log("\n[1] 单 turn 完整序列");
{
  const spy = new SpyEmitter();
  const hooks = new RuntimeHooks();
  hooks.use(createObservabilityPlugin({ emitter: spy, env: "dev" }));
  await emitTurnSequence(hooks, { runId: "run-1", intent: "knowledge_lookup" });

  expect("产出了 1 个 trace", spy.traces.length === 1);
  const tr = spy.traces[0];
  expect("trace input 是用户消息", tr.input?.input === "客户咨询凯美瑞 2024 款保养周期");
  expect("trace tags 含 business_id", tr.input?.tags.business_id === "biz-default");
  expect("trace tags 含 user_id", tr.input?.tags.user_id === "u1");
  expect("trace tags 含 session_id", tr.input?.tags.session_id === "s1");
  expect("trace tags channel=web", tr.input?.tags.channel === "web");
  expect("trace tags env=dev", tr.input?.tags.env === "dev");
  expect("trace 已关闭", tr.ended === true);
  expect(
    "intent 通过 update 回填到 trace metadata",
    tr.metadataUpdates.some((m) => m.intent === "knowledge_lookup")
  );

  // span 数量：context.ingest + context.assembly + route + tool:memory.search + agent.run = 5
  expect(`span 数量 = 5（实得 ${tr.spans.length}）`, tr.spans.length === 5);
  const names = tr.spans.map((s) => (s.input as SpanInput).name);
  expect("含 context.ingest", names.includes("context.ingest"));
  expect("含 context.assembly", names.includes("context.assembly"));
  expect("含 route", names.includes("route"));
  expect("含 tool:memory.search", names.includes("tool:memory.search"));
  expect("含 agent.run（generation）", names.includes("agent.run"));
  expect(
    "agent.run 是 generation 类型",
    tr.spans.find((s) => (s.input as SpanInput).name === "agent.run")?.kind === "generation"
  );
  expect("所有 span 都已 end", tr.spans.every((s) => s.ended));
}

console.log("\n[2] 多个并发 run 互不干扰");
{
  const spy = new SpyEmitter();
  const hooks = new RuntimeHooks();
  hooks.use(createObservabilityPlugin({ emitter: spy, env: "dev" }));

  // 交替 emit 两个 run 的 hook
  await hooks.emit("turn_start", { user_id: "u1", session_id: "s1", run_id: "rA", message: "msg A" });
  await hooks.emit("turn_start", { user_id: "u2", session_id: "s2", run_id: "rB", message: "msg B" });
  await hooks.emit("before_tool_call", { user_id: "u1", session_id: "s1", run_id: "rA", tool: "tool_a" });
  await hooks.emit("before_tool_call", { user_id: "u2", session_id: "s2", run_id: "rB", tool: "tool_b" });
  await hooks.emit("after_tool_call", { user_id: "u2", session_id: "s2", run_id: "rB", tool: "tool_b", output: "B done" });
  await hooks.emit("after_tool_call", { user_id: "u1", session_id: "s1", run_id: "rA", tool: "tool_a", output: "A done" });
  await hooks.emit("turn_end", { user_id: "u1", session_id: "s1", run_id: "rA", answer: "A" });
  await hooks.emit("turn_end", { user_id: "u2", session_id: "s2", run_id: "rB", answer: "B" });

  expect("产出 2 个 trace", spy.traces.length === 2);
  const trA = spy.traces[0];
  const trB = spy.traces[1];
  const trA_toolNames = trA.spans.map((s) => (s.input as SpanInput).name);
  const trB_toolNames = trB.spans.map((s) => (s.input as SpanInput).name);
  expect("trA 含 tool:tool_a 不含 tool:tool_b", trA_toolNames.includes("tool:tool_a") && !trA_toolNames.includes("tool:tool_b"));
  expect("trB 含 tool:tool_b 不含 tool:tool_a", trB_toolNames.includes("tool:tool_b") && !trB_toolNames.includes("tool:tool_a"));
  expect("两个 trace 都 ended", trA.ended && trB.ended);
}

console.log("\n[3] 缺关键字段优雅跳过");
{
  const spy = new SpyEmitter();
  const hooks = new RuntimeHooks();
  hooks.use(createObservabilityPlugin({ emitter: spy, env: "dev" }));

  await hooks.emit("turn_start", { run_id: "x", user_id: "u1" }); // 缺 session_id
  expect("缺 session_id 不创建 trace", spy.traces.length === 0);

  await hooks.emit("before_tool_call", { run_id: "ghost", tool: "x" }); // run 不存在
  expect("不存在的 run_id 不报错", true);

  await hooks.emit("turn_end", { run_id: "ghost" });
  expect("ghost turn_end 不报错", true);
}

console.log("\n[4] emitter 抛异常时 hook emit 不挂");
{
  const spy = new SpyEmitter();
  spy.failOnNthCall = 1; // 第一次 startTrace 直接抛
  const hooks = new RuntimeHooks();
  hooks.use(createObservabilityPlugin({ emitter: spy, env: "dev" }));

  let crashed = false;
  try {
    await hooks.emit("turn_start", {
      user_id: "u1",
      session_id: "s1",
      run_id: "boom",
      message: "x"
    });
    await hooks.emit("turn_end", {
      user_id: "u1",
      session_id: "s1",
      run_id: "boom",
      answer: "y"
    });
  } catch {
    crashed = true;
  }
  expect("hook emit 链路未抛", !crashed);
  expect("emitter 抛后 traces 为空", spy.traces.length === 0);
}

console.log("\n[5] tool span 异常路径");
{
  const spy = new SpyEmitter();
  const hooks = new RuntimeHooks();
  hooks.use(createObservabilityPlugin({ emitter: spy, env: "dev" }));
  await hooks.emit("turn_start", { user_id: "u1", session_id: "s1", run_id: "r5", message: "m" });
  await hooks.emit("before_tool_call", { user_id: "u1", session_id: "s1", run_id: "r5", tool: "fail_tool" });
  await hooks.emit("after_tool_call", {
    user_id: "u1",
    session_id: "s1",
    run_id: "r5",
    tool: "fail_tool",
    error: "boom",
    duration_ms: 50
  });
  await hooks.emit("turn_end", { user_id: "u1", session_id: "s1", run_id: "r5", answer: "" });

  const tr = spy.traces[0];
  const toolSpan = tr.spans.find((s) => (s.input as SpanInput).name === "tool:fail_tool");
  expect("error 被传给 span.end", toolSpan?.errorAtEnd instanceof Error);
}

console.log("\n[6] route 兼容 before/after 双 hook");
{
  const spy = new SpyEmitter();
  const hooks = new RuntimeHooks();
  hooks.use(createObservabilityPlugin({ emitter: spy, env: "dev" }));
  await hooks.emit("turn_start", { user_id: "u1", session_id: "s1", run_id: "r6", message: "m" });
  await hooks.emit("before_route", { user_id: "u1", session_id: "s1", run_id: "r6", message: "m" });
  await hooks.emit("after_route", {
    user_id: "u1",
    session_id: "s1",
    run_id: "r6",
    route: { intent: "chitchat", reason: "no business keywords" }
  });
  await hooks.emit("turn_end", { user_id: "u1", session_id: "s1", run_id: "r6", answer: "" });

  const tr = spy.traces[0];
  const routeSpan = tr.spans.find((s) => (s.input as SpanInput).name === "route");
  expect("route span 已 end", routeSpan?.ended === true);
  expect(
    "trace.update intent=chitchat",
    tr.metadataUpdates.some((m) => m.intent === "chitchat")
  );
}

if (failed > 0) {
  console.error(`\n${failed} observability-plugin smoke check(s) failed`);
  process.exit(1);
}
console.log("\nPASS observability-plugin smoke");
