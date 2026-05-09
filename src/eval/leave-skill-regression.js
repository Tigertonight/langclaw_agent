process.env.WECOM_MODE ??= "mock";

const { createApp } = await import("../app.js");
const { agent } = createApp();
const runId = `leave_regression_${Date.now()}`;
const failures = [];

await test("销售部应扩展到子部门和数据别名", async () => {
  const result = await run("store_gm_001", "查一下销售部的人请假情况", "sales_department");
  expectEqual(result.debug.route?.intent_code, "attendance.leave_query", "intent_code");
  expectEqual(result.debug.selected_skill, "leave-records", "selected_skill");
  expectRows(result, "leave_requests", 4);
  expectFilterValues(result, "department", ["展厅销售组", "华东销售部", "华南销售部"]);
  expectAnswerIncludes(result, ["林悦", "周辰", "沈清和"]);
});

await test("人事部应命中行政人事部/人力资源别名", async () => {
  const result = await run("store_gm_001", "查一下人事部的请假情况", "hr_department");
  expectRows(result, "leave_requests", 1);
  expectFilterValues(result, "department", ["人力资源部"]);
  expectAnswerIncludes(result, ["许宁", "调休"]);
});

await test("公司最近三个月应使用全公司范围和时间窗口", async () => {
  const result = await run("store_gm_001", "查一下整个公司最近三个月的请假记录", "company_recent");
  expectRows(result, "leave_requests", 4);
  expectFilterValues(result, "applicant_user_id", ["__ALL_ORG_USERS__"]);
  expectFilter(result, "start_time", "gte");
  expectFilter(result, "start_time", "lte");
});

await test("普通员工只能查自己的请假记录", async () => {
  const result = await run("sales_001", "查一下我的请假记录", "self_leave");
  expectRows(result, "leave_requests", 2);
  expectFilterValues(result, "applicant_user_id", ["__CURRENT_USER__"]);
  expectAnswerIncludes(result, ["病假", "年假"]);
});

await test("主管查下属请假应使用下属范围", async () => {
  const result = await run("showroom_lead_001", "查一下我下面同学的请假记录", "reports_leave");
  expectRows(result, "leave_requests", 2);
  expectFilterValues(result, "applicant_user_id", ["__CURRENT_USER_REPORTS__"]);
  expectAnswerIncludes(result, ["林悦"]);
});

await test("多轮补充条件应继承上一轮请假任务", async () => {
  const sessionId = `${runId}_continuation`;
  await run("store_gm_001", "查一下请假记录", sessionId);
  const result = await run("store_gm_001", "销售部 最近三个月", sessionId);
  expectEqual(result.debug.conversation?.current_message?.is_likely_continuation, true, "continuation");
  expectRows(result, "leave_requests", 4);
  expectFilterValues(result, "department", ["展厅销售组", "华东销售部", "华南销售部"]);
});

await test("显式新问题不应被上一轮请假上下文黏住", async () => {
  const sessionId = `${runId}_switch`;
  await run("store_gm_001", "查一下销售部的人请假情况", sessionId);
  const result = await run("store_gm_001", "差旅报销标准是什么", sessionId);
  expectEqual(result.debug.route?.intent, "knowledge_qa", "intent");
  expectEqual(result.debug.selected_skill, "knowledge-qa", "selected_skill");
  expectEqual(result.debug.tool_calls?.length ?? 0, 0, "tool_calls");
});

await test("compact debug 不应回退成大块原始执行上下文", async () => {
  const result = await run("store_gm_001", "查一下销售部的人请假情况", "debug_shape");
  const debug = result.debug ?? {};
  expectEqual(Object.hasOwn(debug, "enterprise_context"), false, "enterprise_context omitted");
  expectEqual(Object.hasOwn(debug, "available_primitives"), false, "available_primitives omitted");
  expectEqual(Object.hasOwn(debug, "available_tools"), false, "available_tools omitted");
  const resultText = JSON.stringify(debug.tool_results ?? []);
  if (resultText.includes("field_labels")) {
    throw new Error("tool_results should not include field_labels");
  }
});

if (failures.length > 0) {
  console.log(`\n${failures.length} leave skill regression case(s) failed.`);
  for (const failure of failures) {
    console.log(`FAIL ${failure.name}: ${failure.message}`);
  }
  process.exitCode = 1;
} else {
  console.log("\nAll leave skill regression cases passed.");
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, message: error.message });
    console.log(`FAIL ${name}`);
  }
}

async function run(userId, message, sessionName) {
  return agent.run({
    userId,
    wecomUserId: userId,
    message,
    sessionId: sessionName.startsWith(runId) ? sessionName : `${runId}_${sessionName}`,
    debug: true
  });
}

function expectRows(result, resource, expected) {
  const toolResult = result.debug.tool_results?.find((item) => item.resource === resource);
  if (!toolResult) throw new Error(`expected tool result for ${resource}`);
  expectEqual(toolResult.row_count, expected, `${resource} row_count`);
}

function expectFilterValues(result, field, expectedValues) {
  const values = result.debug.tool_calls
    ?.flatMap((call) => call.filters ?? [])
    .filter((filter) => filter.field === field)
    .flatMap((filter) => Array.isArray(filter.value) ? filter.value : [filter.value]) ?? [];
  for (const expected of expectedValues) {
    if (!values.includes(expected)) {
      throw new Error(`expected filter ${field} to include ${expected}, got [${values.join(", ")}]`);
    }
  }
}

function expectFilter(result, field, op) {
  const matched = result.debug.tool_calls
    ?.flatMap((call) => call.filters ?? [])
    .some((filter) => filter.field === field && filter.op === op);
  if (!matched) throw new Error(`expected filter ${field} ${op}`);
}

function expectAnswerIncludes(result, snippets) {
  for (const snippet of snippets) {
    if (!result.answer.includes(snippet)) {
      throw new Error(`expected answer to include ${snippet}`);
    }
  }
}

function expectEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}
