import { buildGenericDataTableSurface, extractGenericOpenUIStructuredData, type GenericOpenUIStructuredData } from "../generic-surface.js";
import type { SurfacePlugin } from "../plugin-types.js";

export const genericOpenUIPlugin: SurfacePlugin<GenericOpenUIStructuredData> = {
  kind: "openui_generic_output",
  extract: (ctx) => extractGenericOpenUIStructuredData(ctx.record),
  build: (data, ctx) => buildGenericDataTableSurface(data, ctx)
};
