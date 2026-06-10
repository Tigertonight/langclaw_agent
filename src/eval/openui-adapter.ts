import { BASIC_OPENUI_LANG_COMPONENT_NAMES, CORE_OPENUI_COMPONENT_NAMES, buildOpenUILangLegacyEnvelopes, buildOpenUILangResponse, decideOpenUIPresentation, normalizeOpenUIOutput, validateOpenUISurfaceContract } from "../openui-lang/index.js";
import { OpenUILangDataModel, OpenUILangSchemaSanitizerError, sanitizeOpenUILangSchema } from "../openui-lang/core.js";
import { A2UI_DELEGATE_TOOL_NAME, DEFAULT_A2UI_DELEGATE_DESCRIPTION, OPENUI_LANG_DELEGATE_TOOL_NAME, createA2UIDelegateTool, createOpenUILangDelegateTool, isA2UIDelegateToolResult } from "../openui-lang/delegate-tool.js";
import { createOpenUILangGenerationPrompt } from "../openui-lang/generation-prompt.js";
import { createA2UIModule } from "../a2ui/module.js";
import { OpenUILangIncrementalEnvelopeParser, OpenUILangStreamingTranslator } from "../openui-lang/streaming.js";
import { BasicComponentCatalog, OpenUILangBasicHtmlRenderer, OpenUILangFormHtmlRenderer, OpenUILangFormilyRenderer, OpenUILangReactBasicRenderer } from "../openui-lang/rendering.js";
import { basicComponentToSchema, getBasicComponentName, schemaToBasicComponent } from "../openui-lang/schema.js";
import { registerComponentMapping } from "../openui-lang/compat.js";
import { AVAILABLE_PACKS, DomainRegistry } from "../domains/index.js";
import { getChatPageRenderers, setRuntimeRegistryAccessor } from "../domains/runtime-registry.js";
import { renderChatPage } from "../server/chat-page.js";
import { resolveUserWorkspace } from "../runtime/workspace-context.js";
import { ToolRegistry } from "../tools/registry.js";
import { OpenUILangChatService, createOpenUILangModule } from "../openui-lang/module.js";
import type { JsonObject } from "../types/agent-contracts.js";
import type { OpenUILangWireEnvelope } from "../openui-lang/index.js";

const domainRegistry = new DomainRegistry();
domainRegistry.registerMany(AVAILABLE_PACKS);
await domainRegistry.initialize();
setRuntimeRegistryAccessor(domainRegistry);
registerComponentMapping("vehicle_progress", "DealerVehicleProgress");
registerComponentMapping("leave_request_form", "LeaveRequestForm");

const messages = buildOpenUILangLegacyEnvelopes({
  includeRuntime: true,
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
const openuiDocument = buildOpenUILangResponse({
  includeRuntime: true,
  result: {
    run_id: "run_eval",
    sources: [{ id: "doc-1", source: "policy.md", title: "请假制度", heading: "年假", score: 0.9, quote: "年假需要提前提交申请。" }]
  }
});
assert(openuiDocument.protocol === "openui-lang/1.0", "buildOpenUILangResponse should return OpenUI Lang document");
assert(openuiDocument.version === "1.0", "OpenUI Lang document should expose version 1.0");
assert(openuiDocument.surfaces.some((surface) => surface.id.includes("sources")), "OpenUI Lang document should contain source surface");
assert(openuiDocument.surfaces.every((surface) => surface.protocol === "openui-lang/1.0"), "all OpenUI surfaces should use OpenUI Lang protocol");

const nonDebugMessages = buildOpenUILangLegacyEnvelopes({
  result: {
    run_id: "run_non_debug_eval",
    debug: {
      route: {
        intent_code: "knowledge.policy_qa",
        execution_class: "controlled_execution",
        handler_type: "knowledge_lookup",
        confidence: "high"
      }
    }
  }
});

const wrappedMessages = buildOpenUILangLegacyEnvelopes({
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

const vehicleMessages = buildOpenUILangLegacyEnvelopes({
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

const inventoryRiskMessages = buildOpenUILangLegacyEnvelopes({
  result: {
    run_id: "run_inventory_risk_eval",
    user_message: "用风险列表展示库存预警明细",
    answer: "以下是库存风险明细。",
    debug: {
      tool_results: [{
        ok: true,
        tool: "query_business_data",
        resource: "dealer_vehicles",
        total: 3,
        sample_rows: [
          {
            vin: "VIN-001",
            store_name: "比亚迪华东旗舰店",
            series: "汉",
            model: "汉EV荣耀版 605KM 尊贵型",
            status: "在库",
            stock_age_days: 98,
            stock_warning_level: "紧急"
          },
          {
            vin: "VIN-002",
            store_name: "比亚迪华南标准店",
            series: "海豹",
            model: "海豹DM-i荣耀版 121KM",
            status: "展车",
            stock_age_days: 45,
            stock_warning_level: "关注"
          },
          {
            vin: "VIN-003",
            store_name: "比亚迪华东旗舰店",
            series: "宋L",
            model: "宋L Plus荣耀版 112KM",
            status: "锁定",
            stock_age_days: 21,
            stock_warning_level: "正常"
          }
        ]
      }]
    }
  }
});

const nestedContextInventoryRiskMessages = buildOpenUILangLegacyEnvelopes({
  result: {
    run_id: "run_nested_inventory_risk_eval",
    output: {
      answer: "以下是库存风险明细。",
      _openui_lang_context: {
        openui_lang_decision: { eligible: true, intent: "risk_list", reason: "model selected risk list", source: "model" },
        tool_results: [{
          ok: true,
          tool: "query_business_data",
          data: {
            resource: "dealer_vehicles",
            total: 2,
            rows: [
              { vin: "VIN-N1", store_name: "比亚迪华东旗舰店", series: "汉", model: "汉EV", status: "在库", stock_age_days: 98, stock_warning_level: "紧急" },
              { vin: "VIN-N2", store_name: "比亚迪华南标准店", series: "海豹", model: "海豹DM-i", status: "展车", stock_age_days: 45, stock_warning_level: "关注" }
            ]
          }
        }]
      }
    }
  }
});

const genericTableMessages = buildOpenUILangLegacyEnvelopes({
  result: {
    run_id: "run_generic_table_eval",
    user_message: "列出今天待跟进客户明细",
    answer: "以下是待跟进客户明细。",
    debug: {
      tool_results: [{
        ok: true,
        tool: "query_business_data",
        resource: "sales_followups",
        total: 3,
        rows: [
          { customer_name: "王女士", priority: "高", source: "线上线索", status: "待联系", followup_at: "09:30" },
          { customer_name: "李先生", priority: "中", source: "到店", status: "已预约", followup_at: "14:00" },
          { customer_name: "赵女士", priority: "低", source: "转介绍", status: "待确认", followup_at: "16:30" }
        ]
      }]
    }
  }
});

const genericGroupedMessages = buildOpenUILangLegacyEnvelopes({
  result: {
    run_id: "run_generic_grouped_eval",
    user_message: "列出今天待跟进客户，按优先级分组展示",
    answer: "以下按优先级分组展示。",
    debug: {
      tool_results: [{
        ok: true,
        tool: "query_business_data",
        resource: "sales_followups",
        total: 3,
        rows: [
          { customer_name: "王女士", priority: "高", source: "线上线索", status: "待联系", followup_at: "09:30" },
          { customer_name: "李先生", priority: "中", source: "到店", status: "已预约", followup_at: "14:00" },
          { customer_name: "赵女士", priority: "低", source: "转介绍", status: "待确认", followup_at: "16:30" }
        ]
      }]
    }
  }
});

const genericMetricMessages = buildOpenUILangLegacyEnvelopes({
  result: {
    run_id: "run_generic_metric_eval",
    user_message: "给我今日线索统计指标卡",
    answer: "今日线索统计如下。",
    debug: {
      tool_results: [{
        ok: true,
        tool: "query_business_data",
        resource: "lead_metrics",
        total: 3,
        rows: [
          { label: "新增线索", value: 18, unit: "条", trend: "up" },
          { label: "高意向", value: 5, unit: "条", trend: "flat" },
          { label: "待跟进", value: 7, unit: "条", trend: "down" }
        ]
      }]
    }
  }
});

const genericRiskMessages = buildOpenUILangLegacyEnvelopes({
  result: {
    run_id: "run_generic_risk_eval",
    user_message: "展示订单交付风险列表",
    answer: "订单交付风险如下。",
    debug: {
      tool_results: [{
        ok: true,
        tool: "query_business_data",
        resource: "delivery_risks",
        total: 2,
        rows: [
          { customer_name: "陈先生", risk_level: "高", status: "逾期", expected_delivery_date: "2026-06-12", risk: "合格证未到" },
          { customer_name: "周女士", risk_level: "中", status: "待确认", expected_delivery_date: "2026-06-15", risk: "尾款待支付" }
        ]
      }]
    }
  }
});

const genericBarChartMessages = buildOpenUILangLegacyEnvelopes({
  result: {
    run_id: "run_generic_bar_chart_eval",
    user_message: "用柱状图展示所有销售订单按车系分布",
    answer: "总成交额按车系分布如下。",
    debug: {
      tool_results: [{
        ok: true,
        tool: "query_business_data",
        data: {
          resource: "dealer_sales_orders",
          operation: "aggregate",
          total: 2,
          group_by: "series",
          groups: [
            { group: { series: "宋L" }, row_count: 1, aggregates: { total_revenue: 176800 } },
            { group: { series: "秦PLUS" }, row_count: 1, aggregates: { total_revenue: 121800 } }
          ]
        }
      }]
    }
  }
});

const genericPieChartMessages = buildOpenUILangLegacyEnvelopes({
  result: {
    run_id: "run_generic_pie_chart_eval",
    user_message: "分析一下线索来源构成",
    answer: "线索来源构成如下。",
    structured: {
      resource: "lead_source_analysis",
      charts: [{
        kind: "pie",
        title: "线索来源构成",
        categoryKey: "source",
        valueKey: "lead_count",
        series: [
          { source: "线上线索", lead_count: 18 },
          { source: "到店", lead_count: 9 },
          { source: "转介绍", lead_count: 5 }
        ]
      }]
    }
  }
});

const genericLineChartMessages = buildOpenUILangLegacyEnvelopes({
  result: {
    run_id: "run_generic_line_chart_eval",
    user_message: "看一下最近7天成交趋势",
    answer: "最近7天成交趋势如下。",
    structured: {
      resource: "sales_trend",
      charts: [{
        kind: "line",
        title: "近7天成交趋势",
        xKey: "date",
        yKey: "order_count",
        series: [
          { date: "06-04", order_count: 2 },
          { date: "06-05", order_count: 3 },
          { date: "06-06", order_count: 1 }
        ]
      }]
    }
  }
});

const inferredLineChartMessages = buildOpenUILangLegacyEnvelopes({
  result: {
    run_id: "run_inferred_line_chart_eval",
    user_message: "看一下最近7天成交趋势",
    answer: "最近7天成交趋势如下。",
    structured: {
      resource: "sales_trend_rows",
      rows: [
        { date: "06-04", order_count: 2 },
        { date: "06-05", order_count: 3 },
        { date: "06-06", order_count: 1 }
      ]
    }
  }
});

const inferredPieChartMessages = buildOpenUILangLegacyEnvelopes({
  result: {
    run_id: "run_inferred_pie_chart_eval",
    user_message: "分析一下线索来源构成占比",
    answer: "线索来源构成如下。",
    structured: {
      resource: "lead_source_rows",
      rows: [
        { source: "线上线索", lead_count: 18 },
        { source: "到店", lead_count: 9 },
        { source: "转介绍", lead_count: 5 }
      ]
    }
  }
});

const statsObjectMessages = buildOpenUILangLegacyEnvelopes({
  result: {
    run_id: "run_stats_object_eval",
    user_message: "统计一下本月经营指标",
    answer: "本月经营指标如下。",
    structured: {
      resource: "business_stats",
      stats: {
        order_count: 32,
        lead_count: 86
      }
    }
  }
});

const genericAnalyticsMessages = buildOpenUILangLegacyEnvelopes({
  result: {
    run_id: "run_generic_analytics_eval",
    user_message: "统计分析一下本月经营情况",
    answer: "本月经营情况看板如下。",
    structured: {
      resource: "business_analytics",
      metrics: [
        { key: "orders", label: "成交订单", value: 32, unit: "单" },
        { key: "revenue", label: "成交额", value: 3680000, unit: "元" }
      ],
      charts: [
        {
          kind: "bar",
          title: "顾问成交排行",
          xKey: "advisor",
          yKey: "order_count",
          series: [{ advisor: "王经理", order_count: 12 }, { advisor: "李顾问", order_count: 8 }]
        },
        {
          kind: "line",
          title: "近7天成交趋势",
          xKey: "date",
          yKey: "order_count",
          series: [{ date: "06-04", order_count: 2 }, { date: "06-05", order_count: 3 }]
        }
      ],
      insights: [{ title: "成交集中在头部顾问", summary: "王经理贡献最高。", recommendation: "复盘高转化话术。" }],
      rows: [{ advisor: "王经理", order_count: 12 }, { advisor: "李顾问", order_count: 8 }]
    }
  }
});

const structuredProjectionMessages = buildOpenUILangLegacyEnvelopes({
  result: {
    run_id: "run_structured_projection_eval",
    user_message: "展示今日线索明细",
    answer: "今日线索明细如下。",
    structured: {
      resource: "lead_followups",
      total: 2,
      rows: [
        { customer_name: "林女士", priority: "高", status: "待联系" },
        { customer_name: "许先生", priority: "中", status: "已预约" }
      ]
    }
  }
});

const agenticVehicleMessages = buildOpenUILangLegacyEnvelopes({
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

const expenseMessages = buildOpenUILangLegacyEnvelopes({
  result: {
    run_id: "run_expense_eval",
    user_message: "我在北京住了一晚酒店花了780元，可以报销多少？",
    answer: "北京住宿标准为 600 元/晚，780 元中预计可报 600 元，超标 180 元。"
  }
});

const leaveMessages = buildOpenUILangLegacyEnvelopes({
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
assert(!nonDebugMessages.some((message) => message.createSurface?.surfaceId.includes("runtime")), "runtime surface should be debug-only");
assert(vehicleMessages.some((message) => message.createSurface?.surfaceId.includes("vehicle_progress")), "should create vehicle progress surface");
assert(inventoryRiskMessages.some((message) => message.createSurface?.surfaceId.includes("openui_risk_dealer_vehicles")), "inventory risk rows should use generic OpenUI risk surface");
assert(nestedContextInventoryRiskMessages.some((message) => message.createSurface?.surfaceId.includes("openui_risk_dealer_vehicles")), "nested OpenUI Lang context should create generic risk surface");
assert(genericTableMessages.some((message) => message.createSurface?.surfaceId.includes("openui_table_sales_followups")), "should create generic OpenUI Lang table surface");
assert(genericGroupedMessages.some((message) => message.createSurface?.surfaceId.includes("openui_grouped_sales_followups")), "should create generic OpenUI Lang grouped surface");
assert(genericMetricMessages.some((message) => message.createSurface?.surfaceId.includes("openui_metrics_lead_metrics")), "should create generic OpenUI Lang metric surface");
assert(genericRiskMessages.some((message) => message.createSurface?.surfaceId.includes("openui_risk_delivery_risks")), "should create generic OpenUI Lang risk surface");
assert(genericBarChartMessages.some((message) => message.createSurface?.surfaceId.includes("openui_bar_chart_dealer_sales_orders")), "should create generic OpenUI Lang bar chart surface");
assert(genericPieChartMessages.some((message) => message.createSurface?.surfaceId.includes("openui_pie_chart_lead_source_analysis")), "should create generic OpenUI Lang pie chart surface");
assert(genericLineChartMessages.some((message) => message.createSurface?.surfaceId.includes("openui_line_chart_sales_trend")), "should create generic OpenUI Lang line chart surface");
assert(inferredLineChartMessages.some((message) => message.createSurface?.surfaceId.includes("openui_line_chart_sales_trend_rows")), "rows with trend hint should infer LineChartSurface");
assert(inferredPieChartMessages.some((message) => message.createSurface?.surfaceId.includes("openui_pie_chart_lead_source_rows")), "rows with composition hint should infer PieChartSurface");
assert(statsObjectMessages.some((message) => message.createSurface?.surfaceId.includes("openui_metrics_business_stats")), "stats object should infer MetricCardsSurface");
assert(genericAnalyticsMessages.some((message) => message.createSurface?.surfaceId.includes("openui_analytics_business_analytics")), "should create generic OpenUI Lang analytics dashboard surface");
assert(structuredProjectionMessages.some((message) => message.createSurface?.surfaceId.includes("openui_table_lead_followups")), "standard structured.rows should create generic OpenUI table surface");
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
const inventoryRiskData = inventoryRiskMessages.find((message) => message.updateDataModel?.surfaceId.includes("openui_risk_dealer_vehicles"))?.updateDataModel?.value;
assert(readPath(inventoryRiskData, ["openui", "component"]) === "RiskListSurface", "inventory risk rows should map to generic RiskListSurface");
assert(readPath(inventoryRiskData, ["openui_lang", "intent"]) === "risk_list", "inventory risk rows should be presentation-driven risk_list");
const genericTableData = genericTableMessages.find((message) => message.updateDataModel?.surfaceId.includes("openui_table_sales_followups"))?.updateDataModel?.value;
assert(readPath(genericTableData, ["openui", "component"]) === "DataTableSurface", "generic structured rows should map to DataTableSurface");
assert(readPath(genericTableData, ["openui_lang", "protocol"]) === "openui-lang/1.0", "generic table should expose OpenUI Lang protocol metadata");
const genericGroupedData = genericGroupedMessages.find((message) => message.updateDataModel?.surfaceId.includes("openui_grouped_sales_followups"))?.updateDataModel?.value;
assert(readPath(genericGroupedData, ["openui", "component"]) === "GroupedListSurface", "generic grouped rows should map to GroupedListSurface");
const genericMetricData = genericMetricMessages.find((message) => message.updateDataModel?.surfaceId.includes("openui_metrics_lead_metrics"))?.updateDataModel?.value;
assert(readPath(genericMetricData, ["openui", "component"]) === "MetricCardsSurface", "generic metric rows should map to MetricCardsSurface");
const genericRiskData = genericRiskMessages.find((message) => message.updateDataModel?.surfaceId.includes("openui_risk_delivery_risks"))?.updateDataModel?.value;
assert(readPath(genericRiskData, ["openui", "component"]) === "RiskListSurface", "generic risk rows should map to RiskListSurface");
const genericBarChartData = genericBarChartMessages.find((message) => message.updateDataModel?.surfaceId.includes("openui_bar_chart_dealer_sales_orders"))?.updateDataModel?.value;
assert(readPath(genericBarChartData, ["openui", "component"]) === "BarChartSurface", "generic aggregate groups should map to BarChartSurface");
assert(readPath(genericBarChartData, ["openui", "props", "xKey"]) === "series", "bar chart xKey should use aggregate group_by field");
assert(readPath(genericBarChartData, ["openui", "props", "yKey"]) === "total_revenue", "bar chart yKey should use primary aggregate field");
const genericPieChartData = genericPieChartMessages.find((message) => message.updateDataModel?.surfaceId.includes("openui_pie_chart_lead_source_analysis"))?.updateDataModel?.value;
assert(readPath(genericPieChartData, ["openui", "component"]) === "PieChartSurface", "structured pie chart should map to PieChartSurface");
const genericLineChartData = genericLineChartMessages.find((message) => message.updateDataModel?.surfaceId.includes("openui_line_chart_sales_trend"))?.updateDataModel?.value;
assert(readPath(genericLineChartData, ["openui", "component"]) === "LineChartSurface", "structured line chart should map to LineChartSurface");
const inferredLineChartData = inferredLineChartMessages.find((message) => message.updateDataModel?.surfaceId.includes("openui_line_chart_sales_trend_rows"))?.updateDataModel?.value;
assert(readPath(inferredLineChartData, ["openui", "component"]) === "LineChartSurface", "trend rows should map to LineChartSurface");
const inferredPieChartData = inferredPieChartMessages.find((message) => message.updateDataModel?.surfaceId.includes("openui_pie_chart_lead_source_rows"))?.updateDataModel?.value;
assert(readPath(inferredPieChartData, ["openui", "component"]) === "PieChartSurface", "composition rows should map to PieChartSurface");
const statsObjectData = statsObjectMessages.find((message) => message.updateDataModel?.surfaceId.includes("openui_metrics_business_stats"))?.updateDataModel?.value;
assert(readPath(statsObjectData, ["openui", "component"]) === "MetricCardsSurface", "stats object should map to MetricCardsSurface");
const genericAnalyticsData = genericAnalyticsMessages.find((message) => message.updateDataModel?.surfaceId.includes("openui_analytics_business_analytics"))?.updateDataModel?.value;
assert(readPath(genericAnalyticsData, ["openui", "component"]) === "AnalyticsDashboardSurface", "mixed analytics output should map to AnalyticsDashboardSurface");
const structuredProjectionData = structuredProjectionMessages.find((message) => message.updateDataModel?.surfaceId.includes("openui_table_lead_followups"))?.updateDataModel?.value;
assert(readPath(structuredProjectionData, ["openui_lang", "decision", "source"]) === "output_shape", "standard structured projection should be classified by Presentation Policy");

// Presentation Policy: OpenUI is selected from normalized output shape; pure text stays Markdown.
{
  const plainDecision = decideOpenUIPresentation({ message: "你好", answer: "你好，有什么可以帮你？" });
  assert(plainDecision.enabled === false && plainDecision.intent === "none", "Presentation Policy should not enable OpenUI for plain text");
  const tableOutput = normalizeOpenUIOutput({ resource: "customers", rows: [{ name: "A" }, { name: "B" }] });
  assert(Boolean(tableOutput), "normalizer should accept rows");
  assert(decideOpenUIPresentation({ output: tableOutput! }).surfaceKind === "DataTableSurface", "rows should map to DataTableSurface");
  const metricOutput = normalizeOpenUIOutput({ resource: "kpi", metrics: [{ key: "sales", label: "成交", value: 12 }] });
  assert(Boolean(metricOutput), "normalizer should accept metrics");
  assert(decideOpenUIPresentation({ output: metricOutput! }).surfaceKind === "MetricCardsSurface", "metrics should map to MetricCardsSurface");
  const chartOutput = normalizeOpenUIOutput({
    resource: "dealer_sales_orders",
    group_by: "series",
    groups: [{ group: { series: "宋L" }, aggregates: { total_revenue: 176800 } }]
  });
  assert(Boolean(chartOutput), "normalizer should accept grouped aggregates");
  assert(decideOpenUIPresentation({ output: chartOutput! }).surfaceKind === "BarChartSurface", "grouped numeric aggregates should map to BarChartSurface");
  const pieOutput = normalizeOpenUIOutput({ resource: "lead_sources", charts: [{ kind: "pie", categoryKey: "source", valueKey: "count", series: [{ source: "线上", count: 10 }] }] });
  assert(Boolean(pieOutput), "normalizer should accept pie charts");
  assert(decideOpenUIPresentation({ output: pieOutput! }).surfaceKind === "PieChartSurface", "pie chart output should map to PieChartSurface");
  const dashboardOutput = normalizeOpenUIOutput({ resource: "analytics", metrics: [{ label: "成交", value: 12 }], charts: [{ kind: "line", xKey: "date", yKey: "count", series: [{ date: "06-01", count: 1 }] }], rows: [{ date: "06-01", count: 1 }] });
  assert(Boolean(dashboardOutput), "normalizer should accept mixed analytics output");
  assert(decideOpenUIPresentation({ output: dashboardOutput! }).surfaceKind === "AnalyticsDashboardSurface", "mixed analytics output should map to AnalyticsDashboardSurface");
  const inferredLineOutput = normalizeOpenUIOutput({ resource: "trend_rows", rows: [{ date: "06-01", count: 1 }, { date: "06-02", count: 2 }] });
  assert(Boolean(inferredLineOutput), "normalizer should accept trend rows");
  assert(decideOpenUIPresentation({ message: "看趋势", output: inferredLineOutput! }).surfaceKind === "LineChartSurface", "trend rows should infer LineChartSurface");
  const statsOutput = normalizeOpenUIOutput({ resource: "stats", stats: { order_count: 12 } });
  assert(Boolean(statsOutput), "normalizer should accept stats object");
  assert(decideOpenUIPresentation({ message: "统计指标", output: statsOutput! }).surfaceKind === "MetricCardsSurface", "stats object should map to MetricCardsSurface");
  const riskOutput = normalizeOpenUIOutput({ resource: "risks", rows: [{ risk_level: "高", message: "逾期" }, { risk_level: "中", message: "待确认" }] });
  assert(Boolean(riskOutput), "normalizer should accept risk rows");
  assert(decideOpenUIPresentation({ output: riskOutput! }).surfaceKind === "RiskListSurface", "risk rows should map to RiskListSurface");
}

const approvalData = messages.find((message) => message.updateDataModel?.surfaceId.includes("approval"))?.updateDataModel?.value;
assert(readPath(approvalData, ["business_surface", "kind"]) === "approval_flow", "approval should expose business surface kind");
assert(readPath(approvalData, ["openui", "component"]) === "ApprovalFlow", "approval should map to OpenUI component");
const expenseData = expenseMessages.find((message) => message.updateDataModel?.surfaceId.includes("expense_estimate"))?.updateDataModel?.value;
assert(readPath(expenseData, ["openui", "component"]) === "ExpenseEstimate", "expense should map to OpenUI component");
assert(readPath(expenseData, ["eligible_amount"]) === 600, "expense should compute eligible amount");
const leaveData = leaveMessages.find((message) => message.updateDataModel?.surfaceId.includes("leave_request_form"))?.updateDataModel?.value;
assert(readPath(leaveData, ["openui", "component"]) === "LeaveRequestForm", "leave request should map to OpenUI component");
assert(readPath(leaveData, ["slots", "leave_type"]) === "病假", "leave request should extract form slots");
assert(Array.isArray(readPath(leaveData, ["openui", "props", "form", "fields"])), "leave request should expose form fields");
assert(readPath(leaveData, ["openui", "props", "form", "submitAction", "name"]) === "openui.form.submit", "leave form submit should use action registry");

const parsed = new OpenUILangIncrementalEnvelopeParser().parse(messages);
assert(parsed.length === messages.length, "parser should fix and validate generated envelopes");

// OpenUI Lang delegate tool：把“是否需要结构化组件显示”的判断暴露成 agent 可选择工具。
{
  const openuiDelegateTool = createOpenUILangDelegateTool();
  assert(openuiDelegateTool.name === OPENUI_LANG_DELEGATE_TOOL_NAME, "OpenUI Lang delegate should expose stable name");
  assert(openuiDelegateTool.description.includes(DEFAULT_A2UI_DELEGATE_DESCRIPTION), "OpenUI Lang delegate should include default delegation rule prompt");
  assert(openuiDelegateTool.description.includes(createOpenUILangGenerationPrompt()), "OpenUI Lang delegate should include project OpenUI Lang generation rules");
  for (const componentName of ["Card", "Row", "Column", "List", "Text", "Button"]) {
    assert(openuiDelegateTool.description.includes(componentName), `delegate tool should describe Basic Catalog component ${componentName}`);
  }
  assert(openuiDelegateTool.description.includes("DataTableSurface(title?, description?, columns"), "delegate tool should describe DataTableSurface contract signature");
  assert(openuiDelegateTool.description.includes("RiskListSurface(title?, risks"), "delegate tool should describe RiskListSurface contract signature");
  assert(openuiDelegateTool.description.includes("不得在调用前或调用后追加任何文字内容"), "delegate tool should forbid extra text around delegation");
  const registry = new ToolRegistry([openuiDelegateTool]);
  const tools = registry.list({
    user: { id: "eval", role: "eval", permissions: [] },
    intent: "knowledge_qa"
  });
  assert(tools.some((tool) => tool.name === OPENUI_LANG_DELEGATE_TOOL_NAME), "OpenUI Lang delegate should be available for structured-answer intents");
  assert(!tools.some((tool) => tool.name === A2UI_DELEGATE_TOOL_NAME), "legacy A2UI delegate should not be exposed on the OpenUI Lang primary tool path");
  const result = await registry.execute(
    { name: OPENUI_LANG_DELEGATE_TOOL_NAME, args: {} },
    { user: { id: "eval", role: "eval", permissions: [] }, session_id: "session_eval", run_id: "run_eval" }
  );
  assert(isA2UIDelegateToolResult(result), "delegate tool execute result should be recognizable");
  assert(readPath(result, ["session_id"]) === "session_eval", "delegate tool should preserve session context");
  assert(readPath(result, ["protocol"]) === "openui-lang/1.0", "OpenUI Lang delegate should return protocol marker");

  const legacyDelegateTool = createA2UIDelegateTool();
  assert(legacyDelegateTool.name === A2UI_DELEGATE_TOOL_NAME, "legacy delegate alias should remain stable for old callers");
  const legacyResult = await new ToolRegistry([legacyDelegateTool]).execute(
    { name: A2UI_DELEGATE_TOOL_NAME, args: {} },
    { user: { id: "eval", role: "eval", permissions: [] }, session_id: "session_eval", run_id: "run_eval" }
  );
  assert(isA2UIDelegateToolResult(legacyResult), "legacy delegate result should still be recognized by compatibility detector");
}

// ComponentSchema adapter：Basic Catalog ↔ 标准 componentName/props/children
{
  const basic = { id: "card_1", component: { Card: { children: ["text_1"] } } };
  const schema = basicComponentToSchema(basic);
  assert(schema.componentName === "Card", "basic adapter should expose componentName");
  assert(schema.children?.[0] === "text_1", "basic adapter should expose children");
  const roundtrip = schemaToBasicComponent(schema);
  assert(getBasicComponentName(roundtrip) === "Card", "schema adapter should roundtrip component name");
  const children = readPath(roundtrip, ["component", "Card", "children"]);
  assert(Array.isArray(children) && children[0] === "text_1", "schema adapter should roundtrip children");
}

// JSON Pointer：正式支持 /a/b、~1、~0；legacy dot path 仍兼容老 envelope。
{
  const model = new OpenUILangDataModel();
  model.update("/a/b", 1);
  model.update("/a~1b", 2);
  model.update("/a~0b", 3);
  model.update("legacy.count", 4);
  assert(readPath(model.snapshot(), ["a", "b"]) === 1, "json pointer /a/b should update nested object");
  assert(readPath(model.snapshot(), ["a/b"]) === 2, "json pointer ~1 should decode slash");
  assert(readPath(model.snapshot(), ["a~b"]) === 3, "json pointer ~0 should decode tilde");
  assert(readPath(model.snapshot(), ["legacy", "count"]) === 4, "legacy dot path should remain compatible");
}

// sanitizer：动态表达式危险 token 拒绝，普通文本不误伤。
{
  sanitizeOpenUILangSchema({ text: { literalString: "document 只是普通文案时不应被拒绝" } });
  let rejected = false;
  try {
    sanitizeOpenUILangSchema({ type: "JSExpression", value: "window.fetch('/x')" });
  } catch (error) {
    rejected = error instanceof OpenUILangSchemaSanitizerError;
  }
  assert(rejected, "schema sanitizer should reject dangerous dynamic expressions");
}

// OpenUILangBasicHtmlRenderer：Basic Catalog 渲染、dataModel path 取值、OpenUI 未知组件降级。
{
  const catalog = new BasicComponentCatalog();
  assert(Boolean(catalog.lookup("Card")?.acceptsChildren), "BasicComponentCatalog should expose Card descriptor");
  assert(catalog.listRegistered().includes("Button"), "BasicComponentCatalog should list Basic components");

  const parser = new OpenUILangIncrementalEnvelopeParser();
  parser.ingest([
    { version: "v0.9", createSurface: { surfaceId: "renderer", root: "root", catalogId: "cat" } },
    { version: "v0.9", updateDataModel: { surfaceId: "renderer", value: { user: { name: "张三" } } } },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId: "renderer",
        components: [
          { id: "root", component: { Card: { children: ["hello"] } } },
          { id: "hello", component: { Text: { text: { path: "/user/name" } } } }
        ]
      }
    }
  ]);
  const html = new OpenUILangBasicHtmlRenderer().renderSurface(parser.snapshot()[0]);
  assert(html.includes("张三"), "OpenUILangBasicHtmlRenderer should resolve Text path from data model");

  parser.reset();
  parser.ingest([
    { version: "v0.9", createSurface: { surfaceId: "datatable_openui", root: "root", catalogId: "cat" } },
    {
      version: "v0.9",
      updateDataModel: {
        surfaceId: "datatable_openui",
        value: {
          openui: {
            protocol: "openui-bridge/0.1",
            component: "DataTableSurface",
            props: {
              title: "风险表",
              columns: [{ key: "store", label: "门店" }, { key: "risk", label: "风险", type: "status" }],
              rows: [{ store: "华东旗舰店", risk: "紧急" }],
              rowCount: 1
            }
          }
        }
      }
    },
    { version: "v0.9", updateComponents: { surfaceId: "datatable_openui", components: [{ id: "root", component: { Card: { children: [] } } }] } }
  ]);
  const tableHtml = new OpenUILangBasicHtmlRenderer().renderSurface(parser.snapshot()[0]);
  assert(tableHtml.includes("<table>") && tableHtml.includes("华东旗舰店"), "OpenUILangBasicHtmlRenderer should render DataTableSurface by default");

  parser.reset();
  parser.ingest([
    { version: "v0.9", createSurface: { surfaceId: "barchart_openui", root: "root", catalogId: "cat" } },
    {
      version: "v0.9",
      updateDataModel: {
        surfaceId: "barchart_openui",
        value: {
          openui: {
            protocol: "openui-bridge/0.1",
            component: "BarChartSurface",
            props: {
              title: "车系分布",
              xKey: "series",
              yKey: "total_revenue",
              series: [
                { series: "宋L", total_revenue: 176800 },
                { series: "秦PLUS", total_revenue: 121800 }
              ]
            }
          }
        }
      }
    },
    { version: "v0.9", updateComponents: { surfaceId: "barchart_openui", components: [{ id: "root", component: { Card: { children: [] } } }] } }
  ]);
  const chartHtml = new OpenUILangBasicHtmlRenderer().renderSurface(parser.snapshot()[0]);
  assert(chartHtml.includes("openui-bar-chart") && chartHtml.includes("宋L"), "OpenUILangBasicHtmlRenderer should render BarChartSurface by default");

  const businessRenderer = new OpenUILangBasicHtmlRenderer();
  const evidenceHtml = businessRenderer.renderSurface({
    surfaceId: "evidence",
    root: "root",
    data: {
      openui: {
        protocol: "openui-bridge/0.1",
        component: "EvidenceSurface",
        props: { title: "证据", items: [{ title: "制度", source: "policy.md", quote: "可报销" }] }
      }
    },
    components: [{ id: "root", component: { Card: { children: [] } } }]
  });
  assert(evidenceHtml.includes("policy.md") && evidenceHtml.includes("可报销"), "OpenUILangBasicHtmlRenderer should render EvidenceSurface by default");
  const toolCatalogHtml = businessRenderer.renderSurface({
    surfaceId: "tools",
    root: "root",
    data: {
      openui: {
        protocol: "openui-bridge/0.1",
        component: "ToolCatalogSurface",
        props: { tools: [{ name: "query_business_data", description: "查询业务数据", category: "dealer", risk_level: "read" }] }
      }
    },
    components: [{ id: "root", component: { Card: { children: [] } } }]
  });
  assert(toolCatalogHtml.includes("query_business_data") && toolCatalogHtml.includes("dealer"), "OpenUILangBasicHtmlRenderer should render ToolCatalogSurface by default");
  const taskHtml = businessRenderer.renderSurface({
    surfaceId: "tasks",
    root: "root",
    data: {
      openui: {
        protocol: "openui-bridge/0.1",
        component: "TaskTrackingSurface",
        props: { tasks: [{ id: "t1", subject: "跟进请假", status: "active", next_action: "确认日期" }] }
      }
    },
    components: [{ id: "root", component: { Card: { children: [] } } }]
  });
  assert(taskHtml.includes("跟进请假") && taskHtml.includes("确认日期"), "OpenUILangBasicHtmlRenderer should render TaskTrackingSurface by default");
  const pendingHtml = businessRenderer.renderSurface({
    surfaceId: "pending",
    root: "root",
    data: {
      openui: {
        protocol: "openui-bridge/0.1",
        component: "PendingActionSurface",
        props: { actions: [{ action_id: "pa1", description: "提交请假申请", risk_level: "write", args_preview: "年假" }] }
      }
    },
    components: [{ id: "root", component: { Card: { children: [] } } }]
  });
  assert(pendingHtml.includes("提交请假申请") && pendingHtml.includes("write"), "OpenUILangBasicHtmlRenderer should render PendingActionSurface by default");
  const expenseHtml = businessRenderer.renderSurface({
    surfaceId: "expense",
    root: "root",
    data: {
      openui: {
        protocol: "openui-bridge/0.1",
        component: "ExpenseEstimate",
        props: { title: "报销测算", eligible_amount: 600, exceeded_amount: 200 }
      }
    },
    components: [{ id: "root", component: { Card: { children: [] } } }]
  });
  assert(expenseHtml.includes("报销测算") && expenseHtml.includes("eligible_amount"), "OpenUILangBasicHtmlRenderer should render generic business surfaces by default");

  parser.reset();
  parser.ingest([
    { version: "v0.9", createSurface: { surfaceId: "unknown_openui", root: "root", catalogId: "cat" } },
    { version: "v0.9", updateDataModel: { surfaceId: "unknown_openui", value: { openui: { protocol: "openui-bridge/0.1", component: "MissingWidget", props: {} } } } },
    { version: "v0.9", updateComponents: { surfaceId: "unknown_openui", components: [{ id: "root", component: { Card: { children: [] } } }] } }
  ]);
  const fallback = new OpenUILangBasicHtmlRenderer().renderSurface(parser.snapshot()[0]);
  assert(fallback.includes("MissingWidget") && fallback.includes("不支持的组件"), "OpenUILangBasicHtmlRenderer should downgrade unknown OpenUI components");

  const formHtml = new OpenUILangFormHtmlRenderer().render(readPath(leaveData, ["openui", "props", "form"]) as never);
  assert(formHtml.includes('data-action="openui.form.submit"'), "OpenUILangFormHtmlRenderer should render submit action");
  assert(formHtml.includes('name="leave_type"') && formHtml.includes('name="reason"'), "OpenUILangFormHtmlRenderer should render leave form fields");
  const reactNode = new OpenUILangReactBasicRenderer().renderSurface(parser.snapshot()[0]);
  assert(reactNode?.type === "OpenUIUnsupported", "OpenUILangReactBasicRenderer should downgrade unknown OpenUI components");
  const leaveParser = new OpenUILangIncrementalEnvelopeParser();
  leaveParser.ingest(leaveMessages);
  const leaveSurface = leaveParser.snapshot().find((surface) => surface.surfaceId.includes("leave_request_form"));
  assert(Boolean(leaveSurface), "leave request surface should be present in parser snapshot");
  const formilyPlan = new OpenUILangFormilyRenderer().renderSurface(leaveSurface!);
  assert(formilyPlan?.schema.properties.leave_type?.["x-component"] === "Select", "OpenUILangFormilyRenderer should map select fields");
  assert(formilyPlan?.schema.properties.reason?.["x-component"] === "Input.TextArea", "OpenUILangFormilyRenderer should map textarea fields");
  assert(formilyPlan?.submitAction.name === "openui.form.submit", "OpenUILangFormilyRenderer should preserve submit action");
  const leaveRendererCode = getChatPageRenderers().find((renderer) => renderer.name === "LeaveRequestForm")?.code ?? "";
  assert(leaveRendererCode.includes("renderOpenUILangForm(props.form"), "LeaveRequestForm chat renderer should mount generic OpenUI Lang form renderer");
  const chatHtml = renderChatPage();
  assert(chatHtml.includes("function renderOpenUILangForm"), "chat page should expose generic OpenUI Lang form renderer");
  assert(chatHtml.includes("function listRegisteredOpenUIRenderers"), "chat page should include OpenUI renderer registry runtime");
  assert(chatHtml.includes("function applyOpenUILangDocumentToState"), "chat page should render OpenUI Lang documents without requiring legacy envelopes");
  assert(chatHtml.includes(".openui-form-field"), "chat page should include OpenUI form styles");
}

let claimedTask: unknown = null;
let executedActionCount = 0;
const chatService = new OpenUILangChatService(
  {
    async execute(call) {
      executedActionCount += 1;
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
assert(readPath(decorated.openui, ["protocol"]) === "openui-lang/1.0", "OpenUI Lang chat service should decorate result with an OpenUI Lang document");
assert(Array.isArray(readPath(decorated.openui, ["surfaces"])) && (readPath(decorated.openui, ["surfaces"]) as unknown[]).length > 0, "OpenUI Lang document should include surfaces");
assert(Array.isArray(decorated.openui_compat) && decorated.openui_compat.length > 0, "OpenUI Lang chat service should keep legacy envelopes under openui_compat");
assert(Array.isArray(decorated.a2ui) && decorated.a2ui.length === decorated.openui_compat.length, "OpenUI Lang chat service should keep legacy A2UI envelope alias for compatibility");
assert(Array.isArray(decorated.openui_pipe) && decorated.openui_pipe.length > 0, "OpenUI Lang chat service should expose pipe log");
const capabilities = chatService.capabilities();
const serverCapabilities = capabilities.server_capabilities && typeof capabilities.server_capabilities === "object" && !Array.isArray(capabilities.server_capabilities)
  ? capabilities.server_capabilities as { supportedCatalogIds?: unknown; compatibilityCatalogIds?: unknown; supported_components?: unknown; supported_openui_components?: unknown; supported_openui_lang_protocols?: unknown; actions?: unknown; component_contracts?: unknown; presentation_policy?: unknown }
  : {};
assert(Array.isArray(serverCapabilities.supportedCatalogIds), "chat service should expose capabilities");
assert((serverCapabilities.supportedCatalogIds as unknown[]).includes("openui.lang.catalog.basic/1.0"), "OpenUI capabilities should expose OpenUI Lang catalog id");
assert(Array.isArray(serverCapabilities.compatibilityCatalogIds), "OpenUI capabilities should expose legacy catalog ids only as compatibility metadata");
assert(Array.isArray(serverCapabilities.supported_components), "chat service should expose supported Basic components");
assert(Array.isArray(serverCapabilities.supported_openui_components), "chat service should expose supported OpenUI components");
assert(Array.isArray(serverCapabilities.supported_openui_lang_protocols), "chat service should expose OpenUI Lang protocols");
assert(capabilities.protocol === "openui-lang/1.0", "capabilities should declare OpenUI Lang as internal protocol");
assert((serverCapabilities.supported_openui_components as unknown[]).includes("GroupedListSurface"), "capabilities should expose GroupedListSurface");
assert(Array.isArray(readPath(serverCapabilities.component_contracts, ["basic"])), "capabilities should expose Basic component contract docs");
assert(JSON.stringify(serverCapabilities.component_contracts).includes("DataTableSurface"), "capabilities should expose OpenUI business component contract docs");
assert(readPath(serverCapabilities.presentation_policy, ["version"]) === "openui.presentation-policy/1.0", "capabilities should expose Presentation Policy");
assert(JSON.stringify(serverCapabilities.presentation_policy).includes("BarChartSurface"), "Presentation Policy capabilities should describe chart mapping");
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
const formSubmitAction = await chatService.handleAction({
  userId: "eval",
  action: { name: "openui.form.submit", context: { form_kind: "leave_request_form", values: { leave_type: "年假" } } }
});
assert(Boolean(formSubmitAction.ok) && readPath(formSubmitAction.result, ["skipped"]) === true, "chat service should route generic form submit through action registry");
const legacyFormSubmitAction = await chatService.handleAction({
  userId: "eval",
  action: { name: "a2ui.form.submit", context: { form_kind: "leave_request_form", values: { leave_type: "年假" } } }
});
assert(Boolean(legacyFormSubmitAction.ok) && readPath(legacyFormSubmitAction.result, ["skipped"]) === true, "chat service should keep legacy form submit alias");
const unsupportedAction = await chatService.handleAction({
  userId: "eval",
  action: { name: "internal.tool.invoke", context: { tool: "task.delete" } }
});
assert(unsupportedAction.ok === false && unsupportedAction.error === "unsupported_action", "chat service should reject unsupported action names");
const beforeIdempotent = executedActionCount;
const firstIdempotent = await chatService.handleAction({
  userId: "eval",
  clientActionId: "action_eval_000000000000000000000001",
  action: { name: "task.resume.select", context: { task_id: "leave_task", task_list_id: "eval_default" } }
});
const replayedIdempotent = await chatService.handleAction({
  userId: "eval",
  clientActionId: "action_eval_000000000000000000000001",
  action: { name: "task.resume.select", context: { task_id: "leave_task", task_list_id: "eval_default" } }
});
assert(Boolean(firstIdempotent.ok), "first idempotent action call should execute");
assert(replayedIdempotent.idempotent_replay === true, "repeated client_action_id should replay cached action result");
assert(executedActionCount === beforeIdempotent + 1, "repeated client_action_id should not execute action twice");

// Legacy module smoke: keep the old public entrypoint working while OpenUI Lang is the default facade.
const legacyModule = createA2UIModule({
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
      await input.onEvent?.({ type: "done", run_id: "run_stream_eval", answer: "stream ok", sources: [{ id: "doc", title: "制度", heading: "说明", quote: "引用" }] });
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

const controllerResult = await legacyModule.chatController.chat({ user_id: "eval", message: "你好", session_id: "module-session" });
assert(Array.isArray(controllerResult.a2ui), "controller should decorate chat response");
assert(Array.isArray(controllerResult.openui), "legacy controller should expose OpenUI compatibility payload on chat response");
let streamedDone = false;
let legacyEnvelopeEvent = false;
await legacyModule.chatController.stream({ user_id: "eval", message: "流式" }, async (event) => {
  if (event.type === "a2ui_envelope") legacyEnvelopeEvent = true;
  if (event.type === "done") streamedDone = Array.isArray(event.a2ui);
});
assert(streamedDone, "controller should decorate stream done event");
assert(legacyEnvelopeEvent, "legacy stream should emit a2ui_envelope events");
let openuiEnvelopeEvent = false;
let openuiDone = false;
await legacyModule.chatController.stream({ user_id: "eval", message: "OpenUI 流式" }, async (event) => {
  if (event.type === "openui_envelope") openuiEnvelopeEvent = true;
  if (event.type === "done") openuiDone = Array.isArray(event.openui);
}, { eventProtocol: "openui" });
assert(openuiEnvelopeEvent, "OpenUI stream should emit openui_envelope events");
assert(openuiDone, "OpenUI stream done should expose openui payload alias");

const openuiModule = createOpenUILangModule({
  queryEngine: {
    async submitMessage(input) {
      return {
        run_id: "run_openui_module_eval",
        session_id: input.sessionId ?? "openui-module-session",
        answer: `ok:${input.message}`,
        sources: [{ id: "doc", title: "制度", heading: "说明", quote: "引用" }]
      };
    }
  },
  streamAgent: {
    async runStream(input) {
      await input.onEvent?.({ type: "done", run_id: "run_openui_stream_eval", answer: "openui stream ok", sources: [{ id: "doc", title: "制度", heading: "说明", quote: "引用" }] });
    }
  },
  toolRegistry: { async execute() { return { ok: true }; } },
  userContextResolver: { async resolve() { return { id: "eval", role: "eval" }; } }
});
const openuiChatResult = await openuiModule.chatController.chat({ user_id: "eval", message: "facade chat", session_id: "openui-module-session" });
assert(readPath(openuiChatResult.openui, ["protocol"]) === "openui-lang/1.0", "OpenUI Lang facade chat should expose OpenUI Lang document");
assert(Array.isArray(readPath(openuiChatResult.openui, ["surfaces"])), "OpenUI Lang facade document should expose surfaces");
assert(Array.isArray(openuiChatResult.openui_compat), "OpenUI Lang facade chat should keep legacy envelopes under openui_compat");
assert(!Array.isArray(openuiChatResult.a2ui), "OpenUI Lang facade chat should not expose legacy a2ui payload");
let facadeOpenUIEnvelope = false;
let facadeDoneOpenUIOnly = false;
let facadeOpenUIEvent = false;
await openuiModule.chatController.streamOpenUI({ user_id: "eval", message: "facade stream" }, async (event) => {
  if (event.type === "openui_envelope") facadeOpenUIEnvelope = true;
  if (event.type === "openui_envelope" && readPath(event as JsonObject, ["openui_event", "protocol"]) === "openui-lang/1.0") facadeOpenUIEvent = true;
  if (event.type === "done") facadeDoneOpenUIOnly = readPath(event as JsonObject, ["openui", "protocol"]) === "openui-lang/1.0" && !Array.isArray((event as JsonObject).a2ui);
});
assert(facadeOpenUIEnvelope, "OpenUI Lang facade should stream openui_envelope by default");
assert(facadeOpenUIEvent, "OpenUI Lang facade stream should expose OpenUI Lang event projection");
assert(facadeDoneOpenUIOnly, "OpenUI Lang facade stream done should expose OpenUI Lang document without legacy a2ui");
const historySession = `openui-history-${Date.now()}`;
let historyRunId = "";
await openuiModule.chatController.streamOpenUI({ user_id: "eval", message: "history stream", session_id: historySession }, async (event) => {
  if (event.type === "openui_run_started" && typeof (event as JsonObject).run_id === "string") historyRunId = String((event as JsonObject).run_id);
});
const openuiHistory = await openuiModule.chatController.history({ userId: "eval", sessionId: historySession });
assert(readPath(openuiHistory, ["protocol"]) === "openui-lang/1.0", "OpenUI history should expose OpenUI Lang protocol");
assert(readPath(openuiHistory, ["openui", "protocol"]) === "openui-lang/1.0", "OpenUI history should include reconstructed OpenUI document");
assert(Array.isArray(readPath(openuiHistory, ["events"])), "OpenUI history should expose OpenUI events");
assert((readPath(openuiHistory, ["events"]) as unknown[]).some((event) => readPath(event, ["openui_event", "protocol"]) === "openui-lang/1.0"), "OpenUI history events should include OpenUI Lang event projection");
assert(!Array.isArray((openuiHistory as JsonObject).envelopes), "OpenUI history should not expose legacy envelopes as the primary field");
const openuiHistoryStore = openuiModule.chatService.getHistoryStore();
const historyUser = await openuiModule.chatService.resolveUser("eval");
const historyWorkspaceRun = await openuiHistoryStore.latestRun(resolveUserWorkspace(historyUser), historySession);
assert(historyWorkspaceRun?.protocol === "openui-lang/1.0", "OpenUI history store facade should expose protocol");
assert(historyWorkspaceRun?.document.protocol === "openui-lang/1.0", "OpenUI history store facade should expose document");
assert(historyWorkspaceRun?.events.some((event) => event.openui_event?.protocol === "openui-lang/1.0"), "OpenUI history store facade should expose OpenUI events");
const legacyHistory = await openuiModule.chatController.history({ userId: "eval", sessionId: historySession, runId: historyRunId, sinceSeq: 0 }, { eventProtocol: "legacy" });
assert(Array.isArray((legacyHistory as JsonObject).envelopes), "legacy history option should still expose envelopes");

// ---- 流式 fixture：parser stateful 累积、streaming-translator 行为、与 batch 等价性 ----

// 1) parser ingest 容错：非法 envelope 进 rejected，不影响后续累积
{
  const parser = new OpenUILangIncrementalEnvelopeParser();
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
  const openuiResult = parser.ingestOpenUI([{ version: "v0.9", updateDataModel: { surfaceId: "s1", path: "/hello", value: "openui" } }]);
  assert(openuiResult.acceptedOpenUIEvents.some((event) => event.protocol === "openui-lang/1.0" && event.type === "updateDataModel"), "OpenUI parser facade should expose OpenUI events");
  assert(openuiResult.document.protocol === "openui-lang/1.0" && openuiResult.document.surfaces.some((surface) => surface.id === "s1"), "OpenUI parser facade should expose document snapshot");
}

// 2) parser stateful：多次 ingest 应累积；deleteSurface 应隐藏
{
  const parser = new OpenUILangIncrementalEnvelopeParser();
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
  const parser = new OpenUILangIncrementalEnvelopeParser();
  const captured: JsonObject[] = [];
  const legacyCaptured: OpenUILangWireEnvelope[] = [];
  const translator = new OpenUILangStreamingTranslator(parser, async (event, document, envelope) => {
    captured.push(event);
    legacyCaptured.push(envelope);
    assert(document.protocol === "openui-lang/1.0", "stream listener should receive OpenUI document snapshot");
  }, { runId: "run_x" });
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
  assert(captured.some((event) => readPath(event, ["type"]) === "deleteSurface" && String(readPath(event, ["surfaceId"]) ?? "").includes("progress")), "OpenUI deleteSurface event emitted on finalize");
  assert(legacyCaptured.some((e) => e.deleteSurface?.surfaceId.includes("progress")), "legacy deleteSurface envelope still emitted for compatibility");
}

// 4) 等价性：流式累积 snapshot 与 batch parse 后从同一 result finalize 等价
{
  const result = {
    run_id: "run_eq",
    sources: [{ id: "s", source: "p.md", title: "T", heading: "H", score: 0.5, quote: "Q" }],
    debug: { route: { intent_code: "k.policy_qa", execution_class: "controlled_execution", handler_type: "knowledge_lookup", confidence: "high" } }
  };
  const batchParser = new OpenUILangIncrementalEnvelopeParser();
  batchParser.ingest(buildOpenUILangLegacyEnvelopes({ result }));
  const batchSnap = batchParser.snapshot();

  const streamParser = new OpenUILangIncrementalEnvelopeParser();
  const streamTranslator = new OpenUILangStreamingTranslator(streamParser, async () => {}, { runId: "run_eq" });
  await streamTranslator.onAgenticEvent({ kind: "agentic_lifecycle", event: "start" });
  await streamTranslator.finalize(result);
  const streamSnap = streamParser.snapshot();

  assert(streamSnap.length === batchSnap.length, "stream finalize == batch surface count");
  const surfaceIds = (snap: typeof streamSnap) => snap.map((s) => s.surfaceId).sort();
  assert(JSON.stringify(surfaceIds(streamSnap)) === JSON.stringify(surfaceIds(batchSnap)), "surface ids match");
}

// 5) catalog contract：所有插件 build 出来的 component 必须落在 BASIC_COMPONENTS 内；
//    所有 Button action.event.name 必须出现在 capabilities.actions 列表里；
//    所有 surface 必须满足 OpenUI graph + props contract
{
  const allMessages = [
    ...messages,
    ...wrappedMessages,
    ...vehicleMessages,
    ...inventoryRiskMessages,
    ...nestedContextInventoryRiskMessages,
    ...agenticVehicleMessages,
    ...expenseMessages,
    ...leaveMessages
  ];
  const BASIC = new Set(BASIC_OPENUI_LANG_COMPONENT_NAMES);
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
  assert(declaredActions.includes("openui.form.submit"), "capabilities.actions should include OpenUI generic form submit");
  assert(!declaredActions.includes("a2ui.form.submit"), "OpenUI capabilities.actions should not expose legacy A2UI form submit alias");
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

  const allowedOpenUIComponents = [...CORE_OPENUI_COMPONENT_NAMES, ...getChatPageRenderers().map((renderer) => renderer.name)];
  const surfaces = collectSurfaceContracts(allMessages);
  for (const surface of surfaces) {
    const issues = validateOpenUISurfaceContract({ ...surface, allowedOpenUIComponents });
    assert(issues.length === 0, `surface contract failed for ${surface.surfaceId}: ${issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
  }

  const broken = validateOpenUISurfaceContract({
    surfaceId: "broken",
    root: "missing_root",
    data: {},
    components: [{ id: "x", component: { Card: { children: ["ghost"] } } }]
  });
  assert(broken.some((issue) => issue.message.includes("root component")), "contract should reject missing root");
  assert(broken.some((issue) => issue.message.includes("child component")), "contract should reject missing child ref");
}

console.log("PASS openui adapter (OpenUI Lang document + legacy envelope compatibility)");

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

function collectSurfaceContracts(envelopes: OpenUILangWireEnvelope[]): Array<{ surfaceId: string; root: string; data: JsonObject; components: NonNullable<OpenUILangWireEnvelope["updateComponents"]>["components"] }> {
  const surfaces = new Map<string, { surfaceId: string; root: string; data: JsonObject; components: NonNullable<OpenUILangWireEnvelope["updateComponents"]>["components"] }>();
  for (const env of envelopes) {
    if (env.createSurface?.surfaceId) {
      surfaces.set(env.createSurface.surfaceId, {
        surfaceId: env.createSurface.surfaceId,
        root: env.createSurface.root,
        data: {},
        components: []
      });
    }
    if (env.updateDataModel?.surfaceId) {
      const entry = surfaces.get(env.updateDataModel.surfaceId) ?? {
        surfaceId: env.updateDataModel.surfaceId,
        root: "",
        data: {},
        components: []
      };
      if (!env.updateDataModel.path || env.updateDataModel.path === "/") {
        entry.data = toJsonObject(env.updateDataModel.value) ?? {};
      }
      surfaces.set(entry.surfaceId, entry);
    }
    if (env.updateComponents?.surfaceId) {
      const entry = surfaces.get(env.updateComponents.surfaceId) ?? {
        surfaceId: env.updateComponents.surfaceId,
        root: "",
        data: {},
        components: []
      };
      entry.components = env.updateComponents.components;
      surfaces.set(entry.surfaceId, entry);
    }
  }
  return [...surfaces.values()];
}

function toJsonObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
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
