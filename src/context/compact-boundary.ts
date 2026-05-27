/**
 * CompactBoundary — Phase 3 新增
 *
 * 压缩边界标记：在 transcript 里写入 compact_boundary 事件，
 * 记录"在哪个 session 的哪个位置发生了 compaction"。
 *
 * 边界记录内容：
 * - compact_type: "micro" | "session" | "memory"
 * - session_id
 * - at: ISO8601 时间戳
 * - covered_event_count: 本次压缩覆盖的事件数量
 * - original_chars / compacted_chars / saved_chars
 * - summary_ref: 若为 session compaction，指向生成的摘要文件路径
 *
 * 边界事件写入 transcript 后，QueryEngine / ContextAssembler
 * 可从最新的 compact_boundary 开始重建上下文，不再回溯更早的事件。
 */

import type { JsonObject } from "../types/agent-contracts.js";
import type { TranscriptStore } from "../transcript/transcript-store.js";
import type { WorkspaceContext } from "../runtime/workspace-context.js";

export type CompactType = "micro" | "session" | "memory";

export interface CompactBoundaryEvent extends JsonObject {
  compact_type: CompactType;
  session_id: string;
  covered_event_count: number;
  original_chars: number;
  compacted_chars: number;
  saved_chars: number;
  summary_ref?: string;
  reason?: string;
}

export class CompactBoundary {
  private readonly transcriptStore: TranscriptStore;

  constructor(transcriptStore: TranscriptStore) {
    this.transcriptStore = transcriptStore;
  }

  /**
   * write() — 写入一个 compact_boundary transcript 事件。
   *
   * 调用方：
   * - MicroCompact 完成后（compact_type: "micro"）
   * - SessionCompact 完成后（compact_type: "session"）
   * - MemoryLearner compact 完成后（compact_type: "memory"）
   */
  async write(
    workspace: WorkspaceContext,
    sessionId: string,
    info: CompactBoundaryEvent
  ): Promise<void> {
    await this.transcriptStore.append(
      workspace,
      sessionId,
      // TranscriptStore 目前没有 compact_boundary 事件类型，
      // 用 "agent_step" 承载，data 里加 __compact_boundary: true 标记
      "agent_step",
      {
        __compact_boundary: true,
        ...info
      }
    ).catch((error: unknown) => {
      console.warn(`[compact-boundary] write failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  /**
   * findLatest() — 从 transcript 最近 N 条事件里找最后一个 compact_boundary。
   *
   * QueryEngine 可用此方法确定"从哪个 event 开始重建上下文"。
   * 返回 null 表示没有找到边界（应全量重建）。
   */
  findLatest(events: JsonObject[]): CompactBoundaryEvent | null {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      const data = event["data"] as JsonObject | undefined;
      if (data?.["__compact_boundary"] === true) {
        return data as CompactBoundaryEvent;
      }
    }
    return null;
  }
}
