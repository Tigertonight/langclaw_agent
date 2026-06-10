/**
 * Legacy A2UI core facade.
 *
 * OpenUI Lang owns the core protocol state manager, dispatcher, JSON Pointer
 * data model, action emitter, and sanitizer. These aliases preserve old import
 * names for compatibility without maintaining a second core implementation.
 */

export {
  OpenUILangActionEmitter as A2UIActionEmitter,
  OpenUILangDataModel as A2UIDataModel,
  OpenUILangEnvelopeDispatcher as A2UIEnvelopeDispatcher,
  OpenUILangSchemaSanitizerError as A2UISchemaSanitizerError,
  OpenUILangSurfaceManager as A2UISurfaceManager,
  parseOpenUILangJsonPointer as parseJsonPointer,
  sanitizeOpenUILangSchema as sanitizeA2UISchema
} from "../../openui-lang/core.js";
export type {
  OpenUILangActionResult as A2UIActionResult,
  OpenUILangClientAction as A2UIClientAction,
  OpenUILangSurfaceSnapshot as A2UISurfaceSnapshot
} from "../../openui-lang/core.js";
