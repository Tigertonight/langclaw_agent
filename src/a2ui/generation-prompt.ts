/**
 * Legacy prompt alias.
 *
 * OpenUI Lang owns the structured rendering prompt. This file remains only so
 * old imports continue to compile while callers migrate to ../openui-lang.
 */

export { createOpenUILangGenerationPrompt as createA2UIGenerationPrompt } from "../openui-lang/generation-prompt.js";
