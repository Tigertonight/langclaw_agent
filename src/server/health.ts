import { access, mkdir, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { resolveProjectPath } from "../data/load-json.js";
import { getResourceDataPath } from "../domains/runtime-registry.js";
import type { TokenAuthenticator } from "../security/auth.js";

export interface ReadinessCheckResult {
  ok: boolean;
  checks: Record<string, { ok: boolean; detail?: string }>;
}

/**
 * 二段式健康检查：
 * - liveness（/health）：进程没死就 OK，**绝不**依赖外部状态。k8s/LB 用这个判断要不要重启。
 * - readiness（/ready）：检查关键依赖。失败时返回 503，LB 把流量摘掉，但不重启。
 *
 * 关键依赖：
 *   1. data/ 目录关键文件可读（customers.json）
 *   2. users/ 目录可写（落盘 envelope/task 的根）
 *   3. tokens 已加载（除非 dev 模式禁用了鉴权）
 */
export async function checkReadiness(auth: TokenAuthenticator): Promise<ReadinessCheckResult> {
  const checks: ReadinessCheckResult["checks"] = {};

  // 1. 关键配置文件可读
  try {
    const probeFile = getResourceDataPath("customers") ?? "data/customers.json";
    await access(resolveProjectPath(...probeFile.split("/")));
    checks.config_readable = { ok: true };
  } catch (error) {
    checks.config_readable = { ok: false, detail: error instanceof Error ? error.message : "unknown" };
  }

  // 2. users 目录可写（写一个临时探针文件）
  try {
    const probeRoot = resolveProjectPath("users", ".readiness-probe");
    await mkdir(path.dirname(probeRoot), { recursive: true });
    await writeFile(probeRoot, String(Date.now()), "utf8");
    await unlink(probeRoot);
    checks.users_writable = { ok: true };
  } catch (error) {
    checks.users_writable = { ok: false, detail: error instanceof Error ? error.message : "unknown" };
  }

  // 3. 鉴权已就绪
  if (auth.isLoaded()) {
    checks.auth_loaded = { ok: true, detail: auth.loadedAt() ?? undefined };
  } else {
    checks.auth_loaded = { ok: false, detail: "no tokens loaded; set A2UI_AUTH_TOKENS or A2UI_AUTH_TOKENS_FILE" };
  }

  const ok = Object.values(checks).every((entry) => entry.ok);
  return { ok, checks };
}

export function basicLiveness(): { ok: true; uptime_s: number; pid: number } {
  return { ok: true, uptime_s: Math.round(process.uptime()), pid: process.pid };
}

export function _testExists(relativePath: string): boolean {
  return existsSync(resolveProjectPath(relativePath));
}
