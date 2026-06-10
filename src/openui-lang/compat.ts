/**
 * OpenUI Lang surface authoring facade.
 *
 * The legacy A2UI envelope remains a wire-compatibility layer for old browser
 * history and compatibility adapters. New domain/business surface code should
 * import from this module so protocol ownership stays with OpenUI Lang.
 */

export {
  button,
  card,
  formatCurrency,
  list,
  readArray,
  readArrayLike,
  readPath,
  row,
  text,
  toRecord
} from "./builders.js";
export { OPENUI_FORM_SUBMIT_ACTION } from "./action-registry.js";
export { businessSurface, openUIView, registerComponentMapping } from "./view-bridge.js";
export { approvalActions } from "./approval-actions.js";
export { createFormContract } from "./form-contract.js";
export type { SurfaceBuildOutput, SurfacePlugin } from "./plugin-types.js";
export type { OpenUILangCompatComponent as OpenUILangCompatComponentInstance } from "./types.js";
