/**
 * smoke-trace.ts —— 验证 memory-service 侧的 observability 接入。
 *
 * 不依赖真 PG 也不依赖真 Langfuse：
 *   - 用 fake executor 给 MemorySearch（模拟 lexical/vector 返回）
 *   - 用 fake parent span 收集 childSpan 调用，断言 lex/vector/rrf 三个 span 都发了
 *   - 验证 extractUpstreamTrace 能从 headers 拿 trace_id
 *
 * 跑法：cd services/memory-service && npx tsx scripts/smoke-trace.ts
 */

import { MemorySearch } from "../src/db/memory-search.js";
import { extractUpstreamTrace } from "../src/observability/tracer.js";

interface FakeRow {
  id: string;
  category: string;
  name: string;
  content: string;
  tags: string[] | null;
  created_at: Date;
  score: number;
}

class FakeExecutor {
  constructor(private readonly responder: (sql: string) => FakeRow[]) {}
  async query<T>(sql: string): Promise<{ rows: T[] }> {
    return { rows: this.responder(sql) as unknown as T[] };
  }
}

interface FakeSpanCall {
  name: string;
  input?: unknown;
  ended: boolean;
  output?: unknown;
  error?: unknown;
}

function makeFakeSpan() {
  const calls: FakeSpanCall[] = [];
  const span = {
    childSpan(input: { name: string; input?: unknown }) {
      const call: FakeSpanCall = { name: input.name, input: input.input, ended: false };
      calls.push(call);
      return {
        childSpan: (i: { name: string }) => makeFakeSpan().span,
        childGeneration: () => makeFakeSpan().span,
        update: () => {},
        end: (output?: unknown, error?: unknown) => {
          call.ended = true;
          call.output = output;
          call.error = error;
        }
      } as any;
    },
    childGeneration: () => makeFakeSpan().span,
    update: () => {},
    end: () => {}
  } as any;
  return { span, calls };
}

let failures = 0;
function expect(label: string, ok: boolean): void {
  if (ok) console.log(`  ✓ ${label}`);
  else {
    console.log(`  ✗ ${label}`);
    failures += 1;
  }
}

async function main() {
  console.log("\n[1] extractUpstreamTrace 从 headers 提取 trace_id / parent_span_id / run_id");
  const fakeReq = {
    headers: {
      "x-trace-id": "trace-abc",
      "x-parent-span-id": "span-xyz",
      "x-run-id": "run-001"
    }
  } as any;
  const upstream = extractUpstreamTrace(fakeReq);
  expect("trace_id 提取", upstream.trace_id === "trace-abc");
  expect("parent_span_id 提取", upstream.parent_span_id === "span-xyz");
  expect("run_id 提取", upstream.run_id === "run-001");

  const noHeaders = extractUpstreamTrace({ headers: {} } as any);
  expect("缺 headers 时全 undefined", !noHeaders.trace_id && !noHeaders.parent_span_id && !noHeaders.run_id);

  console.log("\n[2] MemorySearch.search 在 hybrid 模式下发 lex/vector/rrf 三个 span");
  const rows: FakeRow[] = [
    { id: "m1", category: "fact", name: "n1", content: "c1", tags: ["t"], created_at: new Date(), score: 0.9 },
    { id: "m2", category: "fact", name: "n2", content: "c2", tags: [], created_at: new Date(), score: 0.7 }
  ];
  const exec = new FakeExecutor((sql) => {
    if (sql.includes("similarity")) return rows; // lexical
    return rows; // vector
  });
  // mock embedding provider through env
  process.env.EMBEDDING_PROVIDER = "hash-fallback";
  process.env.EMBEDDING_MODEL_TAG = "hash-fallback:v1";

  const search = new MemorySearch(exec as any);
  const { span, calls } = makeFakeSpan();
  const identity = { business_id: "b1", user_id: "u1", issued_at: Date.now() / 1000, scope: [] } as any;

  const items = await search.search(
    identity,
    { query: "test", mode: "hybrid", top_k: 5 } as any,
    span
  );

  const names = calls.map((c) => c.name).sort();
  expect("发了 memory.search.lex", names.includes("memory.search.lex"));
  expect("发了 memory.search.vector", names.includes("memory.search.vector"));
  expect("发了 memory.search.rrf", names.includes("memory.search.rrf"));
  expect("所有子 span 都 ended", calls.every((c) => c.ended));
  expect("rrf 输出含 hits", calls.find((c) => c.name === "memory.search.rrf")?.output != null);
  expect("结果非空", items.length > 0);

  console.log("\n[3] 不传 parentSpan 时不发任何 span（零开销 fallback）");
  const search2 = new MemorySearch(exec as any);
  const items2 = await search2.search(
    identity,
    { query: "test", mode: "lexical", top_k: 5 } as any
    // no parentSpan
  );
  expect("无 parentSpan 也能正常返回", items2.length > 0);

  if (failures > 0) {
    console.log(`\nFAIL — ${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.log("\nPASS memory-service trace smoke");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
