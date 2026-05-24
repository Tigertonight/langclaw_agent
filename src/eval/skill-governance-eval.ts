/**
 * Phase 6 eval: skill-governance-eval
 *
 * 测试场景：
 *   1. evolution.diff —— 不存在 override 时返回 has_diff=false
 *   2. evolution.disable —— 禁用一个 memory key
 *   3. evolution.disable 后 evolution.inspect 中该 key 出现在 disabled 列表
 *   4. evolution.restore 后 disabled 列表不再包含该 key
 *   5. memory.inspect —— 精确 key 查找
 *   6. memory.inspect —— fuzzy 模糊搜索
 *   7. memory.inspect 不存在 key 返回 not_found
 *   8. memory.remove —— 成功移除 memory 条目
 *   9. memory.remove 不存在 key 返回 not_found
 *  10. evolution.disable + memory.inspect 验证 governance 层不影响实际移除
 *
 * 全部本地，不联网。
 */

import { rm } from "node:fs/promises";
import { resolveUserWorkspace } from "../runtime/workspace-context.js";
import { resolveProjectPath } from "../data/load-json.js";
import { MemoryLearner } from "../evolution/memory-learner.js";
import { createEvolutionTools } from "../evolution/tools.js";
import { createMemoryTools } from "../memory/tools.js";
import type { EvolutionRuntime } from "../evolution/runtime.js";

const TEST_USER = `eval_skill_gov_${Date.now()}`;
const workspace = resolveUserWorkspace(TEST_USER);
const ctx = { user: { id: TEST_USER, name: TEST_USER, role: "eval", department: "" }, workspace };

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string): void {
  if (cond) {
    console.log(`  PASS [${passed + failed + 1}] ${label}`);
    passed++;
  } else {
    console.error(`  FAIL [${passed + failed + 1}] ${label}`);
    failed++;
  }
}

function assertEqual<T>(a: T, b: T, label: string): void {
  if (a === b) {
    console.log(`  PASS [${passed + failed + 1}] ${label}`);
    passed++;
  } else {
    console.error(`  FAIL [${passed + failed + 1}] ${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
    failed++;
  }
}

async function main(): Promise<void> {
  const memoryLearner = new MemoryLearner();

  // 写入测试 memory 数据
  await memoryLearner.apply({
    workspace,
    actions: [
      { op: "upsert", type: "preference", key: "preferred_language", value: "中文", confidence: 0.9, source: "test" },
      { op: "upsert", type: "fact", key: "user_role", value: "销售经理", confidence: 0.8, source: "test" },
      { op: "upsert", type: "fact", key: "user_department", value: "售后部", confidence: 0.8, source: "test" },
      { op: "upsert", type: "preference", key: "report_format", value: "表格式日报", confidence: 0.7, source: "test" }
    ]
  });

  // mock EvolutionRuntime（这些测试不走 LLM，只需 governance 接口）
  const fakeRuntime = {} as EvolutionRuntime;
  const evolutionTools = createEvolutionTools({ evolutionRuntime: fakeRuntime });
  const memoryTools = createMemoryTools();

  /* ─── Test 1: evolution.diff 无 override 时 has_diff=false ─── */
  {
    const diffTool = evolutionTools.find((t) => t.name === "evolution.diff")!;
    assert(Boolean(diffTool), "evolution.diff 工具存在");
    const result = await diffTool.execute({ skill_id: "nonexistent_skill_xyz" }, ctx) as Record<string, unknown>;
    assert(result.ok === true, "evolution.diff ok=true（无 override 也返回 ok）");
    const data = result.data as Record<string, unknown>;
    assert(data.has_diff === false, "无 override 时 has_diff=false");
    assert(data.override === null, "无 override 时 override=null");
    assert(data.candidate === null, "无 override 时 candidate=null");
  }

  /* ─── Test 2: evolution.disable 禁用 memory key ─── */
  {
    const disableTool = evolutionTools.find((t) => t.name === "evolution.disable")!;
    assert(Boolean(disableTool), "evolution.disable 工具存在");
    const result = await disableTool.execute({
      target: "memory:user_role",
      reason: "测试禁用"
    }, ctx) as Record<string, unknown>;
    assert(result.ok === true, "evolution.disable ok=true");
    const data = result.data as Record<string, unknown>;
    assertEqual(data.target as string, "memory:user_role", "disable 返回正确的 target");
  }

  /* ─── Test 3: evolution.inspect 显示 disabled 列表包含该 key ─── */
  {
    const inspectTool = evolutionTools.find((t) => t.name === "evolution.inspect")!;
    const result = await inspectTool.execute({ limit: 10 }, ctx) as Record<string, unknown>;
    assert(result.ok === true, "evolution.inspect ok=true");
    const data = result.data as Record<string, unknown>;
    const disabled = data.disabled as Array<Record<string, unknown>>;
    assert(Array.isArray(disabled), "evolution.inspect 返回 disabled 数组");
    assert(
      disabled.some((d) => d.target === "memory:user_role"),
      "disabled 列表包含 memory:user_role"
    );
  }

  /* ─── Test 4: evolution.restore 后 disabled 列表不再包含该 key ─── */
  {
    const restoreTool = evolutionTools.find((t) => t.name === "evolution.restore")!;
    assert(Boolean(restoreTool), "evolution.restore 工具存在");
    const restoreResult = await restoreTool.execute({ target: "memory:user_role", reason: "测试恢复" }, ctx) as Record<string, unknown>;
    assert(restoreResult.ok === true, "evolution.restore ok=true");
    const restoreData = restoreResult.data as Record<string, unknown>;
    assert(restoreData.restored === true, "restore 返回 restored=true");

    // 再次 inspect 验证
    const inspectTool = evolutionTools.find((t) => t.name === "evolution.inspect")!;
    const result = await inspectTool.execute({ limit: 10 }, ctx) as Record<string, unknown>;
    const disabled = (result.data as Record<string, unknown>).disabled as Array<Record<string, unknown>>;
    assert(
      !disabled.some((d) => d.target === "memory:user_role"),
      "restore 后 disabled 列表不再包含 memory:user_role"
    );
  }

  /* ─── Test 5: memory.inspect 精确 key 查找 ─── */
  {
    const inspectTool = memoryTools.find((t) => t.name === "memory.inspect")!;
    assert(Boolean(inspectTool), "memory.inspect 工具存在");
    const result = await inspectTool.execute({ key: "preferred_language" }, ctx) as Record<string, unknown>;
    assert(result.ok === true, "memory.inspect 精确查找 ok=true");
    const data = result.data as Record<string, unknown>;
    const item = data.item as Record<string, unknown>;
    assertEqual(item.key as string, "preferred_language", "memory.inspect 返回正确 key");
    assertEqual(item.value as string, "中文", "memory.inspect 返回正确 value");
    assertEqual(item.type as string, "preference", "memory.inspect 返回正确 type");
  }

  /* ─── Test 6: memory.inspect fuzzy 模糊搜索 ─── */
  {
    const inspectTool = memoryTools.find((t) => t.name === "memory.inspect")!;
    const result = await inspectTool.execute({ key: "user", fuzzy: true }, ctx) as Record<string, unknown>;
    assert(result.ok === true, "memory.inspect fuzzy ok=true");
    const data = result.data as Record<string, unknown>;
    assertEqual(data.mode as string, "fuzzy", "memory.inspect fuzzy 模式");
    const items = data.items as Array<Record<string, unknown>>;
    assert(Array.isArray(items) && items.length >= 2, `fuzzy 搜索 'user' 至少匹配 2 条（实际 ${Array.isArray(items) ? items.length : "N/A"}）`);
    assert(items.every((i) => typeof i.key === "string"), "fuzzy 结果每条有 key 字段");
  }

  /* ─── Test 7: memory.inspect 不存在 key 返回 not_found ─── */
  {
    const inspectTool = memoryTools.find((t) => t.name === "memory.inspect")!;
    const result = await inspectTool.execute({ key: "nonexistent_memory_key_xyz_456" }, ctx) as Record<string, unknown>;
    assert(result.ok === false, "memory.inspect 不存在 key 时 ok=false");
    assertEqual(result.error as string, "not_found", "memory.inspect 不存在时 error=not_found");
  }

  /* ─── Test 8: memory.remove 成功移除 memory 条目 ─── */
  {
    const removeTool = memoryTools.find((t) => t.name === "memory.remove")!;
    assert(Boolean(removeTool), "memory.remove 工具存在");
    const result = await removeTool.execute({ key: "report_format", reason: "eval 测试移除" }, ctx) as Record<string, unknown>;
    assert(result.ok === true, "memory.remove ok=true");
    const data = result.data as Record<string, unknown>;
    assert(data.removed === true, "memory.remove 返回 removed=true");
    assertEqual(data.key as string, "report_format", "memory.remove 返回正确 key");

    // 验证 memory.inspect 已找不到该 key
    const inspectTool = memoryTools.find((t) => t.name === "memory.inspect")!;
    const verifyResult = await inspectTool.execute({ key: "report_format" }, ctx) as Record<string, unknown>;
    assert(verifyResult.ok === false, "移除后 memory.inspect 返回 not_found");
  }

  /* ─── Test 9: memory.remove 不存在 key 返回 not_found ─── */
  {
    const removeTool = memoryTools.find((t) => t.name === "memory.remove")!;
    const result = await removeTool.execute({ key: "nonexistent_key_xyz_789" }, ctx) as Record<string, unknown>;
    assert(result.ok === false, "memory.remove 不存在 key 时 ok=false");
    assertEqual(result.error as string, "not_found", "memory.remove 不存在时 error=not_found");
  }

  /* ─── Test 10: evolution.disable 确认工具存在且可链式使用 ─── */
  {
    const disableTool = evolutionTools.find((t) => t.name === "evolution.disable")!;
    // 禁用 skill:dealer-sales 防止污染
    const r1 = await disableTool.execute({ target: "skill:dealer-sales", reason: "eval test" }, ctx) as Record<string, unknown>;
    assert(r1.ok === true, "evolution.disable skill 目标 ok=true");

    // 用 evolution.inspect 确认禁用
    const inspectTool = evolutionTools.find((t) => t.name === "evolution.inspect")!;
    const r2 = await inspectTool.execute({}, ctx) as Record<string, unknown>;
    const disabled2 = (r2.data as Record<string, unknown>).disabled as Array<Record<string, unknown>>;
    assert(disabled2.some((d) => d.target === "skill:dealer-sales"), "inspect 确认 skill:dealer-sales 已禁用");

    // 验证 evolution.diff 对被禁用的 skill 也能正常工作
    const diffTool = evolutionTools.find((t) => t.name === "evolution.diff")!;
    const r3 = await diffTool.execute({ skill_id: "dealer-sales" }, ctx) as Record<string, unknown>;
    assert(r3.ok === true, "evolution.diff 对禁用 skill 也返回 ok=true");
  }

  console.log(`\nskill-governance-eval: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => rm(resolveProjectPath("users", TEST_USER), { recursive: true, force: true }));
