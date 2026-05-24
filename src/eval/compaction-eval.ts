/**
 * compaction-eval
 *
 * 验证 Phase 3 Compaction + Token Budget 的核心功能：
 * 1. TokenBudget.fitSections() 能按优先级截断和全局预算削减
 * 2. TokenBudget.checkUsage() 能返回正确的 compaction_needed 信号
 * 3. MicroCompact.compact() 能压缩大 tool_result，保留摘要
 * 4. SessionCompact.compact() 能生成 session summary 并写入 compacts/
 * 5. CompactBoundary.write() 能写入 transcript 边界事件
 * 6. ContextAssembler.assemble() 返回 token_budget_usage.compaction_needed
 *
 * 运行方式：npm run eval:compaction
 */
import { resolveUserWorkspace } from "../runtime/workspace-context.js";
import { TokenBudget } from "../context/token-budget.js";
import { MicroCompact } from "../context/micro-compact.js";
import { SessionCompact } from "../context/session-compact.js";
import { CompactBoundary } from "../context/compact-boundary.js";
import { TranscriptStore } from "../transcript/transcript-store.js";
import { ContextAssembler } from "../runtime/context-assembler.js";
import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";

const TEST_USER = `eval_compact_${Date.now()}`;
const workspace = resolveUserWorkspace(TEST_USER);

// 清理
try { await rm(workspace.root, { recursive: true, force: true }); } catch { /* ok */ }

// ── 测试 1：TokenBudget.fitSections() 按优先级截断 ────────────────────────
console.log("[eval] 测试 1：TokenBudget.fitSections() 截断...");
const budget = new TokenBudget({ maxChars: 1000, softTokenLimit: 300, sections: [
  { name: "runtime", maxChars: 300, priority: 100 },
  { name: "admin",   maxChars: 300, priority: 90  },
  { name: "memory",  maxChars: 300, priority: 70  },
  { name: "tasks",   maxChars: 200, priority: 80  }
] });

const sections = [
  { name: "runtime", content: "x".repeat(280) },  // 在限制内
  { name: "admin",   content: "y".repeat(290) },  // 在限制内
  { name: "memory",  content: "m".repeat(500) },  // 超过 300 → 截断
  { name: "tasks",   content: "t".repeat(200) }   // 在限制内
];

const fitResult = budget.fitSections(sections);
assert(fitResult.sections.length === 4, "fitSections 应返回 4 个分区");
const runtimeSection = fitResult.sections.find((s) => s.name === "runtime");
const memorySection = fitResult.sections.find((s) => s.name === "memory");
assert(runtimeSection !== undefined && !runtimeSection.truncated, "runtime 分区不应被截断");
assert(memorySection !== undefined && memorySection.truncated, "memory 分区应被截断");
assert(memorySection !== undefined && memorySection.used_chars < 500, `memory 截断后字符数应 < 500，实际 ${memorySection?.used_chars}`);
assert(fitResult.usage.used_chars <= 1000 + 100, `总字符数应接近 1000，实际 ${fitResult.usage.used_chars}`); // 允许一点截断后缀误差
console.log(`[eval] 测试 1 PASS — 总字符 ${fitResult.usage.used_chars}，memory 截断: ${memorySection?.truncated}`);

// ── 测试 2：TokenBudget.checkUsage() compaction_needed 信号 ─────────────
console.log("[eval] 测试 2：compaction_needed 信号...");
const budgetTight = new TokenBudget({ maxChars: 10000, softTokenLimit: 100 });
const largeSection = [{ name: "conversation", content: "a".repeat(300) }];
const usage = budgetTight.checkUsage(largeSection);
// 300 chars / 2 = 150 tokens > soft_limit 100 → compaction_needed = true
assert(usage.compaction_needed === true, `softTokenLimit=100, 150 estimated tokens 应触发 compaction_needed，实际 ${usage.estimated_tokens}`);

const budgetLoose = new TokenBudget({ maxChars: 10000, softTokenLimit: 10000 });
const smallSection = [{ name: "conversation", content: "hello" }];
const usageLoose = budgetLoose.checkUsage(smallSection);
assert(usageLoose.compaction_needed === false, "宽松预算不应触发 compaction_needed");
console.log("[eval] 测试 2 PASS");

// ── 测试 3：MicroCompact.compact() 压缩大 tool_result ────────────────────
console.log("[eval] 测试 3：MicroCompact 压缩大 tool_result...");
const microCompact = new MicroCompact({ maxResultChars: 200 });

const fakeToolResult = {
  id: "evt_001",
  at: new Date().toISOString(),
  session_id: "sess_001",
  type: "tool_result" as const,
  data: {
    tool: "dealer.sales_query",
    ok: true,
    data: Array.from({ length: 50 }, (_, i) => ({ row: i, value: `data_${i}_${"x".repeat(30)}` }))
  }
};

const fakeToolCall = {
  id: "evt_000",
  at: new Date().toISOString(),
  session_id: "sess_001",
  type: "tool_call" as const,
  data: { tool: "dealer.sales_query", arguments: { date: "2024-01", store: "001" } }
};

const microResult = microCompact.compact([fakeToolCall, fakeToolResult]);
assert(microResult.compacted_count === 1, `应压缩 1 条 tool_result，实际 ${microResult.compacted_count}`);
assert(microResult.saved_chars > 0, "应节省字符数");
const compactedEvent = microResult.events[1];
assert(compactedEvent.data["__compacted"] === true, "压缩后应有 __compacted 标记");
assert(compactedEvent.data["__ref"] === "evt_001", "压缩后应保留原始 event id ref");
assert(typeof (compactedEvent.data["data_summary"] as Record<string, unknown>)?.["count"] === "number", "data_summary 应包含 count");
console.log(`[eval] 测试 3 PASS — 节省 ${microResult.saved_chars} 字符`);

// ── 测试 4：MicroCompact 不压缩小 tool_result ────────────────────────────
console.log("[eval] 测试 4：MicroCompact 不压缩小 tool_result...");
const microCompact2 = new MicroCompact({ maxResultChars: 10000 });
const smallResult = {
  id: "evt_002",
  at: new Date().toISOString(),
  session_id: "sess_001",
  type: "tool_result" as const,
  data: { tool: "memory.retrieve", ok: true, data: { items: [] } }
};
const microResult2 = microCompact2.compact([smallResult]);
assert(microResult2.compacted_count === 0, "小 tool_result 不应被压缩");
console.log("[eval] 测试 4 PASS");

// ── 测试 5：SessionCompact.compact() 生成 session summary ─────────────────
console.log("[eval] 测试 5：SessionCompact.compact() 生成摘要...");

const transcriptStore = new TranscriptStore();
const SESSION_ID = "eval_session_compact_001";

// 写入足够多的 transcript 事件
for (let index = 0; index < 5; index += 1) {
  await transcriptStore.append(workspace, SESSION_ID, "turn_start", { turn: index });
  await transcriptStore.append(workspace, SESSION_ID, "user_message", { text: `华南区线索情况第${index + 1}次询问`, run_id: `run_${index}` });
  await transcriptStore.append(workspace, SESSION_ID, "route_decision", { route: "dealer.sales_query", confidence: 0.92 });
  await transcriptStore.append(workspace, SESSION_ID, "tool_call", { tool: "dealer.sales_query", arguments: { date: "2024-01" }, run_id: `run_${index}` });
  await transcriptStore.append(workspace, SESSION_ID, "tool_result", { tool: "dealer.sales_query", ok: true, data: "x".repeat(2000), run_id: `run_${index}` });
  await transcriptStore.append(workspace, SESSION_ID, "assistant_answer", { text: `华南区本月线索数为 ${100 + index * 10} 条`, run_id: `run_${index}` });
  await transcriptStore.append(workspace, SESSION_ID, "turn_end", { message_preview: "询问线索", answer_preview: "结果已给出" });
}

const sessionCompact = new SessionCompact({
  transcriptStore,
  options: { triggerEventCount: 10, windowSize: 80, keepRecentTurns: 3, keepTaskSnapshots: 5 }
});

const compactResult = await sessionCompact.compact(workspace, SESSION_ID);
assert(compactResult.session_id === SESSION_ID, "session_id 应匹配");
assert(compactResult.summary.covered_event_count > 0, "covered_event_count 应 > 0");
assert(Array.isArray(compactResult.summary.turns), "turns 应为数组");
assert(Array.isArray(compactResult.summary.route_decisions), "route_decisions 应为数组");
assert(compactResult.summary.route_decisions.length > 0, "应提取到 route_decisions");
assert(existsSync(compactResult.summary_path), `summary 文件应存在: ${compactResult.summary_path}`);
assert(compactResult.micro_compact_stats.compacted_count > 0, "MicroCompact 应压缩至少 1 条大 tool_result");
console.log(`[eval] 测试 5 PASS — ${compactResult.summary.covered_event_count} 事件 → summary，节省 ${compactResult.micro_compact_stats.saved_chars} 字符`);

// ── 测试 6：SessionCompact.loadLatestSummary() 能读取摘要 ─────────────────
console.log("[eval] 测试 6：loadLatestSummary() 读取摘要...");
const loadedSummary = await sessionCompact.loadLatestSummary(workspace, SESSION_ID);
assert(loadedSummary !== null, "loadLatestSummary 应返回非 null");
assert(loadedSummary!.session_id === SESSION_ID, "summary session_id 应匹配");
assert(Array.isArray(loadedSummary!.turns), "summary turns 应为数组");
console.log(`[eval] 测试 6 PASS — 加载 summary，turns: ${loadedSummary!.turns.length}`);

// ── 测试 7：CompactBoundary 写入 transcript 边界 ─────────────────────────
console.log("[eval] 测试 7：CompactBoundary.write() 写入 transcript...");
const compactBoundary = new CompactBoundary(transcriptStore);
await compactBoundary.write(workspace, SESSION_ID, {
  compact_type: "micro",
  session_id: SESSION_ID,
  covered_event_count: 10,
  original_chars: 5000,
  compacted_chars: 2000,
  saved_chars: 3000,
  reason: "test boundary write"
});

const eventsAfterBoundary = await transcriptStore.recent(workspace, SESSION_ID, 200);
const boundaryEvent = eventsAfterBoundary.find((e) => e.data?.["__compact_boundary"] === true);
assert(boundaryEvent !== undefined, "应能在 transcript 中找到 compact_boundary 事件");
// 查找最新边界（micro，在 session 边界之后写入）
const latestAfterWrite = compactBoundary.findLatest(eventsAfterBoundary);
assert(latestAfterWrite !== null, "findLatest 应找到最新边界（micro）");
assert((latestAfterWrite!.compact_type as string) === "micro", `最新 compact_type 应为 micro，实际 ${latestAfterWrite!.compact_type}`);
console.log("[eval] 测试 7 PASS");

// ── 测试 8：CompactBoundary.findLatest() 能定位最新边界 ──────────────────
console.log("[eval] 测试 8：CompactBoundary.findLatest()...");
const latestBoundary = compactBoundary.findLatest(eventsAfterBoundary);
assert(latestBoundary !== null, "findLatest 应找到边界事件");
assert(latestBoundary!.compact_type === "micro", "findLatest 返回的 compact_type 应为 micro");
console.log("[eval] 测试 8 PASS");

// ── 测试 9：ContextAssembler 返回 token_budget_usage ─────────────────────
console.log("[eval] 测试 9：ContextAssembler token_budget_usage...");
const assembler = new ContextAssembler();
const fakeUser = { id: TEST_USER, name: "测试用户", role: "sales", department: "华南区", default_store: "store_001", permissions: [] };
const result = assembler.assemble({
  user: fakeUser,
  workspace,
  message: "华南区线索情况",
  enterpriseContext: {
    admin: [{ type: "system", content: "你是汽车经销商 Agent" }],
    user_memory: { items: [{ key: "preference", value: "喜欢表格" }] },
    tasks: { active: [{ id: "t1", subject: "Q2 线索提升" }] }
  }
});

assert("token_budget_usage" in result, "结果应包含 token_budget_usage 字段");
assert(result.token_budget_usage !== null, "token_budget_usage 不应为 null");
assert(typeof result.token_budget_usage!.estimated_tokens === "number", "estimated_tokens 应为数字");
assert(typeof result.token_budget_usage!.compaction_needed === "boolean", "compaction_needed 应为 boolean");
assert("compaction_needed" in result.budget, "budget 对象应包含 compaction_needed");
console.log(`[eval] 测试 9 PASS — estimated_tokens=${result.token_budget_usage!.estimated_tokens}, compaction_needed=${result.token_budget_usage!.compaction_needed}`);

// ── 清理 ──────────────────────────────────────────────────────────────────
try { await rm(workspace.root, { recursive: true, force: true }); } catch { /* ok */ }

console.log("\n✓ PASS compaction eval");
console.log(`  TokenBudget: fitSections 截断 memory 分区，节省 ${500 - (memorySection?.used_chars ?? 500)} 字符`);
console.log(`  MicroCompact: 压缩 ${microResult.compacted_count} 条，节省 ${microResult.saved_chars} 字符`);
console.log(`  SessionCompact: ${compactResult.summary.covered_event_count} 事件 → summary（${compactResult.summary.turns.length} 轮问答）`);
console.log(`  CompactBoundary: transcript 边界事件写入 PASS`);
console.log(`  ContextAssembler: compaction_needed=${result.token_budget_usage!.compaction_needed}`);

// ── 工具函数 ─────────────────────────────────────────────────────────────

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[FAIL] ${message}`);
}
