/**
 * MicroCompact — Phase 3 新增
 *
 * 针对单轮 transcript 事件的轻量压缩：
 * 清理 tool_result / tool_call 里的大字段，
 * 只保留摘要/ref，避免大查询结果无限进入后续 prompt。
 *
 * 对标 Claude Code 的 MicroCompact 机制：
 * - 不修改原始 JSONL，而是生成 compacted 视图
 * - 保留 tool call id / tool name / status，丢弃 data 大字段
 * - 可配置单条 result 最大 char 数（default: 800）
 * - 压缩时在 data 里留 __compacted: true 和 ref（原始 event id）
 *
 * 典型场景：
 * - 大查询结果（dealer.sales_query 返回几百行 JSON）
 * - MCP tool 返回长文档
 * - 截图 / base64 内容（直接丢弃）
 */

import type { JsonObject, JsonValue } from "../types/agent-contracts.js";
import type { TranscriptEvent } from "../transcript/transcript-store.js";

export interface MicroCompactOptions {
  /** 单条 tool_result data 最大字符数，超过则压缩（默认 800） */
  maxResultChars: number;
  /** 单条 tool_call arguments 最大字符数（默认 400） */
  maxArgsChars: number;
  /** 是否压缩 tool_call 的 arguments（默认 false，只压缩 tool_result） */
  compactArgs: boolean;
}

const DEFAULT_MICRO_OPTIONS: MicroCompactOptions = {
  maxResultChars: 800,
  maxArgsChars: 400,
  compactArgs: false
};

export interface MicroCompactResult {
  /** 压缩后的事件列表（仅替换 data，其余字段不变） */
  events: TranscriptEvent[];
  /** 被压缩的事件数量 */
  compacted_count: number;
  /** 压缩前总字符数 */
  original_chars: number;
  /** 压缩后总字符数 */
  compacted_chars: number;
  /** 节省字符数 */
  saved_chars: number;
}

export class MicroCompact {
  private readonly options: MicroCompactOptions;

  constructor(options: Partial<MicroCompactOptions> = {}) {
    this.options = { ...DEFAULT_MICRO_OPTIONS, ...options };
  }

  /**
   * compact() — 批量压缩一组 transcript 事件。
   *
   * 只处理 tool_result 和（可选）tool_call 事件，
   * 其余事件原样透传。
   *
   * 性能优化：
   * - 对非压缩目标事件（非 tool_result/tool_call）跳过 JSON.stringify，
   *   改为用数据大小的保守估算（0），减少无效序列化开销。
   * - 仅在 hasCompactTargets 时才完整统计 originalChars（fast-path）。
   */
  compact(events: TranscriptEvent[]): MicroCompactResult {
    // 快速判断：是否有需要压缩的事件（避免无目标时仍全量序列化）
    const hasToolResult = events.some((e) => e.type === "tool_result");
    const hasToolCall = this.options.compactArgs && events.some((e) => e.type === "tool_call");

    if (!hasToolResult && !hasToolCall) {
      // fast-path：无压缩目标，原样返回
      const totalChars = events.reduce((sum, e) => sum + JSON.stringify(e.data).length, 0);
      return {
        events,
        compacted_count: 0,
        original_chars: totalChars,
        compacted_chars: totalChars,
        saved_chars: 0
      };
    }

    let compactedCount = 0;
    let originalChars = 0;
    let compactedChars = 0;

    const resultEvents = events.map((event) => {
      if (event.type === "tool_result") {
        const raw = JSON.stringify(event.data);
        originalChars += raw.length;
        const compacted = this.compactToolResult(event);
        const newRaw = JSON.stringify(compacted.data);
        compactedChars += newRaw.length;
        if (compacted.was_compacted) compactedCount += 1;
        return compacted.event;
      }

      if (event.type === "tool_call" && this.options.compactArgs) {
        const raw = JSON.stringify(event.data);
        originalChars += raw.length;
        const compacted = this.compactToolCall(event);
        const newRaw = JSON.stringify(compacted.data);
        compactedChars += newRaw.length;
        if (compacted.was_compacted) compactedCount += 1;
        return compacted.event;
      }

      // 非目标事件：原样透传，chars 计入统计
      const rawLen = JSON.stringify(event.data).length;
      originalChars += rawLen;
      compactedChars += rawLen;
      return event;
    });

    return {
      events: resultEvents,
      compacted_count: compactedCount,
      original_chars: originalChars,
      compacted_chars: compactedChars,
      saved_chars: Math.max(0, originalChars - compactedChars)
    };
  }

  /**
   * compactOne() — 单条事件压缩，返回是否发生了压缩。
   */
  compactOne(event: TranscriptEvent): { event: TranscriptEvent; was_compacted: boolean } {
    if (event.type === "tool_result") return this.compactToolResult(event);
    if (event.type === "tool_call" && this.options.compactArgs) return this.compactToolCall(event);
    return { event, was_compacted: false };
  }

  private compactToolResult(event: TranscriptEvent): { event: TranscriptEvent; data: JsonObject; was_compacted: boolean } {
    const data = event.data;
    const rawData = JSON.stringify(data);
    if (rawData.length <= this.options.maxResultChars) {
      return { event, data, was_compacted: false };
    }

    // 提取关键元信息
    const toolName = safeStr(data["tool"] ?? data["tool_name"]);
    const ok = data["ok"];
    const status = safeStr(data["status"] ?? (ok === true ? "ok" : ok === false ? "error" : undefined));
    const errorMsg = ok === false ? safeStr(data["error"] ?? data["message"]) : undefined;

    // 提取数据摘要（行数 / 字段 / 预览）
    const dataSummary = summarizeToolData(data["data"] ?? data["result"]);

    const compactedData: JsonObject = {
      __compacted: true,
      __ref: event.id,
      tool: toolName,
      status,
      ...(errorMsg !== undefined ? { error_preview: errorMsg.slice(0, 200) } : {}),
      data_summary: dataSummary,
      original_chars: rawData.length
    };

    const compactedEvent: TranscriptEvent = { ...event, data: compactedData };
    return { event: compactedEvent, data: compactedData, was_compacted: true };
  }

  private compactToolCall(event: TranscriptEvent): { event: TranscriptEvent; data: JsonObject; was_compacted: boolean } {
    const data = event.data;
    const argsRaw = JSON.stringify(data["arguments"] ?? data["args"] ?? {});
    if (argsRaw.length <= this.options.maxArgsChars) {
      return { event, data, was_compacted: false };
    }

    const compactedArgs = `${argsRaw.slice(0, this.options.maxArgsChars - 20)}...(args truncated)`;
    const compactedData: JsonObject = {
      ...data,
      arguments: compactedArgs,
      __args_compacted: true
    };
    return { event: { ...event, data: compactedData }, data: compactedData, was_compacted: true };
  }
}

// ── 内部工具 ──────────────────────────────────────────────────────────────

function safeStr(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function summarizeToolData(value: JsonValue | undefined): JsonObject {
  if (value === null || value === undefined) return { type: "null" };

  if (Array.isArray(value)) {
    const preview = value.slice(0, 3).map((item) => {
      const raw = JSON.stringify(item ?? null);
      return raw.length > 120 ? `${raw.slice(0, 120)}...` : raw;
    });
    return {
      type: "array",
      count: value.length,
      preview
    };
  }

  if (typeof value === "object") {
    const keys = Object.keys(value as object);
    return {
      type: "object",
      keys: keys.slice(0, 20),
      key_count: keys.length
    };
  }

  const str = String(value);
  return {
    type: typeof value,
    preview: str.length > 200 ? `${str.slice(0, 200)}...` : str,
    length: str.length
  };
}
