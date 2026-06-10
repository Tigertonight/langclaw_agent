/**
 * LEGACY COMPATIBILITY LAYER.
 *
 * New protocol-facing code should import from ../openui-lang/*. This namespace
 * is kept for A2UI v0.9 envelope compatibility, legacy tests, and browser
 * runtime adapters while the external wire format is migrated gradually.
 */

export * from "./adapter.js";
export * from "./catalog-service.js";
export * from "./chat-controller.js";
export * from "./chat-service.js";
export * from "./core/index.js";
export * from "./dto.js";
export * from "./delegate-tool.js";
export * from "./generation-prompt.js";
export * from "./incremental-envelope-parser.js";
export * from "./module.js";
export * from "./payload-fixer.js";
export * from "./pipe-log-service.js";
export * from "./rendering/index.js";
export * from "./schema/index.js";
export * from "./streaming-translator.js";
export * from "./translator-service.js";
export * from "./types.js";
export * from "./validators.js";
