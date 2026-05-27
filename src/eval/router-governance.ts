import { IntentRegistry } from "../router/intent-registry.js";
import { executionClassForHandler } from "../router/execution-class.js";

const registry = new IntentRegistry({ dir: "data/intent-codes" });
const manifests = registry.listCodes();

assert(manifests.length > 0, "intent registry should load manifests");

for (const manifest of manifests) {
  assert(Boolean(manifest.intent_code), "intent manifest requires intent_code");
  assert(Boolean(manifest.handler_type), `${manifest.intent_code} requires handler_type`);
  assert(Boolean(manifest.params_schema), `${manifest.intent_code} requires params_schema`);
  const expectedClass = executionClassForHandler(manifest.handler_type);
  if (manifest.execution_class) {
    assert(manifest.execution_class === expectedClass, `${manifest.intent_code} execution_class should match handler_type`);
  }
  if (manifest.handler_type === "intent_query") {
    assert(Boolean(manifest.tool_binding), `${manifest.intent_code} intent_query should bind a tool`);
  }
  const examples = Array.isArray(manifest.examples) ? manifest.examples : [];
  assert(examples.length > 0 || manifest.intent_code === "unsupported", `${manifest.intent_code} should provide route eval examples`);
}

const examples = registry.getAllExamples();
assert(examples.length >= manifests.length - 1, "router governance should expose enough examples for eval");

console.log("PASS router governance");

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
