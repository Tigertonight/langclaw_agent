import { rm } from "node:fs/promises";
import { resolveProjectPath } from "../data/load-json.js";
import { resolveUserWorkspace } from "../runtime/workspace-context.js";
import { A2UIEnvelopeStore } from "../a2ui/envelope-store.js";
import { PendingActionStore } from "../runtime/pending-action-store.js";

const workspace = resolveUserWorkspace(`eval_concurrency_${Date.now()}`);
const failures: string[] = [];

try {
  await testEnvelopeAppendSequential();
  await testPendingActionConcurrent();

  if (failures.length > 0) {
    console.error(`FAIL store concurrency: ${failures.length} failures`);
    for (const message of failures) console.error(` - ${message}`);
    process.exitCode = 1;
  } else {
    console.log("PASS store concurrency");
  }
} finally {
  await rm(resolveProjectPath("users", workspace.user_id), { recursive: true, force: true });
}

async function testEnvelopeAppendSequential(): Promise<void> {
  const store = new A2UIEnvelopeStore();
  const N = 100;
  const tasks: Promise<{ seq: number }>[] = [];
  for (let i = 0; i < N; i += 1) {
    tasks.push(store.append(workspace, {
      sessionId: "concurrency",
      runId: "run_a",
      envelope: { surfaces: [], events: [{ type: "marker", index: i } as never] } as never
    }));
  }
  const results = await Promise.all(tasks);

  const seqs = results.map((r) => r.seq).sort((a, b) => a - b);
  if (seqs.length !== N) {
    failures.push(`envelope append: expected ${N} results, got ${seqs.length}`);
    return;
  }
  for (let i = 0; i < N; i += 1) {
    if (seqs[i] !== i + 1) {
      failures.push(`envelope append: expected seq ${i + 1}, got ${seqs[i]} at index ${i}`);
      return;
    }
  }

  // 再读一次确认落盘的 envelopes 数量等于 N，且 seq 与索引对齐
  const persisted = await store.listEnvelopesSince(workspace, "concurrency", "run_a", 0);
  if (persisted.length !== N) {
    failures.push(`envelope append: expected ${N} persisted, found ${persisted.length}`);
    return;
  }
  const persistedSeqs = persisted.map((p) => p.seq).sort((a, b) => a - b);
  for (let i = 0; i < N; i += 1) {
    if (persistedSeqs[i] !== i + 1) {
      failures.push(`envelope persisted: expected seq ${i + 1}, got ${persistedSeqs[i]} at index ${i}`);
      return;
    }
  }
}

async function testPendingActionConcurrent(): Promise<void> {
  const store = new PendingActionStore();
  const N = 50;
  const tasks: Promise<unknown>[] = [];
  for (let i = 0; i < N; i += 1) {
    tasks.push(store.create(workspace, {
      userId: workspace.user_id,
      call: { name: "task.create", args: { title: `t${i}` } } as never,
      reason: `test_${i}`
    }));
  }
  await Promise.all(tasks);

  const all = await store.list(workspace, { includeExpired: true });
  if (all.length !== N) {
    failures.push(`pending action create: expected ${N}, found ${all.length}`);
    return;
  }
  const ids = new Set(all.map((a) => a.id));
  if (ids.size !== N) {
    failures.push(`pending action create: duplicate ids detected (${ids.size} unique vs ${N})`);
  }
}
