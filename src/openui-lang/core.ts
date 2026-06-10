import type { JsonObject, JsonValue } from "../types/agent-contracts.js";
import type { OpenUILangCompatComponent, OpenUILangCompatEnvelope } from "./types.js";

export interface OpenUILangClientAction {
  name: string;
  surfaceId: string;
  sourceComponentId?: string;
  timestamp: string;
  context: JsonObject;
}

export interface OpenUILangActionResult {
  status: "Success" | "Error";
  result?: JsonObject;
}

export class OpenUILangActionEmitter {
  private readonly observers = new Set<(action: OpenUILangClientAction) => void>();
  private handler: ((action: OpenUILangClientAction) => Promise<OpenUILangActionResult>) | null = null;

  on(observer: (action: OpenUILangClientAction) => void): () => void {
    this.observers.add(observer);
    return () => this.observers.delete(observer);
  }

  setHandler(handler: (action: OpenUILangClientAction) => Promise<OpenUILangActionResult>): void {
    this.handler = handler;
  }

  async emit(action: OpenUILangClientAction): Promise<OpenUILangActionResult> {
    for (const observer of this.observers) observer(action);
    if (!this.handler) return { status: "Error" };
    return await this.handler(action);
  }
}

export class OpenUILangDataModel {
  private store: JsonObject = {};

  update(path: string | undefined, value: JsonValue | undefined): void {
    if (!path || path === "/") {
      this.store = isJsonObject(value) ? cloneJson(value) : {};
      return;
    }
    const segments = parseOpenUILangJsonPointer(path);
    if (segments.length === 0) return;
    if (value === undefined) {
      this.deleteByPath(segments);
      return;
    }
    let cursor: JsonObject = this.store;
    for (let i = 0; i < segments.length - 1; i++) {
      const key = segments[i];
      const next = cursor[key];
      if (isJsonObject(next)) {
        cursor = next;
      } else {
        const created: JsonObject = {};
        cursor[key] = created;
        cursor = created;
      }
    }
    cursor[segments[segments.length - 1]] = cloneJson(value) as JsonValue;
  }

  get(path?: string): JsonValue | undefined {
    if (!path || path === "/") return cloneJson(this.store) as JsonValue;
    let cursor: unknown = this.store;
    for (const segment of parseOpenUILangJsonPointer(path)) {
      if (!isJsonObject(cursor)) return undefined;
      cursor = cursor[segment];
    }
    return cloneJson(cursor) as JsonValue;
  }

  snapshot(): JsonObject {
    return cloneJson(this.store);
  }

  clear(): void {
    this.store = {};
  }

  private deleteByPath(segments: string[]): void {
    if (segments.length === 0) {
      this.clear();
      return;
    }
    let cursor: JsonObject = this.store;
    for (let i = 0; i < segments.length - 1; i++) {
      const next = cursor[segments[i]];
      if (!isJsonObject(next)) return;
      cursor = next;
    }
    delete cursor[segments[segments.length - 1]];
  }
}

export function parseOpenUILangJsonPointer(path: string): string[] {
  if (!path || path === "/") return [];
  if (!path.startsWith("/")) {
    return path.split(/[./]/).map((segment) => segment.trim()).filter(Boolean);
  }
  const normalized = path.startsWith("/") ? path.slice(1) : path;
  if (!normalized) return [];
  return normalized.split("/").map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
}

interface SurfaceState {
  surfaceId: string;
  root: string;
  catalogId?: string;
  dataModel: OpenUILangDataModel;
  components: Map<string, OpenUILangCompatComponent>;
  componentOrder: string[];
  deleted: boolean;
}

export interface OpenUILangSurfaceSnapshot {
  surfaceId: string;
  root: string;
  catalogId?: string;
  data: JsonObject;
  components: OpenUILangCompatComponent[];
}

export class OpenUILangSurfaceManager {
  private readonly surfaces = new Map<string, SurfaceState>();
  private readonly listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  create(input: { surfaceId: string; root?: string; catalogId?: string }): void {
    const existing = this.surfaces.get(input.surfaceId);
    if (existing && !existing.deleted) {
      existing.root = input.root ?? existing.root;
      existing.catalogId = input.catalogId ?? existing.catalogId;
      this.notify();
      return;
    }
    this.surfaces.set(input.surfaceId, {
      surfaceId: input.surfaceId,
      root: input.root ?? "",
      catalogId: input.catalogId,
      dataModel: new OpenUILangDataModel(),
      components: new Map(),
      componentOrder: [],
      deleted: false
    });
    this.notify();
  }

  updateComponents(surfaceId: string, components: OpenUILangCompatComponent[]): void {
    const state = this.ensureSurface(surfaceId);
    for (const component of components) {
      if (!component.id) continue;
      if (!state.components.has(component.id)) state.componentOrder.push(component.id);
      state.components.set(component.id, cloneJson(component));
    }
    this.notify();
  }

  updateDataModel(surfaceId: string, path: string | undefined, value: JsonValue | undefined): void {
    const state = this.ensureSurface(surfaceId);
    state.dataModel.update(path, value);
    this.notify();
  }

  delete(surfaceId: string): void {
    const state = this.surfaces.get(surfaceId);
    if (!state) return;
    state.deleted = true;
    this.notify();
  }

  snapshot(): OpenUILangSurfaceSnapshot[] {
    const output: OpenUILangSurfaceSnapshot[] = [];
    for (const state of this.surfaces.values()) {
      if (state.deleted) continue;
      output.push({
        surfaceId: state.surfaceId,
        root: state.root,
        catalogId: state.catalogId,
        data: state.dataModel.snapshot(),
        components: state.componentOrder
          .map((id) => state.components.get(id))
          .filter((component): component is OpenUILangCompatComponent => Boolean(component))
          .map((component) => cloneJson(component))
      });
    }
    return output;
  }

  reset(): void {
    this.surfaces.clear();
    this.notify();
  }

  private ensureSurface(surfaceId: string): SurfaceState {
    const existing = this.surfaces.get(surfaceId);
    if (existing && !existing.deleted) return existing;
    const state: SurfaceState = {
      surfaceId,
      root: existing?.root ?? "",
      catalogId: existing?.catalogId,
      dataModel: new OpenUILangDataModel(),
      components: new Map(),
      componentOrder: [],
      deleted: false
    };
    this.surfaces.set(surfaceId, state);
    return state;
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

const MESSAGE_KINDS = ["createSurface", "updateComponents", "updateDataModel", "deleteSurface"] as const;

export class OpenUILangEnvelopeDispatcher {
  constructor(private readonly manager: OpenUILangSurfaceManager) {}

  dispatch(envelope: OpenUILangCompatEnvelope): void {
    const kinds = MESSAGE_KINDS.filter((kind) => Boolean(envelope[kind]));
    if (kinds.length !== 1) {
      throw new Error("OpenUI Lang compatibility envelope must contain exactly one message kind.");
    }
    if (envelope.createSurface) {
      this.manager.create({
        surfaceId: envelope.createSurface.surfaceId,
        root: envelope.createSurface.root,
        catalogId: envelope.createSurface.catalogId
      });
      return;
    }
    if (envelope.updateComponents) {
      this.manager.updateComponents(envelope.updateComponents.surfaceId, envelope.updateComponents.components ?? []);
      return;
    }
    if (envelope.updateDataModel) {
      this.manager.updateDataModel(
        envelope.updateDataModel.surfaceId,
        envelope.updateDataModel.path,
        envelope.updateDataModel.value
      );
      return;
    }
    if (envelope.deleteSurface) {
      this.manager.delete(envelope.deleteSurface.surfaceId);
    }
  }
}

const FORBIDDEN_TOKENS = [
  "window",
  "document",
  "fetch",
  "XMLHttpRequest",
  "localStorage",
  "sessionStorage",
  "eval",
  "Function(",
  "setTimeout",
  "setInterval",
  "globalThis",
  "process",
  "require(",
  "import("
] as const;

const DYNAMIC_TYPES = new Set(["JSExpression", "JSFunction", "JSSlot", "JSRaw"]);

export class OpenUILangSchemaSanitizerError extends Error {
  constructor(readonly path: string, readonly token: string, readonly expression: string) {
    super(`Forbidden token "${token}" at ${path}: ${expression.slice(0, 80)}`);
  }
}

export function sanitizeOpenUILangSchema(value: unknown, path = "$"): void {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    if (isExpressionPath(path)) scanExpression(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => sanitizeOpenUILangSchema(item, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";
  if (DYNAMIC_TYPES.has(type) && typeof record.value === "string") {
    scanExpression(record.value, `${path}.value`);
  }
  for (const [key, child] of Object.entries(record)) {
    sanitizeOpenUILangSchema(child, `${path}.${key}`);
  }
}

function scanExpression(expression: string, path: string): void {
  for (const token of FORBIDDEN_TOKENS) {
    if (expression.includes(token)) {
      throw new OpenUILangSchemaSanitizerError(path, token, expression);
    }
  }
}

function isExpressionPath(path: string): boolean {
  return /\.(expression|script|handler|code|fn|function|value)$/i.test(path);
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null)) as T;
}
