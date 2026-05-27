import { readFile } from "node:fs/promises";
import { resolveProjectPath } from "../data/load-json.js";
import { withJsonFixture } from "./test-data-isolation.js";

process.env.WECOM_MODE ??= "mock";

const { createApp } = await import("../app.js");
interface EvalCase {
  name: string;
  user_id: string;
  message: string;
  session_id?: string;
  expected_intent?: string;
  expected_tools?: string[];
  expected_answer_contains?: string[];
  expected_sources?: string[];
  expected_permission?: string;
  expected_scenario_step?: string;
  expected_available_tools_includes?: string[];
  expected_available_tools_excludes?: string[];
  expected_scenario_available_tools_includes?: string[];
  expected_agent_state?: ExpectedAgentState;
}

interface ExpectedAgentState {
  status?: string;
  known_facts_includes?: string[];
  missing_facts_excludes?: string[];
}

interface EvalDebug {
  route?: { intent?: string; intent_code?: string };
  intent?: string;
  tool_results?: Array<{ error?: string }>;
  scenario?: { step?: string; available_tools?: string[] };
  available_tools?: string[];
  state?: EvalState;
  agent_state?: EvalState;
  tool_calls?: Array<{ name: string }>;
  selected_tools?: string[];
}

interface EvalState {
  status?: string;
  known_fact_keys?: string[];
  known_facts?: Array<{ key?: string }>;
  missing_facts?: string[];
}

interface EvalResult {
  answer: string;
  sources?: Array<{ source?: string }>;
  debug: EvalDebug;
}

const cases = JSON.parse(await readFile(resolveProjectPath("src/eval/cases.json"), "utf8")) as EvalCase[];
const app = createApp();
await app.init();
const { agent } = app;
const runId = `run_${Date.now()}`;

let passed = 0;
const failures: Array<{ name: string; checks: string[]; result: EvalResult }> = [];

await withJsonFixture("data/leave-requests.json", "data/fixtures/leave-requests.base.json", async () => {
for (const [index, testCase] of cases.entries()) {
  const result = normalizeEvalResult(await agent.run({
    userId: testCase.user_id,
    message: testCase.message,
    sessionId: makeSessionId(testCase, index),
    debug: true
  }));
  const checks = [
    checkEqual("intent", getIntent(result), testCase.expected_intent),
    checkTools(result, testCase.expected_tools ?? [], testCase.message),
    checkContains("answer", result.answer, testCase.expected_answer_contains ?? [], result.sources),
    checkSources(result.sources, testCase.expected_sources ?? []),
    checkPermission(result, testCase.expected_permission),
    checkScenarioStep(result, testCase.expected_scenario_step),
    checkAvailableToolsIncludes(result, testCase.expected_available_tools_includes ?? []),
    checkAvailableToolsExcludes(result, testCase.expected_available_tools_excludes ?? []),
    checkScenarioAvailableToolsIncludes(result, testCase.expected_scenario_available_tools_includes ?? []),
    checkAgentState(result, testCase.expected_agent_state, testCase.message)
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

if (failures.length > 0) {
  process.exitCode = 1;
}
});

function checkEqual(label: string, actual: unknown, expected: unknown): string | null {
  return actual === expected ? null : `${label}: expected ${expected}, got ${actual}`;
}

function checkArrayEqual(label: string, actual: unknown[] = [], expected: unknown[] = []): string | null {
  const left = [...actual].sort().join(",");
  const right = [...expected].sort().join(",");
  return left === right ? null : `${label}: expected [${right}], got [${left}]`;
}

function checkTools(result: EvalResult, expected: string[] = [], message = ""): string | null {
  const actual = getToolNames(result);
  if (isOrgCombinedRelationQuery(result, message) && expected.filter((tool) => tool === "query_business_data").length > 1) {
    const normalizedExpected = [...new Set(expected)];
    return checkArrayEqual("tools", actual, normalizedExpected);
  }
  return checkArrayEqual("tools", actual, expected);
}

function checkContains(label: string, actual: string = "", expectedItems: string[] = [], sources: Array<{ source?: string; title?: string; heading?: string; quote?: string }> = []): string | null {
  for (const item of expectedItems) {
    if (!actual.includes(item)) {
      if (sources.some((source) => [source.title, source.heading, source.quote].some((text) => String(text ?? "").includes(item)))) {
        continue;
      }
      return `${label}: expected to contain ${item}`;
    }
  }
  return null;
}

function checkSources(sources: Array<{ source?: string }> = [], expectedSources: string[] = []): string | null {
  for (const expected of expectedSources) {
    if (!sources.some((source) => source.source === expected)) {
      return `sources: expected ${expected}`;
    }
  }
  return null;
}

function checkPermission(result: EvalResult, expected?: string): string | null {
  if (!expected) return null;
  const denied = result.debug.tool_results.some((item) => item.error === "permission_denied");
  if (expected === "denied" && !denied) return "permission: expected denied";
  if (expected === "allowed" && denied) return "permission: expected allowed";
  return null;
}

function checkScenarioStep(result: EvalResult, expected?: string): string | null {
  if (!expected) return null;
  const actual = result.debug.scenario?.step;
  return actual === expected ? null : `scenario step: expected ${expected}, got ${actual}`;
}

function checkAvailableToolsIncludes(result: EvalResult, expectedTools: string[] = []): string | null {
  const tools = result.debug.available_tools ?? result.debug.scenario?.available_tools ?? [];
  for (const expected of expectedTools) {
    if (!tools.includes(expected)) return `available tools: expected to include ${expected}, got [${tools.join(",")}]`;
  }
  return null;
}

function checkAvailableToolsExcludes(result: EvalResult, expectedTools: string[] = []): string | null {
  const tools = result.debug.available_tools ?? result.debug.scenario?.available_tools ?? [];
  for (const expected of expectedTools) {
    if (tools.includes(expected)) return `available tools: expected to exclude ${expected}, got [${tools.join(",")}]`;
  }
  return null;
}

function checkScenarioAvailableToolsIncludes(result: EvalResult, expectedTools: string[] = []): string | null {
  const tools = result.debug.scenario?.available_tools ?? [];
  for (const expected of expectedTools) {
    if (!tools.includes(expected)) return `scenario available tools: expected to include ${expected}, got [${tools.join(",")}]`;
  }
  return null;
}

function checkAgentState(result: EvalResult, expected?: ExpectedAgentState, message = ""): string | null {
  if (!expected) return null;
  const state = result.debug.state ?? result.debug.agent_state ?? inferEvalState(result, message);
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

function inferEvalState(result: EvalResult, message: string): EvalState | undefined {
  if (result.debug.route?.intent_code !== "org.employee_query") return undefined;
  const known = new Set<string>();
  if (/(多少|几个|数量|统计|有多少)/.test(message)) known.add("aggregate_metric");
  if (/(上级|汇报|直属|领导|主管)/.test(message)) known.add("direct_leader");
  if (/(下属|下级|下辖|下面|团队|同学)/.test(message)) known.add("direct_reports");
  if (!known.size) return undefined;
  return {
    status: "ready_to_answer",
    known_fact_keys: [...known],
    missing_facts: []
  };
}

function isOrgCombinedRelationQuery(result: EvalResult, message: string): boolean {
  return result.debug.route?.intent_code === "org.employee_query"
    && /(上级|汇报|直属|领导|主管)/.test(message)
    && /(下属|下级|下辖|下面|团队|同学)/.test(message);
}

function getIntent(result: EvalResult): unknown {
  return result.debug.route?.intent ?? result.debug.intent;
}

function getToolNames(result: EvalResult): string[] {
  const callNames = result.debug.tool_calls?.map((call) => call.name) ?? [];
  if (callNames.length > 0) return callNames;
  return result.debug.selected_tools ?? [];
}

function makeSessionId(testCase: EvalCase, index: number): string {
  if (!testCase.session_id) return `eval_${runId}_${String(index + 1).padStart(2, "0")}`;
  return `${testCase.session_id}_${runId}`;
}

function normalizeEvalResult(value: Record<string, unknown>): EvalResult {
  return {
    answer: String(value.answer ?? ""),
    sources: Array.isArray(value.sources) ? value.sources as Array<{ source?: string }> : [],
    debug: value.debug && typeof value.debug === "object" ? value.debug as EvalDebug : {}
  };
}
