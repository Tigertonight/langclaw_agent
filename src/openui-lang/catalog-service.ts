import { getChatPageRenderers } from "../domains/runtime-registry.js";
import type { JsonObject } from "../types/agent-contracts.js";
import { LEGACY_A2UI_FORM_SUBMIT_ACTION, OPENUI_FORM_SUBMIT_ACTION } from "./action-registry.js";
import {
  BASIC_OPENUI_COMPONENT_CONTRACT_DOCS,
  BASIC_OPENUI_LANG_COMPONENT_NAMES,
  CORE_OPENUI_COMPONENT_NAMES,
  OPENUI_BUSINESS_COMPONENT_CONTRACT_DOCS
} from "./component-contracts.js";
import { OPENUI_PRESENTATION_POLICY_CAPABILITIES } from "./presentation-policy.js";
import { OPENUI_LANG_BASIC_CATALOG_ID, OPENUI_LANG_BASIC_CATALOG_VERSION, OPENUI_LANG_PROTOCOL, OPENUI_LANG_VIEW_PROTOCOL } from "./types.js";

export const BASIC_OPENUI_LANG_COMPONENTS = BASIC_OPENUI_LANG_COMPONENT_NAMES;
export const CORE_OPENUI_LANG_COMPONENTS = CORE_OPENUI_COMPONENT_NAMES;

const BASIC_COMPONENTS = new Set<string>(BASIC_OPENUI_LANG_COMPONENTS);
const LEGACY_A2UI_BASIC_CATALOG_ID = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json";

export class OpenUILangCatalogService {
  capabilities(): JsonObject {
    const supportedOpenUIComponents = unique([...CORE_OPENUI_LANG_COMPONENTS, ...getChatPageRenderers().map((renderer) => renderer.name)]);
    return {
      version: OPENUI_LANG_PROTOCOL,
      protocol: OPENUI_LANG_PROTOCOL,
      compatibility_protocol: "v0.9",
      catalog_version: OPENUI_LANG_BASIC_CATALOG_VERSION,
      server_capabilities: {
        supportedCatalogIds: [OPENUI_LANG_BASIC_CATALOG_ID],
        supported_openui_lang_protocols: [OPENUI_LANG_PROTOCOL],
        supportedViewProtocols: [OPENUI_LANG_VIEW_PROTOCOL],
        supported_components: [...BASIC_OPENUI_LANG_COMPONENTS],
        supported_openui_components: supportedOpenUIComponents,
        supportedOpenUIComponents: supportedOpenUIComponents,
        component_contracts: {
          basic: BASIC_OPENUI_COMPONENT_CONTRACT_DOCS,
          openui: OPENUI_BUSINESS_COMPONENT_CONTRACT_DOCS,
          domain: getChatPageRenderers().map((renderer) => ({ name: renderer.name }))
        },
        presentation_policy: OPENUI_PRESENTATION_POLICY_CAPABILITIES,
        acceptsClientDataModel: true,
        actions: [
          "runtime.pending_action.confirm",
          "runtime.pending_action.reject",
          "task.resume.select",
          "task.resume.ignore",
          OPENUI_FORM_SUBMIT_ACTION,
          LEGACY_A2UI_FORM_SUBMIT_ACTION
        ],
        compatibilityCatalogIds: [LEGACY_A2UI_BASIC_CATALOG_ID]
      }
    };
  }

  defaultCatalogId(): string {
    return OPENUI_LANG_BASIC_CATALOG_ID;
  }

  isSupportedComponent(name: string): boolean {
    return BASIC_COMPONENTS.has(name);
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
