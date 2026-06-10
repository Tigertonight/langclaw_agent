/**
 * Legacy streaming translator facade.
 *
 * Streaming translation is implemented by OpenUI Lang. This module keeps the
 * historic A2UI export names so old callers compile while using the same
 * OpenUI Lang parser, event projection, and compatibility envelopes.
 */

export {
  OpenUILangStreamingTranslator as A2UIStreamingTranslator
} from "../openui-lang/streaming.js";

export type {
  OpenUILangStreamingEmitContext as StreamingEmitContext,
  OpenUILangStreamingListener as StreamingEnvelopeListener
} from "../openui-lang/streaming.js";
