import { A2UIPayloadFixer } from "./payload-fixer.js";
import { A2UIEnvelopeValidator, A2UIGraphValidator, A2UINodeValidator, A2UIValidationError } from "./validators.js";
import type { A2UIComponentInstance, A2UIEnvelope } from "./types.js";
import type { JsonObject, JsonValue } from "../types/agent-contracts.js";

export interface SurfaceSnapshot {
  surfaceId: string;
  root: string;
  catalogId?: string;
  data: JsonObject;
  components: A2UIComponentInstance[];
}

export interface RejectedEnvelope {
  envelope: unknown;
  reason: string;
  path?: string;
}

export interface IngestResult {
  accepted: A2UIEnvelope[];
  rejected: RejectedEnvelope[];
  snapshot: SurfaceSnapshot[];
}

interface SurfaceState {
  surfaceId: string;
  root: string;
  catalogId?: string;
  data: JsonObject;
  components: Map<string, JsonObject>;
  componentOrder: string[];
  deleted: boolean;
}

export class A2UIIncrementalEnvelopeParser {
  private readonly surfaces = new Map<string, SurfaceState>();

  constructor(
    private readonly payloadFixer = new A2UIPayloadFixer(),
    private readonly envelopeValidator = new A2UIEnvelopeValidator(),
    private readonly nodeValidator = new A2UINodeValidator(),
    private readonly graphValidator = new A2UIGraphValidator()
  ) {}

  ingest(input: unknown): IngestResult {
    const raw = Array.isArray(input) ? input : parseJsonLines(String(input ?? ""));
    const accepted: A2UIEnvelope[] = [];
    const rejected: RejectedEnvelope[] = [];

    for (const item of raw) {
      const fixed = safeCall(() => this.payloadFixer.fixEnvelope(item), item, rejected, "/");
      if (!fixed) continue;
      if (!this.tryValidate(this.envelopeValidator, fixed, item, rejected)) continue;
      if (!this.tryValidate(this.nodeValidator, fixed, item, rejected)) continue;
      this.applyEnvelope(fixed);
      accepted.push(fixed);
    }

    const graphOk = safeCall(() => {
      this.graphValidator.validate(accepted);
      return true;
    }, accepted, [], "/graph");
    if (!graphOk) {
      // graph-level 校验失败时不撤回 surface 状态：流式中间态 root 可能还没到，
      // 视为"快照暂时无 root 可见"，下次 ingest 即可恢复。
    }

    return { accepted, rejected, snapshot: this.snapshot() };
  }

  parse(input: unknown): A2UIEnvelope[] {
    // batch 兼容路径：保持原有"严格抛错"语义，调用方（translator-service）依赖此行为。
    const raw = Array.isArray(input) ? input : parseJsonLines(String(input ?? ""));
    const fixed = this.payloadFixer.fixMany(raw);
    for (const envelope of fixed) {
      this.envelopeValidator.validate(envelope);
      this.nodeValidator.validate(envelope);
    }
    this.graphValidator.validate(fixed);
    return fixed;
  }

  snapshot(): SurfaceSnapshot[] {
    const out: SurfaceSnapshot[] = [];
    for (const state of this.surfaces.values()) {
      if (state.deleted) continue;
      out.push({
        surfaceId: state.surfaceId,
        root: state.root,
        catalogId: state.catalogId,
        data: cloneJson(state.data),
        components: state.componentOrder.map((id) => ({ id, component: cloneJson(state.components.get(id) ?? {}) }))
      });
    }
    return out;
  }

  reset(): void {
    this.surfaces.clear();
  }

  private applyEnvelope(envelope: A2UIEnvelope): void {
    if (envelope.createSurface) {
      const create = envelope.createSurface;
      const existing = this.surfaces.get(create.surfaceId);
      const state: SurfaceState = existing && !existing.deleted ? existing : {
        surfaceId: create.surfaceId,
        root: create.root,
        catalogId: create.catalogId,
        data: {},
        components: new Map(),
        componentOrder: [],
        deleted: false
      };
      state.root = create.root;
      state.catalogId = create.catalogId ?? state.catalogId;
      state.deleted = false;
      this.surfaces.set(create.surfaceId, state);
    }
    if (envelope.updateComponents) {
      const update = envelope.updateComponents;
      const state = this.ensureSurface(update.surfaceId);
      for (const item of update.components ?? []) {
        if (!state.components.has(item.id)) state.componentOrder.push(item.id);
        state.components.set(item.id, cloneJson(item.component ?? {}));
      }
    }
    if (envelope.updateDataModel) {
      const update = envelope.updateDataModel;
      const state = this.ensureSurface(update.surfaceId);
      state.data = mergeDataModel(state.data, update.path, update.value);
    }
    if (envelope.deleteSurface) {
      const target = this.surfaces.get(envelope.deleteSurface.surfaceId);
      if (target) target.deleted = true;
    }
  }

  private ensureSurface(surfaceId: string): SurfaceState {
    const existing = this.surfaces.get(surfaceId);
    if (existing && !existing.deleted) return existing;
    const state: SurfaceState = {
      surfaceId,
      root: existing?.root ?? "",
      catalogId: existing?.catalogId,
      data: {},
      components: new Map(),
      componentOrder: [],
      deleted: false
    };
    this.surfaces.set(surfaceId, state);
    return state;
  }

  private tryValidate(
    validator: { validate: (envelope: A2UIEnvelope) => void },
    envelope: A2UIEnvelope,
    raw: unknown,
    rejected: RejectedEnvelope[]
  ): boolean {
    try {
      validator.validate(envelope);
      return true;
    } catch (error) {
      rejected.push({
        envelope: raw,
        reason: error instanceof Error ? error.message : String(error),
        path: error instanceof A2UIValidationError ? error.path : undefined
      });
      return false;
    }
  }
}

function parseJsonLines(text: string): unknown[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function safeCall<T>(fn: () => T, raw: unknown, rejected: RejectedEnvelope[], path: string): T | null {
  try {
    return fn();
  } catch (error) {
    rejected.push({
      envelope: raw,
      reason: error instanceof Error ? error.message : String(error),
      path: error instanceof A2UIValidationError ? error.path : path
    });
    return null;
  }
}

function mergeDataModel(current: JsonObject, path: string | undefined, value: JsonValue | undefined): JsonObject {
  if (!path) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return cloneJson(value as JsonObject);
    }
    return cloneJson(current);
  }
  const segments = path.split(/[./]/).map((seg) => seg.trim()).filter(Boolean);
  if (!segments.length) return cloneJson(current);
  const next = cloneJson(current);
  let cursor: JsonObject = next;
  for (let i = 0; i < segments.length - 1; i++) {
    const key = segments[i];
    const child = cursor[key];
    if (child && typeof child === "object" && !Array.isArray(child)) {
      cursor = child as JsonObject;
    } else {
      const created: JsonObject = {};
      cursor[key] = created;
      cursor = created;
    }
  }
  cursor[segments[segments.length - 1]] = (value ?? null) as JsonValue;
  return next;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null)) as T;
}
