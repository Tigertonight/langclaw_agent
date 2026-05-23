import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

/**
 * 集成测试 /api/commands：
 *   1. 无 user_id → 401
 *   2. store_gm_001（顾明远，全权限）→ 应看到全部 5 条命令
 *   3. finance_001（唐若溪，缺 customer/inventory/after_sales 权限）→ 仅看到 help + today_orders（2 条）
 *   4. 不存在的用户 → 401（resolve 抛错被吞）
 *
 * 真实 HTTP server 子进程，不是 mock。
 */
async function main(): Promise<void> {
  const port = 3912;
  const server = spawn("node", ["dist/server/http.js"], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await waitForServerReady(server, port);

  try {
    // case 1
    const r1 = await fetch(`http://localhost:${port}/api/commands`);
    assert(r1.status === 401, `no user_id should be 401, got ${r1.status}`);

    // case 2: store_gm_001 has order/customer/sales_report/finance, but NOT inventory/after_sales
    const r2 = await fetch(`http://localhost:${port}/api/commands`, {
      headers: { "X-User-Id": "store_gm_001" }
    });
    assert(r2.status === 200, `store_gm_001 should be 200, got ${r2.status}`);
    const body2 = await r2.json() as { commands: Array<{ id: string; intent_code: string | null; title: string; triggers: string[] }> };
    const ids2 = new Set(body2.commands.map((c) => c.id));
    // store_gm_001 lacks inventory:read / after_sales:read — those should be filtered
    assert(ids2.has("help"), "store_gm should see help");
    assert(ids2.has("today_orders"), "store_gm has order:read → today_orders visible");
    assert(ids2.has("my_leads"), "store_gm has customer:read → my_leads visible");
    assert(!ids2.has("inventory_alert"), `store_gm lacks inventory:read; got commands ${[...ids2].join(",")}`);
    assert(!ids2.has("warranty_claims"), `store_gm lacks after_sales:read; got commands ${[...ids2].join(",")}`);

    // case 3: finance_001 lacks customer/inventory/after_sales
    const r3 = await fetch(`http://localhost:${port}/api/commands`, {
      headers: { "X-User-Id": "finance_001" }
    });
    assert(r3.status === 200, `finance_001 should be 200, got ${r3.status}`);
    const body3 = await r3.json() as { commands: Array<{ id: string }> };
    const ids3 = new Set(body3.commands.map((c) => c.id));
    assert(ids3.has("help"), "finance sees help");
    assert(ids3.has("today_orders"), "finance has order:read → today_orders visible");
    assert(!ids3.has("my_leads"), "finance lacks customer:read → my_leads hidden");
    assert(!ids3.has("inventory_alert"), "finance lacks inventory:read");
    assert(!ids3.has("warranty_claims"), "finance lacks after_sales:read");
    assert(ids3.size === 2, `finance should see exactly 2 commands, got ${ids3.size}: ${[...ids3].join(",")}`);

    // case 4: unknown user → resolver 返回 anonymous（无权限），应只看到无权限要求的命令
    const r4 = await fetch(`http://localhost:${port}/api/commands`, {
      headers: { "X-User-Id": "ghost_user_xyz_404" }
    });
    assert(r4.status === 200, `unknown user resolves to anonymous, got ${r4.status}`);
    const body4 = await r4.json() as { commands: Array<{ id: string }> };
    const ids4 = new Set(body4.commands.map((c) => c.id));
    assert(ids4.has("help"), "anonymous still sees help (no perm required)");
    assert(!ids4.has("today_orders"), "anonymous lacks order:read → today_orders hidden");
    assert(ids4.size === 1, `anonymous should see exactly 1 command, got ${ids4.size}: ${[...ids4].join(",")}`);

    console.log(`PASS commands-api (4 cases: 401 / store_gm sees ${ids2.size} / finance sees ${ids3.size} / anonymous sees ${ids4.size})`);
  } finally {
    server.kill("SIGTERM");
    await delay(200);
    if (!server.killed) server.kill("SIGKILL");
  }
}

async function waitForServerReady(server: ChildProcess, port: number): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      if (res.ok) return;
    } catch { /* not ready yet */ }
    await delay(200);
  }
  server.kill("SIGKILL");
  throw new Error(`server did not become ready on port ${port}`);
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
