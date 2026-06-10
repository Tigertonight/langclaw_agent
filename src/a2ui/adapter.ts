/**
 * LEGACY A2UI envelope adapter.
 *
 * The public function name is preserved for existing callers and tests. The
 * implementation now builds OpenUI Lang surfaces first, then emits A2UI v0.9
 * envelopes as the compatibility wire format for the bundled chat UI.
 */

import { type SurfacePlugin } from "./plugins/index.js";
import { A2UI_BASIC_CATALOG_ID, A2UI_VERSION, type A2UIComponentInstance, type A2UIEnvelope } from "./types.js";
import { buildOpenUILangLegacyEnvelopes, ENVELOPE_LIMITS } from "../openui-lang/response.js";
import type { JsonObject } from "../types/agent-contracts.js";

export { ENVELOPE_LIMITS };

export interface BuildA2UIInput {
  result: unknown;
  surfacePrefix?: string;
  /** 自定义插件集；不传用 defaultSurfacePlugins() */
  plugins?: SurfacePlugin<unknown>[];
  /** 多租户 namespace：拼到 surfaceId 前面避免跨租户碰撞 */
  namespace?: string;
  /** 客户端能力（versioning + 支持的组件列表）；不传则不做降级 */
  clientCapabilities?: ClientCapabilities;
  /** debug 模式才输出 runtime summary，避免普通用户看到执行细节。 */
  includeRuntime?: boolean;
}

export interface ClientCapabilities {
  catalog_version?: string;
  supported_components?: string[];
}

/**
 * 把 agent result 转成 OpenUI Lang surfaces，再转成旧 A2UI envelopes：
 * 调度器只负责 1) 取 plugin、2) 调 extract、3) 调 build、4) 拼 createSurface/updateDataModel/updateComponents 三件套。
 * 业务规则全部下沉到 src/openui-lang/plugins/* 以及 domain pack 注册的 SurfacePlugin。
 *
 * 注意：/api/a2ui/* 仍输出 v0.9 envelope 是兼容层；内部规范入口已经迁到 OpenUI Lang。
 */
export function buildA2UIResponse({ result, surfacePrefix = "agent", plugins, namespace, clientCapabilities, includeRuntime = false }: BuildA2UIInput): A2UIEnvelope[] {
  return buildOpenUILangLegacyEnvelopes({
    result,
    surfacePrefix,
    plugins,
    namespace,
    clientCapabilities,
    includeRuntime
  });
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
