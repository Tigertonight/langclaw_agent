import { rm } from "node:fs/promises";
import { resolveProjectPath } from "../data/load-json.js";
import { RuntimeHooks } from "../runtime/hooks.js";
import { createTranscriptPlugin } from "../runtime/transcript-plugin.js";
import { resolveUserWorkspace } from "../runtime/workspace-context.js";
import { TranscriptStore } from "../transcript/transcript-store.js";
import { createRuntimeInspectionTools } from "../tools/runtime-inspection-tools.js";
import { ToolRegistry } from "../tools/registry.js";
import type { UserContext } from "../types/agent-contracts.js";

const user: UserContext = { id: `eval_trace_${Date.now()}`, role: "eval", permissions: [] };
const workspace = resolveUserWorkspace(user);
const sessionId = "trace-session";
const runId = "run_trace_eval";

try {
  const transcriptStore = new TranscriptStore();
  const hooks = new RuntimeHooks();
  hooks.use(createTranscriptPlugin({ transcriptStore }));

  await hooks.emit("turn_start", { user_id: user.id, session_id: sessionId, run_id: runId, message: "继续上次那个制度问答" });
  await hooks.emit("context_assembly", {
    user_id: user.id,
    session_id: sessionId,
    run_id: runId,
    budget: { used_chars: 1234 },
    sections: [{ name: "runtime", chars: 200 }],
    dropped: []
  });
  await hooks.emit("route_decision", {
    user_id: user.id,
    session_id: sessionId,
    run_id: runId,
    message: "继续上次那个制度问答",
    route: { intent_code: "knowledge.policy_qa", execution_class: "controlled_execution", handler_type: "knowledge_lookup", confidence: "high", source: "eval" }
  });
  await hooks.emit("tool_result", {
    user_id: user.id,
    session_id: sessionId,
    run_id: runId,
    tool: "retrieve_knowledge",
    decision: "allowed",
    risk_level: "read"
  });
  await hooks.emit("turn_end", {
    user_id: user.id,
    session_id: sessionId,
    run_id: runId,
    message: "继续上次那个制度问答",
    answer: "制度依据如下。",
    route: { intent_code: "knowledge.policy_qa" },
    tool_calls: [{ name: "retrieve_knowledge", args: { query: "制度" } }],
    tool_results: [{ ok: true, tool: "retrieve_knowledge", data: { total: 1 } }],
    agent_steps: [{ phase: "retrieve_knowledge", title: "检索知识库", status: "completed" }]
  });

  const registry = new ToolRegistry([]);
  const tools = createRuntimeInspectionTools({
    transcriptStore,
    enterpriseContextProvider: {
      async load() {
        return {};
      }
    },
    toolRegistry: registry
  });
  const replay = tools.find((tool) => tool.name === "runtime.trace.replay");
  const result = await replay?.execute({ session_id: sessionId, run_id: runId }, { user, workspace }) as { data?: Record<string, unknown> };
  const data = result.data ?? {};
  assert(Array.isArray(data.events) && data.events.length >= 6, "trace replay should return run events");
  assert(Array.isArray(data.timeline) && data.timeline.length >= 6, "trace replay should return timeline");
  assert((data.route_summary as { intent_code?: string } | undefined)?.intent_code === "knowledge.policy_qa", "trace should summarize route");
  assert((data.metrics as { context_used_chars?: number } | undefined)?.context_used_chars === 1234, "trace should expose context metrics");
  assert((data.governance_summary as { allowed?: number } | undefined)?.allowed === 1, "trace should summarize governance");
  console.log("PASS trace maturity");
} finally {
  await rm(resolveProjectPath("users", workspace.user_id), { recursive: true, force: true });
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
