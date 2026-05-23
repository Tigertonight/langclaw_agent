import { mkdir, rm, readFile } from "node:fs/promises";
import path from "node:path";
import { resolveProjectPath } from "../data/load-json.js";
import { resolveUserWorkspace } from "../runtime/workspace-context.js";
import { parseCronExpression, nextOccurrence, matchesCron } from "../cron/cron-expression.js";
import { UserCronStore, PAUSE_THRESHOLD } from "../cron/user-cron-store.js";
import { AgentCronJobRunner } from "../cron/agent-job-runner.js";
import { createCronTools } from "../tools/cron-tools.js";
import type { AgenticHandler } from "../handlers/agentic-handler.js";
import type { JsonObject, UserContext } from "../types/agent-contracts.js";

/**
 * §4 cron smoke：
 *   §1 表达式解析   —— 5 字段、范围、列表、步长、错误用例
 *   §2 nextOccurrence —— 每天 8 点 / 每 5 分钟 / 每月 1 号
 *   §3 store CRUD  —— create/get/list；user_id 越权拦截；update 校验 cron 格式
 *   §4 runner 触发 —— mock handler，到点 spawn 子 agent，写 history + state + task
 *   §5 连续失败暂停 —— 失败 3 次后 paused=true；resume 清零
 *   §6 并发控制  —— running=true 期间下一轮 tick 跳过
 *   §7 工具集成  —— 通过 cron.create / list / history 跑一遍
 *
 * 全部本地，不联网。LLM 决策全 mock。
 */

const TEST_USER_ID = "cron_smoke_user";
const ORIGINAL_API_KEY = process.env.LLM_API_KEY;

async function main(): Promise<void> {
  process.env.LLM_API_KEY = process.env.LLM_API_KEY ?? "smoke-fake-key";
  const ws = resolveUserWorkspace(TEST_USER_ID);
  // 清干净测试目录
  await rm(path.join(ws.root, ".cron"), { recursive: true, force: true });
  await rm(path.join(ws.root, "tasks"), { recursive: true, force: true });
  await mkdir(ws.root, { recursive: true });
  try {
    await section1ParseExpression();
    await section2NextOccurrence();
    await section3StoreCrud();
    await section4RunnerTrigger();
    await section5PauseAfterFailures();
    await section6ConcurrentSkip();
    await section7ToolIntegration();
    await section8DisableEnableRunNow();
    console.log("cron:smoke OK");
  } finally {
    if (ORIGINAL_API_KEY === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = ORIGINAL_API_KEY;
    await rm(path.join(ws.root, ".cron"), { recursive: true, force: true });
    await rm(path.join(ws.root, "tasks"), { recursive: true, force: true });
  }
}

/** §1 解析：合法/非法 / 范围/列表/步长 */
async function section1ParseExpression(): Promise<void> {
  // 每天 8 点
  const e1 = parseCronExpression("0 8 * * *");
  expect(e1.minute.values.has(0) && e1.minute.values.size === 1, "minute should be {0}");
  expect(e1.hour.values.has(8) && e1.hour.values.size === 1, "hour should be {8}");
  expect(e1.day.values.size === 31, `day should be 1..31, got ${e1.day.values.size}`);

  // 每 5 分钟
  const e2 = parseCronExpression("*/5 * * * *");
  expect(e2.minute.values.size === 12, `*/5 minute should yield 12 values, got ${e2.minute.values.size}`);
  expect(e2.minute.values.has(0) && e2.minute.values.has(55) && !e2.minute.values.has(7), "*/5 minute boundaries");

  // 列表 + 范围
  const e3 = parseCronExpression("0,30 8-18/2 1,15 * 1-5");
  expect(e3.minute.values.size === 2 && e3.minute.values.has(30), "minute list 0,30");
  expect(e3.hour.values.has(8) && e3.hour.values.has(10) && e3.hour.values.has(18) && !e3.hour.values.has(9), "hour 8-18/2");
  expect(e3.weekday.values.size === 5 && !e3.weekday.values.has(0), "weekday 1-5");

  // 错误：字段数不对
  let threw = false;
  try { parseCronExpression("0 8 * *"); } catch { threw = true; }
  expect(threw, "4-field cron should throw");

  // 错误：超出范围
  threw = false;
  try { parseCronExpression("0 25 * * *"); } catch { threw = true; }
  expect(threw, "hour=25 should throw");

  // 错误：负 step
  threw = false;
  try { parseCronExpression("*/0 * * * *"); } catch { threw = true; }
  expect(threw, "step=0 should throw");

  console.log(`§1 parse: 合法 / 范围 / 列表 / 步长 / 错误用例 全部覆盖`);
}

/** §2 nextOccurrence：每天 8 点 / 每 5 分钟 / 每月 1 号 */
async function section2NextOccurrence(): Promise<void> {
  // 2026-05-23 10:30 → 下一次"每天 8 点" 是 2026-05-24 08:00
  const expr = parseCronExpression("0 8 * * *");
  const from = new Date(2026, 4, 23, 10, 30, 0);
  const next = nextOccurrence(expr, from);
  expect(next !== null, "should find next");
  expect(next!.getDate() === 24 && next!.getHours() === 8 && next!.getMinutes() === 0, `expected 5/24 08:00, got ${next!.toString()}`);

  // 2026-05-23 10:30 → 下一次"每 5 分钟" 是 10:35
  const expr2 = parseCronExpression("*/5 * * * *");
  const next2 = nextOccurrence(expr2, from);
  expect(next2!.getHours() === 10 && next2!.getMinutes() === 35, `expected 10:35, got ${next2!.toString()}`);

  // matchesCron：直接给一个匹配点
  expect(matchesCron(expr, new Date(2026, 4, 24, 8, 0, 0)), "8AM should match");
  expect(!matchesCron(expr, new Date(2026, 4, 24, 8, 1, 0)), "8:01 should not match");

  console.log(`§2 nextOccurrence: 每天 8 点 / 每 5 分钟 / matchesCron 全部正确`);
}

/** §3 store CRUD + 越权 */
async function section3StoreCrud(): Promise<void> {
  const store = new UserCronStore();
  const ws = resolveUserWorkspace(TEST_USER_ID);

  const spec = await store.create(ws, {
    user_id: TEST_USER_ID,
    cron_expr: "0 8 * * *",
    task: "每天 8 点跑库存盘点"
  });
  expect(spec.id.startsWith("cron_"), `bad id: ${spec.id}`);
  expect(spec.missed_window === "skip", `default missed_window should be skip, got ${spec.missed_window}`);

  // list 读得到
  const list = await store.list(ws);
  expect(list.length === 1, `expected 1 spec, got ${list.length}`);

  // 越权删（不同 user_id）→ forbidden
  const denyResult = await store.delete(ws, spec.id, "other_user");
  expect(denyResult.ok === false && denyResult.reason === "forbidden", `delete forbidden: ${JSON.stringify(denyResult)}`);

  // 越权 update → forbidden
  const updateDeny = await store.update(ws, spec.id, "other_user", { task: "改" });
  expect(updateDeny.ok === false && updateDeny.reason === "forbidden", "update should forbid other user");

  // 合法 update：cron_expr 非法应抛
  let threw = false;
  try { await store.update(ws, spec.id, TEST_USER_ID, { cron_expr: "bad" }); } catch { threw = true; }
  expect(threw, "update with bad cron_expr should throw");

  // 合法 update
  const ok = await store.update(ws, spec.id, TEST_USER_ID, { task: "改成更具体的库存盘点" });
  expect(ok.ok === true, "valid update should succeed");

  // 删除
  const del = await store.delete(ws, spec.id, TEST_USER_ID);
  expect(del.ok === true, "owner delete should succeed");
  const after = await store.list(ws);
  expect(after.length === 0, "list should be empty after delete");

  console.log(`§3 store CRUD: create/list/update/delete + 越权拦截 全部 OK`);
}

/** §4 runner 触发：mock handler decideNext → answer，验证 history + state + task 落地 */
async function section4RunnerTrigger(): Promise<void> {
  const store = new UserCronStore();
  const ws = resolveUserWorkspace(TEST_USER_ID);
  const spec = await store.create(ws, {
    user_id: TEST_USER_ID,
    cron_expr: "* * * * *", // 每分钟，方便触发
    task: "本测试任务"
  });

  // 把 last_seen_window 拨到 2 分钟前，确保 computeDue 命中
  await store.mergeState(ws, spec.id, { last_seen_window: new Date(Date.now() - 2 * 60_000).toISOString() });

  const decisions: Array<Record<string, unknown>> = [
    { action: "answer", answer: "已检查，无库存超期。", reason: "结果干净" }
  ];
  const handler = makeFakeHandler({ decisions, availableTools: [] });
  const runner = new AgentCronJobRunner({ handler, cronStore: store });

  const results = await runner.runDue(ws);
  expect(results.length === 1, `should evaluate 1 spec, got ${results.length}`);
  expect(results[0].ran === true, `spec should run, reason=${results[0].reason}`);
  expect(results[0].entry?.status === "ok", `entry status: ${results[0].entry?.status}`);
  expect(results[0].entry?.summary.includes("无库存超期"), `summary: ${results[0].entry?.summary}`);

  // state 已更新
  const updated = await store.get(ws, spec.id);
  expect(updated?.state?.last_status === "ok", `state.last_status: ${updated?.state?.last_status}`);
  expect((updated?.state?.consecutive_failures ?? 0) === 0, "failures should be 0 after ok");
  expect(updated?.state?.running === false, "running should clear");

  // history 写入
  const history = await store.readHistory(ws, spec.id, 10);
  expect(history.length === 1, `history len: ${history.length}`);
  expect(history[0].status === "ok", "history status");

  // task 写入
  const tasksFile = path.join(ws.root, "tasks", "active.json");
  const tasksRaw = await readFile(tasksFile, "utf8").catch(() => "");
  expect(tasksRaw.length > 0, "tasks/active.json should exist after cron task upsert");

  console.log(`§4 runner: trigger → answer → history + state + task 全部落地`);
  // cleanup
  await store.delete(ws, spec.id, TEST_USER_ID);
}

/** §5 连续失败 → 自动 paused */
async function section5PauseAfterFailures(): Promise<void> {
  const store = new UserCronStore();
  const ws = resolveUserWorkspace(TEST_USER_ID);
  const spec = await store.create(ws, {
    user_id: TEST_USER_ID,
    cron_expr: "* * * * *",
    task: "故意失败",
    max_steps: 2 // 让 max_iterations 快速触发
  });

  // 反复触发：每次都把 last_run_at 重置，让下一轮再触发
  // 决策永远 tool_call，工具永远抛错——runAgent 会跑到 max_iterations，status=max_iterations → 算失败
  const handler = makeFakeHandler({
    decisions: [],  // 不用 decisions 数组，用 alwaysToolCall 模式
    availableTools: [{ name: "intent.fake", kind: "intent", description: "fake", params_schema: {} }],
    callTool: async () => { throw new Error("tool always fails"); },
    alwaysToolCall: { tool_name: "intent.fake", args: {} }
  });
  const runner = new AgentCronJobRunner({ handler, cronStore: store });

  for (let i = 0; i < PAUSE_THRESHOLD + 1; i += 1) {
    // 每轮跑前回到 2 分钟前，让 computeDue 再次命中
    await store.mergeState(ws, spec.id, {
      last_seen_window: new Date(Date.now() - 2 * 60_000).toISOString(),
      last_run_at: undefined,
      paused: false
    });
    const reloaded = await store.get(ws, spec.id);
    if (reloaded?.state?.paused) break;
    await runner.runDue(ws);
  }

  const final = await store.get(ws, spec.id);
  expect(final?.state?.paused === true, `should be paused, state=${JSON.stringify(final?.state)}`);
  expect((final?.state?.consecutive_failures ?? 0) >= PAUSE_THRESHOLD, `failures: ${final?.state?.consecutive_failures}`);

  // resume
  const resume = await store.resume(ws, spec.id, TEST_USER_ID);
  expect(resume.ok === true, "resume should succeed");
  const after = await store.get(ws, spec.id);
  expect(after?.state?.paused === false, "paused should be cleared");
  expect(after?.state?.consecutive_failures === 0, "failures should be 0");

  console.log(`§5 pause: 连续失败 ${PAUSE_THRESHOLD} 次自动暂停 + resume 清零`);
  await store.delete(ws, spec.id, TEST_USER_ID);
}

/** §6 并发控制：running=true 时跳过 */
async function section6ConcurrentSkip(): Promise<void> {
  const store = new UserCronStore();
  const ws = resolveUserWorkspace(TEST_USER_ID);
  const spec = await store.create(ws, {
    user_id: TEST_USER_ID,
    cron_expr: "* * * * *",
    task: "测并发"
  });
  // 拨到过去 + 强制 running
  await store.mergeState(ws, spec.id, {
    last_seen_window: new Date(Date.now() - 2 * 60_000).toISOString(),
    running: true
  });

  const handler = makeFakeHandler({ decisions: [], availableTools: [] });
  const runner = new AgentCronJobRunner({ handler, cronStore: store });
  const results = await runner.runDue(ws);
  expect(results.length === 1, "evaluated 1 spec");
  expect(results[0].ran === false, `should skip while running, got ran=${results[0].ran}`);
  expect(results[0].reason === "running", `reason should be 'running', got ${results[0].reason}`);

  console.log(`§6 concurrent: running=true 跳过下一轮触发`);
  await store.delete(ws, spec.id, TEST_USER_ID);
}

/** §7 cron.* 工具串联跑：create → list → history */
async function section7ToolIntegration(): Promise<void> {
  const store = new UserCronStore();
  const ws = resolveUserWorkspace(TEST_USER_ID);
  const tools = createCronTools({ cronStore: store });
  const create = tools.find((t) => t.name === "cron.create");
  const list = tools.find((t) => t.name === "cron.list");
  const del = tools.find((t) => t.name === "cron.delete");
  expect(!!create && !!list && !!del, "cron.create/list/delete should all exist");

  const ctx = { user: { id: TEST_USER_ID, name: TEST_USER_ID, role: "user", department: "" } as UserContext, workspace: ws };

  const created = (await create!.execute({ cron_expr: "0 9 * * *", task: "每天 9 点跑测试" }, ctx)) as {
    ok: boolean;
    data?: { spec_id: string };
  };
  expect(created.ok === true, `create should ok, got ${JSON.stringify(created)}`);
  const sid = created.data!.spec_id;

  const listed = (await list!.execute({}, ctx)) as { ok: boolean; data?: { count: number; specs: Array<{ id: string }> } };
  expect(listed.ok === true && listed.data!.count === 1, `list count: ${listed.data?.count}`);
  expect(listed.data!.specs[0].id === sid, "spec id should match");

  // 越权 list（其他 user）应只看到 0 条
  const otherCtx = { user: { id: "other_user", name: "x", role: "user", department: "" } as UserContext, workspace: ws };
  const otherListed = (await list!.execute({}, otherCtx)) as { ok: boolean; data?: { count: number } };
  expect(otherListed.data?.count === 0, `other user should see 0, got ${otherListed.data?.count}`);

  // 越权 delete
  const denyDel = (await del!.execute({ spec_id: sid }, otherCtx)) as { ok: boolean; error?: string };
  expect(denyDel.ok === false && denyDel.error === "forbidden", `delete forbidden: ${JSON.stringify(denyDel)}`);

  // 自己 delete OK
  const okDel = (await del!.execute({ spec_id: sid }, ctx)) as { ok: boolean };
  expect(okDel.ok === true, "owner delete");

  console.log(`§7 tools: create/list/delete + 越权隔离 全 OK`);
}

/** §8 cron.disable / cron.enable / cron.run_now */
async function section8DisableEnableRunNow(): Promise<void> {
  const store = new UserCronStore();
  const ws = resolveUserWorkspace(TEST_USER_ID);
  // run_now 用一个永远 answer 的 fake handler，确保跑通
  const handler = makeFakeHandler({
    decisions: [{ action: "answer", answer: "手动触发完成", reason: "ok" }],
    availableTools: []
  });
  const runner = new AgentCronJobRunner({ handler, cronStore: store });
  const tools = createCronTools({ cronStore: store, runner });
  const disable = tools.find((t) => t.name === "cron.disable");
  const enable = tools.find((t) => t.name === "cron.enable");
  const runNow = tools.find((t) => t.name === "cron.run_now");
  expect(!!disable && !!enable && !!runNow, "disable/enable/run_now should all exist");

  const ctx = { user: { id: TEST_USER_ID, name: TEST_USER_ID, role: "user", department: "" } as UserContext, workspace: ws };
  const otherCtx = { user: { id: "other_user", name: "x", role: "user", department: "" } as UserContext, workspace: ws };

  const spec = await store.create(ws, {
    user_id: TEST_USER_ID,
    cron_expr: "0 10 * * *",
    task: "测 disable/enable/run_now"
  });

  // disable
  const dis = (await disable!.execute({ spec_id: spec.id }, ctx)) as { ok: boolean; data?: { enabled: boolean } };
  expect(dis.ok === true && dis.data?.enabled === false, `disable should ok, got ${JSON.stringify(dis)}`);
  const after1 = await store.get(ws, spec.id);
  expect(after1?.enabled === false, "spec should be disabled");

  // 越权 disable
  const denyDis = (await disable!.execute({ spec_id: spec.id }, otherCtx)) as { ok: boolean; error?: string };
  expect(denyDis.ok === false && denyDis.error === "forbidden", "other user disable forbidden");

  // enable
  const en = (await enable!.execute({ spec_id: spec.id }, ctx)) as { ok: boolean; data?: { enabled: boolean } };
  expect(en.ok === true && en.data?.enabled === true, `enable should ok, got ${JSON.stringify(en)}`);
  const after2 = await store.get(ws, spec.id);
  expect(after2?.enabled === true, "spec should be enabled again");

  // 记录 run_now 之前的 last_seen_window
  const prevWindow = after2?.state?.last_seen_window;

  // run_now
  const ran = (await runNow!.execute({ spec_id: spec.id }, ctx)) as {
    ok: boolean;
    data?: { status: string; summary: string };
  };
  expect(ran.ok === true, `run_now should ok, got ${JSON.stringify(ran)}`);
  expect(ran.data?.status === "ok", `status: ${ran.data?.status}`);
  expect(ran.data?.summary.includes("手动触发完成"), `summary: ${ran.data?.summary}`);

  // last_seen_window 未被推进（手动触发不影响调度窗口）
  const after3 = await store.get(ws, spec.id);
  expect(after3?.state?.last_seen_window === prevWindow, `window should be restored, prev=${prevWindow}, now=${after3?.state?.last_seen_window}`);

  // 越权 run_now
  const denyRun = (await runNow!.execute({ spec_id: spec.id }, otherCtx)) as { ok: boolean; error?: string };
  expect(denyRun.ok === false && denyRun.error === "forbidden", "other user run_now forbidden");

  // run_now on missing spec
  const miss = (await runNow!.execute({ spec_id: "cron_does_not_exist" }, ctx)) as { ok: boolean; error?: string };
  expect(miss.ok === false && miss.error === "not_found", "missing spec should be not_found");

  // 不传 runner 时 cron.run_now 不应注册
  const toolsNoRunner = createCronTools({ cronStore: store });
  expect(toolsNoRunner.find((t) => t.name === "cron.run_now") === undefined, "without runner, cron.run_now should not be registered");

  console.log(`§8 disable/enable/run_now: 全部 OK，window 不被手动触发推进`);
  await store.delete(ws, spec.id, TEST_USER_ID);
}

interface FakeHandlerInput {
  availableTools: Array<{ name: string; kind: string; description: string; params_schema: Record<string, { type?: string; description?: string }> }>;
  decisions: Array<Record<string, unknown>>;
  callTool?: (name: string, args: JsonObject) => Promise<unknown>;
  /** 如果设置，decisions 用完后永远返回这个 tool_call（用于 §5 失败循环测试） */
  alwaysToolCall?: { tool_name: string; args: JsonObject };
}

function makeFakeHandler(input: FakeHandlerInput): AgenticHandler {
  let cursor = 0;
  const fake = {
    getAvailableTools: () => input.availableTools,
    decideNext: async () => {
      if (cursor >= input.decisions.length) {
        if (input.alwaysToolCall) return { action: "tool_call", ...input.alwaysToolCall };
        return { action: "answer", answer: "(decisions exhausted)" };
      }
      const d = input.decisions[cursor];
      cursor += 1;
      return d;
    },
    callTool: async ({ callName, args }: { callName?: string; args?: JsonObject }) => {
      if (input.callTool) return input.callTool(callName ?? "", args ?? {});
      return { ok: true };
    }
  };
  return fake as unknown as AgenticHandler;
}

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(`assertion failed: ${message}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
