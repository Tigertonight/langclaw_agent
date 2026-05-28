/**
 * 验证 Langfuse 自部署的 6 个组件都活着。
 * 跑：cd services/observability && npx tsx scripts/smoke-langfuse-up.ts
 *
 * 不依赖 SDK，纯走 HTTP / TCP，方便客户运维人员跑。
 */

const HOST = process.env.LANGFUSE_HOST ?? "http://localhost:3001";

let failed = 0;
const expect = (label: string, ok: boolean, detail?: unknown): void => {
  if (ok) console.log(`  ✓ ${label}`);
  else {
    console.log(`  ✗ ${label}`, detail ?? "");
    failed += 1;
  }
};

async function check(label: string, fn: () => Promise<boolean>): Promise<void> {
  try {
    const ok = await fn();
    expect(label, ok);
  } catch (e) {
    expect(label, false, e instanceof Error ? e.message : e);
  }
}

console.log(`\nLangfuse self-host smoke (host=${HOST})\n`);

await check("Langfuse Web /api/public/health 返回 OK", async () => {
  const r = await fetch(`${HOST}/api/public/health`);
  if (!r.ok) return false;
  const body = (await r.json()) as { status?: string };
  return body.status === "OK";
});

await check("Langfuse Web 返回 HTML 首页", async () => {
  const r = await fetch(HOST);
  return r.ok && (await r.text()).includes("Langfuse");
});

if (failed > 0) {
  console.error(`\n${failed} smoke check(s) failed`);
  process.exit(1);
}
console.log("\nPASS langfuse-up smoke");
console.log("\n下一步：");
console.log("  1. 浏览器开 " + HOST + " 注册管理员 + 创建 project");
console.log("  2. 拿 PUBLIC_KEY/SECRET_KEY 配到根项目 .env");
console.log("  3. 跑 D 阶段的 smoke-trace-roundtrip.ts 验证端到端");
