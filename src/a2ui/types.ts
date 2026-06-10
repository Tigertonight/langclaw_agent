/**
 * Legacy A2UI type facade.
 *
 * OpenUI Lang is the protocol owner. These exports preserve the old A2UI v0.9
 * names for compatibility with browser history, older tests, and old imports.
 */

import {
  OPENUI_LANG_BASIC_CATALOG_ID,
  OPENUI_LANG_BASIC_CATALOG_VERSION,
  OPENUI_LANG_VIEW_PROTOCOL
} from "../openui-lang/types.js";

export const A2UI_VERSION = "v0.9";
export const A2UI_BASIC_CATALOG_ID = OPENUI_LANG_BASIC_CATALOG_ID;
export const A2UI_BASIC_DOM_CATALOG_VERSION = OPENUI_LANG_BASIC_CATALOG_VERSION;
export const OPENUI_BRIDGE_VERSION = OPENUI_LANG_VIEW_PROTOCOL;

export type {
  OpenUILangAction as A2UIAction,
  OpenUILangCompatComponent as A2UIComponentInstance,
  OpenUILangCompatCreateSurface as A2UICreateSurface,
  OpenUILangCompatDeleteSurface as A2UIDeleteSurface,
  OpenUILangCompatEnvelope as A2UIEnvelope,
  OpenUILangCompatUpdateComponents as A2UIUpdateComponents,
  OpenUILangCompatUpdateDataModel as A2UIUpdateDataModel,
  OpenUILangView as OpenUIView
} from "../openui-lang/types.js";

export type BusinessSurfacePayload = {
  kind: string;
  version: string;
  title?: string;
  openui?: import("../openui-lang/types.js").OpenUILangView;
};
