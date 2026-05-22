import { A2UICatalogService } from "./catalog-service.js";
import type { A2UIEnvelope } from "./types.js";

export class A2UIValidationError extends Error {
  code = "A2UI_VALIDATION_FAILED";

  constructor(message: string, readonly path: string) {
    super(message);
  }
}

export class A2UIEnvelopeValidator {
  validate(envelope: A2UIEnvelope): void {
    const kinds = ["createSurface", "updateComponents", "updateDataModel", "deleteSurface"].filter((key) => envelope[key as keyof A2UIEnvelope]);
    if (envelope.version !== "v0.9") throw new A2UIValidationError("A2UI envelope version must be v0.9.", "/version");
    if (kinds.length !== 1) throw new A2UIValidationError("A2UI envelope must contain exactly one message kind.", "/");
    const surfaceId = envelope.createSurface?.surfaceId ?? envelope.updateComponents?.surfaceId ?? envelope.updateDataModel?.surfaceId ?? envelope.deleteSurface?.surfaceId;
    if (!surfaceId) throw new A2UIValidationError("A2UI envelope requires surfaceId.", "/surfaceId");
  }
}

export class A2UINodeValidator {
  constructor(private readonly catalogService = new A2UICatalogService()) {}

  validate(envelope: A2UIEnvelope): void {
    const components = envelope.updateComponents?.components ?? [];
    const ids = new Set<string>();
    for (const [index, item] of components.entries()) {
      if (!item.id) throw new A2UIValidationError("Component id is required.", `/updateComponents/components/${index}/id`);
      if (ids.has(item.id)) throw new A2UIValidationError(`Duplicate component id: ${item.id}.`, `/updateComponents/components/${index}/id`);
      ids.add(item.id);
      const componentName = Object.keys(item.component ?? {})[0];
      if (!componentName || !this.catalogService.isSupportedComponent(componentName)) {
        throw new A2UIValidationError(`Unsupported component: ${componentName || "unknown"}.`, `/updateComponents/components/${index}/component`);
      }
    }
  }
}

export class A2UIGraphValidator {
  validate(envelopes: A2UIEnvelope[]): void {
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
        throw new A2UIValidationError(`Surface root component not found: ${root}.`, `/surface/${surfaceId}/root`);
      }
    }
  }
}
