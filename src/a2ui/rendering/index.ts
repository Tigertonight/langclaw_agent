/**
 * Legacy A2UI rendering facade.
 *
 * OpenUI Lang owns the renderer ports and implementations. The exports below
 * keep the old class/function names as aliases for compatibility.
 */

export {
  BasicComponentCatalog,
  OpenUILangBasicHtmlRenderer as BasicHtmlRenderer,
  OpenUILangFormHtmlRenderer as FormHtmlRenderer,
  OpenUILangFormilyRenderer as FormilyRenderer,
  OpenUILangReactBasicRenderer as ReactBasicRenderer,
  OpenUIRendererRegistry,
  openUILangBrowserBasicRuntimeScript as a2uiBrowserBasicRuntimeScript,
  openUILangBrowserOpenUIRuntimeScript as a2uiBrowserOpenUIRuntimeScript,
  openUILangBrowserStateRuntimeScript as a2uiBrowserStateRuntimeScript,
  readOpenUILangDataPath as readA2UIDataPath,
  readSurfaceFormContract,
  resolveOpenUILangText as resolveA2UIText
} from "../../openui-lang/index.js";
export type {
  BasicComponentDescriptor,
  OpenUILangComponentCatalog as A2UIComponentCatalog,
  OpenUILangFormilyRenderPlan as A2UIFormilyRenderPlan,
  OpenUILangFormilySchema as A2UIFormilySchema,
  OpenUILangReactNode as A2UIReactNode,
  OpenUILangRenderer as A2UIRenderer,
  OpenUIRenderer
} from "../../openui-lang/index.js";
