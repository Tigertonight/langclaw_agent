import { writeFile, mkdir, rm } from "node:fs/promises";
import { resolveProjectPath } from "../data/load-json.js";
import { TokenAuthenticator } from "../security/auth.js";
import { sharedMetrics } from "../security/observability.js";
import { basicLiveness, checkReadiness } from "../server/health.js";

const failures: string[] = [];

await runAll();

if (failures.length > 0) {
  console.error(`FAIL ops endpoints: ${failures.length} failures`);
  for (const message of failures) console.error(` - ${message}`);
  process.exitCode = 1;
} else {
  console.log("PASS ops endpoints");
}

async function runAll(): Promise<void> {
  await testLiveness();
  await testReadinessOk();
  await testReadinessNoAuth();
  await testTokenFileLoadAndReload();
  await testTokenRevocation();
  await testAdminToken();
  await testPrometheusFormat();
}

function testLiveness(): void {
  const r = basicLiveness();
  if (r.ok !== true) failures.push("liveness: ok !== true");
  if (typeof r.uptime_s !== "number") failures.push("liveness: uptime_s missing");
  if (typeof r.pid !== "number") failures.push("liveness: pid missing");
}

async function testReadinessOk(): Promise<void> {
  const auth = new TokenAuthenticator({ OPENUI_AUTH_TOKENS: '{"tk_x":{"user_id":"u1"}}' });
  const r = await checkReadiness(auth);
  if (!r.ok) failures.push(`readiness ok: expected ok, got ${JSON.stringify(r)}`);
  if (!r.checks.config_readable.ok) failures.push("readiness: config_readable failed");
  if (!r.checks.users_writable.ok) failures.push("readiness: users_writable failed");
  if (!r.checks.auth_loaded.ok) failures.push("readiness: auth_loaded failed");
  auth.dispose();
}

async function testReadinessNoAuth(): Promise<void> {
  const auth = new TokenAuthenticator({}); // no tokens, not disabled
  const r = await checkReadiness(auth);
  if (r.ok) failures.push("readiness no auth: should fail");
  if (r.checks.auth_loaded.ok) failures.push("readiness no auth: auth_loaded should be false");
  auth.dispose();
}

async function testTokenFileLoadAndReload(): Promise<void> {
  const tmpDir = resolveProjectPath("users", `_eval_tokens_${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  const tokenFile = `${tmpDir}/tokens.json`;
  await writeFile(tokenFile, JSON.stringify({ tk_a: { user_id: "u_a" } }), "utf8");
  const auth = new TokenAuthenticator({ OPENUI_AUTH_TOKENS_FILE: tokenFile });
  if (!auth.isLoaded()) failures.push("token file: initial load failed");
  // reload after rewrite
  await writeFile(tokenFile, JSON.stringify({ tk_a: { user_id: "u_a" }, tk_b: { user_id: "u_b" } }), "utf8");
  const reloadResult = auth.reload();
  if (!reloadResult.ok) failures.push(`token file: reload ok=false ${JSON.stringify(reloadResult)}`);
  if (reloadResult.ok && reloadResult.size !== 2) failures.push(`token file: expected 2 tokens after reload, got ${reloadResult.size}`);
  auth.dispose();
  await rm(tmpDir, { recursive: true, force: true });
}

async function testTokenRevocation(): Promise<void> {
  const auth = new TokenAuthenticator({
    OPENUI_AUTH_TOKENS: JSON.stringify({
      tk_revoked: { user_id: "u1", revoked_at: "2020-01-01T00:00:00Z" },
      tk_active: { user_id: "u1" }
    })
  });
  // 模拟 IncomingMessage
  const reqRevoked = { headers: { authorization: "Bearer tk_revoked" } } as never;
  const reqActive = { headers: { authorization: "Bearer tk_active" } } as never;
  try {
    auth.authenticate(reqRevoked, null);
    failures.push("revocation: revoked token should throw");
  } catch (err) {
    if (!(err as Error).message.includes("revoked")) {
      failures.push(`revocation: unexpected error ${(err as Error).message}`);
    }
  }
  try {
    auth.authenticate(reqActive, null);
  } catch (err) {
    failures.push(`revocation: active token should pass, got ${(err as Error).message}`);
  }
  auth.dispose();
}

function testAdminToken(): void {
  const auth = new TokenAuthenticator({
    OPENUI_AUTH_TOKENS: JSON.stringify({
      tk_admin: { user_id: "u_admin", is_admin: true },
      tk_user: { user_id: "u_user" }
    })
  });
  const reqAdmin = { headers: { authorization: "Bearer tk_admin" } } as never;
  const reqUser = { headers: { authorization: "Bearer tk_user" } } as never;
  const reqAnon = { headers: {} } as never;
  if (!auth.isAdminToken(reqAdmin)) failures.push("admin: tk_admin should be admin");
  if (auth.isAdminToken(reqUser)) failures.push("admin: tk_user should not be admin");
  if (auth.isAdminToken(reqAnon)) failures.push("admin: anonymous should not be admin");
  auth.dispose();
}

function testPrometheusFormat(): void {
  // 用临时 metrics 实例避免污染 sharedMetrics 太多
  sharedMetrics.inc("chat_request_total", { tenant: "t1" });
  sharedMetrics.inc("chat_request_total", { tenant: "t1" });
  sharedMetrics.observe("finalize_latency_ms", 123, { tenant: "t1" });
  sharedMetrics.observe("finalize_latency_ms", 456, { tenant: "t1" });
  const text = sharedMetrics.toPrometheus();
  if (!text.includes("# TYPE chat_request_total counter")) failures.push("prometheus: missing counter TYPE");
  if (!text.match(/chat_request_total\{tenant="t1"\}\s+\d+/)) failures.push("prometheus: missing counter value with label");
  if (!text.includes("# TYPE finalize_latency_ms summary")) failures.push("prometheus: missing summary TYPE");
  if (!text.includes('quantile="0.95"')) failures.push("prometheus: missing quantile labels");
  if (!text.includes("finalize_latency_ms_sum")) failures.push("prometheus: missing _sum line");
  if (!text.includes("finalize_latency_ms_count")) failures.push("prometheus: missing _count line");
}
