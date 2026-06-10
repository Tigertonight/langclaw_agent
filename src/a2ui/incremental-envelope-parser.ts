/**
 * Legacy incremental parser facade.
 *
 * OpenUI Lang owns parser state, validation, JSON Pointer application, and
 * OpenUI document projection. The A2UI names below are compatibility aliases
 * for older imports.
 */

export {
  OpenUILangIncrementalEnvelopeParser as A2UIIncrementalEnvelopeParser
} from "../openui-lang/streaming.js";

export type {
  OpenUILangIngestResult as IngestResult,
  OpenUILangRejectedEnvelope as RejectedEnvelope,
  OpenUILangStreamingSurfaceSnapshot as SurfaceSnapshot
} from "../openui-lang/streaming.js";
