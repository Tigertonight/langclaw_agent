import { A2UIPayloadFixer } from "./payload-fixer.js";
import { A2UIEnvelopeValidator, A2UIGraphValidator, A2UINodeValidator } from "./validators.js";
import type { A2UIEnvelope } from "./types.js";

export class A2UIIncrementalEnvelopeParser {
  constructor(
    private readonly payloadFixer = new A2UIPayloadFixer(),
    private readonly envelopeValidator = new A2UIEnvelopeValidator(),
    private readonly nodeValidator = new A2UINodeValidator(),
    private readonly graphValidator = new A2UIGraphValidator()
  ) {}

  parse(input: unknown): A2UIEnvelope[] {
    const raw = Array.isArray(input) ? input : parseJsonLines(String(input ?? ""));
    const fixed = this.payloadFixer.fixMany(raw);
    for (const envelope of fixed) {
      this.envelopeValidator.validate(envelope);
      this.nodeValidator.validate(envelope);
    }
    this.graphValidator.validate(fixed);
    return fixed;
  }
}

function parseJsonLines(text: string): unknown[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
