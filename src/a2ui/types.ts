import type { JsonObject, JsonValue } from "../types/agent-contracts.js";

export const A2UI_VERSION = "v0.9";
export const A2UI_BASIC_CATALOG_ID = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json";
export const OPENUI_BRIDGE_VERSION = "openui-bridge/0.1";

export interface OpenUIView extends JsonObject {
  protocol: typeof OPENUI_BRIDGE_VERSION;
  component: string;
  props?: JsonObject;
  actions?: JsonObject[];
}

export interface BusinessSurfacePayload extends JsonObject {
  kind: string;
  version: string;
  title?: string;
  openui?: OpenUIView;
}

export interface A2UIAction extends JsonObject {
  event: {
    name: string;
    context?: JsonObject;
  };
}

export interface A2UIComponentInstance extends JsonObject {
  id: string;
  component: JsonObject;
}

export interface A2UICreateSurface extends JsonObject {
  surfaceId: string;
  catalogId?: string;
  root: string;
  sendDataModel?: boolean;
  theme?: JsonObject;
}

export interface A2UIUpdateComponents extends JsonObject {
  surfaceId: string;
  components: A2UIComponentInstance[];
}

export interface A2UIUpdateDataModel extends JsonObject {
  surfaceId: string;
  path?: string;
  value?: JsonValue;
}

export interface A2UIDeleteSurface extends JsonObject {
  surfaceId: string;
}

export interface A2UIEnvelope extends JsonObject {
  version: typeof A2UI_VERSION;
  createSurface?: A2UICreateSurface;
  updateComponents?: A2UIUpdateComponents;
  updateDataModel?: A2UIUpdateDataModel;
  deleteSurface?: A2UIDeleteSurface;
}
