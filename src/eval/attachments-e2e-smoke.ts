/**
 * attachments e2e smoke
 *
 * 不打 HTTP、不真发 LLM；直接：
 *  1) 往 AttachmentStore 注入一条 text 附件
 *  2) 调 expandMessageWithAttachments — 验证 LLM-bound message 被拼上了附件正文
 *  3) 调 queryEngine.submitMessage(attachmentIds=[id]) — 验证：
 *     - result.user_message 仍是 *原始* message（没有泄漏 expansion 给 caller / transcript）
 *     - transcript 写入了 attachments_attached 事件，且 metadata 正确
 *     - 跨租户访问被拒（防泄漏）
 *
 * 跑法：npx tsx src/eval/attachments-e2e-smoke.ts
 */
import { createApp } from "../app.js";
import { resolveUserWorkspace } from "../runtime/workspace-context.js";
import { getAttachmentStore } from "../attachments/index.js";
import { expandMessageWithAttachments } from "../runtime/business-query-engine.js";
import type { AttachmentContext } from "../attachments/types.js";

const userId = "sales_001";
const otherUserId = "sales_002";
const workspace = resolveUserWorkspace(userId);
const sessionId = `eval_attach_e2e_${Date.now()}`;

const app = createApp();
await app.init();
const { queryEngine, transcriptStore } = app;

const store = getAttachmentStore();

// ── 注入一条 text 附件 ────────────────────────────────────────────
const fakeId = `att_${Date.now()}`;
const fakeText = "线索ID,姓名,跟进状态\n001,张三,已联系\n002,李四,待联系\n";
const ctx: AttachmentContext = {
  id: fakeId,
  filename: "leads.csv",
  mime_type: "text/csv",
  size_bytes: Buffer.byteLength(fakeText),
  kind: "text",
  text: fakeText,
  text_chars_total: fakeText.length,
  text_chars_truncated: 0,
  storage_key: `${workspace.business_id}/${userId}/${sessionId}/${fakeId}-leads.csv`
};
store.put(workspace.business_id, userId, sessionId, ctx);

// ── [1] expandMessageWithAttachments 行为 ───────────────────────────
console.log("[1] expandMessageWithAttachments 拼接附件正文");
const userMessage = "帮我看下这批线索";
const expanded = expandMessageWithAttachments(workspace.business_id, userId, {
  userId,
  message: userMessage,
  sessionId,
  attachmentIds: [fakeId]
});
assert(expanded.attachments.length === 1, "应解出 1 条附件");
assert(
  expanded.expandedMessage.includes("--- file: leads.csv (text) ---"),
  "expandedMessage 应含文件 marker"
);
assert(
  expanded.expandedMessage.includes("张三"),
  "expandedMessage 应含解析后的正文"
);
assert(
  expanded.expandedMessage.endsWith(userMessage),
  "expandedMessage 末尾应保留原始用户消息"
);
console.log("  ✓ marker + 正文 + 原始 message 都在");

// ── [2] 跨租户访问被拒 ─────────────────────────────────────────────
console.log("[2] 跨租户取附件应当不可见");
const otherWorkspace = resolveUserWorkspace(otherUserId);
const cross = expandMessageWithAttachments(otherWorkspace.business_id, otherUserId, {
  userId: otherUserId,
  message: userMessage,
  sessionId,
  attachmentIds: [fakeId]
});
assert(cross.attachments.length === 0, "其他用户不该能拿到这条附件");
assert(cross.expandedMessage === userMessage, "无附件时 expandedMessage 应等于原始消息");
console.log("  ✓ 隔离生效");

// ── [3] submitMessage 真跑一遍 ──────────────────────────────────────
console.log("[3] submitMessage(attachmentIds) 端到端");
// 重新注入（前一步的 get 会刷新到期但不会消费，仍可复用；为避免被前面用例改动到状态，再 put 一次更稳）
store.put(workspace.business_id, userId, sessionId, ctx);

const result = await queryEngine.submitMessage({
  userId,
  message: userMessage,
  sessionId,
  debug: false,
  attachmentIds: [fakeId]
}) as { run_id: string; user_message?: string; answer?: string };

assert(typeof result.run_id === "string" && result.run_id.startsWith("run_"), "应返回 run_id");
assert(
  result.user_message === userMessage,
  `result.user_message 应保留原始消息（不泄漏 expansion）；got: ${result.user_message?.slice(0, 60)}`
);
console.log(`  ✓ user_message 保留原始；run_id=${result.run_id}`);

// ── [4] transcript 落了 attachments_attached ───────────────────────
console.log("[4] transcript 写入 attachments_attached 事件");
await sleep(200);
const events = await transcriptStore.recent(workspace, sessionId, 200);
const attachEvents = events.filter((e) => e.type === "attachments_attached");
assert(attachEvents.length >= 1, `应至少写入 1 条 attachments_attached 事件，实际 ${attachEvents.length}`);

const evt = attachEvents[attachEvents.length - 1];
const evtAttachments = Array.isArray(evt.data?.attachments) ? (evt.data.attachments as Array<Record<string, unknown>>) : [];
assert(evtAttachments.length === 1, "事件 payload 应含 1 条附件 metadata");
const meta = evtAttachments[0];
assert(meta.id === fakeId, "metadata.id 应匹配");
assert(meta.filename === "leads.csv", "metadata.filename 应匹配");
assert(meta.kind === "text", "metadata.kind 应为 text");
// transcript 仅记 metadata，不应包含解析后的正文
const evtJson = JSON.stringify(evt);
assert(!evtJson.includes("张三"), "transcript 事件不应含正文（避免重复存储）");
console.log("  ✓ metadata 正确，正文未泄漏到 transcript");

// ── [5] 不传 attachmentIds 时不发事件 ──────────────────────────────
console.log("[5] 无附件 turn 不应触发 attachments_attached");
const sessionId2 = `${sessionId}_noattach`;
await queryEngine.submitMessage({
  userId,
  message: "今天天气如何",
  sessionId: sessionId2,
  debug: false
});
await sleep(200);
const events2 = await transcriptStore.recent(workspace, sessionId2, 50);
const attachEvents2 = events2.filter((e) => e.type === "attachments_attached");
assert(attachEvents2.length === 0, "无附件 turn 不该写 attachments_attached");
console.log("  ✓ 无附件路径未触发事件");

console.log("\n✓ PASS attachments-e2e-smoke");

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`[FAIL] ${msg}`);
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
