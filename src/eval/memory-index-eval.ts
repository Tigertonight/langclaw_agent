/**
 * memory-index-eval
 *
 * 验证 Phase 2 Memory Index + Retriever + Episodes 的核心功能：
 * 1. MemoryIndex.rebuild() 能生成正确格式的 MEMORY.md
 * 2. MemoryIndex.load() 能解析 frontmatter，返回正确的摘要
 * 3. MemoryIndex.scanCategories() 能按分类返回条目文本
 * 4. MemoryLearner.apply() 后自动触发 MEMORY.md 索引重建
 * 5. MemoryRetriever.retrieve() 能利用索引短路（空 memory 时快速返回）
 * 6. EpisodeStore.append() + recent() 正常工作
 *
 * 运行方式：npm run eval:memory-index
 */
import { resolveUserWorkspace } from "../runtime/workspace-context.js";
import { MemoryIndex } from "../memory/memory-index.js";
import { MemoryLearner } from "../evolution/memory-learner.js";
import { MemoryRetriever } from "../memory/memory-retriever.js";
import { EpisodeStore } from "../evolution/episode-store.js";
import type { EvolutionTurnInput, EvolutionResult } from "../evolution/types.js";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";

const TEST_USER = `eval_mem_idx_${Date.now()}`;
const workspace = resolveUserWorkspace(TEST_USER);
const memoryIndex = new MemoryIndex();
const memoryLearner = new MemoryLearner();
const memoryRetriever = new MemoryRetriever({ memoryIndex });
const episodeStore = new EpisodeStore();

// ── 清理旧 workspace ──────────────────────────────────────────────────────
try {
  await rm(workspace.root, { recursive: true, force: true });
} catch { /* ok */ }

// ── 测试 1：空 workspace 时 MemoryIndex.load() 返回 null ─────────────────
console.log("[eval] 测试 1：空 workspace 时 MemoryIndex.load() 返回 null...");
const emptyIndex = await memoryIndex.load(workspace);
assert(emptyIndex === null, "空 workspace 时 load() 应返回 null");
console.log("[eval] 测试 1 PASS");

// ── 测试 2：MemoryIndex.rebuild() 生成正确格式的 MEMORY.md ────────────────
// 先通过 MemoryLearner.apply() 批量写入 memory.json，确保两个存储一致
console.log("[eval] 测试 2：rebuild() 生成 MEMORY.md...");

// 用 apply() 写入 6 条初始 memory（覆盖 preference/feedback/project/reference/procedure/fact），同步到 memory.json
await memoryLearner.apply({
  workspace,
  actions: [
    { op: "upsert", type: "preference", key: "preferred_report_format", value: "更喜欢表格化的数据呈现方式，不喜欢长段文字", confidence: 0.9, source: "evolution" },
    { op: "upsert", type: "feedback", key: "negative_feedback_verbose_answer", value: "用户反馈回答太啰嗦，需要更简洁", confidence: 0.85, source: "evolution" },
    { op: "upsert", type: "project", key: "current_project", value: "华南区 Q2 线索提升项目，目标：线索转化率提升 15%", confidence: 0.8, source: "evolution" },
    { op: "upsert", type: "reference", key: "crm_system", value: "内部 CRM 系统地址：https://crm.internal.example.com", confidence: 0.95, source: "evolution" },
    { op: "upsert", type: "procedure", key: "daily_report_procedure", value: "每日 9:00 先看昨日经营日报，关注线索数和毛利率", confidence: 0.75, source: "evolution" },
    { op: "upsert", type: "fact", key: "south_china_q1_performance", value: "华南区 Q1 完成率 87%，高于全国均值 82%", confidence: 0.9, source: "evolution" }
  ]
});
// 等待异步 rebuild 完成
await sleep(300);

// 直接用 sampleItems 验证 rebuild() 的 Markdown 格式（独立测试，不依赖 memory.json）
const sampleItems = [
  { key: "preferred_report_format", type: "preference", value: "更喜欢表格化的数据呈现方式，不喜欢长段文字", confidence: 0.9, source: "evolution" },
  { key: "negative_feedback_verbose_answer", type: "feedback", value: "用户反馈回答太啰嗦，需要更简洁", confidence: 0.85, source: "evolution" },
  { key: "current_project", type: "project", value: "华南区 Q2 线索提升项目，目标：线索转化率提升 15%", confidence: 0.8, source: "evolution" },
  { key: "crm_system", type: "reference", value: "内部 CRM 系统地址：https://crm.internal.example.com", confidence: 0.95, source: "evolution" },
  { key: "daily_report_procedure", type: "procedure", value: "每日 9:00 先看昨日经营日报，关注线索数和毛利率", confidence: 0.75, source: "evolution" },
  { key: "south_china_q1_performance", type: "fact", value: "华南区 Q1 完成率 87%，高于全国均值 82%", confidence: 0.9, source: "evolution" }
];

const summary = await memoryIndex.rebuild(workspace, sampleItems);
assert(summary !== null, "rebuild() 应返回非 null summary");
assert(summary!.item_count === 6, `item_count 应为 6，实际 ${summary!.item_count}`);
assert(summary!.user_id === TEST_USER, `user_id 应为 ${TEST_USER}，实际 ${summary!.user_id}`);
assert(summary!.categories.user === 1, `user category 应为 1，实际 ${summary!.categories.user}`);
assert(summary!.categories.feedback === 1, `feedback category 应为 1，实际 ${summary!.categories.feedback}`);
assert(summary!.categories.project === 1, `project category 应为 1，实际 ${summary!.categories.project}`);
assert(summary!.categories.reference === 1, `reference category 应为 1，实际 ${summary!.categories.reference}`);
assert(summary!.categories.procedure === 1, `procedure category 应为 1，实际 ${summary!.categories.procedure}`);
assert(summary!.categories.fact === 1, `fact category 应为 1，实际 ${summary!.categories.fact}`);

const indexFile = memoryIndex.filePath(workspace);
assert(existsSync(indexFile), "MEMORY.md 文件应已生成");
console.log(`[eval] 测试 2 PASS — MEMORY.md 已生成于 ${indexFile}`);

// ── 测试 3：MemoryIndex.load() 能正确解析 frontmatter ──────────────────
console.log("[eval] 测试 3：load() 解析 MEMORY.md...");
const loaded = await memoryIndex.load(workspace);
assert(loaded !== null, "load() 应返回非 null");
assert(loaded!.item_count === 6, `load 后 item_count 应为 6，实际 ${loaded!.item_count}`);
assert(loaded!.categories.user === 1, `load 后 user 应为 1，实际 ${loaded!.categories.user}`);
assert(typeof loaded!.updated_at === "string" && loaded!.updated_at.length > 0, "updated_at 应为非空字符串");
console.log("[eval] 测试 3 PASS");

// ── 测试 4：MemoryIndex.scanCategories() 返回分类文本 ───────────────────
console.log("[eval] 测试 4：scanCategories() 按分类返回文本...");
const blocks = await memoryIndex.scanCategories(workspace);
assert(blocks.size > 0, "scanCategories 应返回非空 Map");
const userBlock = blocks.get("user");
assert(Array.isArray(userBlock) && userBlock.length > 0, "user 分类应有文本行");
assert(userBlock![0].includes("preferred_report_format"), `user 分类应包含 key preferred_report_format，实际：${userBlock![0]}`);
const feedbackBlock = blocks.get("feedback");
assert(Array.isArray(feedbackBlock) && feedbackBlock.length > 0, "feedback 分类应有文本行");
console.log("[eval] 测试 4 PASS");

// ── 测试 5：MemoryLearner.apply() 后自动重建索引 ────────────────────────
console.log("[eval] 测试 5：MemoryLearner.apply() 后自动更新 MEMORY.md...");
await memoryLearner.apply({
  workspace,
  actions: [
    { op: "upsert", type: "preference", key: "preferred_language", value: "更喜欢中文回答", confidence: 0.88, source: "test" }
  ]
});
// 等待异步索引重建
await sleep(300);

const updatedIndex = await memoryIndex.load(workspace);
assert(updatedIndex !== null, "apply 后 load() 应返回非 null");
assert(updatedIndex!.item_count === 7, `apply 后 item_count 应为 7（原 6 + 新增 1），实际 ${updatedIndex!.item_count}`);
assert(updatedIndex!.categories.user === 2, `apply 后 user category 应为 2，实际 ${updatedIndex!.categories.user}`);
console.log("[eval] 测试 5 PASS");

// ── 测试 6：MemoryRetriever.retrieve() 正常召回 ──────────────────────────
console.log("[eval] 测试 6：MemoryRetriever.retrieve() 召回相关记忆...");
const retrieved = await memoryRetriever.retrieve(workspace, "华南区线索转化情况", { limit: 10 });
assert(Array.isArray(retrieved), "retrieve 应返回数组");
// 应该能找到 project 和 fact 相关的条目
const hasProjectItem = retrieved.some((item) => item.id === "current_project" || String(item.text).includes("华南区"));
assert(hasProjectItem, `retrieve 结果应包含华南区相关记忆，实际: ${JSON.stringify(retrieved.map((item) => item.id))}`);
// 验证 relevance 排序
for (let index = 1; index < retrieved.length; index += 1) {
  assert(retrieved[index - 1].relevance >= retrieved[index].relevance, `结果应按 relevance 降序排列：[${index - 1}]=${retrieved[index - 1].relevance} >= [${index}]=${retrieved[index].relevance}`);
}
console.log(`[eval] 测试 6 PASS — 召回 ${retrieved.length} 条，top: ${retrieved[0]?.id}`);

// ── 测试 7：空查询短路 ───────────────────────────────────────────────────
console.log("[eval] 测试 7：空查询应快速返回空数组...");
const emptyResult = await memoryRetriever.retrieve(workspace, "", { limit: 10 });
assert(emptyResult.length === 0, "空查询应返回空数组");
console.log("[eval] 测试 7 PASS");

// ── 测试 8：EpisodeStore.append() + recent() ─────────────────────────────
console.log("[eval] 测试 8：EpisodeStore 写入和读取...");

const fakeTurnInput: EvolutionTurnInput = {
  trigger: "agent_finish",
  user: { id: TEST_USER, name: "测试用户", role: "sales", department: "华南区", default_store: "store_001", permissions: [] },
  workspace,
  sessionId: "eval_session_001",
  message: "华南区本月线索完成情况如何？",
  answer: "华南区本月线索转化率 23%，高于上月 20%。"
};

const fakeResult: EvolutionResult = {
  status: "applied",
  trigger: "agent_finish",
  reason: "有业务上下文值得记录",
  applied: { memory: 1, tasks: 0, skills: 0 }
};

await episodeStore.append(fakeTurnInput, fakeResult);
await episodeStore.append(fakeTurnInput, { ...fakeResult, reason: "第二次 episode" });

const episodes = await episodeStore.recent(workspace, 10);
assert(episodes.length >= 2, `应能读取至少 2 条 episode，实际 ${episodes.length}`);
assert(typeof episodes[0].user_message === "string", "episode 应包含 user_message");
assert(String(episodes[0].user_message).includes("线索"), "episode user_message 应包含线索相关内容");
console.log(`[eval] 测试 8 PASS — 写入并读取 ${episodes.length} 条 episode`);

// ── 清理 ──────────────────────────────────────────────────────────────────
try {
  await rm(workspace.root, { recursive: true, force: true });
} catch { /* ok */ }

console.log("\n✓ PASS memory-index eval");
console.log(`  MEMORY.md 索引：${summary!.item_count} 条，${Object.entries(summary!.categories).filter(([, v]) => v > 0).map(([k, v]) => `${k}:${v}`).join(", ")}`);
console.log(`  MemoryRetriever top-k 召回：${retrieved.length} 条`);
console.log(`  EpisodeStore：${episodes.length} 条 episode`);

// ── 工具函数 ─────────────────────────────────────────────────────────────

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[FAIL] ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
