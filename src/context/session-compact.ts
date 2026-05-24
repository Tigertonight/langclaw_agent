/**
 * SessionCompact — Phase 3 新增
 *
 * 将一段 transcript window 压缩为 session summary，
 * 避免长期运行后对话历史无限膨胀，对标 Claude Code Session Memory 压缩机制。
 *
 * 三个压缩层次：
 *
 * 1. MicroCompact（轻量）：清理 tool_result 大字段，不生成摘要。
 * 2. SessionCompact（中量）：transcript window → session_summary 文本，
 *    写入 workspace/compacts/{sessionId}_{timestamp}.json。
 * 3. MemoryCompact（重量）：episodes + memory items 去重合并，
 *    超限后丢弃低 confidence 旧条目。
 *
 * 本文件实现 SessionCompact：
 * - 读取 transcript recent N 条事件
 * - 提取 user_message / assistant_answer / route_decision / task 等关键事件
 * - 构建结构化摘要（不依赖 LLM，纯 rule-based）
 * - 写入 compacts/ 目录
 * - 通过 CompactBoundary 写入 transcript 标记边界
 *
 * 注：LLM 摘要是未来增强方向（MemoryLearner.apply() 可接收 episode 类型的记忆）。
 * 当前实现为 rule-based，保证在无 LLM 调用情况下也能正常工作。
 */

import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { safeJoinWorkspace, type WorkspaceContext } from "../runtime/workspace-context.js";
import type { JsonObject } from "../types/agent-contracts.js";
import type { TranscriptEvent, TranscriptStore } from "../transcript/transcript-store.js";
import { MicroCompact } from "./micro-compact.js";
import { CompactBoundary } from "./compact-boundary.js";

export interface SessionCompactOptions {
  /** 触发 compact 的最小事件数（默认 60） */
  triggerEventCount: number;
  /** 压缩时最多取最近 N 条事件（默认 120） */
  windowSize: number;
  /** compact 后在 summary 里保留最近 N 轮问答（默认 5） */
  keepRecentTurns: number;
  /** compact 后在 summary 里保留最多 N 个 task 摘要（默认 8） */
  keepTaskSnapshots: number;
}

const DEFAULT_SESSION_OPTIONS: SessionCompactOptions = {
  triggerEventCount: 60,
  windowSize: 120,
  keepRecentTurns: 5,
  keepTaskSnapshots: 8
};

export interface SessionSummary extends JsonObject {
  session_id: string;
  compacted_at: string;
  covered_event_count: number;
  turns: JsonObject[];
  route_decisions: JsonObject[];
  task_snapshots: JsonObject[];
  tool_calls_summary: JsonObject[];
  errors: JsonObject[];
  user_intent_keywords: string[];
}

export interface SessionCompactResult {
  session_id: string;
  summary: SessionSummary;
  summary_path: string;
  micro_compact_stats: { compacted_count: number; saved_chars: number };
  original_event_count: number;
}

export class SessionCompact {
  private readonly transcriptStore: TranscriptStore;
  private readonly microCompact: MicroCompact;
  private readonly compactBoundary: CompactBoundary;
  private readonly options: SessionCompactOptions;

  constructor({
    transcriptStore,
    microCompact = new MicroCompact(),
    options = {}
  }: {
    transcriptStore: TranscriptStore;
    microCompact?: MicroCompact;
    options?: Partial<SessionCompactOptions>;
  }) {
    this.transcriptStore = transcriptStore;
    this.microCompact = microCompact;
    this.compactBoundary = new CompactBoundary(transcriptStore);
    this.options = { ...DEFAULT_SESSION_OPTIONS, ...options };
  }

  /**
   * shouldCompact() — 检查当前 session 是否需要 compact。
   *
   * 基于规则：recent 事件数超过 triggerEventCount 时触发。
   */
  async shouldCompact(workspace: WorkspaceContext, sessionId: string): Promise<boolean> {
    const events = await this.transcriptStore.recent(workspace, sessionId, this.options.windowSize);
    // 若已有 compact_boundary 且后续新增事件少于 triggerEventCount，不再触发
    const lastBoundaryIndex = findLastBoundaryIndex(events);
    const newEventCount = lastBoundaryIndex >= 0 ? events.length - lastBoundaryIndex - 1 : events.length;
    return newEventCount >= this.options.triggerEventCount;
  }

  /**
   * compact() — 执行 session compaction。
   *
   * 1. 读取 transcript 最近 windowSize 条事件
   * 2. MicroCompact 压缩大 tool result
   * 3. 构建结构化 session summary
   * 4. 写入 compacts/ 目录
   * 5. 通过 CompactBoundary 写入 transcript 标记边界
   */
  async compact(workspace: WorkspaceContext, sessionId: string): Promise<SessionCompactResult> {
    const events = await this.transcriptStore.recent(workspace, sessionId, this.options.windowSize);

    // Step 1: MicroCompact
    const microResult = this.microCompact.compact(events);
    const compactedEvents = microResult.events;

    // Step 2: 构建 session summary
    const summary = buildSessionSummary(sessionId, compactedEvents, this.options);

    // Step 3: 写入 compacts/ 目录
    const compactsDir = safeJoinWorkspace(workspace.root, "compacts");
    await mkdir(compactsDir, { recursive: true });
    const ts = Date.now();
    const summaryFileName = `${sessionId.replace(/[^A-Za-z0-9_.-]/g, "_")}_${ts}.json`;
    const summaryPath = path.join(compactsDir, summaryFileName);
    await writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");

    // Step 4: 写入 compact_boundary
    const originalChars = events.reduce((sum, e) => sum + JSON.stringify(e).length, 0);
    const compactedChars = compactedEvents.reduce((sum, e) => sum + JSON.stringify(e).length, 0);
    await this.compactBoundary.write(workspace, sessionId, {
      compact_type: "session",
      session_id: sessionId,
      covered_event_count: events.length,
      original_chars: originalChars,
      compacted_chars: compactedChars,
      saved_chars: Math.max(0, originalChars - compactedChars),
      summary_ref: summaryPath,
      reason: `session_compact: ${events.length} events → summary`
    });

    return {
      session_id: sessionId,
      summary,
      summary_path: summaryPath,
      micro_compact_stats: {
        compacted_count: microResult.compacted_count,
        saved_chars: microResult.saved_chars
      },
      original_event_count: events.length
    };
  }

  /**
   * loadLatestSummary() — 加载该 session 最近的 compact summary。
   *
   * ContextAssembler 可将 summary 注入 conversation 分区，
   * 替代完整 transcript 重放。
   */
  async loadLatestSummary(workspace: WorkspaceContext, sessionId: string): Promise<SessionSummary | null> {
    const compactsDir = safeJoinWorkspace(workspace.root, "compacts");
    if (!existsSync(compactsDir)) return null;
    const safeId = sessionId.replace(/[^A-Za-z0-9_.-]/g, "_");
    const fs = await import("node:fs/promises");
    let entries: string[] = [];
    try {
      const dirEntries = await fs.readdir(compactsDir);
      entries = dirEntries
        .filter((name) => name.startsWith(safeId) && name.endsWith(".json"))
        .sort()
        .reverse();
    } catch {
      return null;
    }
    if (!entries.length) return null;
    try {
      const content = await fs.readFile(path.join(compactsDir, entries[0]), "utf8");
      return JSON.parse(content) as SessionSummary;
    } catch {
      return null;
    }
  }
}

// ── 内部函数 ──────────────────────────────────────────────────────────────

function buildSessionSummary(
  sessionId: string,
  events: TranscriptEvent[],
  options: SessionCompactOptions
): SessionSummary {
  const turns: JsonObject[] = [];
  const routeDecisions: JsonObject[] = [];
  const taskSnapshots: JsonObject[] = [];
  const toolCallsSummary: JsonObject[] = [];
  const errors: JsonObject[] = [];
  const userKeywords = new Set<string>();

  let currentTurn: { user_message?: string; assistant_answer?: string; at?: string } | null = null;

  for (const event of events) {
    switch (event.type) {
      case "turn_start":
        currentTurn = { at: event.at };
        break;

      case "user_message": {
        const text = safeStr(event.data["text"] ?? event.data["message"]);
        if (currentTurn) currentTurn.user_message = text.slice(0, 300);
        extractKeywords(text).forEach((kw) => userKeywords.add(kw));
        break;
      }

      case "assistant_answer": {
        const text = safeStr(event.data["text"] ?? event.data["answer"]);
        if (currentTurn) currentTurn.assistant_answer = text.slice(0, 600);
        break;
      }

      case "turn_end":
        if (currentTurn?.user_message) {
          turns.push({ ...currentTurn });
        }
        currentTurn = null;
        break;

      case "route_decision":
        routeDecisions.push({
          at: event.at,
          route: event.data["route"] ?? event.data["route_key"],
          confidence: event.data["confidence"]
        });
        break;

      case "task_claimed":
      case "task_updated":
        taskSnapshots.push({
          at: event.at,
          type: event.type,
          task_id: event.data["task_id"] ?? event.data["id"],
          subject: event.data["subject"] ?? event.data["title"],
          status: event.data["status"]
        });
        break;

      case "tool_call":
        toolCallsSummary.push({
          at: event.at,
          tool: event.data["tool"] ?? event.data["tool_name"],
          status: "called"
        });
        break;

      case "tool_result":
        if (toolCallsSummary.length > 0) {
          const last = toolCallsSummary[toolCallsSummary.length - 1];
          last["status"] = event.data["ok"] === false ? "error" : "ok";
        }
        break;

      case "error":
      case "interruption":
        errors.push({
          at: event.at,
          type: event.type,
          message: safeStr(event.data["message"] ?? event.data["error"]).slice(0, 200)
        });
        break;

      default:
        break;
    }
  }

  // 若 turn 未 close 就结束了（最后一轮可能没有 turn_end）
  if (currentTurn?.user_message) {
    turns.push({ ...currentTurn });
  }

  return {
    session_id: sessionId,
    compacted_at: new Date().toISOString(),
    covered_event_count: events.length,
    turns: turns.slice(-options.keepRecentTurns),
    route_decisions: routeDecisions.slice(-20),
    task_snapshots: taskSnapshots.slice(-options.keepTaskSnapshots),
    tool_calls_summary: toolCallsSummary.slice(-30),
    errors: errors.slice(-10),
    user_intent_keywords: Array.from(userKeywords).slice(0, 40)
  };
}

function findLastBoundaryIndex(events: TranscriptEvent[]): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].data?.["__compact_boundary"] === true) return index;
  }
  return -1;
}

function safeStr(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_\u4e00-\u9fa5]+/u)
    .filter((token) => token.length >= 2)
    .slice(0, 20);
}
