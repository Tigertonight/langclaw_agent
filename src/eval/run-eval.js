import { readFile, writeFile } from "node:fs/promises";
import { resolveProjectPath } from "../data/load-json.js";

process.env.WECOM_MODE ??= "mock";

const { createApp } = await import("../app.js");
const cases = JSON.parse(await readFile(resolveProjectPath("src/eval/cases.json"), "utf8"));
const { agent } = createApp();
const runId = `run_${Date.now()}`;
const leaveRequestsPath = resolveProjectPath("data/leave-requests.json");
const leaveRequestsSnapshot = await readFile(leaveRequestsPath, "utf8").catch(() => null);

let passed = 0;
const failures = [];

for (const [index, testCase] of cases.entries()) {
  const result = await agent.run({
    userId: testCase.user_id,
    message: testCase.message,
    sessionId: makeSessionId(testCase, index),
    debug: true
  });
  const checks = [
    checkEqual("intent", getIntent(result), testCase.expected_intent),
    checkArrayEqual("tools", getToolNames(result), testCase.expected_tools ?? []),
    checkContains("answer", result.answer, testCase.expected_answer_contains ?? []),
    checkSources(result.sources, testCase.expected_sources ?? []),
    checkPermission(result, testCase.expected_permission),
    checkScenarioStep(result, testCase.expected_scenario_step),
    checkAvailableToolsIncludes(result, testCase.expected_available_tools_includes ?? []),
    checkAvailableToolsExcludes(result, testCase.expected_available_tools_excludes ?? []),
    checkScenarioAvailableToolsIncludes(result, testCase.expected_scenario_available_tools_includes ?? []),
    checkAgentState(result, testCase.expected_agent_state)
  ].filter(Boolean);

  if (checks.length === 0) {
    passed += 1;
    console.log(`PASS ${testCase.name}`);
  } else {
    failures.push({ name: testCase.name, checks, result });
    console.log(`FAIL ${testCase.name}`);
    for (const check of checks) console.log(`  - ${check}`);
  }
}

console.log(`\n${passed}/${cases.length} eval cases passed.`);

if (leaveRequestsSnapshot !== null) {
  await writeFile(leaveRequestsPath, leaveRequestsSnapshot, "utf8");
}

if (failures.length > 0) {
  process.exitCode = 1;
}

function checkEqual(label, actual, expected) {
  return actual === expected ? null : `${label}: expected ${expected}, got ${actual}`;
}

function checkArrayEqual(label, actual, expected) {
  const left = [...actual].sort().join(",");
  const right = [...expected].sort().join(",");
  return left === right ? null : `${label}: expected [${right}], got [${left}]`;
}

function checkContains(label, actual, expectedItems) {
  for (const item of expectedItems) {
    if (!actual.includes(item)) {
      return `${label}: expected to contain ${item}`;
    }
  }
  return null;
}

function checkSources(sources, expectedSources) {
  for (const expected of expectedSources) {
    if (!sources.some((source) => source.source === expected)) {
      return `sources: expected ${expected}`;
    }
  }
  return null;
}

function checkPermission(result, expected) {
  if (!expected) return null;
  const denied = result.debug.tool_results.some((item) => item.error === "permission_denied");
  if (expected === "denied" && !denied) return "permission: expected denied";
  if (expected === "allowed" && denied) return "permission: expected allowed";
  return null;
}

function checkScenarioStep(result, expected) {
  if (!expected) return null;
  const actual = result.debug.scenario?.step;
  return actual === expected ? null : `scenario step: expected ${expected}, got ${actual}`;
}

function checkAvailableToolsIncludes(result, expectedTools) {
  const tools = result.debug.available_tools ?? result.debug.scenario?.available_tools ?? [];
  for (const expected of expectedTools) {
    if (!tools.includes(expected)) return `available tools: expected to include ${expected}, got [${tools.join(",")}]`;
  }
  return null;
}

function checkAvailableToolsExcludes(result, expectedTools) {
  const tools = result.debug.available_tools ?? result.debug.scenario?.available_tools ?? [];
  for (const expected of expectedTools) {
    if (tools.includes(expected)) return `available tools: expected to exclude ${expected}, got [${tools.join(",")}]`;
  }
  return null;
}

function checkScenarioAvailableToolsIncludes(result, expectedTools) {
  const tools = result.debug.scenario?.available_tools ?? [];
  for (const expected of expectedTools) {
    if (!tools.includes(expected)) return `scenario available tools: expected to include ${expected}, got [${tools.join(",")}]`;
  }
  return null;
}

function checkAgentState(result, expected) {
  if (!expected) return null;
  const state = result.debug.state ?? result.debug.agent_state;
  if (!state) return "agent state: expected state";
  if (expected.status && state.status !== expected.status) {
    return `agent state: expected status ${expected.status}, got ${state.status}`;
  }
  for (const fact of expected.known_facts_includes ?? []) {
    const factKeys = state.known_fact_keys ?? state.known_facts?.map((item) => item.key) ?? [];
    if (!factKeys.includes(fact)) {
      return `agent state: expected known fact ${fact}`;
    }
  }
  for (const fact of expected.missing_facts_excludes ?? []) {
    if (state.missing_facts?.includes(fact)) {
      return `agent state: expected missing facts to exclude ${fact}`;
    }
  }
  return null;
}

function getIntent(result) {
  return result.debug.route?.intent ?? result.debug.intent;
}

function getToolNames(result) {
  const callNames = result.debug.tool_calls?.map((call) => call.name) ?? [];
  if (callNames.length > 0) return callNames;
  return result.debug.selected_tools ?? [];
}

function makeSessionId(testCase, index) {
  if (!testCase.session_id) return `eval_${runId}_${String(index + 1).padStart(2, "0")}`;
  return `${testCase.session_id}_${runId}`;
}
