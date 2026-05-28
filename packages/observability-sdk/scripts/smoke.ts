/**
 * SDK 自测：覆盖开关语义、scrub 规则、Noop/Langfuse adapter 切换。
 *
 * 不依赖真实 Langfuse 服务 —— LangfuseAdapter 用假 key 启动，仅验证类型和
 * 接口契约（不发请求；进程退出 shutdown timeout 后即可）。
 *
 * 真实 Langfuse roundtrip 在 services/observability/scripts/smoke-trace-roundtrip.ts。
 */

import {
  __resetEmitterForTests,
  getEmitter,
  LangfuseAdapter,
  NoopAdapter,
  scrubString,
  scrubValue
} from "../src/index.js";

let failed = 0;
const expect = (label: string, ok: boolean, detail?: unknown): void => {
  if (ok) console.log(`  ✓ ${label}`);
  else {
    console.log(`  ✗ ${label}`, detail ?? "");
    failed += 1;
  }
};

const ORIG = {
  enabled: process.env.OBSERVABILITY_ENABLED,
  host: process.env.LANGFUSE_HOST,
  pk: process.env.LANGFUSE_PUBLIC_KEY,
  sk: process.env.LANGFUSE_SECRET_KEY,
  scrub: process.env.OBS_SCRUB_ENABLED
};

function setEnv(
  enabled?: string,
  host?: string,
  pk?: string,
  sk?: string,
  scrub?: string
): void {
  for (const [k, v] of [
    ["OBSERVABILITY_ENABLED", enabled],
    ["LANGFUSE_HOST", host],
    ["LANGFUSE_PUBLIC_KEY", pk],
    ["LANGFUSE_SECRET_KEY", sk],
    ["OBS_SCRUB_ENABLED", scrub]
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  __resetEmitterForTests();
}

console.log("\n[1] 开关语义");

setEnv();
expect("no env → Noop", getEmitter() instanceof NoopAdapter);

setEnv(undefined, "http://localhost:3001", "pk-test", "sk-test");
const e2 = getEmitter();
expect("host+pk+sk → LangfuseAdapter", e2 instanceof LangfuseAdapter);

setEnv("false", "http://localhost:3001", "pk-test", "sk-test");
expect("ENABLED=false 强制 Noop", getEmitter() instanceof NoopAdapter);

setEnv("true", "http://localhost:3001", undefined, "sk-test");
expect("ENABLED=true 但缺 pk → Noop（不抛）", getEmitter() instanceof NoopAdapter);

for (const truthy of ["1", "yes", "on", "TRUE"]) {
  setEnv(truthy, "http://localhost:3001", "pk-test", "sk-test");
  expect(`ENABLED=${truthy} accepted`, getEmitter() instanceof LangfuseAdapter);
}
for (const falsy of ["0", "no", "off", "FALSE"]) {
  setEnv(falsy, "http://localhost:3001", "pk-test", "sk-test");
  expect(`ENABLED=${falsy} disables`, getEmitter() instanceof NoopAdapter);
}

console.log("\n[2] PII scrub");

const cfg = { enabled: true };
expect(
  "phone scrubbed",
  scrubString("call me at 13912345678 anytime", cfg).includes("[REDACTED:phone:139***78]")
);
expect("id_card scrubbed", scrubString("身份证 110101199003075418", cfg).includes("[REDACTED:id_card]"));
expect("email scrubbed", scrubString("hi alice@example.com", cfg).includes("[REDACTED:email"));
expect("plate scrubbed", scrubString("车牌粤A12345", cfg).includes("***"));
expect(
  "scrub disabled passes through",
  scrubString("phone 13912345678", { enabled: false }) === "phone 13912345678"
);

const obj = {
  user: "alice@example.com",
  msg: "我是 13912345678",
  nested: { plates: ["粤A12345", "京B67890"] }
};
const scrubbed = scrubValue(obj, cfg) as typeof obj;
expect(
  "scrubValue 递归 object/array",
  scrubbed.user.includes("[REDACTED:email") &&
    scrubbed.msg.includes("[REDACTED:phone") &&
    scrubbed.nested.plates.every((p) => p.includes("***"))
);
expect("scrubValue 不改原对象", obj.user === "alice@example.com");

console.log("\n[3] Noop trace handle 行为");

setEnv();
const noop = getEmitter();
const tr = noop.startTrace({
  name: "test",
  tags: {
    business_id: "biz1",
    user_id: "u1",
    session_id: "s1",
    channel: "web",
    env: "dev"
  }
});
expect("traceId 是有效字符串", typeof tr.traceId === "string" && tr.traceId.length > 0);
const sp = tr.span({ name: "step1" });
sp.update({ k: "v" });
sp.end({ ok: true });
const sp2 = sp.childSpan({ name: "nested" });
sp2.end();
tr.score({ name: "quality", value: 4, comment: "ok" });
tr.end({ done: true });
expect("Noop 全链路无异常", true);

console.log("\n[4] LangfuseAdapter 失败容忍");

setEnv("true", "http://nonexistent.localhost:1", "pk-test", "sk-test");
const lf = getEmitter();
const lftr = lf.startTrace({
  name: "test",
  tags: {
    business_id: "biz1",
    user_id: "u1",
    session_id: "s1",
    channel: "web",
    env: "dev"
  },
  input: "hello, my phone is 13912345678"
});
expect("LangfuseAdapter startTrace 不抛", typeof lftr.traceId === "string");
lftr.span({ name: "x" }).end();
lftr.end();
await lf.flush(); // 即使 host 不可达也应 resolve
await lf.shutdown(500);
expect("flush + shutdown 不抛", true);

// 还原环境
__resetEmitterForTests();
for (const [k, v] of [
  ["OBSERVABILITY_ENABLED", ORIG.enabled],
  ["LANGFUSE_HOST", ORIG.host],
  ["LANGFUSE_PUBLIC_KEY", ORIG.pk],
  ["LANGFUSE_SECRET_KEY", ORIG.sk],
  ["OBS_SCRUB_ENABLED", ORIG.scrub]
] as const) {
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
}

if (failed > 0) {
  console.error(`\n${failed} observability-sdk smoke check(s) failed`);
  process.exit(1);
}
console.log("\nPASS observability-sdk smoke");
