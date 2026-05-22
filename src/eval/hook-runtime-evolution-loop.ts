import { rm } from "node:fs/promises";
import { resolveProjectPath } from "../data/load-json.js";
import { createEvolutionSignalPlugin } from "../evolution/evolution-signal-plugin.js";
import { EvolutionIterationLoop } from "../evolution/iteration-loop.js";
import { EvolutionRuntime } from "../evolution/runtime.js";
import { RuntimeHooks } from "../runtime/hooks.js";
import { createTranscriptPlugin } from "../runtime/transcript-plugin.js";
import { resolveUserWorkspace } from "../runtime/workspace-context.js";
import { TranscriptStore } from "../transcript/transcript-store.js";
import type { UserContext } from "../types/agent-contracts.js";

const user: UserContext = { id: `eval_hook_runtime_${Date.now()}`, role: "eval" };
const workspace = resolveUserWorkspace(user);
const sessionId = `${user.id}:default`;

try {
  const hooks = new RuntimeHooks();
  let idleSeen = false;
  const evolutionRuntime = new EvolutionRuntime({
    debounceMs: 10,
    onSessionIdle: (input) => hooks.emit("session_idle", {
      user_id: input.user.id,
      session_id: input.sessionId,
      trace_turns: input.sessionTrace?.turns.length ?? 0
    }),
    onReviewed: (input, result) => hooks.emit("evolution_applied", {
      user_id: input.user.id,
      session_id: input.sessionId,
      status: result.status,
      result: JSON.parse(JSON.stringify(result))
    })
  });
  const transcriptStore = new TranscriptStore();
  hooks.use(createTranscriptPlugin({ transcriptStore }));
  hooks.use(createEvolutionSignalPlugin({ evolutionRuntime }));
  hooks.on("session_idle", (event) => {
    if (event.session_id === sessionId) idleSeen = true;
  });

  await hooks.emit("turn_end", {
    user: JSON.parse(JSON.stringify(user)),
    user_id: user.id,
    session_id: sessionId,
    message: "记住我偏好简洁回答",
    answer: "好的。",
    route: { intent_code: "general" },
    tool_calls: [],
    tool_results: [],
    agent_steps: []
  });
  await evolutionRuntime.flushSession(user.id, sessionId);
  assert(idleSeen, "session_idle should be emitted after debounce/flush");
  const events = await transcriptStore.recent(workspace, sessionId, 10);
  assert(events.some((event) => event.type === "user_message"), "transcript plugin should persist turn");

  const loop = new EvolutionIterationLoop();
  const proposed = await loop.propose(workspace, {
    targetType: "skill",
    targetId: "summarize-alert",
    goal: "回答更简洁",
    evidence: { source: "eval" }
  });
  assertEqual(proposed.status, "proposed", "iteration propose");
  const observed = await loop.observe(workspace, proposed.id, "试运行表现稳定", true);
  assertEqual(observed.status, "accepted", "iteration observe accept");
  const rolled = await loop.rollback(workspace, proposed.id, "eval rollback");
  assertEqual(rolled.status, "rolled_back", "iteration rollback");

  console.log("PASS hook runtime evolution loop");
} finally {
  await rm(resolveProjectPath("users", workspace.user_id), { recursive: true, force: true });
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}
