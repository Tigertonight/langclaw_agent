export type {
  TraceEmitter,
  TraceHandle,
  SpanHandle,
  TraceInput,
  SpanInput,
  GenerationInput,
  ScoreInput
} from "./emitter.js";

export type {
  TraceTags,
  RequiredTraceTags,
  OptionalTraceTags,
  Channel,
  Env
} from "./tags.js";
export { SpanName } from "./tags.js";

export { NoopAdapter } from "./adapters/noop.js";
export { LangfuseAdapter } from "./adapters/langfuse.js";
export type { LangfuseAdapterOptions } from "./adapters/langfuse.js";

export {
  scrubString,
  scrubValue,
  loadScrubConfigFromEnv
} from "./scrub.js";
export type { ScrubConfig, ScrubRuleName } from "./scrub.js";

export { getEmitter, __resetEmitterForTests } from "./factory.js";
