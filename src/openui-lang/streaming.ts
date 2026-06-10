import { businessSurface } from "./compat.js";
import { OpenUILangEnvelopeDispatcher, OpenUILangSurfaceManager } from "./core.js";
import { buildOpenUILangLegacyEnvelopes } from "./response.js";
import { legacyEnvelopeToOpenUILangEvent, legacyEnvelopesToOpenUILangDocument } from "./legacy-adapter.js";
import { OPENUI_LANG_BASIC_CATALOG, type OpenUILangCompatComponent, type OpenUILangCompatEnvelope, type OpenUILangDocument, type OpenUILangWireEvent } from "./types.js";
import type { JsonObject, JsonValue } from "../types/agent-contracts.js";

const COMPAT_VERSION = "v0.9";
const COMPAT_BASIC_CATALOG_ID = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json";
const BASIC_COMPONENTS = new Set(["Text", "Image", "Icon", "Video", "AudioPlayer", "Row", "Column", "List", "Card", "Tabs", "Button"]);

export interface OpenUILangStreamingSurfaceSnapshot {
  surfaceId: string;
  root: string;
  catalogId?: string;
  data: JsonObject;
  components: OpenUILangCompatComponent[];
}

export interface OpenUILangRejectedEnvelope {
  envelope: unknown;
  reason: string;
  path?: string;
}

export interface OpenUILangIngestResult {
  accepted: OpenUILangCompatEnvelope[];
  rejected: OpenUILangRejectedEnvelope[];
  snapshot: OpenUILangStreamingSurfaceSnapshot[];
  acceptedOpenUIEvents: OpenUILangWireEvent[];
  document: OpenUILangDocument;
}

export interface OpenUILangStreamingEmitContext {
  surfacePrefix?: string;
  runId?: string;
  clientCapabilities?: { catalog_version?: string; supported_components?: string[] };
  includeRuntime?: boolean;
}

export type OpenUILangStreamingListener = (
  event: OpenUILangWireEvent,
  document: OpenUILangDocument,
  compatibilityEnvelope: OpenUILangCompatEnvelope
) => void | Promise<void>;

export class OpenUILangValidationError extends Error {
  code = "OPENUI_LANG_VALIDATION_FAILED";

  constructor(message: string, readonly path: string) {
    super(message);
  }
}

export class OpenUILangIncrementalEnvelopeParser {
  private readonly surfaceManager = new OpenUILangSurfaceManager();
  private readonly dispatcher = new OpenUILangEnvelopeDispatcher(this.surfaceManager);
  private readonly acceptedEnvelopes: OpenUILangCompatEnvelope[] = [];

  ingest(input: unknown): OpenUILangIngestResult {
    const raw = Array.isArray(input) ? input : parseJsonLines(String(input ?? ""));
    const accepted: OpenUILangCompatEnvelope[] = [];
    const rejected: OpenUILangRejectedEnvelope[] = [];

    for (const item of raw) {
      const fixed = safeCall(() => fixEnvelope(item), item, rejected, "/");
      if (!fixed) continue;
      if (!tryValidate(() => validateEnvelope(fixed), item, rejected)) continue;
      if (!tryValidate(() => validateNodes(fixed), item, rejected)) continue;
      this.dispatcher.dispatch(fixed);
      accepted.push(fixed);
      this.acceptedEnvelopes.push(fixed);
    }

    safeCall(() => {
      validateGraph(accepted);
      return true;
    }, accepted, [], "/graph");

    return {
      accepted,
      rejected,
      snapshot: this.snapshot(),
      acceptedOpenUIEvents: accepted
        .map(legacyEnvelopeToOpenUILangEvent)
        .filter((event): event is OpenUILangWireEvent => Boolean(event)),
      document: this.document()
    };
  }

  ingestOpenUI(input: unknown): OpenUILangIngestResult {
    return this.ingest(input);
  }

  parse(input: unknown): OpenUILangCompatEnvelope[] {
    const raw = Array.isArray(input) ? input : parseJsonLines(String(input ?? ""));
    const fixed = raw.map(fixEnvelope);
    for (const envelope of fixed) {
      validateEnvelope(envelope);
      validateNodes(envelope);
    }
    validateGraph(fixed);
    return fixed;
  }

  parseOpenUI(input: unknown): OpenUILangWireEvent[] {
    return this.parse(input)
      .map(legacyEnvelopeToOpenUILangEvent)
      .filter((event): event is OpenUILangWireEvent => Boolean(event));
  }

  snapshot(): OpenUILangStreamingSurfaceSnapshot[] {
    return this.surfaceManager.snapshot();
  }

  document(): OpenUILangDocument {
    return legacyEnvelopesToOpenUILangDocument(this.acceptedEnvelopes);
  }

  reset(): void {
    this.acceptedEnvelopes.length = 0;
    this.surfaceManager.reset();
  }
}

export class OpenUILangStreamingTranslator {
  private readonly progressSurfaces = new Map<string, ProgressSurfaceState>();
  private readonly progressKey: string;
  private finalized = false;

  constructor(
    private readonly parser: OpenUILangIncrementalEnvelopeParser,
    private readonly listener: OpenUILangStreamingListener,
    private readonly ctx: OpenUILangStreamingEmitContext = {}
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

  async finalize(result: unknown): Promise<OpenUILangWireEvent[]> {
    if (this.finalized) {
      return this.parser.snapshot().map(snapshotToCreateEnvelope)
        .map(legacyEnvelopeToOpenUILangEvent)
        .filter((event): event is OpenUILangWireEvent => Boolean(event));
    }
    this.finalized = true;

    const final = buildOpenUILangLegacyEnvelopes({
      result,
      surfacePrefix: this.ctx.surfacePrefix,
      clientCapabilities: this.ctx.clientCapabilities,
      includeRuntime: this.ctx.includeRuntime === true
    });
    const ingest = this.parser.ingest(final);
    for (const envelope of ingest.accepted) {
      const event = legacyEnvelopeToOpenUILangEvent(envelope);
      if (event) await this.listener(event, this.parser.document(), envelope);
    }

    const deletions: OpenUILangCompatEnvelope[] = [];
    for (const state of this.progressSurfaces.values()) {
      deletions.push({ version: COMPAT_VERSION, deleteSurface: { surfaceId: state.surfaceId } });
    }
    if (deletions.length) {
      const delIngest = this.parser.ingest(deletions);
      for (const envelope of delIngest.accepted) {
        const event = legacyEnvelopeToOpenUILangEvent(envelope);
        if (event) await this.listener(event, this.parser.document(), envelope);
      }
    }
    this.progressSurfaces.clear();
    return final
      .map(legacyEnvelopeToOpenUILangEvent)
      .filter((event): event is OpenUILangWireEvent => Boolean(event));
  }

  snapshot(): OpenUILangStreamingSurfaceSnapshot[] {
    return this.parser.snapshot();
  }

  document(): OpenUILangDocument {
    return this.parser.document();
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
      const current = this.progressSurfaces.get(surfaceId)!;
      current.step = input.step;
      if (input.toolName) current.toolName = input.toolName;
    }

    const ingest = this.parser.ingest(envelopes);
    for (const envelope of ingest.accepted) {
      const event = legacyEnvelopeToOpenUILangEvent(envelope);
      if (event) await this.listener(event, this.parser.document(), envelope);
    }
  }
}

interface ProgressSurfaceState {
  surfaceId: string;
  toolName: string;
  step: number;
}

type ProgressTone = "info" | "running" | "done" | "warn";

function fixEnvelope(input: unknown): OpenUILangCompatEnvelope {
  const record = input && typeof input === "object" && !Array.isArray(input) ? input as OpenUILangCompatEnvelope : { version: COMPAT_VERSION };
  const envelope: OpenUILangCompatEnvelope = {
    ...record,
    version: COMPAT_VERSION
  };
  if (envelope.createSurface) {
    envelope.createSurface = {
      ...envelope.createSurface,
      surfaceId: safeId(envelope.createSurface.surfaceId, "surface"),
      root: safeId(envelope.createSurface.root, "root"),
      catalogId: envelope.createSurface.catalogId ?? COMPAT_BASIC_CATALOG_ID
    };
  }
  if (envelope.updateDataModel) {
    envelope.updateDataModel = {
      ...envelope.updateDataModel,
      surfaceId: safeId(envelope.updateDataModel.surfaceId, "surface")
    };
  }
  if (envelope.updateComponents) {
    envelope.updateComponents = {
      ...envelope.updateComponents,
      surfaceId: safeId(envelope.updateComponents.surfaceId, "surface"),
      components: (envelope.updateComponents.components ?? []).map((item, index) => ({
        ...item,
        id: safeId(item.id, `component_${index}`)
      }))
    };
  }
  if (envelope.deleteSurface) {
    envelope.deleteSurface = {
      ...envelope.deleteSurface,
      surfaceId: safeId(envelope.deleteSurface.surfaceId, "surface")
    };
  }
  return envelope;
}

function validateEnvelope(envelope: OpenUILangCompatEnvelope): void {
  const kinds = ["createSurface", "updateComponents", "updateDataModel", "deleteSurface"].filter((key) => envelope[key as keyof OpenUILangCompatEnvelope]);
  if (envelope.version !== COMPAT_VERSION) throw new OpenUILangValidationError("OpenUI Lang compatibility envelope version must be v0.9.", "/version");
  if (kinds.length !== 1) throw new OpenUILangValidationError("OpenUI Lang compatibility envelope must contain exactly one message kind.", "/");
  const surfaceId = envelope.createSurface?.surfaceId ?? envelope.updateComponents?.surfaceId ?? envelope.updateDataModel?.surfaceId ?? envelope.deleteSurface?.surfaceId;
  if (!surfaceId) throw new OpenUILangValidationError("OpenUI Lang compatibility envelope requires surfaceId.", "/surfaceId");
}

function validateNodes(envelope: OpenUILangCompatEnvelope): void {
  const components = envelope.updateComponents?.components ?? [];
  const ids = new Set<string>();
  for (const [index, item] of components.entries()) {
    if (!item.id) throw new OpenUILangValidationError("Component id is required.", `/updateComponents/components/${index}/id`);
    if (ids.has(item.id)) throw new OpenUILangValidationError(`Duplicate component id: ${item.id}.`, `/updateComponents/components/${index}/id`);
    ids.add(item.id);
    const componentName = Object.keys(item.component ?? {})[0];
    if (!componentName || !BASIC_COMPONENTS.has(componentName)) {
      throw new OpenUILangValidationError(`Unsupported component: ${componentName || "unknown"}.`, `/updateComponents/components/${index}/component`);
    }
  }
}

function validateGraph(envelopes: OpenUILangCompatEnvelope[]): void {
  const roots = new Map<string, string>();
  const componentIds = new Map<string, Set<string>>();
  for (const envelope of envelopes) {
    if (envelope.createSurface) {
      roots.set(envelope.createSurface.surfaceId, envelope.createSurface.root);
      if (!componentIds.has(envelope.createSurface.surfaceId)) componentIds.set(envelope.createSurface.surfaceId, new Set());
    }
    if (envelope.updateComponents) {
      const ids = componentIds.get(envelope.updateComponents.surfaceId) ?? new Set<string>();
      for (const item of envelope.updateComponents.components) ids.add(item.id);
      componentIds.set(envelope.updateComponents.surfaceId, ids);
    }
  }
  for (const [surfaceId, root] of roots.entries()) {
    if (!componentIds.get(surfaceId)?.has(root)) {
      throw new OpenUILangValidationError(`Surface root component not found: ${root}.`, `/surface/${surfaceId}/root`);
    }
  }
}

function buildSurfaceEnvelopes(input: { surfaceId: string; root: string; data: JsonObject; components: OpenUILangCompatComponent[] }): OpenUILangCompatEnvelope[] {
  return [
    {
      version: COMPAT_VERSION,
      createSurface: {
        surfaceId: input.surfaceId,
        catalogId: COMPAT_BASIC_CATALOG_ID,
        root: input.root,
        sendDataModel: true,
        theme: { primaryColor: "#111111", agentDisplayName: "LangClaw" }
      }
    },
    envelopeUpdateData(input.surfaceId, input.data),
    envelopeUpdateComponents(input.surfaceId, input.components)
  ];
}

function progressComponents(input: { title: string; detail: string; tone: ProgressTone }): OpenUILangCompatComponent[] {
  const toneEmoji = input.tone === "warn" ? "!" : input.tone === "done" ? "✓" : input.tone === "running" ? "..." : "-";
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

function envelopeUpdateData(surfaceId: string, value: JsonValue): OpenUILangCompatEnvelope {
  return { version: COMPAT_VERSION, updateDataModel: { surfaceId, value } };
}

function envelopeUpdateComponents(surfaceId: string, components: OpenUILangCompatComponent[]): OpenUILangCompatEnvelope {
  return { version: COMPAT_VERSION, updateComponents: { surfaceId, components } };
}

function snapshotToCreateEnvelope(snapshot: OpenUILangStreamingSurfaceSnapshot): OpenUILangCompatEnvelope {
  return {
    version: COMPAT_VERSION,
    createSurface: {
      surfaceId: snapshot.surfaceId,
      root: snapshot.root,
      catalogId: snapshot.catalogId ?? OPENUI_LANG_BASIC_CATALOG,
      sendDataModel: true
    }
  };
}

function parseJsonLines(text: string): unknown[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function safeCall<T>(fn: () => T, raw: unknown, rejected: OpenUILangRejectedEnvelope[], path: string): T | null {
  try {
    return fn();
  } catch (error) {
    rejected.push({
      envelope: raw,
      reason: error instanceof Error ? error.message : String(error),
      path: error instanceof OpenUILangValidationError ? error.path : path
    });
    return null;
  }
}

function tryValidate(fn: () => void, raw: unknown, rejected: OpenUILangRejectedEnvelope[]): boolean {
  try {
    fn();
    return true;
  } catch (error) {
    rejected.push({
      envelope: raw,
      reason: error instanceof Error ? error.message : String(error),
      path: error instanceof OpenUILangValidationError ? error.path : undefined
    });
    return false;
  }
}

function safeId(value: unknown, fallback: string): string {
  const text = String(value ?? fallback).trim().replace(/[^a-zA-Z0-9_.:-]/g, "_");
  return text || fallback;
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
