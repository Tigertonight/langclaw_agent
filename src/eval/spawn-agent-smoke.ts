import type { AgenticHandler } from "../handlers/agentic-handler.js";
import { createSpawnAgentTool } from "../tools/spawn-agent-tool.js";
import type { JsonObject } from "../types/agent-contracts.js";

/**
 * §6 spawn_agent smoke：
 *   §1 基本委派：mock decideNext → tool_call → answer 两轮，验证 status=answered + summary 来自子 agent
 *   §2 白名单裁剪：传 allowed_tools 后，子 agent 看到的工具被裁剪；调白名单外的工具被拒
 *   §3 超预算被截断：max_steps=2 + decideNext 永远返回 tool_call → status=max_iterations
 *
 * 不联网：用 fake handler 替换 decideNext / callTool / getAvailableTools。
 * 校验整条 createSpawnAgentTool → runAgent → handler 的串联。
 */

const ORIGINAL_API_KEY = process.env.LLM_API_KEY;

async function main(): Promise<void> {
  // spawn_agent 需要 LLM_API_KEY，否则直接返回 ok:false
  process.env.LLM_API_KEY = process.env.LLM_API_KEY ?? "smoke-fake-key";
  try {
    await section1Basic();
    await section2Whitelist();
    await section3Budget();
    await section4MissingTask();
    console.log("spawn-agent:smoke OK");
  } finally {
    if (ORIGINAL_API_KEY === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = ORIGINAL_API_KEY;
  }
}

/** §1 基本委派：mock 出 tool_call → answer，验证 summary 回流 */
async function section1Basic(): Promise<void> {
  const decisions: Array<Record<string, unknown>> = [
    { action: "tool_call", tool_name: "intent.fake.lookup", args: { q: "x" }, reason: "查一下" },
    { action: "answer", answer: "结论：发现 3 条相关库存。", reason: "已收集足够" }
  ];
  const callsObserved: Array<{ name: string; args: JsonObject }> = [];
  const handler = makeFakeHandler({
    availableTools: [
      { name: "intent.fake.lookup", kind: "intent", description: "fake intent", params_schema: { q: { type: "string" } } }
    ],
    decisions,
    callTool: async (name, args) => {
      callsObserved.push({ name, args });
      return { ok: true, rows: [{ id: 1 }, { id: 2 }, { id: 3 }] };
    }
  });

  const tool = createSpawnAgentTool({ handler });
  const result = (await tool.execute({ task: "看一下库存" })) as {
    ok: boolean;
    data?: {
      status?: string;
      summary?: string;
      iterations?: number;
      tool_calls?: Array<{ tool: string; ok: boolean }>;
      tools_visible?: number;
    };
  };

  expect(result.ok === true, `expected ok=true, got ${result.ok}`);
  expect(result.data?.status === "answered", `status mismatch: ${result.data?.status}`);
  expect(result.data?.summary === "结论：发现 3 条相关库存。", `summary mismatch: ${result.data?.summary}`);
  expect(result.data?.iterations === 2, `iterations should be 2, got ${result.data?.iterations}`);
  expect(result.data?.tool_calls?.length === 1, `tool_calls length: ${result.data?.tool_calls?.length}`);
  expect(result.data?.tool_calls?.[0].tool === "intent.fake.lookup", `tool name: ${result.data?.tool_calls?.[0].tool}`);
  expect(result.data?.tool_calls?.[0].ok === true, `tool ok mismatch`);
  expect(callsObserved.length === 1, `callTool should fire 1x, got ${callsObserved.length}`);
  expect(result.data?.tools_visible === 1, `tools_visible: ${result.data?.tools_visible}`);
  console.log(`§1 basic delegate: answered after 2 iterations, summary forwarded`);
}

/** §2 白名单裁剪：allowed_tools 缩到 1 个；子 agent 调白名单外的会被拒 */
async function section2Whitelist(): Promise<void> {
  const handler = makeFakeHandler({
    availableTools: [
      { name: "intent.dealer.inventory", kind: "intent", description: "库存", params_schema: {} },
      { name: "intent.dealer.sales", kind: "intent", description: "销售", params_schema: {} },
      { name: "tool.safe_compute", kind: "tool", description: "算数", params_schema: {} }
    ],
    decisions: [
      // 子 agent 试图调白名单外的工具 → runner 应该拒（observation 返回 tool_not_allowed）
      { action: "tool_call", tool_name: "intent.dealer.sales", args: {}, reason: "试一下被禁的" },
      { action: "answer", answer: "无法访问销售数据。", reason: "工具被拒了" }
    ],
    callTool: async () => {
      throw new Error("白名单外的工具不应该真的被调用");
    }
  });

  const tool = createSpawnAgentTool({ handler });
  const result = (await tool.execute({
    task: "查销售",
    allowed_tools: ["intent.dealer.inventory"]
  })) as {
    ok: boolean;
    data?: {
      status?: string;
      tools_visible?: number;
      tool_calls?: Array<{ tool: string; ok: boolean; summary: string }>;
    };
  };

  expect(result.data?.tools_visible === 1, `tools_visible should be 1 after whitelist, got ${result.data?.tools_visible}`);
  expect(result.data?.status === "answered", `status: ${result.data?.status}`);
  // 子 agent 调了白名单外的工具，runner 直接给假 observation（不进 callTool）
  const denied = result.data?.tool_calls?.[0];
  expect(denied?.tool === "intent.dealer.sales", `denied tool name: ${denied?.tool}`);
  expect(denied?.ok === false, `denied call should be ok=false`);
  expect(
    typeof denied?.summary === "string" && denied.summary.includes("tool_not_allowed"),
    `summary should mention tool_not_allowed: ${denied?.summary}`
  );
  console.log(`§2 whitelist: tools_visible=1, off-list call denied`);
}

/** §3 超预算：max_steps=2，decide 永远返回 tool_call → status=max_iterations */
async function section3Budget(): Promise<void> {
  const decisions = Array.from({ length: 10 }, () => ({
    action: "tool_call",
    tool_name: "intent.fake.lookup",
    args: {},
    reason: "继续查"
  }));
  const handler = makeFakeHandler({
    availableTools: [
      { name: "intent.fake.lookup", kind: "intent", description: "fake", params_schema: {} }
    ],
    decisions,
    callTool: async () => ({ ok: true, rows: [] })
  });

  const tool = createSpawnAgentTool({ handler });
  const result = (await tool.execute({ task: "无限查", max_steps: 2 })) as {
    ok: boolean;
    error?: string;
    data?: { status?: string; iterations?: number; tool_calls?: unknown[] };
  };

  expect(result.ok === false, `over-budget should ok=false, got ${result.ok}`);
  expect(result.data?.status === "max_iterations", `status: ${result.data?.status}`);
  expect(result.data?.iterations === 2, `iterations should be 2, got ${result.data?.iterations}`);
  expect((result.data?.tool_calls?.length ?? 0) === 2, `tool_calls should be 2, got ${result.data?.tool_calls?.length}`);
  expect(result.error === "max_iterations", `error code: ${result.error}`);
  console.log(`§3 budget: capped at 2 iterations, status=max_iterations`);
}

/** §4 缺 task：直接返回 missing_task，不走 LLM */
async function section4MissingTask(): Promise<void> {
  const handler = makeFakeHandler({
    availableTools: [],
    decisions: [],
    callTool: async () => ({ ok: true })
  });
  const tool = createSpawnAgentTool({ handler });
  const result = (await tool.execute({})) as { ok: boolean; error?: string };
  expect(result.ok === false, `missing task should ok=false`);
  expect(result.error === "missing_task", `error code: ${result.error}`);
  console.log(`§4 missing task: rejected before LLM`);
}

interface FakeHandlerInput {
  availableTools: Array<{
    name: string;
    kind: string;
    description: string;
    params_schema: Record<string, { type?: string; description?: string }>;
  }>;
  decisions: Array<Record<string, unknown>>;
  callTool: (name: string, args: JsonObject) => Promise<unknown>;
}

/**
 * 造一个 AgenticHandler 形状的 fake，只实现 spawn-agent-tool 实际用到的 3 个方法：
 *   getAvailableTools / decideNext / callTool。
 * 其它 method 不会被调，cast as AgenticHandler 即可。
 */
function makeFakeHandler(input: FakeHandlerInput): AgenticHandler {
  let cursor = 0;
  const fake = {
    getAvailableTools: () => input.availableTools,
    decideNext: async () => {
      if (cursor >= input.decisions.length) {
        // 极端情况：smoke §3 数组够用；超出当 answer
        return { action: "answer", answer: "(decisions exhausted)" };
      }
      const decision = input.decisions[cursor];
      cursor += 1;
      return decision;
    },
    callTool: async ({ callName, args }: { callName?: string; args?: JsonObject }) => {
      return input.callTool(callName ?? "", args ?? {});
    }
  };
  return fake as unknown as AgenticHandler;
}

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(`assertion failed: ${message}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
