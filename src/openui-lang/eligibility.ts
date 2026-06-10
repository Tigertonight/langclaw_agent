import type { JsonObject } from "../types/agent-contracts.js";
import { decideOpenUIPresentation } from "./presentation-policy.js";

export type OpenUILangLayoutIntent = "none" | "table" | "metrics" | "risk_list" | "grouped_list" | "form" | "chart";

export interface OpenUILangEligibilityDecision extends JsonObject {
  eligible: boolean;
  intent: OpenUILangLayoutIntent;
  reason: string;
  source: "model" | "policy";
}

export function decideOpenUILangEligibility(input: {
  message?: unknown;
  answer?: unknown;
  rows?: JsonObject[];
  modelDecision?: unknown;
}): OpenUILangEligibilityDecision {
  const decision = decideOpenUIPresentation(input);
  return {
    eligible: decision.enabled,
    intent: toLegacyIntent(decision.intent),
    reason: decision.reason,
    source: decision.source === "model_hint" ? "model" : "policy"
  };
}

function toLegacyIntent(intent: string): OpenUILangLayoutIntent {
  if (intent === "sources") return "none";
  if (intent === "insights" || intent === "analytics") return "chart";
  return intent as OpenUILangLayoutIntent;
}
