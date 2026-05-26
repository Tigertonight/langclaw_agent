import type { AgenticHandler } from "../handlers/agentic-handler.js";
import {
  runAgent,
  renderToolListForPrompt,
  type AgentRunnerToolView,
  type AgentRunnerDecision
} from "../agentic/agent-runner.js";
import type { JsonObject, ToolDefinition, ToolMetadata, UserContext } from "../types/agent-contracts.js";

/**
 * agentic.spawn_agent —— 让主 agent 委派一个隔离子 agent。
 *
 * 行为：
 *   - 子 agent 有自己的 context（独立 conversation），跑完只把摘要塞回主 agent 一条 tool_result，
 *     主 agent 的 context 不被脏活污染（这是 Claude Code Agent 工具最大的卖点）。
 *   - 工具白名单可裁剪：默认继承主 agent 的 expose_to_agentic 工具集，allowed_tools 给了就在它里面再交集。
 *   - 预算独立：max_steps 默认 5（比主 agent 的 7 小），total_timeout_ms 默认 60s（主 agent 是 180s）。
 *   - 决策协议：复用 AgenticHandler.decideNext 的 LLM JSON 协议，工具调用复用 AgenticHandler.callTool 的路由。
 *
 * 安全：标 risk_level=read（不会给数据库写权限）；expose_to_agentic=true（主 agent 可见）。
 *   子 agent 不能再 spawn 子子 agent（白名单内本工具不会暴露给自己）—— 通过过滤 self.name 实现。
 *
 * 注意：本工具依赖 LLM_API_KEY；缺 key 时直接返回 ok:false，不做本地 fallback（fallback 应留给主 agent）。
 */

const TOOL_NAME = "agentic.spawn_agent";
const DEFAULT_MAX_STEPS = 5;
const DEFAULT_TOTAL_TIMEOUT_MS = 60_000;
const HARD_MAX_STEPS = 10;
const HARD_TIMEOUT_MS = 180_000;

interface SpawnAgentArgs extends JsonObject {
  task?: string;
  allowed_tools?: string[];
  max_steps?: number;
  total_timeout_ms?: number;
  /** 可选：主 agent 想给子 agent 加的额外指令（拼到 system prompt 末尾） */
  extra_instructions?: string;
}

export function createSpawnAgentTool({ handler }: { handler: AgenticHandler }): ToolDefinition {
  const metadata: ToolMetadata = {
    required_permissions: [],
    risk_level: "read",
    expose_to_agentic: true,
    source: "agentic.spawn_agent"
  };

  return {
    name: TOOL_NAME,
    description:
      "委派一个隔离子 agent 跑一段调研型子任务，返回精简摘要。子 agent 有独立 context、独立预算、可被裁剪的工具白名单。" +
      "适合：跨意图调研、多源对比、不希望污染主对话上下文的脏活。不适合：需要主 agent 实时决策的事。",
    schema: {
      type: "object",
      required: ["task"],
      properties: {
        task: {
          type: "string",
          description: "子 agent 的目标，越具体越好。例：'调研最近 30 天的异常数据，给出 200 字摘要'。"
        },
        allowed_tools: {
          type: "array",
          items: { type: "string" },
          description: "工具名白名单（带命名空间，如 'intent.<domain>.<action>.<resource>'）。不传则继承主 agent 全部 expose_to_agentic 工具。"
        },
        max_steps: {
          type: "number",
          description: `子 agent 最大循环步数，默认 ${DEFAULT_MAX_STEPS}，硬上限 ${HARD_MAX_STEPS}。`
        },
        total_timeout_ms: {
          type: "number",
          description: `子 agent 总时长上限（毫秒），默认 ${DEFAULT_TOTAL_TIMEOUT_MS}，硬上限 ${HARD_TIMEOUT_MS}。`
        },
        extra_instructions: {
          type: "string",
          description: "可选附加指令，拼到子 agent 的 system prompt 末尾。"
        }
      }
    },
    metadata,
    async execute(args, context) {
      const parsed = parseArgs(args ?? {});
      const apiKey = process.env.LLM_DECISION_API_KEY ?? process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return {
          ok: false,
          tool: TOOL_NAME,
          error: "no_api_key",
          message: "spawn_agent 需要 LLM_API_KEY"
        };
      }
      if (!parsed.task) {
        return {
          ok: false,
          tool: TOOL_NAME,
          error: "missing_task",
          message: "task 必填"
        };
      }

      const user = context?.user as UserContext | undefined;
      const workspace = context?.workspace;

      // 1) 准备工具白名单：从主 agent 全集中筛 + 应用 allowed_tools 交集 + 移除自身
      const fullToolset = handler.getAvailableTools({ user, workspace });
      const allowedSet = parsed.allowedTools ? new Set(parsed.allowedTools) : null;
      const subToolViews: AgentRunnerToolView[] = [];
      for (const tool of fullToolset) {
        if (tool.name === TOOL_NAME) continue; // 防递归
        if (tool.name.startsWith(`tool.${TOOL_NAME}`)) continue;
        if (allowedSet && !allowedSet.has(tool.name)) continue;
        subToolViews.push({
          name: tool.name,
          description: tool.description,
          params_schema: tool.params_schema as Record<string, { type?: string; description?: string }> | undefined
        });
      }

      // 2) 装配 system prompt（薄一点，子 agent 不需要 plannerState）
      const systemPrompt = buildSubAgentSystemPrompt({
        toolListText: renderToolListForPrompt(subToolViews),
        extraInstructions: parsed.extraInstructions
      });

      // 3) 跑 runner
      const result = await runAgent({
        systemPrompt,
        userMessage: parsed.task,
        tools: subToolViews,
        maxIterations: parsed.maxSteps,
        totalTimeoutMs: parsed.totalTimeoutMs,
        decide: async (conversation) => {
          const decision = await handler.decideNext({ conversation, apiKey });
          return decision as AgentRunnerDecision;
        },
        callTool: async (toolName, toolArgs) => {
          return handler.callTool({
            callName: toolName,
            args: toolArgs,
            user,
            workspace
          });
        }
      });

      return {
        ok: result.status === "answered",
        tool: TOOL_NAME,
        data: {
          status: result.status,
          summary: result.summary,
          iterations: result.iterations,
          duration_ms: result.durationMs,
          tool_calls: result.toolCalls.map((c) => ({
            step: c.step,
            tool: c.tool,
            ok: c.ok,
            summary: c.observation_summary
          })),
          tools_visible: subToolViews.length
        },
        ...(result.status !== "answered" && {
          error: result.status,
          message: result.lastError ?? result.summary
        })
      };
    }
  };
}

function parseArgs(args: SpawnAgentArgs): {
  task: string;
  allowedTools: string[] | null;
  maxSteps: number;
  totalTimeoutMs: number;
  extraInstructions: string | undefined;
} {
  const task = typeof args.task === "string" ? args.task.trim() : "";
  const allowedTools = Array.isArray(args.allowed_tools)
    ? args.allowed_tools.filter((s): s is string => typeof s === "string" && s.length > 0)
    : null;
  const maxStepsRaw = typeof args.max_steps === "number" ? args.max_steps : DEFAULT_MAX_STEPS;
  const maxSteps = clamp(Math.floor(maxStepsRaw), 1, HARD_MAX_STEPS);
  const timeoutRaw = typeof args.total_timeout_ms === "number" ? args.total_timeout_ms : DEFAULT_TOTAL_TIMEOUT_MS;
  const totalTimeoutMs = clamp(Math.floor(timeoutRaw), 1000, HARD_TIMEOUT_MS);
  const extraInstructions = typeof args.extra_instructions === "string" && args.extra_instructions.trim()
    ? args.extra_instructions.trim()
    : undefined;
  return { task, allowedTools, maxSteps, totalTimeoutMs, extraInstructions };
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function buildSubAgentSystemPrompt({
  toolListText,
  extraInstructions
}: {
  toolListText: string;
  extraInstructions: string | undefined;
}): string {
  const parts = [
    "你是一个被主 agent 委派的子 agent。任务由用户消息给出，你独立完成，最终用 action=answer 返回一段简洁结论给主 agent。",
    "",
    "可用工具（每轮只能调白名单内的工具，未授权的工具会被拒）：",
    toolListText,
    "",
    "工作流程：每轮严格输出 JSON：",
    `{
  "action": "tool_call" | "answer",
  "tool_name": "<当 action=tool_call 时填工具名>",
  "args": { ... },
  "tools": [{"tool_name": "<可选：相互独立的工具可一次返回多个>", "args": { ... }}],
  "answer": "<当 action=answer 时填最终答复>",
  "reason": "<一句话理由>"
}`,
    "",
    "硬规则：",
    "1. 你的 answer 是给主 agent 看的摘要，不是给最终用户。控制在 300 字以内，结构化（结论 + 关键证据 + 数据来源）。",
    "2. 你的 context 不会被保留到下一次调用，所以观察过的数据要在 answer 里讲清楚，不要假设主 agent 也能看到。",
    "3. 不要尝试调用『agentic.spawn_agent』本身，会被拒绝（不允许子 agent 嵌套）。",
    "4. 工具失败也算证据，记得在 answer 里说明。",
    "5. 步数预算很紧，多步任务要及时收敛，不要无限调工具。"
  ];
  if (extraInstructions) {
    parts.push("", "主 agent 附加指令：", extraInstructions);
  }
  return parts.join("\n");
}
