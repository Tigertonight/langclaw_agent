import path from "node:path";
import type { JsonObject, JsonValue } from "../types/agent-contracts.js";

/**
 * AgentRunner —— 薄循环，专为子 agent（spawn_agent 工具）设计。
 *
 * 设计取舍：
 *   - 不复用 AgenticHandler 的循环（它带 plannerState/taskContext/双流 traces/SSE/business fallback，
 *     这些在子 agent 场景里都是噪音）。子 agent 要的是"独立 context、独立预算、跑完返回摘要"。
 *   - 决策协议复用 AgenticHandler 的 JSON schema（同样的 action: tool_call / answer），方便 LLM 复用经验。
 *   - 决策函数 + 工具调用函数都通过 ctor 注入，单元测试不需要真 LLM 也能跑。
 *   - 不维护 plannerState；observation 直接拼回 conversation 让 LLM 自己消化。
 *   - 超时优先级：单步超时由 decide 函数自己管（fetch signal）；总超时和步数上限由 runner 强制。
 *
 * 输入：systemPrompt + userMessage + 工具白名单 + 预算
 * 输出：{ status, summary, toolCalls[], iterations, durationMs }
 *   - status=answered：LLM 主动 answer
 *   - status=max_iterations：达到 maxIterations 仍未 answer
 *   - status=timeout：总时长超 totalTimeoutMs
 *   - status=error：决策函数抛错或 LLM 输出格式错
 *   - summary 永远有值：answered → LLM 给的 answer；其余 → runner 拼一段简短复盘
 */

export interface AgentRunnerToolView {
  /** 工具名（带命名空间，比如 intent.dealer.query.inventory / tool.safe_compute / skill.summarize-alert） */
  name: string;
  description?: string;
  /** 简化版 params 描述 {key: {type, description}}，用于 system prompt 渲染 */
  params_schema?: Record<string, { type?: string; description?: string }>;
}

export interface AgentRunnerDecision {
  action?: string;
  answer?: string;
  reason?: string;
  tool_name?: string;
  args?: JsonObject;
  tools?: Array<{ tool_name?: string; name?: string; args?: JsonObject }>;
}

export interface AgentRunnerToolCallRecord {
  step: number;
  tool: string;
  args: JsonObject;
  ok: boolean;
  /** 观察摘要——给 LLM 回灌时只挑短的 */
  observation_summary: string;
}

export interface AgentRunnerResult {
  status: "answered" | "max_iterations" | "timeout" | "error";
  summary: string;
  toolCalls: AgentRunnerToolCallRecord[];
  iterations: number;
  durationMs: number;
  /** answered 时的原始 answer（不一定 == summary，但通常一致） */
  rawAnswer?: string;
  /** 出错时的最后一条错误信息 */
  lastError?: string;
}

/**
 * workspaceGuard —— workspace 隔离选项（Phase 8）。
 *
 * 若配置了 allowedWorkspaceRoot，runAgent 在每次 callTool 之前会检查
 * args 中所有路径字段（path / file / workspace / dir / root / src / dest / target）
 * 是否都在 allowedWorkspaceRoot 内，越界调用直接拒绝，不发起实际工具调用。
 *
 * 这是一条防御性边界，补充（而非替代）工具层自身的权限校验。
 * 当 args 中无路径字段时，视为安全，照常调用。
 */
export interface WorkspaceGuardOptions {
  /** 允许的 workspace 根目录绝对路径，例如 "/home/user/myproject" */
  allowedWorkspaceRoot: string;
  /** 额外允许的目录列表（如 tmpdir），默认为空 */
  extraAllowedRoots?: string[];
}

export interface AgentRunnerOptions {
  systemPrompt: string;
  userMessage: string;
  tools: AgentRunnerToolView[];
  /**
   * 决策函数：吃 conversation，返回下一步决策。
   * 通常实现 = 调 LLM；测试时可 mock。单步超时由实现自管。
   */
  decide: (conversation: Array<{ role: string; content: string }>) => Promise<AgentRunnerDecision>;
  /**
   * 工具调用函数：吃 toolName + args，返回 observation。
   * runner 会校验 toolName ∈ tools 列表，未授权直接拒。
   */
  callTool: (toolName: string, args: JsonObject) => Promise<unknown>;
  maxIterations?: number;
  totalTimeoutMs?: number;
  /**
   * Phase 8 workspace 隔离选项。
   * 配置后，每次工具调用前会检查 args 中的路径参数是否在允许的根目录内。
   * 越界调用返回 { ok: false, error: "workspace_boundary_violation" }，不执行实际调用。
   */
  workspaceGuard?: WorkspaceGuardOptions;
}

const DEFAULT_MAX_ITERATIONS = 5;
const DEFAULT_TOTAL_TIMEOUT_MS = 60_000;
const OBSERVATION_PREVIEW_CHARS = 400;

/** workspace 边界校验路径参数名（大小写均识别） */
const PATH_ARG_KEYS = new Set([
  "path", "file", "workspace", "dir", "root", "src", "dest", "target",
  "filepath", "file_path", "workspacepath", "workspace_path", "directory",
  "source", "output", "outputpath", "output_path"
]);

/**
 * checkWorkspaceBoundary() —— 检查工具 args 中所有路径字段是否在允许的根目录内。
 *
 * 返回 null 表示通过；返回字符串表示违规描述。
 * 只检查字符串类型且以 / 开头（绝对路径）的值，相对路径不检查（交由工具层处理）。
 */
function checkWorkspaceBoundary(
  args: JsonObject,
  guard: WorkspaceGuardOptions
): string | null {
  const allowed = [
    path.resolve(guard.allowedWorkspaceRoot),
    ...(guard.extraAllowedRoots ?? []).map((r) => path.resolve(r))
  ];
  for (const [key, value] of Object.entries(args)) {
    if (typeof value !== "string" || !value.startsWith("/")) continue;
    if (!PATH_ARG_KEYS.has(key.toLowerCase())) continue;
    const resolved = path.resolve(value);
    const inBounds = allowed.some((root) => resolved === root || resolved.startsWith(root + path.sep));
    if (!inBounds) {
      return `工具参数 ${key}="${value}" 越出 workspace 边界（允许: ${allowed.join(", ")}）`;
    }
  }
  return null;
}

export async function runAgent(opts: AgentRunnerOptions): Promise<AgentRunnerResult> {
  const maxIterations = opts.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const totalTimeoutMs = opts.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
  const allowedNames = new Set(opts.tools.map((t) => t.name));
  const toolCalls: AgentRunnerToolCallRecord[] = [];
  const conversation = [
    { role: "system", content: opts.systemPrompt },
    { role: "user", content: opts.userMessage }
  ];
  const startedAt = Date.now();
  let lastError: string | null = null;

  for (let step = 0; step < maxIterations; step += 1) {
    if (Date.now() - startedAt > totalTimeoutMs) {
      return finish({
        status: "timeout",
        summary: buildFallbackSummary({ reason: "总时长超时", toolCalls, lastError }),
        toolCalls,
        iterations: step,
        startedAt,
        lastError
      });
    }
    let decision: AgentRunnerDecision;
    try {
      decision = await opts.decide(conversation);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      return finish({
        status: "error",
        summary: buildFallbackSummary({ reason: `决策失败：${lastError}`, toolCalls, lastError }),
        toolCalls,
        iterations: step,
        startedAt,
        lastError
      });
    }
    conversation.push({ role: "assistant", content: JSON.stringify(decision) });

    if (decision.action === "answer") {
      const answer = typeof decision.answer === "string" ? decision.answer : "";
      return finish({
        status: "answered",
        summary: answer || "(子 agent 返回空 answer)",
        rawAnswer: answer,
        toolCalls,
        iterations: step + 1,
        startedAt
      });
    }

    if (decision.action === "tool_call") {
      const calls = normalizeCalls(decision);
      if (!calls.length) {
        lastError = "tool_call 缺少工具名";
        conversation.push({ role: "user", content: `错误：tool_call 必须填 tool_name。请重试或直接 answer。` });
        continue;
      }
      const observations: Array<{ tool: string; args: JsonObject; observation: unknown; ok: boolean }> = [];
      for (const call of calls) {
        if (!allowedNames.has(call.tool_name)) {
          observations.push({
            tool: call.tool_name,
            args: call.args,
            observation: { ok: false, error: "tool_not_allowed", message: `工具 ${call.tool_name} 不在子 agent 白名单内` },
            ok: false
          });
          continue;
        }
        // Phase 8 workspace 边界检查
        if (opts.workspaceGuard) {
          const violation = checkWorkspaceBoundary(call.args, opts.workspaceGuard);
          if (violation) {
            observations.push({
              tool: call.tool_name,
              args: call.args,
              observation: {
                ok: false,
                error: "workspace_boundary_violation",
                message: violation
              },
              ok: false
            });
            continue;
          }
        }
        try {
          const observation = await opts.callTool(call.tool_name, call.args);
          const ok = !isObservationError(observation);
          observations.push({ tool: call.tool_name, args: call.args, observation, ok });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          observations.push({
            tool: call.tool_name,
            args: call.args,
            observation: { ok: false, error: "tool_threw", message },
            ok: false
          });
        }
      }
      for (const ob of observations) {
        toolCalls.push({
          step,
          tool: ob.tool,
          args: ob.args,
          ok: ob.ok,
          observation_summary: summarizeObservation(ob.observation)
        });
      }
      conversation.push({
        role: "user",
        content: JSON.stringify({
          observations: observations.map((ob) => ({
            tool: ob.tool,
            ok: ob.ok,
            observation: truncateObservation(ob.observation)
          })),
          instruction: "基于以上观察继续决策。可以再调工具，或 action=answer 给最终答案。"
        }, null, 2)
      });
      continue;
    }

    // 未识别的 action：让 LLM 重试，但计入步数避免死循环
    lastError = `未识别 action: ${decision.action ?? "(missing)"}`;
    conversation.push({
      role: "user",
      content: `错误：action 必须是 tool_call 或 answer。请重新决策。`
    });
  }

  return finish({
    status: "max_iterations",
    summary: buildFallbackSummary({ reason: `已达步数上限 ${maxIterations}`, toolCalls, lastError }),
    toolCalls,
    iterations: maxIterations,
    startedAt,
    lastError
  });
}

function finish(input: {
  status: AgentRunnerResult["status"];
  summary: string;
  toolCalls: AgentRunnerToolCallRecord[];
  iterations: number;
  startedAt: number;
  rawAnswer?: string;
  lastError?: string | null;
}): AgentRunnerResult {
  return {
    status: input.status,
    summary: input.summary,
    toolCalls: input.toolCalls,
    iterations: input.iterations,
    durationMs: Date.now() - input.startedAt,
    rawAnswer: input.rawAnswer,
    lastError: input.lastError ?? undefined
  };
}

function normalizeCalls(decision: AgentRunnerDecision): Array<{ tool_name: string; args: JsonObject }> {
  const raw = Array.isArray(decision.tools) && decision.tools.length
    ? decision.tools
    : [{ tool_name: decision.tool_name, args: decision.args ?? {} }];
  return raw
    .map((item) => {
      const record = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      const name = typeof record.tool_name === "string" ? record.tool_name
        : typeof record.name === "string" ? record.name
        : null;
      const args = record.args && typeof record.args === "object" && !Array.isArray(record.args)
        ? record.args as JsonObject
        : {};
      return name ? { tool_name: name, args } : null;
    })
    .filter((c): c is { tool_name: string; args: JsonObject } => c !== null);
}

function isObservationError(observation: unknown): boolean {
  if (!observation || typeof observation !== "object") return false;
  const record = observation as { ok?: unknown; isError?: unknown };
  return record.ok === false || record.isError === true;
}

function summarizeObservation(observation: unknown): string {
  if (observation === null || observation === undefined) return "(empty)";
  if (typeof observation === "string") return observation.slice(0, OBSERVATION_PREVIEW_CHARS);
  try {
    const json = JSON.stringify(observation);
    return json.length > OBSERVATION_PREVIEW_CHARS ? `${json.slice(0, OBSERVATION_PREVIEW_CHARS)}…` : json;
  } catch {
    return "(unserializable)";
  }
}

function truncateObservation(observation: unknown): JsonValue {
  if (observation === null || observation === undefined) return null;
  if (typeof observation === "string") {
    return observation.length > OBSERVATION_PREVIEW_CHARS
      ? `${observation.slice(0, OBSERVATION_PREVIEW_CHARS)}…`
      : observation;
  }
  if (typeof observation === "number" || typeof observation === "boolean") return observation;
  try {
    const json = JSON.stringify(observation);
    if (json.length <= OBSERVATION_PREVIEW_CHARS * 2) return JSON.parse(json) as JsonValue;
    return `${json.slice(0, OBSERVATION_PREVIEW_CHARS * 2)}…`;
  } catch {
    return "(unserializable)";
  }
}

function buildFallbackSummary({
  reason,
  toolCalls,
  lastError
}: {
  reason: string;
  toolCalls: AgentRunnerToolCallRecord[];
  lastError: string | null | undefined;
}): string {
  const lines = [`子 agent 未给出最终答案：${reason}`];
  if (toolCalls.length) {
    lines.push(`已执行 ${toolCalls.length} 次工具调用：`);
    for (const c of toolCalls.slice(-3)) {
      lines.push(`  - ${c.tool}（${c.ok ? "成功" : "失败"}）：${c.observation_summary}`);
    }
  } else {
    lines.push("未执行任何工具。");
  }
  if (lastError) lines.push(`最近一次错误：${lastError}`);
  return lines.join("\n");
}

/** 给 spawn_agent 工具用的便利函数：把白名单工具列表渲染成 system prompt 末尾的工具说明段 */
export function renderToolListForPrompt(tools: AgentRunnerToolView[]): string {
  if (!tools.length) return "（无可用工具，只能直接 answer。）";
  return tools.map((t) => {
    const params = Object.entries(t.params_schema ?? {})
      .map(([k, s]) => `${k}(${s?.type ?? "string"})`)
      .join(", ");
    return `- ${t.name}: ${t.description ?? ""}${params ? `；参数: ${params}` : ""}`;
  }).join("\n");
}
