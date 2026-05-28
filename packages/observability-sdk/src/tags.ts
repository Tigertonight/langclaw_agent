/**
 * Trace/Span 上的 tag 与 metadata 类型。
 *
 * tags 用于 Langfuse 的过滤/分组（business_id / user_id / channel / env 等）。
 * metadata 用于下钻细节（reason / scores / chunks 等）。
 *
 * 为什么 tag 和 metadata 分开：
 *   - tag 是高基数有限值，进 Langfuse 索引能快速过滤
 *   - metadata 是任意 JSON，看详情时展开
 */

export type Channel =
  | "web"
  | "wecom"
  | "feishu"
  | "dingtalk"
  | "webhook"
  | "cron"
  | "cli";

export type Env = "dev" | "staging" | "prod";

export interface RequiredTraceTags {
  business_id: string;
  user_id: string;
  session_id: string;
  channel: Channel;
  env: Env;
}

export interface OptionalTraceTags {
  intent?: string;
  agent_role?: string;
  parent_trace_id?: string;
}

export type TraceTags = RequiredTraceTags & OptionalTraceTags;

/** Span name 命名空间，避免随手写字符串 */
export const SpanName = {
  Route: "route",
  PromptBuild: "prompt_build",
  Llm: "llm",
  Tool: (toolName: string) => `tool:${toolName}`,
  MemorySearch: "memory.search",
  MemoryRecallChunk: "memory.recall.chunk",
  EvolutionJudge: "evolution.judge",
  EvolutionApply: "evolution.apply",
  EvolutionExtract: "evolution.extract",
  IngestChunk: "ingest.chunk",
  IngestEmbed: "ingest.embed"
} as const;
