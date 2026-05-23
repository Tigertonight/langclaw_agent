import { buildA2UIResponse, type ClientCapabilities } from "./adapter.js";
import { A2UIIncrementalEnvelopeParser } from "./incremental-envelope-parser.js";
import type { A2UIEnvelope } from "./types.js";

export class A2UITranslatorService {
  constructor(private readonly parser = new A2UIIncrementalEnvelopeParser()) {}

  translateAgentResult(result: unknown, options: { clientCapabilities?: ClientCapabilities } = {}): A2UIEnvelope[] {
    return this.parser.parse(buildA2UIResponse({ result, clientCapabilities: options.clientCapabilities }));
  }
}
