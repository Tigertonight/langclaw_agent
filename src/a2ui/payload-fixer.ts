import { A2UI_BASIC_CATALOG_ID, A2UI_VERSION, type A2UIEnvelope } from "./types.js";

export class A2UIPayloadFixer {
  fixEnvelope(input: unknown): A2UIEnvelope {
    const record = input && typeof input === "object" && !Array.isArray(input) ? input as A2UIEnvelope : { version: A2UI_VERSION };
    const envelope: A2UIEnvelope = {
      ...record,
      version: A2UI_VERSION
    };
    if (envelope.createSurface) {
      envelope.createSurface = {
        ...envelope.createSurface,
        surfaceId: safeId(envelope.createSurface.surfaceId, "surface"),
        root: safeId(envelope.createSurface.root, "root"),
        catalogId: envelope.createSurface.catalogId ?? A2UI_BASIC_CATALOG_ID
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

  fixMany(input: unknown[]): A2UIEnvelope[] {
    return input.map((item) => this.fixEnvelope(item));
  }
}

function safeId(value: unknown, fallback: string): string {
  const text = String(value ?? fallback).trim().replace(/[^a-zA-Z0-9_.:-]/g, "_");
  return text || fallback;
}
