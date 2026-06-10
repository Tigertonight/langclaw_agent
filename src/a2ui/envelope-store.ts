/**
 * Legacy A2UI envelope-store facade.
 *
 * OpenUI Lang owns persisted structured UI event history. The old class and
 * type names remain as aliases because the compatibility envelope file keeps
 * the historical runtime/a2ui-envelopes.json filename.
 */

export {
  OpenUILangEnvelopeStore as A2UIEnvelopeStore
} from "../openui-lang/envelope-store.js";
export type {
  PersistedEnvelope,
  SessionEnvelopeRecord
} from "../openui-lang/envelope-store.js";
