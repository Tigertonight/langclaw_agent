import type { JsonObject, JsonValue, ToolResult, UserContext } from "../types/agent-contracts.js";
import {
  readableToolNameFromRegistry,
  summarizeToolResultFromRegistry,
  sanitizeToolObservationFromRegistry,
} from "../domains/runtime-registry.js";

export interface AgentStep {
  phase: string;
  title: string;
  detail: string;
  status: string;
  at: string;
  [key: string]: JsonValue | JsonObject | undefined;
}

/**
 * 强类型事件 schema，灵感来自 OpenClaw `AgentEventStream` + `AgentItemEventData`。
 *
 * 业务流（onBlockReply）/ Debug 流（agent_steps）/ 时间流（lifecycle）原本各发各的事件，
 * 容易漂移。通过统一的 item 抽象，让一次"工具调用 / 命令执行 / 检索操作"在三个视角下
 * 共享同一个 itemId 与生命周期，业务流读 summary、Debug 读全字段、时间流看 phase 排序。
 *
 * 这是新增能力，不替换 AgentStep / lifecycle/assistant/tool 三个原始 array。
 */
export type AgentEventStream =
  | "lifecycle"
  | "assistant"
  | "tool"
  | "thinking"
  | "error"
  | "approval";

export type AgentEventPhase = "start" | "update" | "end";

export type AgentItemKind = "tool" | "command" | "search" | "analysis" | "patch" | "skill";

export type AgentItemStatus = "running" | "completed" | "failed" | "blocked";

export interface AgentItemEvent {
  itemId: string;
  stream: AgentEventStream;
  phase: AgentEventPhase;
  kind: AgentItemKind;
  status: AgentItemStatus;
  title: string;
  summary?: string;
  meta?: JsonObject;
  toolCallId?: string;
  /** 相对会话开始的毫秒数，与 lifecycle/assistant/tool 三个 array 的 ts 对齐 */
  ts?: number;
  startedAt?: string;
  endedAt?: string;
  error?: { code: string; message: string };
}

let __itemIdSeq = 0;
export function nextAgentItemId(prefix = "item"): string {
  __itemIdSeq += 1;
  return `${prefix}_${Date.now().toString(36)}_${__itemIdSeq.toString(36)}`;
}

/**
 * 构造 phase=start 的 item 事件。配合 pushTool/pushLifecycle 等推送使用。
 * 调用方拿到 itemId 后，自己保存，等到 end 阶段再用同一个 itemId 发 end 事件。
 */
export function buildItemStartEvent(input: {
  itemId: string;
  stream: AgentEventStream;
  kind: AgentItemKind;
  title: string;
  summary?: string;
  meta?: JsonObject;
  toolCallId?: string;
  ts: number;
}): AgentItemEvent {
  const { itemId, stream, kind, title, summary, meta, toolCallId, ts } = input;
  return {
    itemId,
    stream,
    phase: "start",
    kind,
    status: "running",
    title,
    summary: summary ?? `${title} 开始`,
    meta,
    toolCallId,
    ts,
    startedAt: new Date().toISOString()
  };
}

/**
 * 构造 phase=end 的 item 事件。失败可通过 status: "failed" + error 字段表达。
 */
export function buildItemEndEvent(input: {
  itemId: string;
  stream: AgentEventStream;
  kind: AgentItemKind;
  status: AgentItemStatus;
  title: string;
  summary?: string;
  meta?: JsonObject;
  toolCallId?: string;
  ts: number;
  error?: { code: string; message: string };
}): AgentItemEvent {
  const { itemId, stream, kind, status, title, summary, meta, toolCallId, ts, error } = input;
  return {
    itemId,
    stream,
    phase: "end",
    kind,
    status,
    title,
    summary: summary ?? `${title} 结束`,
    meta,
    toolCallId,
    ts,
    endedAt: new Date().toISOString(),
    error
  };
}

/**
 * 把一次工具调用浓缩成一组 item 事件（start + end）。
 * 调用方拿到这两个事件后可以直接 push 给 onEmit，也可以拆开做更细的 update。
 */
export function buildToolItemEvents(input: {
  itemId: string;
  toolName: string;
  args?: JsonObject;
  ts: number;
  result?: ToolResult;
  toolCallId?: string;
}): { start: AgentItemEvent; end: AgentItemEvent } {
  const { itemId, toolName, args, ts, result, toolCallId } = input;
  const start: AgentItemEvent = {
    itemId,
    stream: "tool",
    phase: "start",
    kind: "tool",
    status: "running",
    title: toolName,
    summary: `开始调用 ${toolName}`,
    meta: args ? { args } : undefined,
    toolCallId,
    ts,
    startedAt: new Date().toISOString()
  };
  const failed = !!result && (result.ok === false || result.isError === true);
  const end: AgentItemEvent = {
    itemId,
    stream: "tool",
    phase: "end",
    kind: "tool",
    status: failed ? "failed" : "completed",
    title: toolName,
    summary: result ? summarizeToolResultText(result) : "工具调用结束",
    meta: result ? { result_ok: result.ok ?? !failed, code: result.code } : undefined,
    toolCallId,
    ts,
    endedAt: new Date().toISOString(),
    error: failed
      ? { code: String(result?.code ?? result?.error ?? "execution_failed"), message: String(result?.message ?? "") }
      : undefined
  };
  return { start, end };
}

function summarizeToolResultText(result: ToolResult): string {
  if (result.ok === false || result.isError === true) {
    return `失败：${result.message ?? result.error ?? "未知错误"}`;
  }
  const summarized = summarizeToolResultFromRegistry(result);
  return summarized ?? "调用完成";
}

export function createSources(docs: Array<{ id: string; score: number; text?: string; metadata: { source: string; title: string; heading: string } }>): Array<{ id: string; source: string; title: string; heading: string; score: number; quote: string }> {
  return docs.map((doc) => ({
    id: doc.id,
    source: doc.metadata.source,
    title: doc.metadata.title,
    heading: doc.metadata.heading,
    score: doc.score,
    quote: String(doc.text ?? "").replace(/\s+/g, " ").trim().slice(0, 180)
  }));
}

export function createAgentStep(phase: string, title: string, detail: string, extra: JsonObject = {}): AgentStep {
  return {
    phase,
    title,
    detail,
    status: "completed",
    at: new Date().toISOString(),
    ...extra
  };
}

export function createIdentifyUserStep(user: UserContext): AgentStep {
  return createAgentStep(
    "identify_user",
    "确认员工身份",
    `当前以 ${user.name}（${user.department} / ${user.role}）的身份处理请求。`
  );
}

export function createToolSteps(toolPlan: { calls?: Array<{ name: string; args?: JsonObject }> }, toolResults: ToolResult[]): AgentStep[] {
  const calls = toolPlan.calls ?? [];
  return calls.map((call, index) => {
    const result = toolResults[index];
    if (!result) {
      return createAgentStep("execute_tool", "执行工具", `已请求调用 ${readableToolName(call.name)}，但没有获得返回结果。`, {
        action: { type: "tool_call", tool: call.name, args: call.args },
        status: "failed"
      });
    }

    if (!result.ok) {
      return createAgentStep("execute_tool", "执行工具", `${readableToolName(call.name)} 未完成：${result.message || result.error || "未知错误"}。`, {
        action: { type: "tool_call", tool: call.name, args: call.args },
        observation: sanitizeObservation(result),
        status: "failed"
      });
    }

    return createAgentStep("execute_tool", "执行工具", `${readableToolName(call.name)} 已完成，${summarizeToolResult(result)}。`, {
      action: { type: "tool_call", tool: call.name, args: call.args },
      observation: sanitizeObservation(result)
    });
  });
}

export function splitForStreaming(text: unknown): string[] {
  return String(text ?? "").match(/.{1,4}/gs) ?? [];
}

function readableToolName(name: string): string {
  return readableToolNameFromRegistry(name, name);
}

function summarizeToolResult(result: ToolResult): string {
  // 域贡献的 tool-specific summarizer 优先
  const fromRegistry = summarizeToolResultFromRegistry(result);
  if (fromRegistry) return fromRegistry;

  // 通用 fallback：工具结果中包含列表字段时做计数摘要
  if (result.data && typeof result.data === "object") {
    const listKey = Object.keys(result.data).find((k) => Array.isArray((result.data as Record<string, unknown>)[k]));
    if (listKey) {
      const list = (result.data as Record<string, unknown[]>)[listKey];
      const toolLabel = readableToolNameFromRegistry(result.tool);
      return `返回 ${list.length} 条${toolLabel !== result.tool ? toolLabel : "记录"}`;
    }
    // 单条数据结果
    const name = (result.data as Record<string, unknown>).name ?? (result.data as Record<string, unknown>).id;
    if (name) {
      const toolLabel = readableToolNameFromRegistry(result.tool);
      return `找到${toolLabel !== result.tool ? toolLabel : "记录"}「${name}」`;
    }
  }
  // 通用工具标签
  const toolLabel = readableToolNameFromRegistry(result.tool);
  if (toolLabel !== result.tool) return `${toolLabel}已返回结果`;
  return "已获得工具返回结果";
}

function sanitizeObservation(result: ToolResult | undefined): JsonObject {
  if (!result?.ok) {
    return {
      ok: false,
      error: result?.error,
      code: result?.code,
      message: result?.message
    };
  }
  // 域贡献的 tool-specific sanitizer 优先
  const fromRegistry = sanitizeToolObservationFromRegistry(result);
  if (fromRegistry) return fromRegistry;
  return {
    ok: true,
    tool: result.tool
  };
}
