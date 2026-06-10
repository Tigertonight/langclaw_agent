/**
 * Legacy A2UI catalog-service facade.
 *
 * Catalog capabilities are now defined by OpenUI Lang. A2UI v0.9 catalog ids
 * are exposed only as compatibility metadata.
 */

export {
  BASIC_OPENUI_LANG_COMPONENTS as BASIC_A2UI_COMPONENTS,
  CORE_OPENUI_LANG_COMPONENTS as CORE_OPENUI_COMPONENTS,
  OpenUILangCatalogService as A2UICatalogService
} from "../openui-lang/catalog-service.js";
