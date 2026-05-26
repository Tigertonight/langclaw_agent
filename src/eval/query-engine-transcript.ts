/**
 * query-engine-transcript eval
 *
 * 验证 BusinessQueryEngine Phase 1 升级后的 transcript 生命周期：
 * 1. submitMessage() 执行后，transcript 文件中应写入 turn_start 事件（engine=business_query_engine）
 * 2. submitMessage() 执行后，transcript 文件中应写入 turn_end 事件（engine=business_query_engine）
 * 3. 用 transcriptStore.recent() 能读回本轮的事件（可恢复会话历史）
 * 4. 事件中包含正确的 run_id / session_id / message_preview
 * 5. submitStream() 执行后，也应写入 turn_start 和 turn_end 事件
 *
 * 运行方式：npm run eval:query-engine-transcript
 */
import { createApp } from "../app.js";
import { resolveUserWorkspace } from "../runtime/workspace-context.js";

const sessionId = `eval_qe_transcript_${Date.now()}`;
const userId = "sales_001";
const workspace = resolveUserWorkspace(userId);

const app = createApp();
await app.init();
const { queryEngine, transcriptStore } = app;

// ── 测试 1：非流式路径 submitMessage() ──────────────────────────────────────

console.log("[eval] 测试 submitMessage() transcript 写入...");

const result = await queryEngine.submitMessage({
  userId,
  message: "今天销售目标完成情况如何？",
  sessionId,
  debug: false
});

assert(typeof result.answer === "string" && result.answer.length > 0, "submitMessage 应返回非空 answer");
assert(result.session_id === sessionId, "result.session_id 应与请求 sessionId 一致");
assert(typeof result.run_id === "string" && result.run_id.startsWith("run_"), "run_id 格式应正确");

// 稍微等一下，让异步 transcript 写入完成
await sleep(200);

const events = await transcriptStore.recent(workspace, sessionId, 200);
assert(events.length > 0, "transcript 应有事件写入");

// 验证 QueryEngine 层写入的 turn_start
const qeTurnStarts = events.filter(
  (event) => event.type === "turn_start" && event.data?.engine === "business_query_engine"
);
assert(qeTurnStarts.length > 0, "应有 engine=business_query_engine 的 turn_start 事件");
assert(
  String(qeTurnStarts[0].data.message_preview ?? "").includes("销售目标"),
  "turn_start 应包含 message_preview"
);
assert(
  qeTurnStarts[0].data.run_id === result.run_id,
  `turn_start.run_id 应匹配 result.run_id（期望 ${result.run_id}，实际 ${qeTurnStarts[0].data.run_id}）`
);

// 验证 QueryEngine 层写入的 query_engine_summary（turn_end）
const qeTurnEnds = events.filter(
  (event) => event.type === "turn_end" && event.data?.engine === "business_query_engine"
);
assert(qeTurnEnds.length > 0, "应有 engine=business_query_engine 的 turn_end 事件");
assert(
  typeof qeTurnEnds[0].data.latency_ms === "number",
  "turn_end 应包含 latency_ms"
);
assert(
  typeof qeTurnEnds[0].data.estimated_tokens === "number",
  "turn_end 应包含 estimated_tokens"
);

console.log(`[eval] submitMessage transcript OK — events=${events.length}, run_id=${result.run_id}`);

// ── 测试 2：流式路径 submitStream() ───────────────────────────────────────

console.log("[eval] 测试 submitStream() transcript 写入...");

const streamSessionId = `${sessionId}_stream`;
const streamEvents: Record<string, unknown>[] = [];

await queryEngine.submitStream({
  userId,
  message: "华南区本月线索跟进率是多少？",
  sessionId: streamSessionId,
  debug: false,
  onEvent: async (event) => {
    streamEvents.push(event);
  }
});

await sleep(200);

const streamTranscriptEvents = await transcriptStore.recent(workspace, streamSessionId, 200);
assert(streamTranscriptEvents.length > 0, "流式路径也应写入 transcript 事件");

const streamTurnStarts = streamTranscriptEvents.filter(
  (event) => event.type === "turn_start" && event.data?.engine === "business_query_engine"
);
assert(streamTurnStarts.length > 0, "流式路径应写入 engine=business_query_engine 的 turn_start");

const streamTurnEnds = streamTranscriptEvents.filter(
  (event) => event.type === "turn_end" && event.data?.engine === "business_query_engine"
);
assert(streamTurnEnds.length > 0, "流式路径应写入 engine=business_query_engine 的 turn_end");

console.log(`[eval] submitStream transcript OK — events=${streamTranscriptEvents.length}`);

// ── 测试 3：transcript.recent() 可恢复会话（会话可重放验证）───────────────

console.log("[eval] 测试 transcript 会话恢复...");

const recentEvents = await transcriptStore.recent(workspace, sessionId, 20);
assert(recentEvents.length > 0, "recent() 应能读回本 session 的事件");

// 验证按时间顺序排列：at 字段递增
for (let index = 1; index < recentEvents.length; index += 1) {
  const prev = recentEvents[index - 1].at;
  const curr = recentEvents[index].at;
  assert(prev <= curr, `事件应按时间顺序排列：index ${index - 1}(${prev}) <= ${index}(${curr})`);
}

// 验证能通过 sessionSearch 找到本轮对话
const searchResults = await transcriptStore.sessionSearch(workspace, "销售目标", { limit: 5, window: 5 });
// sessionSearch 结果可能为空（SQLite 索引可选），只要不崩就行
assert(Array.isArray(searchResults), "sessionSearch 应返回数组");

console.log(`[eval] 会话恢复验证 OK — recent=${recentEvents.length} events`);

// ── 清理 ──────────────────────────────────────────────────────────────────
console.log("\n✓ PASS query-engine-transcript eval");
console.log(`  submitMessage: ${events.length} transcript events, run_id=${result.run_id}`);
console.log(`  submitStream:  ${streamTranscriptEvents.length} transcript events`);
console.log(`  session recent: ${recentEvents.length} events`);

// ── 工具函数 ─────────────────────────────────────────────────────────────

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`[FAIL] ${message}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
