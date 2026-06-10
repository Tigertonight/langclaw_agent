import type { JsonObject } from "../types/agent-contracts.js";
import type { OpenUILangCompatComponent } from "./types.js";

export interface SurfacePluginContext {
  runId: string;
  surfacePrefix: string;
  record: Record<string, unknown>;
}

export interface SurfaceBuildOutput {
  surfaceId: string;
  root: string;
  data: JsonObject;
  components: OpenUILangCompatComponent[];
}

export interface SurfacePlugin<TData = unknown> {
  kind: string;
  extract: (ctx: SurfacePluginContext) => TData | null;
  build: (data: TData, ctx: SurfacePluginContext) => SurfaceBuildOutput;
}
