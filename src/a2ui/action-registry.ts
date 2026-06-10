/**
 * Legacy A2UI action-registry facade.
 *
 * OpenUI Lang owns the action registry implementation. These aliases keep old
 * imports compiling while preventing a second protocol-layer registry from
 * growing under src/a2ui.
 */

export {
  ActionError,
  LEGACY_A2UI_FORM_SUBMIT_ACTION,
  OPENUI_FORM_SUBMIT_ACTION,
  OpenUILangActionRegistry as A2UIActionRegistry
} from "../openui-lang/action-registry.js";
export type {
  ActionAuthContext,
  ActionDefinition,
  ActionExecuteResult
} from "../openui-lang/action-registry.js";
