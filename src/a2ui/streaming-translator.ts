import { buildA2UIResponse, buildSurfaceEnvelopes, type ClientCapabilities } from "./adapter.js";
import { A2UIIncrementalEnvelopeParser, type IngestResult, type SurfaceSnapshot } from "./incremental-envelope-parser.js";
import { businessSurface } from "./openui-bridge.js";
import { A2UI_VERSION, type A2UIComponentInstance, type A2UIEnvelope } from "./types.js";
import type { JsonObject, JsonValue } from "../types/agent-contracts.js";

export interface StreamingEmitContext {
  surfacePrefix?: string;
  runId?: string;
  clientCapabilities?: ClientCapabilities;
}

export type StreamingEnvelopeListener = (envelope: A2UIEnvelope, snapshot: SurfaceSnapshot[]) => void | Promise<void>;

interface ProgressSurfaceState {
  surfaceId: string;
  toolName: string;
  step: number;
}

/**
 * 流式翻译器：把 agentic_event 实时转成 a2UI envelope，喂给同一个 stateful parser，
 * 让前端可以在工具尚未返回时就先看到 skeleton，工具返回时看到数据填充。
 *
 * 注意：当前 agentic-handler 的 tool_call 事件已带 observation_summary（事后），
 * 因此 skeleton 与 data 在时间上贴近；真正能拉开 skeleton 时长的是 `decided` 事件。
 */
export class A2UIStreamingTranslator {
  private readonly progressSurfaces = new Map<string, ProgressSurfaceState>();
  private readonly progressKey: string;
  private finalized = false;

  constructor(
    private readonly parser: A2UIIncrementalEnvelopeParser,
    private readonly listener: StreamingEnvelopeListener,
    private readonly ctx: StreamingEmitContext = {}
  ) {
    const prefix = ctx.surfacePrefix ?? "agent";
    const runId = ctx.runId ?? `run_${Date.now()}`;
    this.progressKey = `${prefix}_${runId}_progress`;
  }

  async onAgenticEvent(event: Record<string, unknown>): Promise<void> {
    const kind = String(event.kind ?? "");
    if (kind === "agentic_lifecycle") {
      const eventName = String(event.event ?? "");
      if (eventName === "start") {
        await this.emitProgress({
          step: 0,
          title: "正在理解问题",
          detail: "Agent 正在分析这次请求需要哪些信息。",
          tone: "info"
        });
      } else if (eventName === "decided") {
        const planner = toRecord(event.planner_state);
        const action = String(event.action ?? "");
        if (action === "tool_call") {
          const lastTool = String(planner?.last_tool ?? "工具");
          await this.emitProgress({
            step: Number(event.step ?? 0),
            title: `准备调用 ${lastTool}`,
            detail: "正在准备工具入参，马上发起调用。",
            tone: "running",
            toolName: lastTool
          });
        } else if (action === "answer") {
          await this.emitProgress({
            step: Number(event.step ?? 0),
            title: "正在整理答案",
            detail: "已经收集到必要信息，正在生成最终回答。",
            tone: "running"
          });
        }
      } else if (eventName === "answered") {
        await this.emitProgress({
          step: Number(event.step ?? 0),
          title: "已生成答案",
          detail: "答案已经生成，下面是处理摘要。",
          tone: "done"
        });
      } else if (eventName === "step_failed" || eventName === "fallback" || eventName === "total_timeout") {
        await this.emitProgress({
          step: Number(event.step ?? 0),
          title: "处理中遇到问题",
          detail: String(event.error ?? event.reason ?? "切换到兜底路径继续处理。"),
          tone: "warn"
        });
      }
    } else if (kind === "agentic_tool" && event.type === "tool_call") {
      const toolName = String(event.tool ?? "");
      await this.emitProgress({
        step: Number(event.step ?? 0),
        title: `${toolName || "工具"} 已返回`,
        detail: summarizeObservation(event.observation_summary),
        tone: "done",
        toolName
      });
    }
  }

  /**
   * 末端 finalize：把 buildA2UIResponse 产的全量 envelope 喂进同一个 parser，
   * 并把 progress surface 在 finalize 时删掉（业务卡片已经替代它的角色）。
   */
  async finalize(result: unknown): Promise<A2UIEnvelope[]> {
    if (this.finalized) return this.parser.snapshot().map(snapshotToCreateEnvelope);
    this.finalized = true;

    const final = buildA2UIResponse({ result, surfacePrefix: this.ctx.surfacePrefix, clientCapabilities: this.ctx.clientCapabilities });
    const ingest = this.parser.ingest(final);
    for (const envelope of ingest.accepted) {
      await this.listener(envelope, ingest.snapshot);
    }

    const deletions: A2UIEnvelope[] = [];
    for (const state of this.progressSurfaces.values()) {
      const env: A2UIEnvelope = { version: A2UI_VERSION, deleteSurface: { surfaceId: state.surfaceId } };
      deletions.push(env);
    }
    if (deletions.length) {
      const delIngest = this.parser.ingest(deletions);
      for (const envelope of delIngest.accepted) await this.listener(envelope, delIngest.snapshot);
    }
    this.progressSurfaces.clear();
    return final;
  }

  snapshot(): SurfaceSnapshot[] {
    return this.parser.snapshot();
  }

  private async emitProgress(input: { step: number; title: string; detail: string; tone: ProgressTone; toolName?: string }): Promise<void> {
    if (this.finalized) return;
    const surfaceId = this.progressKey;
    const data: JsonObject = {
      _skeleton: input.tone === "running" || input.tone === "info",
      tone: input.tone,
      step: input.step,
      title: input.title,
      detail: input.detail,
      tool_name: input.toolName ?? null,
      ...businessSurface("agent_progress", input.title, {
        tone: input.tone,
        step: input.step,
        title: input.title,
        detail: input.detail,
        tool_name: input.toolName ?? null
      })
    };
    const components = progressComponents({ title: input.title, detail: input.detail, tone: input.tone });
    const envelopes = this.progressSurfaces.has(surfaceId)
      ? [
          envelopeUpdateData(surfaceId, data),
          envelopeUpdateComponents(surfaceId, components)
        ]
      : buildSurfaceEnvelopes({ surfaceId, root: "progress_root", data, components });

    if (!this.progressSurfaces.has(surfaceId)) {
      this.progressSurfaces.set(surfaceId, { surfaceId, toolName: input.toolName ?? "", step: input.step });
    } else {
      const cur = this.progressSurfaces.get(surfaceId)!;
      cur.step = input.step;
      if (input.toolName) cur.toolName = input.toolName;
    }

    const ingest: IngestResult = this.parser.ingest(envelopes);
    for (const envelope of ingest.accepted) {
      await this.listener(envelope, ingest.snapshot);
    }
  }
}

type ProgressTone = "info" | "running" | "done" | "warn";

function progressComponents(input: { title: string; detail: string; tone: ProgressTone }): A2UIComponentInstance[] {
  const toneEmoji = input.tone === "warn" ? "⚠️" : input.tone === "done" ? "✓" : input.tone === "running" ? "…" : "•";
  return [
    { id: "progress_root", component: { Card: { children: ["progress_text"] } } },
    {
      id: "progress_text",
      component: {
        Text: {
          text: { literalString: `**${toneEmoji} ${input.title}**\n\n${input.detail}` }
        }
      }
    }
  ];
}

function envelopeUpdateData(surfaceId: string, value: JsonValue): A2UIEnvelope {
  return { version: A2UI_VERSION, updateDataModel: { surfaceId, value } };
}

function envelopeUpdateComponents(surfaceId: string, components: A2UIComponentInstance[]): A2UIEnvelope {
  return { version: A2UI_VERSION, updateComponents: { surfaceId, components } };
}

function snapshotToCreateEnvelope(snapshot: SurfaceSnapshot): A2UIEnvelope {
  return {
    version: A2UI_VERSION,
    createSurface: {
      surfaceId: snapshot.surfaceId,
      root: snapshot.root,
      catalogId: snapshot.catalogId,
      sendDataModel: true
    }
  };
}

function summarizeObservation(value: unknown): string {
  if (!value) return "工具返回完成。";
  if (typeof value === "string") return value.slice(0, 200);
  try {
    return JSON.stringify(value).slice(0, 200);
  } catch {
    return "工具返回完成。";
  }
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
