import type { JsonObject } from "../../types/agent-contracts.js";
import type { A2UIComponentInstance } from "../types.js";

export interface SurfacePluginContext {
  runId: string;
  surfacePrefix: string;
  record: Record<string, unknown>;
}

export interface SurfaceBuildOutput {
  surfaceId: string;
  root: string;
  data: JsonObject;
  components: A2UIComponentInstance[];
}

/**
 * 业务卡片插件协议：
 * - kind：业务唯一标识，决定 surfaceId 后缀（${prefix}_${runId}_${kind}）
 * - extract：从 agent result 抽取卡片数据；返回 null 表示这一轮不出该卡片
 * - build：把数据 + 上下文转成 surface 输出
 */
export interface SurfacePlugin<TData = unknown> {
  kind: string;
  extract: (ctx: SurfacePluginContext) => TData | null;
  build: (data: TData, ctx: SurfacePluginContext) => SurfaceBuildOutput;
}
