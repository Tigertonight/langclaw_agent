/**
 * Legacy translator service facade.
 *
 * New code should use OpenUI Lang response builders directly. This class keeps
 * the old batch translation API while delegating to OpenUI Lang compatibility
 * envelopes and parser validation.
 */

import { buildOpenUILangLegacyEnvelopes } from "../openui-lang/response.js";
import { OpenUILangIncrementalEnvelopeParser } from "../openui-lang/streaming.js";
import type { OpenUILangClientCapabilities, OpenUILangCompatEnvelope } from "../openui-lang/types.js";

export class A2UITranslatorService {
  constructor(private readonly parser = new OpenUILangIncrementalEnvelopeParser()) {}

  translateAgentResult(
    result: unknown,
    options: { clientCapabilities?: OpenUILangClientCapabilities; includeRuntime?: boolean } = {}
  ): OpenUILangCompatEnvelope[] {
    return this.parser.parse(buildOpenUILangLegacyEnvelopes({
      result,
      clientCapabilities: options.clientCapabilities,
      includeRuntime: options.includeRuntime === true
    }));
  }
}
