import { OpenUILangCatalogService } from "./catalog-service.js";
import {
  OPENUI_LANG_BASIC_CATALOG_ID,
  type OpenUILangCompatEnvelope
} from "./types.js";

export class OpenUILangCompatibilityValidationError extends Error {
  code = "OPENUI_LANG_COMPAT_VALIDATION_FAILED";

  constructor(message: string, readonly path: string) {
    super(message);
  }
}

export class OpenUILangCompatibilityPayloadFixer {
  fixEnvelope(input: unknown): OpenUILangCompatEnvelope {
    const record = input && typeof input === "object" && !Array.isArray(input)
      ? input as OpenUILangCompatEnvelope
      : { version: "v0.9" as const };
    const envelope: OpenUILangCompatEnvelope = {
      ...record,
      version: "v0.9"
    };
    if (envelope.createSurface) {
      envelope.createSurface = {
        ...envelope.createSurface,
        surfaceId: safeId(envelope.createSurface.surfaceId, "surface"),
        root: safeId(envelope.createSurface.root, "root"),
        catalogId: envelope.createSurface.catalogId ?? OPENUI_LANG_BASIC_CATALOG_ID
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

  fixMany(input: unknown[]): OpenUILangCompatEnvelope[] {
    return input.map((item) => this.fixEnvelope(item));
  }
}

export class OpenUILangCompatibilityEnvelopeValidator {
  validate(envelope: OpenUILangCompatEnvelope): void {
    const kinds = ["createSurface", "updateComponents", "updateDataModel", "deleteSurface"].filter((key) => envelope[key as keyof OpenUILangCompatEnvelope]);
    if (envelope.version !== "v0.9") throw new OpenUILangCompatibilityValidationError("OpenUI Lang compatibility envelope version must be v0.9.", "/version");
    if (kinds.length !== 1) throw new OpenUILangCompatibilityValidationError("OpenUI Lang compatibility envelope must contain exactly one message kind.", "/");
    const surfaceId = envelope.createSurface?.surfaceId ?? envelope.updateComponents?.surfaceId ?? envelope.updateDataModel?.surfaceId ?? envelope.deleteSurface?.surfaceId;
    if (!surfaceId) throw new OpenUILangCompatibilityValidationError("OpenUI Lang compatibility envelope requires surfaceId.", "/surfaceId");
  }
}

export class OpenUILangCompatibilityNodeValidator {
  constructor(private readonly catalogService = new OpenUILangCatalogService()) {}

  validate(envelope: OpenUILangCompatEnvelope): void {
    const components = envelope.updateComponents?.components ?? [];
    const ids = new Set<string>();
    for (const [index, item] of components.entries()) {
      if (!item.id) throw new OpenUILangCompatibilityValidationError("Component id is required.", `/updateComponents/components/${index}/id`);
      if (ids.has(item.id)) throw new OpenUILangCompatibilityValidationError(`Duplicate component id: ${item.id}.`, `/updateComponents/components/${index}/id`);
      ids.add(item.id);
      const componentName = Object.keys(item.component ?? {})[0];
      if (!componentName || !this.catalogService.isSupportedComponent(componentName)) {
        throw new OpenUILangCompatibilityValidationError(`Unsupported component: ${componentName || "unknown"}.`, `/updateComponents/components/${index}/component`);
      }
    }
  }
}

export class OpenUILangCompatibilityGraphValidator {
  validate(envelopes: OpenUILangCompatEnvelope[]): void {
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
        throw new OpenUILangCompatibilityValidationError(`Surface root component not found: ${root}.`, `/surface/${surfaceId}/root`);
      }
    }
  }
}

function safeId(value: unknown, fallback: string): string {
  const text = String(value ?? fallback).trim().replace(/[^a-zA-Z0-9_.:-]/g, "_");
  return text || fallback;
}
