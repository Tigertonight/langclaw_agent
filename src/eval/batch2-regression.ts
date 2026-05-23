import { spawn } from "node:child_process";

/**
 * 第二批（企业级可用成熟阶段）的一键回归：
 * 把 M2-A..E 的 smoke + 关键 batch-1 smoke 串成一条命令。
 * 失败任意一条立刻退出码 1，方便接 CI。
 *
 * 不直接 import 各 smoke，而是 spawn node 子进程跑 dist/eval/*.js，
 * 让每条 smoke 保持独立进程边界，避免污染（hooks/console.warn 之类）。
 */

interface SmokeSpec {
  label: string;
  script: string;
}

const SMOKES: SmokeSpec[] = [
  // batch-1 关键回归
  { label: "tool:timeout", script: "dist/eval/tool-timeout.js" },
  { label: "tool:abort", script: "dist/eval/tool-abort.js" },
  { label: "emit:resilience", script: "dist/eval/emit-resilience.js" },
  { label: "ingest:failure", script: "dist/eval/ingest-failure.js" },
  { label: "context:ingest-hook", script: "dist/eval/context-ingest-hook.js" },
  { label: "item:watchdog", script: "dist/eval/item-watchdog.js" },
  { label: "prompt:authority-alert", script: "dist/eval/prompt-authority-alert.js" },
  { label: "handlers:auth", script: "dist/eval/handlers-auth.js" },
  // batch-2 新增
  { label: "metrics:smoke", script: "dist/eval/metrics-collector.js" },
  { label: "prompt:alert-dedup", script: "dist/eval/prompt-alert-dedup.js" },
  { label: "tool:retry", script: "dist/eval/tool-retry.js" },
  { label: "commands:api", script: "dist/eval/commands-api.js" },
  { label: "skill:install-e2e", script: "dist/eval/skill-install-e2e.js" },
  { label: "evolution:auto-compact", script: "dist/eval/auto-compaction-smoke.js" },
  { label: "scheduler:self-driving", script: "dist/eval/scheduler-self-driving.js" },
  { label: "mcp:smoke", script: "dist/eval/mcp-client-smoke.js" },
  { label: "agent:spawn", script: "dist/eval/spawn-agent-smoke.js" },
  { label: "cron:smoke", script: "dist/eval/cron-smoke.js" },
  { label: "terminal:smoke", script: "dist/eval/terminal-smoke.js" }
];

async function main(): Promise<void> {
  const failures: Array<{ label: string; reason: string }> = [];
  for (const spec of SMOKES) {
    process.stdout.write(`▶ ${spec.label} ... `);
    const result = await runOne(spec);
    if (result.ok) {
      process.stdout.write(`PASS (${result.elapsedMs}ms)\n`);
    } else {
      process.stdout.write(`FAIL (exit=${result.exitCode}, ${result.elapsedMs}ms)\n`);
      if (result.tail) process.stdout.write(`  ${result.tail}\n`);
      failures.push({ label: spec.label, reason: result.tail ?? `exit ${result.exitCode}` });
    }
  }
  console.log("");
  console.log(`Batch-2 regression summary: ${SMOKES.length - failures.length}/${SMOKES.length} passed`);
  if (failures.length) {
    console.log("Failed smokes:");
    for (const f of failures) console.log(`  - ${f.label}: ${f.reason}`);
    process.exit(1);
  }
}

interface SmokeResult {
  ok: boolean;
  exitCode: number | null;
  elapsedMs: number;
  tail?: string;
}

function runOne(spec: SmokeSpec): Promise<SmokeResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn("node", [spec.script], { stdio: ["ignore", "pipe", "pipe"] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("close", (code) => {
      const elapsedMs = Date.now() - startedAt;
      const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      const ok = code === 0;
      const tail = ok ? undefined : (stderr.split(/\n/).slice(-1)[0] || stdout.split(/\n/).slice(-1)[0]);
      resolve({ ok, exitCode: code, elapsedMs, tail });
    });
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
