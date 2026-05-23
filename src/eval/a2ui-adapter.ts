import { buildA2UIResponse } from "../a2ui/adapter.js";
import { A2UIChatService } from "../a2ui/chat-service.js";
import { A2UIIncrementalEnvelopeParser } from "../a2ui/incremental-envelope-parser.js";
import { createA2UIModule } from "../a2ui/module.js";

const messages = buildA2UIResponse({
  result: {
    run_id: "run_eval",
    sources: [{
      id: "doc-1",
      source: "policy.md",
      title: "请假制度",
      heading: "年假",
      score: 0.9,
      quote: "年假需要提前提交申请。"
    }],
    debug: {
      route: {
        intent_code: "knowledge.policy_qa",
        execution_class: "controlled_execution",
        handler_type: "knowledge_lookup",
        confidence: "high"
      },
      tool_results: [{
        ok: false,
        tool: "submit_leave_request",
        error: "confirmation_required",
        message: "工具 submit_leave_request 需要用户确认后才能执行。",
        data: {
          pending_action_id: "pa_eval",
          tool: "submit_leave_request",
          risk_level: "write",
          expires_at: "2026-05-22T12:00:00.000Z",
          call: { name: "submit_leave_request", args: { leave_type: "年假" } }
        }
      }]
    },
    trace: {
      task_retrieval: {
        relevant_count: 1,
        top: [{
          id: "leave_task",
          task_list_id: "eval_default",
          subject: "请假申请跟进",
          status: "in_progress",
          next_action: "确认请假日期",
          relevance: 0.8,
          reason: "continue_request"
        }]
      }
    }
  }
});

const wrappedMessages = buildA2UIResponse({
  result: {
    run_id: "run_wrapped_eval",
    output: {
      sources: [{
        id: "doc-wrapped",
        source: "policy.md",
        title: "包装来源",
        heading: "章节",
        score: 0.8,
        quote: "QueryEngine 包装后的 sources 也应该被 A2UI 捕获。"
      }],
      debug: {
        route: {
          intent_code: "knowledge.policy_qa",
          execution_class: "controlled_execution",
          handler_type: "knowledge_lookup",
          confidence: "high"
        }
      }
    }
  }
});

const vehicleMessages = buildA2UIResponse({
  result: {
    run_id: "run_vehicle_eval",
    output: {
      table: {
        rows: [{
          id: "SO-001",
          customer_name: "李明",
          series: "宋L Plus",
          model: "荣耀版",
          order_status: "待交付",
          payment_status: "部分收款",
          invoice_status: "未开票",
          delivery_status: "整备中",
          final_price: 128000,
          paid_amount: 20000,
          expected_delivery_date: "2026-05-12"
        }]
      },
      debug: {
        tool_call: {
          args: {
            resource: "dealer_sales_orders"
          }
        }
      }
    }
  }
});

const agenticVehicleMessages = buildA2UIResponse({
  result: {
    run_id: "run_agentic_vehicle_eval",
    output: {
      debug: {
        tool_results: [{
          ok: true,
          tool: "query_business_data",
          resource: "dealer_sales_orders",
          total: 1,
          sample_rows: [{
            id: "SO-002",
            customer_name: "赵强",
            series: "唐",
            order_status: "整备中",
            payment_status: "已收定金",
            delivery_status: "待整备完成",
            final_price: 300800
          }]
        }]
      }
    }
  }
});

const expenseMessages = buildA2UIResponse({
  result: {
    run_id: "run_expense_eval",
    user_message: "我在北京住了一晚酒店花了780元，可以报销多少？",
    answer: "北京住宿标准为 600 元/晚，780 元中预计可报 600 元，超标 180 元。"
  }
});

const leaveMessages = buildA2UIResponse({
  result: {
    run_id: "run_leave_eval",
    user_message: "帮我明天请病假一天，因为在家休息",
    answer: "请确认是否提交这条请假申请：\n\n- 类型：病假\n- 开始：明天\n- 结束：明天 全天\n- 事由：在家休息"
  }
});

assert(messages.some((message) => message.createSurface?.surfaceId.includes("approval")), "should create approval surface");
assert(messages.some((message) => message.createSurface?.surfaceId.includes("sources")), "should create sources surface");
assert(wrappedMessages.some((message) => message.createSurface?.surfaceId.includes("sources")), "should create sources surface from wrapped output");
assert(messages.some((message) => message.createSurface?.surfaceId.includes("task_resume")), "should create task resume surface");
assert(messages.some((message) => message.createSurface?.surfaceId.includes("runtime")), "should create runtime surface");
assert(vehicleMessages.some((message) => message.createSurface?.surfaceId.includes("vehicle_progress")), "should create vehicle progress surface");
assert(agenticVehicleMessages.some((message) => message.createSurface?.surfaceId.includes("vehicle_progress")), "should create vehicle progress surface from agentic tool results");
assert(expenseMessages.some((message) => message.createSurface?.surfaceId.includes("expense_estimate")), "should create expense estimate surface");
assert(leaveMessages.some((message) => message.createSurface?.surfaceId.includes("leave_request_form")), "should create leave request form surface");
assert(messages.every((message) => message.version === "v0.9"), "should use A2UI v0.9 envelopes");

const approvalUpdate = messages.find((message) => message.updateComponents?.surfaceId.includes("approval"));
const hasConfirmButton = approvalUpdate?.updateComponents?.components.some((item) => Boolean(item.component.Button));
assert(Boolean(hasConfirmButton), "approval surface should include action buttons");
const approvalText = readText(approvalUpdate?.updateComponents?.components.find((item) => item.id === "approval_0_text"));
assert(approvalText.includes("动作 ID：pa_eval") && approvalText.includes("过期时间："), "approval surface should expose action details");

const taskUpdate = messages.find((message) => message.updateComponents?.surfaceId.includes("task_resume"));
const hasTaskSelectButton = taskUpdate?.updateComponents?.components.some((item) => readButtonActionName(item) === "task.resume.select");
assert(Boolean(hasTaskSelectButton), "task resume surface should include select action");

const sourceUpdate = messages.find((message) => message.updateComponents?.surfaceId.includes("sources"));
const sourceText = readText(sourceUpdate?.updateComponents?.components.find((item) => item.id === "source_0"));
assert(sourceText.includes("来源：policy.md") && sourceText.includes("相关度：0.90"), "source surface should include attribution metadata");

const vehicleUpdate = vehicleMessages.find((message) => message.updateComponents?.surfaceId.includes("vehicle_progress"));
const vehicleText = readText(vehicleUpdate?.updateComponents?.components.find((item) => item.id === "vehicle_order_0_body"));
assert(vehicleText.includes("李明") && vehicleText.includes("整备中"), "vehicle progress surface should include order progress details");
const vehicleData = vehicleMessages.find((message) => message.updateDataModel?.surfaceId.includes("vehicle_progress"))?.updateDataModel?.value;
assert(readPath(vehicleData, ["openui", "protocol"]) === "openui-bridge/0.1", "vehicle progress should include OpenUI bridge protocol");
assert(readPath(vehicleData, ["openui", "component"]) === "DealerVehicleProgress", "vehicle progress should map to material component");

const approvalData = messages.find((message) => message.updateDataModel?.surfaceId.includes("approval"))?.updateDataModel?.value;
assert(readPath(approvalData, ["business_surface", "kind"]) === "approval_flow", "approval should expose business surface kind");
assert(readPath(approvalData, ["openui", "component"]) === "ApprovalFlow", "approval should map to OpenUI component");
const expenseData = expenseMessages.find((message) => message.updateDataModel?.surfaceId.includes("expense_estimate"))?.updateDataModel?.value;
assert(readPath(expenseData, ["openui", "component"]) === "ExpenseEstimate", "expense should map to OpenUI component");
assert(readPath(expenseData, ["eligible_amount"]) === 600, "expense should compute eligible amount");
const leaveData = leaveMessages.find((message) => message.updateDataModel?.surfaceId.includes("leave_request_form"))?.updateDataModel?.value;
assert(readPath(leaveData, ["openui", "component"]) === "LeaveRequestForm", "leave request should map to OpenUI component");
assert(readPath(leaveData, ["slots", "leave_type"]) === "病假", "leave request should extract form slots");

const parsed = new A2UIIncrementalEnvelopeParser().parse(messages);
assert(parsed.length === messages.length, "parser should fix and validate generated envelopes");

let claimedTask: unknown = null;
const chatService = new A2UIChatService(
  {
    async execute(call) {
      claimedTask = call;
      return { ok: true, call };
    }
  },
  {
    async resolve() {
      return { id: "eval", role: "eval" };
    }
  }
);
const decorated = await chatService.decorateChatResult({ run_id: "run_eval", sources: [{ id: "doc", title: "制度", heading: "说明", quote: "引用" }] });
assert(Array.isArray(decorated.a2ui) && decorated.a2ui.length > 0, "chat service should decorate result with A2UI envelopes");
assert(Array.isArray(decorated.a2ui_pipe) && decorated.a2ui_pipe.length > 0, "chat service should expose pipe log");
const capabilities = chatService.capabilities();
const serverCapabilities = capabilities.server_capabilities && typeof capabilities.server_capabilities === "object" && !Array.isArray(capabilities.server_capabilities)
  ? capabilities.server_capabilities as { supportedCatalogIds?: unknown }
  : {};
assert(Array.isArray(serverCapabilities.supportedCatalogIds), "chat service should expose capabilities");
const taskAction = await chatService.handleAction({
  userId: "eval",
  action: { name: "task.resume.select", context: { task_id: "leave_task", task_list_id: "eval_default" } }
});
assert(Boolean(taskAction.ok), "chat service should handle task resume select action");
assert(JSON.stringify(claimedTask).includes("task.claim"), "task resume select should call task.claim");
const ignoreAction = await chatService.handleAction({
  userId: "eval",
  action: { name: "task.resume.ignore", context: { task_id: "leave_task" } }
});
assert(Boolean(ignoreAction.ok), "chat service should handle task resume ignore action");

const module = createA2UIModule({
  queryEngine: {
    async submitMessage(input) {
      return {
        run_id: "run_module_eval",
        session_id: input.sessionId ?? "module-session",
        answer: `ok:${input.message}`,
        sources: [{ id: "doc", title: "制度", heading: "说明", quote: "引用" }]
      };
    }
  },
  streamAgent: {
    async runStream(input) {
      await input.onEvent?.({ type: "done", run_id: "run_stream_eval", answer: "stream ok", sources: [] });
    }
  },
  toolRegistry: {
    async execute() {
      return { ok: true };
    }
  },
  userContextResolver: {
    async resolve() {
      return { id: "eval", role: "eval" };
    }
  }
});

const controllerResult = await module.chatController.chat({ user_id: "eval", message: "你好", session_id: "module-session" });
assert(Array.isArray(controllerResult.a2ui), "controller should decorate chat response");
let streamedDone = false;
await module.chatController.stream({ user_id: "eval", message: "流式" }, async (event) => {
  if (event.type === "done") streamedDone = Array.isArray(event.a2ui);
});
assert(streamedDone, "controller should decorate stream done event");

// ---- 流式 fixture：parser stateful 累积、streaming-translator 行为、与 batch 等价性 ----

import { A2UIStreamingTranslator } from "../a2ui/streaming-translator.js";
import type { A2UIEnvelope } from "../a2ui/types.js";

// 1) parser ingest 容错：非法 envelope 进 rejected，不影响后续累积
{
  const parser = new A2UIIncrementalEnvelopeParser();
  const result = parser.ingest([
    { version: "v0.9", createSurface: { surfaceId: "s1", root: "root", catalogId: "cat", sendDataModel: true } },
    { version: "v0.9" }, // 缺 surfaceId/kind，应被拒
    { version: "v0.9", updateComponents: { surfaceId: "s1", components: [{ id: "root", component: { Card: { children: [] } } }] } },
    { version: "v0.9", updateDataModel: { surfaceId: "s1", value: { hello: "world" } } }
  ]);
  assert(result.accepted.length === 3, "ingest should accept 3 envelopes");
  assert(result.rejected.length === 1, "ingest should reject 1 envelope");
  assert(result.snapshot.length === 1, "snapshot should contain 1 surface");
  assert(result.snapshot[0].surfaceId === "s1", "snapshot surface id");
  assert(readPath(result.snapshot[0].data, ["hello"]) === "world", "data model merged");
  assert(result.snapshot[0].components[0]?.id === "root", "components captured");
}

// 2) parser stateful：多次 ingest 应累积；deleteSurface 应隐藏
{
  const parser = new A2UIIncrementalEnvelopeParser();
  parser.ingest([{ version: "v0.9", createSurface: { surfaceId: "s2", root: "r", catalogId: "c", sendDataModel: true } }]);
  parser.ingest([{ version: "v0.9", updateComponents: { surfaceId: "s2", components: [{ id: "r", component: { Card: { children: [] } } }] } }]);
  parser.ingest([{ version: "v0.9", updateDataModel: { surfaceId: "s2", path: "stats.count", value: 7 } }]);
  let snap = parser.snapshot();
  assert(snap.length === 1 && readPath(snap[0].data, ["stats", "count"]) === 7, "path-based data merge works");
  parser.ingest([{ version: "v0.9", deleteSurface: { surfaceId: "s2" } }]);
  snap = parser.snapshot();
  assert(snap.length === 0, "deleteSurface hides surface from snapshot");
}

// 3) streaming-translator：lifecycle/tool 事件 → progress envelope；finalize 后清理 progress
{
  const parser = new A2UIIncrementalEnvelopeParser();
  const captured: A2UIEnvelope[] = [];
  const translator = new A2UIStreamingTranslator(parser, async (env) => { captured.push(env); }, { runId: "run_x" });
  await translator.onAgenticEvent({ kind: "agentic_lifecycle", event: "start" });
  await translator.onAgenticEvent({ kind: "agentic_lifecycle", event: "decided", action: "tool_call", planner_state: { last_tool: "task.list" } });
  await translator.onAgenticEvent({ kind: "agentic_tool", type: "tool_call", tool: "task.list", observation_summary: { count: 3 } });

  const before = parser.snapshot();
  assert(before.length === 1, "during streaming progress surface visible");
  assert(before[0].root === "progress_root", "progress surface root");
  assert(before[0].data._skeleton === false, "tool returned tone=done -> skeleton off");

  await translator.finalize({ run_id: "run_x", debug: { route: { intent_code: "x", execution_class: "y", handler_type: "z", confidence: "high" } } });
  const after = parser.snapshot();
  assert(after.every((s) => s.root !== "progress_root"), "progress surface cleaned after finalize");
  assert(captured.some((e) => e.deleteSurface?.surfaceId.includes("progress")), "deleteSurface emitted on finalize");
}

// 4) 等价性：流式累积 snapshot 与 batch parse 后从同一 result finalize 等价
{
  const result = {
    run_id: "run_eq",
    sources: [{ id: "s", source: "p.md", title: "T", heading: "H", score: 0.5, quote: "Q" }],
    debug: { route: { intent_code: "k.policy_qa", execution_class: "controlled_execution", handler_type: "knowledge_lookup", confidence: "high" } }
  };
  const batchParser = new A2UIIncrementalEnvelopeParser();
  batchParser.ingest(buildA2UIResponse({ result }));
  const batchSnap = batchParser.snapshot();

  const streamParser = new A2UIIncrementalEnvelopeParser();
  const streamTranslator = new A2UIStreamingTranslator(streamParser, async () => {}, { runId: "run_eq" });
  await streamTranslator.onAgenticEvent({ kind: "agentic_lifecycle", event: "start" });
  await streamTranslator.finalize(result);
  const streamSnap = streamParser.snapshot();

  assert(streamSnap.length === batchSnap.length, "stream finalize == batch surface count");
  const surfaceIds = (snap: typeof streamSnap) => snap.map((s) => s.surfaceId).sort();
  assert(JSON.stringify(surfaceIds(streamSnap)) === JSON.stringify(surfaceIds(batchSnap)), "surface ids match");
}

// 5) catalog contract：所有插件 build 出来的 component 必须落在 BASIC_COMPONENTS 内；
//    所有 Button action.event.name 必须出现在 capabilities.actions 列表里
{
  const allMessages = [
    ...messages,
    ...wrappedMessages,
    ...vehicleMessages,
    ...agenticVehicleMessages,
    ...expenseMessages,
    ...leaveMessages
  ];
  const BASIC = new Set(["Text", "Image", "Icon", "Video", "AudioPlayer", "Row", "Column", "List", "Card", "Tabs", "Button"]);
  for (const env of allMessages) {
    if (!env.updateComponents) continue;
    for (const item of env.updateComponents.components) {
      const componentNames = Object.keys(item.component);
      for (const name of componentNames) {
        assert(BASIC.has(name), `component "${name}" must be in BASIC catalog (instance=${item.id})`);
      }
    }
  }

  const capServer = chatService.capabilities().server_capabilities as { actions?: unknown };
  const declaredActions = Array.isArray(capServer?.actions) ? capServer.actions as string[] : [];
  for (const env of allMessages) {
    if (!env.updateComponents) continue;
    for (const item of env.updateComponents.components) {
      const actionName = readButtonActionName(item);
      if (!actionName) continue;
      assert(
        declaredActions.includes(actionName),
        `button action "${actionName}" must be declared in capabilities.actions`
      );
    }
  }
}

console.log("PASS a2ui adapter");

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function readText(component: unknown): string {
  const item = toRecord(component);
  const textComponent = toRecord(toRecord(item?.component)?.Text);
  const text = toRecord(textComponent?.text);
  return typeof text?.literalString === "string" ? text.literalString : "";
}

function readButtonActionName(component: unknown): string {
  const item = toRecord(component);
  const button = toRecord(toRecord(item?.component)?.Button);
  const action = toRecord(button?.action);
  const event = toRecord(action?.event);
  return typeof event?.name === "string" ? event.name : "";
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readPath(value: unknown, path: string[]): unknown {
  let cursor: unknown = value;
  for (const key of path) {
    const record = toRecord(cursor);
    if (!record) return undefined;
    cursor = record[key];
  }
  return cursor;
}
