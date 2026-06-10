import { getOpenUILangBasicComponentName } from "./component-schema.js";
import { CORE_OPENUI_COMPONENT_NAMES, summarizeContractIssues, validateOpenUISurfaceContract } from "./component-contracts.js";
import { OpenUILangSchemaSanitizerError, sanitizeOpenUILangSchema } from "./core.js";
import { openUILangSurfaceToLegacyEnvelopes, surfaceOutputToOpenUILang } from "./legacy-adapter.js";
import { defaultOpenUILangSurfacePlugins, type SurfacePlugin } from "./surface-plugins.js";
import { OPENUI_LANG_PROTOCOL, type BuildOpenUILangResponseInput, type OpenUILangClientCapabilities, type OpenUILangCompatComponent, type OpenUILangCompatEnvelope, type OpenUILangDocument, type OpenUILangSurface } from "./types.js";
import { getChatPageRenderers } from "../domains/runtime-registry.js";
import { logEvent, sharedMetrics } from "../security/observability.js";
import type { JsonObject } from "../types/agent-contracts.js";

/** Defensive limits for OpenUI Lang surfaces before any legacy adapter projection. */
export const ENVELOPE_LIMITS = {
  maxSerializedBytes: 256 * 1024,
  maxComponents: 200,
  maxDepth: 20
} as const;

export type { OpenUILangClientCapabilities };

export function buildOpenUILangResponse(input: BuildOpenUILangResponseInput): OpenUILangDocument {
  return {
    protocol: OPENUI_LANG_PROTOCOL,
    version: "1.0",
    surfaces: buildOpenUILangSurfaces(input)
  };
}

export function buildOpenUILangSurfaces({
  result,
  surfacePrefix = "agent",
  plugins,
  namespace,
  clientCapabilities,
  includeRuntime = false
}: BuildOpenUILangResponseInput): OpenUILangSurface[] {
  const record = toRecord(result) ?? {};
  const runId = stringOr(record.run_id, `run_${Date.now()}`);
  const ctx = { runId, surfacePrefix, record };
  const surfaces: OpenUILangSurface[] = [];
  const activePlugins = (plugins ?? defaultOpenUILangSurfacePlugins()).filter((plugin) => includeRuntime || plugin.kind !== "runtime");
  for (const plugin of activePlugins) {
    let data: unknown;
    try {
      data = plugin.extract(ctx);
    } catch (error) {
      sharedMetrics.inc("plugin_extract_failed", { plugin: plugin.kind });
      logEvent("warn", "plugin_extract_failed", { plugin: plugin.kind, run_id: runId, error: error instanceof Error ? error.message : String(error) });
      continue;
    }
    if (data === null || data === undefined) {
      sharedMetrics.inc("plugin_extract_skipped", { plugin: plugin.kind });
      continue;
    }
    let built;
    try {
      built = plugin.build(data, ctx);
    } catch (error) {
      sharedMetrics.inc("plugin_build_failed", { plugin: plugin.kind });
      logEvent("warn", "plugin_build_failed", { plugin: plugin.kind, run_id: runId, error: error instanceof Error ? error.message : String(error) });
      continue;
    }
    try {
      sanitizeOpenUILangSchema({ data: built.data, components: built.components });
    } catch (error) {
      sharedMetrics.inc("envelope_rejected_total", { plugin: plugin.kind, reason: "schema_sanitizer" });
      logEvent("warn", "openui_surface_rejected", {
        plugin: plugin.kind,
        run_id: runId,
        reason: "schema_sanitizer",
        path: error instanceof OpenUILangSchemaSanitizerError ? error.path : undefined,
        token: error instanceof OpenUILangSchemaSanitizerError ? error.token : undefined,
        error: error instanceof Error ? error.message : String(error)
      });
      continue;
    }
    const surfaceId = namespace ? `${namespace}_${built.surfaceId}` : built.surfaceId;
    const downgraded = clientCapabilities?.supported_components
      ? downgradeUnsupported(built.components, clientCapabilities.supported_components, plugin.kind, runId)
      : built.components;
    const guardCheck = checkSurfaceGuardrails({ ...built, surfaceId, components: downgraded }, plugin.kind, runId);
    if (!guardCheck.ok) continue;
    surfaces.push(surfaceOutputToOpenUILang({ ...built, surfaceId, components: downgraded }));
  }
  return surfaces;
}

export function buildOpenUILangLegacyEnvelopes(input: BuildOpenUILangResponseInput): OpenUILangCompatEnvelope[] {
  return buildOpenUILangSurfaces(input).flatMap(openUILangSurfaceToLegacyEnvelopes) as OpenUILangCompatEnvelope[];
}

function checkSurfaceGuardrails(input: { surfaceId: string; root: string; data: JsonObject; components: OpenUILangCompatComponent[] }, pluginKind: string, runId: string): { ok: true } | { ok: false } {
  if (input.components.length > ENVELOPE_LIMITS.maxComponents) {
    sharedMetrics.inc("envelope_rejected_total", { plugin: pluginKind, reason: "too_many_components" });
    logEvent("warn", "openui_surface_rejected", { plugin: pluginKind, run_id: runId, reason: "too_many_components", count: input.components.length, limit: ENVELOPE_LIMITS.maxComponents });
    return { ok: false };
  }
  for (const component of input.components) {
    const depth = componentDepth(component);
    if (depth > ENVELOPE_LIMITS.maxDepth) {
      sharedMetrics.inc("envelope_rejected_total", { plugin: pluginKind, reason: "depth_exceeded" });
      logEvent("warn", "openui_surface_rejected", { plugin: pluginKind, run_id: runId, reason: "depth_exceeded", depth, limit: ENVELOPE_LIMITS.maxDepth });
      return { ok: false };
    }
  }
  const serialized = JSON.stringify({ data: input.data, components: input.components });
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes > ENVELOPE_LIMITS.maxSerializedBytes) {
    sharedMetrics.inc("envelope_rejected_total", { plugin: pluginKind, reason: "size_exceeded" });
    logEvent("warn", "openui_surface_rejected", { plugin: pluginKind, run_id: runId, reason: "size_exceeded", bytes, limit: ENVELOPE_LIMITS.maxSerializedBytes });
    return { ok: false };
  }
  const issues = validateOpenUISurfaceContract({
    ...input,
    allowedOpenUIComponents: [...CORE_OPENUI_COMPONENT_NAMES, ...getChatPageRenderers().map((renderer) => renderer.name)]
  });
  if (issues.length) {
    sharedMetrics.inc("envelope_rejected_total", { plugin: pluginKind, reason: "contract_failed" });
    logEvent("warn", "openui_surface_rejected", {
      plugin: pluginKind,
      run_id: runId,
      reason: "contract_failed",
      error: summarizeContractIssues(issues.slice(0, 6))
    });
    return { ok: false };
  }
  return { ok: true };
}

function componentDepth(component: OpenUILangCompatComponent, depth = 1): number {
  let max = depth;
  visitNested(component as unknown, depth, (childDepth) => {
    if (childDepth > max) max = childDepth;
  });
  return max;
}

function visitNested(value: unknown, depth: number, onDepth: (d: number) => void): void {
  if (depth > ENVELOPE_LIMITS.maxDepth + 5) {
    onDepth(depth);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) visitNested(item, depth + 1, onDepth);
    return;
  }
  if (value && typeof value === "object") {
    onDepth(depth);
    for (const v of Object.values(value as Record<string, unknown>)) visitNested(v, depth + 1, onDepth);
  }
}

function downgradeUnsupported(components: OpenUILangCompatComponent[], supported: string[], pluginKind: string, runId: string): OpenUILangCompatComponent[] {
  if (supported.length === 0) return components;
  const supportedSet = new Set(supported);
  let downgradedCount = 0;
  const result = components.map((component) => {
    const name = getOpenUILangBasicComponentName(component);
    if (!name || supportedSet.has(name)) return component;
    downgradedCount += 1;
    return {
      id: component.id,
      component: {
        Text: {
          text: { literalString: `（客户端不支持组件 ${name}，已降级为文本）` }
        }
      }
    } as OpenUILangCompatComponent;
  });
  if (downgradedCount > 0) {
    sharedMetrics.inc("envelope_component_downgraded_total", { plugin: pluginKind });
    logEvent("info", "openui_surface_component_downgraded", { plugin: pluginKind, run_id: runId, count: downgradedCount });
  }
  return result;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value ? value : fallback;
}
