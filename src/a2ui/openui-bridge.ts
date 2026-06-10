/**
 * Legacy OpenUI bridge facade.
 *
 * OpenUI Lang owns the bridge registry and kind-to-component mapping. This
 * path remains only for older surface plugins and evals.
 */

export {
  businessSurface,
  openUIView,
  registerComponentMapping
} from "../openui-lang/view-bridge.js";
