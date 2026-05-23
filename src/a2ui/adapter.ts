import { defaultSurfacePlugins, type SurfacePlugin } from "./plugins/index.js";
import { A2UI_BASIC_CATALOG_ID, A2UI_VERSION, type A2UIComponentInstance, type A2UIEnvelope } from "./types.js";
import { logEvent, sharedMetrics } from "../security/observability.js";
import type { JsonObject } from "../types/agent-contracts.js";

/** envelope 防御性硬限制：单 envelope 序列化字节数 / 单 surface 组件数 / 嵌套深度 */
export const ENVELOPE_LIMITS = {
  maxSerializedBytes: 256 * 1024,
  maxComponents: 200,
  maxDepth: 20
} as const;

interface BuildA2UIInput {
  result: unknown;
  surfacePrefix?: string;
  /** 自定义插件集；不传用 defaultSurfacePlugins() */
  plugins?: SurfacePlugin<unknown>[];
  /** 多租户 namespace：拼到 surfaceId 前面避免跨租户碰撞 */
  namespace?: string;
  /** 客户端能力（versioning + 支持的组件列表）；不传则不做降级 */
  clientCapabilities?: ClientCapabilities;
}

export interface ClientCapabilities {
  catalog_version?: string;
  supported_components?: string[];
}

/**
 * 把 agent result 转成 a2UI envelopes：
 * 调度器只负责 1) 取 plugin、2) 调 extract、3) 调 build、4) 拼 createSurface/updateDataModel/updateComponents 三件套。
 * 业务规则全部下沉到 src/a2ui/plugins/*。
 */
export function buildA2UIResponse({ result, surfacePrefix = "agent", plugins, namespace, clientCapabilities }: BuildA2UIInput): A2UIEnvelope[] {
  const record = toRecord(result) ?? {};
  const runId = stringOr(record.run_id, `run_${Date.now()}`);
  const ctx = { runId, surfacePrefix, record };
  const messages: A2UIEnvelope[] = [];
  for (const plugin of plugins ?? defaultSurfacePlugins()) {
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
    const surfaceId = namespace ? `${namespace}_${built.surfaceId}` : built.surfaceId;
    const downgraded = clientCapabilities?.supported_components
      ? downgradeUnsupported(built.components, clientCapabilities.supported_components, plugin.kind, runId)
      : built.components;
    const guardCheck = checkSurfaceWithinLimits({ ...built, surfaceId, components: downgraded }, plugin.kind, runId);
    if (!guardCheck.ok) continue;
    messages.push(...surface({ ...built, surfaceId, components: downgraded }));
  }
  return messages;
}

function checkSurfaceWithinLimits(input: { surfaceId: string; root: string; data: JsonObject; components: A2UIComponentInstance[] }, pluginKind: string, runId: string): { ok: true } | { ok: false } {
  if (input.components.length > ENVELOPE_LIMITS.maxComponents) {
    sharedMetrics.inc("envelope_rejected_total", { plugin: pluginKind, reason: "too_many_components" });
    logEvent("warn", "envelope_rejected", { plugin: pluginKind, run_id: runId, reason: "too_many_components", count: input.components.length, limit: ENVELOPE_LIMITS.maxComponents });
    return { ok: false };
  }
  for (const component of input.components) {
    const depth = componentDepth(component);
    if (depth > ENVELOPE_LIMITS.maxDepth) {
      sharedMetrics.inc("envelope_rejected_total", { plugin: pluginKind, reason: "depth_exceeded" });
      logEvent("warn", "envelope_rejected", { plugin: pluginKind, run_id: runId, reason: "depth_exceeded", depth, limit: ENVELOPE_LIMITS.maxDepth });
      return { ok: false };
    }
  }
  const serialized = JSON.stringify({ data: input.data, components: input.components });
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes > ENVELOPE_LIMITS.maxSerializedBytes) {
    sharedMetrics.inc("envelope_rejected_total", { plugin: pluginKind, reason: "size_exceeded" });
    logEvent("warn", "envelope_rejected", { plugin: pluginKind, run_id: runId, reason: "size_exceeded", bytes, limit: ENVELOPE_LIMITS.maxSerializedBytes });
    return { ok: false };
  }
  return { ok: true };
}

function componentDepth(component: A2UIComponentInstance, depth = 1): number {
  let max = depth;
  // 把整个 component 当作一棵树看待（包括 component.{Type}.children/data 等）
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

function downgradeUnsupported(components: A2UIComponentInstance[], supported: string[], pluginKind: string, runId: string): A2UIComponentInstance[] {
  if (supported.length === 0) return components;
  const supportedSet = new Set(supported);
  let downgradedCount = 0;
  const result = components.map((component) => {
    const name = (component as { componentName?: string }).componentName;
    if (!name || supportedSet.has(name)) return component;
    downgradedCount += 1;
    return {
      ...component,
      componentName: "Text",
      properties: {
        text: `（客户端不支持组件 ${name}，已降级为文本）`,
        variant: "body"
      }
    } as A2UIComponentInstance;
  });
  if (downgradedCount > 0) {
    sharedMetrics.inc("envelope_component_downgraded_total", { plugin: pluginKind });
    logEvent("info", "envelope_component_downgraded", { plugin: pluginKind, run_id: runId, count: downgradedCount });
  }
  return result;
}

export function buildSurfaceEnvelopes(input: { surfaceId: string; root: string; data: JsonObject; components: A2UIComponentInstance[] }): A2UIEnvelope[] {
  return surface(input);
}

function surface({ surfaceId, root, data, components }: { surfaceId: string; root: string; data: JsonObject; components: A2UIComponentInstance[] }): A2UIEnvelope[] {
  return [
    {
      version: A2UI_VERSION,
      createSurface: {
        surfaceId,
        catalogId: A2UI_BASIC_CATALOG_ID,
        root,
        sendDataModel: true,
        theme: {
          primaryColor: "#111111",
          agentDisplayName: "LangClaw"
        }
      }
    },
    {
      version: A2UI_VERSION,
      updateDataModel: {
        surfaceId,
        value: data
      }
    },
    {
      version: A2UI_VERSION,
      updateComponents: {
        surfaceId,
        components
      }
    }
  ];
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value ? value : fallback;
}
