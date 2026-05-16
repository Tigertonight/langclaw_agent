import { createApp } from "../app.js";

const sessionId = `eval_recovery_${Date.now()}`;

interface RecoveryResult {
  answer: string;
  debug: {
    scenario?: {
      step?: string;
    };
  };
}

let app = createApp();
const first = normalizeRecoveryResult(await app.agent.run({
  userId: "sales_001",
  sessionId,
  message: "我明天想请假",
  debug: true
}));

assertEqual(first.debug.scenario.step, "collecting", "first step");

app = createApp();
const second = normalizeRecoveryResult(await app.agent.run({
  userId: "sales_001",
  sessionId,
  message: "年假，请到下午6点，因为家里有事",
  debug: true
}));

assertEqual(second.debug.scenario.step, "awaiting_confirmation", "second step");
if (!second.answer.includes("开始：明天")) {
  throw new Error("recovered session should keep start_time from first turn");
}

await app.sessionStore.clear(sessionId);

console.log("PASS session recovery");

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function normalizeRecoveryResult(value: Record<string, unknown>): RecoveryResult {
  const debug = value.debug && typeof value.debug === "object" ? value.debug as RecoveryResult["debug"] : {};
  return {
    answer: String(value.answer ?? ""),
    debug
  };
}
