/**
 * Spec 1.12 wiring smoke：
 *   1) workspace.business_id 来自 user.business_id / env / "default"；
 *   2) transcript-plugin turn_end 镜像 user/assistant 消息到 memory-service；
 *   3) memory-service 不可用时进入离线队列；可用后下次调用先 flush 重放。
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { RuntimeHooks } from "../runtime/hooks.js";
import { createTranscriptPlugin } from "../runtime/transcript-plugin.js";
import { resolveUserWorkspace } from "../runtime/workspace-context.js";
import { OfflineQueue } from "../memory/offline-queue.js";
import { QueuedMemoryClient } from "../memory/queued-client.js";
import { TranscriptStore } from "../transcript/transcript-store.js";
import type { CallContext, MemoryClient, MessageItem } from "../../packages/memory-sdk/src/index.js";
import { resolveProjectPath } from "../data/load-json.js";

let failed = 0;
const expect = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`  ✓ ${label}`);
  else { console.log(`  ✗ ${label}`, detail ?? ""); failed += 1; }
};

// ─── 1. business_id 解析 ─────────────────────────────────────────────────
const wsExplicit = resolveUserWorkspace({ id: "u1", business_id: "biz_alpha" } as never);
expect("workspace.business_id from user.business_id", wsExplicit.business_id === "biz_alpha");

delete process.env.MEMORY_SERVICE_DEFAULT_BUSINESS_ID;
const wsDefault = resolveUserWorkspace({ id: "u2" } as never);
expect("workspace.business_id falls back to 'default'", wsDefault.business_id === "default");

process.env.MEMORY_SERVICE_DEFAULT_BUSINESS_ID = "biz_env";
const wsEnv = resolveUserWorkspace({ id: "u3" } as never);
expect("workspace.business_id falls back to env", wsEnv.business_id === "biz_env");
delete process.env.MEMORY_SERVICE_DEFAULT_BUSINESS_ID;

// ─── 2. offline queue 行为 ───────────────────────────────────────────────
const queueRoot = await mkdtemp(path.join(tmpdir(), "memq-"));
const queueFile = path.join(queueRoot, "q.jsonl");
const q = new OfflineQueue({ filePath: queueFile });
const ctx: CallContext = { business_id: "biz", user_id: "u" };
await q.enqueue("createMemory", ctx, { name: "k1", category: "fact", content: "v1" });
await q.enqueue("batchMessages", ctx, [{ session_id: "s", turn_index: 0, role: "user", content: "hi" }]);
expect("queue.size = 2 after two enqueues", await q.size() === 2);

// flush: 第二条故意失败 → 第二条保留
let seen = 0;
const partial = await q.flush(async (entry) => {
  seen += 1;
  if (entry.kind === "batchMessages") throw new Error("simulated_fail");
});
expect("flush replays first then stops on failure", partial.replayed === 1 && partial.remaining === 1);
expect("queue retains failed entry", await q.size() === 1);

// 再次 flush 全部成功 → 队列清空
await q.flush(async () => undefined);
expect("queue cleared after successful replay", await q.size() === 0);
void seen;

// ─── 3. QueuedMemoryClient 失败 → enqueue → flush ───────────────────────
class FakeClient {
  failNext = 0;
  inserted: MessageItem[] = [];
  memories: Array<{ ctx: CallContext; input: unknown }> = [];
  async batchMessages(_ctx: CallContext, items: MessageItem[]): Promise<{ inserted: number }> {
    if (this.failNext > 0) { this.failNext -= 1; throw new Error("simulated_down"); }
    this.inserted.push(...items);
    return { inserted: items.length };
  }
  async createMemory(c: CallContext, input: unknown): Promise<{ id: string }> {
    if (this.failNext > 0) { this.failNext -= 1; throw new Error("simulated_down"); }
    this.memories.push({ ctx: c, input });
    return { id: `mem_${this.memories.length}` };
  }
  async createRelation(): Promise<void> {
    if (this.failNext > 0) { this.failNext -= 1; throw new Error("simulated_down"); }
  }
}

const wsForQueue = resolveUserWorkspace({ id: `wiring_q_${Date.now()}` } as never);
await mkdir(wsForQueue.memory_dir, { recursive: true });
const fake = new FakeClient();
const queueFile2 = path.join(queueRoot, "client-q.jsonl");
const queued = new QueuedMemoryClient({
  client: fake as unknown as MemoryClient,
  workspace: wsForQueue,
  queueFilePath: queueFile2
});

// 模拟 service 暂时挂掉：下一次调用失败入队
fake.failNext = 1;
const r1 = await queued.batchMessages(ctx, [{ session_id: "s1", turn_index: 0, role: "user", content: "hello" }]);
expect("queued client returns ok:false on failure", r1.ok === false);
expect("queue contains the failed entry", existsSync(queueFile2));

// service 恢复后，下次调用先 flush 重放
const r2 = await queued.batchMessages(ctx, [{ session_id: "s1", turn_index: 1, role: "assistant", content: "hi" }]);
expect("queued client returns ok:true after recovery", r2.ok === true);
expect("fake client received both replayed and current messages", fake.inserted.length === 2);
expect("replay preserves original content", fake.inserted.some((m) => m.content === "hello"));

// ─── 4. transcript-plugin → memory-service 端到端 ────────────────────────
const wsForPlugin = resolveUserWorkspace({ id: `wiring_p_${Date.now()}` } as never);
await mkdir(wsForPlugin.memory_dir, { recursive: true });
const fakePlugin = new FakeClient();
const queueFile3 = path.join(queueRoot, "plugin-q.jsonl");
const factoryClient = new QueuedMemoryClient({
  client: fakePlugin as unknown as MemoryClient,
  workspace: wsForPlugin,
  queueFilePath: queueFile3
});

const hooks = new RuntimeHooks();
hooks.use(createTranscriptPlugin({
  transcriptStore: new TranscriptStore(),
  memoryClientFactory: () => factoryClient
}));

await hooks.emit("turn_end", {
  user_id: wsForPlugin.user_id,
  session_id: "session_a",
  message: "客户张三想买汉EV",
  answer: "好的"
});

expect("transcript wrote 2 messages to memory-service", fakePlugin.inserted.length === 2);
expect("user message routed to memory-service", fakePlugin.inserted.some((m) => m.role === "user" && m.content === "客户张三想买汉EV"));
expect("assistant message routed to memory-service", fakePlugin.inserted.some((m) => m.role === "assistant"));
const indices = fakePlugin.inserted.map((m) => m.turn_index).sort((a, b) => a - b);
expect("turn indices are 0, 1", indices[0] === 0 && indices[1] === 1);

// 第二次 turn_end → turn_index 继续递增
await hooks.emit("turn_end", {
  user_id: wsForPlugin.user_id,
  session_id: "session_a",
  message: "再问一句",
  answer: "好"
});
const allIndices = fakePlugin.inserted.map((m) => m.turn_index).sort((a, b) => a - b);
expect("second turn extends turn_index", allIndices.includes(2) && allIndices.includes(3));

// 验证 memory-service 不可用时不阻塞 transcript-store 主路径
const transcriptFile = path.join(wsForPlugin.root, "transcripts", "session_a.jsonl");
expect("transcript file still written even with memory-service path", existsSync(transcriptFile));
const events = (await readFile(transcriptFile, "utf8")).split("\n").filter(Boolean);
expect("transcript contains turn_end event", events.some((l) => l.includes("\"turn_end\"")));

// ─── 清理 ────────────────────────────────────────────────────────────────
await rm(queueRoot, { recursive: true, force: true });
await rm(resolveProjectPath("users", wsForQueue.user_id), { recursive: true, force: true });
await rm(resolveProjectPath("users", wsForPlugin.user_id), { recursive: true, force: true });

if (failed > 0) {
  console.error(`\n${failed} 1.12 wiring smoke check(s) failed`);
  process.exit(1);
}
console.log("\nPASS memory-service 1.12 wiring smoke");
