import type { JsonObject, JsonValue } from "../types/agent-contracts.js";
import type { SurfacePlugin } from "./plugin-types.js";

export const OPENUI_LANG_PROTOCOL = "openui-lang/1.0";
export const OPENUI_LANG_BASIC_CATALOG_ID = "openui.lang.catalog.basic/1.0";
export const OPENUI_LANG_BASIC_CATALOG_VERSION = "openui-lang/1.0";
export const OPENUI_LANG_VIEW_PROTOCOL = "openui-bridge/0.1";
export const OPENUI_LANG_BASIC_CATALOG = OPENUI_LANG_BASIC_CATALOG_ID;

export interface OpenUILangTextValue extends JsonObject {
  literalString?: string;
  path?: string;
}

export interface OpenUILangAction extends JsonObject {
  event: {
    name: string;
    context?: JsonObject;
  };
}

export interface OpenUILangNode extends JsonObject {
  id: string;
  componentName: string;
  props?: JsonObject;
  children?: Array<string | OpenUILangNode>;
}

export interface OpenUILangSurface extends JsonObject {
  protocol: typeof OPENUI_LANG_PROTOCOL;
  id: string;
  root: string;
  catalog?: string;
  data?: JsonObject;
  nodes: OpenUILangNode[];
  view?: OpenUILangView;
}

export interface OpenUILangView extends JsonObject {
  protocol: typeof OPENUI_LANG_PROTOCOL | typeof OPENUI_LANG_VIEW_PROTOCOL;
  component: string;
  props?: JsonObject;
  actions?: JsonObject[];
}

export interface OpenUILangDocument extends JsonObject {
  protocol: typeof OPENUI_LANG_PROTOCOL;
  version: "1.0";
  surfaces: OpenUILangSurface[];
}

export type OpenUILangWireEvent =
  | {
      protocol: typeof OPENUI_LANG_PROTOCOL;
      type: "createSurface";
      surfaceId: string;
      root: string;
      catalog: typeof OPENUI_LANG_BASIC_CATALOG;
      compatibilityCatalogId?: string;
      sendDataModel?: boolean;
      theme?: JsonObject;
    }
  | {
      protocol: typeof OPENUI_LANG_PROTOCOL;
      type: "updateDataModel";
      surfaceId: string;
      path?: string;
      value?: JsonValue;
    }
  | {
      protocol: typeof OPENUI_LANG_PROTOCOL;
      type: "updateComponents";
      surfaceId: string;
      nodes: OpenUILangNode[];
    }
  | {
      protocol: typeof OPENUI_LANG_PROTOCOL;
      type: "deleteSurface";
      surfaceId: string;
    };

export interface OpenUILangDataTableColumn extends JsonObject {
  key: string;
  label: string;
  type?: "text" | "number" | "date" | "status" | "currency";
}

export interface OpenUILangDataTableProps extends JsonObject {
  title?: string;
  description?: string;
  columns: OpenUILangDataTableColumn[];
  rows: JsonObject[];
  rowCount?: number;
}

export type OpenUILangJsonValue = JsonValue;

export interface OpenUILangCompatComponent extends JsonObject {
  id: string;
  component: JsonObject;
}

export interface OpenUILangCompatCreateSurface extends JsonObject {
  surfaceId: string;
  catalogId?: string;
  root: string;
  sendDataModel?: boolean;
  theme?: JsonObject;
}

export interface OpenUILangCompatUpdateComponents extends JsonObject {
  surfaceId: string;
  components: OpenUILangCompatComponent[];
}

export interface OpenUILangCompatUpdateDataModel extends JsonObject {
  surfaceId: string;
  path?: string;
  value?: JsonValue;
}

export interface OpenUILangCompatDeleteSurface extends JsonObject {
  surfaceId: string;
}

/** Legacy browser/history compatibility envelope shape. */
export interface OpenUILangCompatEnvelope extends JsonObject {
  version: "v0.9";
  createSurface?: OpenUILangCompatCreateSurface;
  updateComponents?: OpenUILangCompatUpdateComponents;
  updateDataModel?: OpenUILangCompatUpdateDataModel;
  deleteSurface?: OpenUILangCompatDeleteSurface;
}

/** Compatibility builder/history envelope while legacy adapters are still present. */
export type OpenUILangWireEnvelope = OpenUILangCompatEnvelope;

/** Client rendering capability contract accepted by OpenUI Lang endpoints. */
export interface OpenUILangClientCapabilities {
  catalog_version?: string;
  supported_components?: string[];
}

/** Input accepted by the OpenUI Lang response builder. */
export interface BuildOpenUILangResponseInput {
  result: unknown;
  surfacePrefix?: string;
  plugins?: SurfacePlugin<unknown>[];
  namespace?: string;
  clientCapabilities?: OpenUILangClientCapabilities;
  includeRuntime?: boolean;
}
