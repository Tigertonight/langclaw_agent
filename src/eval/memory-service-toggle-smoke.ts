/**
 * 验证 getMemoryClient() 的开关语义：
 *   1) 未配 URL/SECRET → null（向后兼容）
 *   2) 配齐 URL+SECRET → 返回 client
 *   3) MEMORY_SERVICE_ENABLED=false → 强制 null
 *   4) MEMORY_SERVICE_ENABLED=true 但缺 SECRET → null（不抛）
 */

import { getMemoryClient, __resetMemoryClientForTests } from "../memory/service-client.js";

let failed = 0;
const expect = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`  ✓ ${label}`);
  else { console.log(`  ✗ ${label}`, detail ?? ""); failed += 1; }
};

const ORIG = {
  enabled: process.env.MEMORY_SERVICE_ENABLED,
  url: process.env.MEMORY_SERVICE_URL,
  secret: process.env.MEMORY_SERVICE_SECRET
};

function setEnv(enabled?: string, url?: string, secret?: string): void {
  if (enabled === undefined) delete process.env.MEMORY_SERVICE_ENABLED;
  else process.env.MEMORY_SERVICE_ENABLED = enabled;
  if (url === undefined) delete process.env.MEMORY_SERVICE_URL;
  else process.env.MEMORY_SERVICE_URL = url;
  if (secret === undefined) delete process.env.MEMORY_SERVICE_SECRET;
  else process.env.MEMORY_SERVICE_SECRET = secret;
  __resetMemoryClientForTests();
}

// 1) 全空
setEnv();
expect("no env → null", getMemoryClient() === null);

// 2) URL+SECRET 齐
setEnv(undefined, "http://localhost:4310", "test-secret");
const c2 = getMemoryClient();
expect("url+secret → client", c2 !== null);

// 3) 显式 false 强制关
setEnv("false", "http://localhost:4310", "test-secret");
expect("ENABLED=false overrides url+secret", getMemoryClient() === null);

// 4) ENABLED=true 但缺 SECRET → null（不抛）
setEnv("true", "http://localhost:4310", undefined);
expect("ENABLED=true with missing secret → null (no throw)", getMemoryClient() === null);

// 5) 各种 truthy 值
for (const truthy of ["1", "yes", "on", "TRUE"]) {
  setEnv(truthy, "http://localhost:4310", "test-secret");
  expect(`ENABLED=${truthy} accepted`, getMemoryClient() !== null);
}

// 6) 各种 falsy 值
for (const falsy of ["0", "no", "off", "FALSE"]) {
  setEnv(falsy, "http://localhost:4310", "test-secret");
  expect(`ENABLED=${falsy} disables`, getMemoryClient() === null);
}

// 还原
process.env.MEMORY_SERVICE_ENABLED = ORIG.enabled ?? "";
if (ORIG.enabled === undefined) delete process.env.MEMORY_SERVICE_ENABLED;
process.env.MEMORY_SERVICE_URL = ORIG.url ?? "";
if (ORIG.url === undefined) delete process.env.MEMORY_SERVICE_URL;
process.env.MEMORY_SERVICE_SECRET = ORIG.secret ?? "";
if (ORIG.secret === undefined) delete process.env.MEMORY_SERVICE_SECRET;
__resetMemoryClientForTests();

if (failed > 0) {
  console.error(`\n${failed} memory-service toggle check(s) failed`);
  process.exit(1);
}
console.log("\nPASS memory-service toggle smoke");
