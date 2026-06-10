import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

test.describe("OpenUI dynamic form", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
  });

  test("renders LeaveRequestForm contract and submits through openui action", async ({ page }) => {
    let capturedAction: any = null;

    await page.route("**/api/openui/chat/stream", async (route) => {
      const openui = [
        {
          version: "v0.9",
          createSurface: {
            surfaceId: "agent_test_leave_request_form",
            catalogId: "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
            root: "leave_request_root",
            sendDataModel: true
          }
        },
        {
          version: "v0.9",
          updateDataModel: {
            surfaceId: "agent_test_leave_request_form",
            value: {
              step: "collecting",
              completion: 25,
              slots: { leave_type: "年假", reason: "" },
              missing_slots: ["start_time", "end_time", "reason"],
              openui: {
                protocol: "openui-bridge/0.1",
                component: "LeaveRequestForm",
                props: {
                  step: "collecting",
                  completion: 25,
                  slots: { leave_type: "年假", reason: "" },
                  missing_slots: ["start_time", "end_time", "reason"],
                  form: {
                    fields: [
                      { name: "leave_type", label: "请假类型", component: "Select", required: true, options: [{ label: "年假", value: "年假" }, { label: "病假", value: "病假" }] },
                      { name: "start_time", label: "开始时间", component: "DateTime", required: true },
                      { name: "end_time", label: "结束时间", component: "DateTime", required: true },
                      { name: "reason", label: "请假事由", component: "TextArea", required: true }
                    ],
                    initialValues: { leave_type: "年假", start_time: "", end_time: "", reason: "" },
                    submitAction: {
                      name: "openui.form.submit",
                      label: "提交请假申请",
                      context: { source: "playwright", form_kind: "leave_request_form" }
                    }
                  }
                },
                actions: []
              }
            }
          }
        },
        {
          version: "v0.9",
          updateComponents: {
            surfaceId: "agent_test_leave_request_form",
            components: [{ id: "leave_request_root", component: { Card: { children: [] } } }]
          }
        }
      ];
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
        body: `event: done\ndata: ${JSON.stringify({ type: "done", answer: "请补全请假申请", openui })}\n\n`
      });
    });

    await page.route("**/api/openui/action", async (route) => {
      capturedAction = JSON.parse(route.request().postData() || "{}");
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ok: true })
      });
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await submitPrompt(page, "我要请假");

    const form = page.locator(".openui-form");
    await expect(form).toBeVisible({ timeout: 10_000 });
    await expect(form.locator('[name="leave_type"]')).toHaveValue("年假");
    await form.locator('[name="start_time"]').fill("明天9点");
    await form.locator('[name="end_time"]').fill("明天下午6点");
    await form.locator('[name="reason"]').fill("家里有事");
    await form.locator('button[type="submit"]').click();

    await expect.poll(() => capturedAction?.action?.name).toBe("openui.form.submit");
    expect(capturedAction.action.context).toMatchObject({
      source: "playwright",
      form_kind: "leave_request_form",
      values: {
        leave_type: "年假",
        start_time: "明天9点",
        end_time: "明天下午6点",
        reason: "家里有事"
      }
    });
  });

  test("replays historical legacy envelopes from saved sessions", async ({ page }) => {
    const openui = basicTextSurface("agent_test_history", "history_root", "历史 legacy envelope 已渲染");
    await page.route("**/api/openui/chat/stream", async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
        body: `event: done\ndata: ${JSON.stringify({ type: "done", answer: "历史回答", openui })}\n\n`
      });
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await submitPrompt(page, "历史 openui");

    await expect(page.locator(".openui-text", { hasText: "历史 legacy envelope 已渲染" })).toBeVisible({ timeout: 10_000 });
    await expect.poll(async () => page.evaluate(() => {
      const sessions = JSON.parse(localStorage.getItem("langclaw.web.sessions.v6") || "[]");
      return sessions.some((session: any) => (session.messages || []).some((message: any) => message.role === "assistant" && Array.isArray(message.a2ui) && message.a2ui.length > 0));
    })).toBe(true);
    await page.reload();
    await expect(page.locator(".openui-text", { hasText: "历史 legacy envelope 已渲染" })).toBeVisible({ timeout: 10_000 });
  });

  test("renders incremental streaming OpenUI envelopes", async ({ page }) => {
    const envelopes = basicTextSurface("agent_test_streaming", "streaming_root", "流式 OpenUI 已渲染");
    await page.route("**/api/openui/chat/stream", async (route) => {
      const body = [
        `event: openui_envelope\ndata: ${JSON.stringify({ seq: 1, run_id: "run_stream", protocol: "openui-lang/1.0", envelope: envelopes[0] })}`,
        `event: openui_envelope\ndata: ${JSON.stringify({ seq: 2, run_id: "run_stream", protocol: "openui-lang/1.0", envelope: envelopes[1] })}`,
        `event: openui_envelope\ndata: ${JSON.stringify({ seq: 3, run_id: "run_stream", protocol: "openui-lang/1.0", envelope: envelopes[2] })}`,
        `event: done\ndata: ${JSON.stringify({ type: "done", answer: "流式回答", openui: [] })}`
      ].join("\n\n") + "\n\n";
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
        body
      });
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await submitPrompt(page, "流式 openui");

    await expect(page.locator(".openui-text", { hasText: "流式 OpenUI 已渲染" })).toBeVisible({ timeout: 10_000 });
  });

  test("suppresses duplicate markdown table when OpenUI surface owns the display", async ({ page }) => {
    const openui = dataTableSurface("agent_test_openui_table");
    const markdownTable = [
      "### Markdown 重复表",
      "",
      "| 门店 | 风险 |",
      "| --- | --- |",
      "| 华东旗舰店 | 紧急 |"
    ].join("\n");

    await page.route("**/api/openui/chat/stream", async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
        body: `event: done\ndata: ${JSON.stringify({ type: "done", answer: markdownTable, openui })}\n\n`
      });
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await submitPrompt(page, "库存风险表");

    await expect(page.getByText("OpenUI 风险表")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("table")).toHaveCount(1);
    await expect(page.getByText("Markdown 重复表")).toHaveCount(0);
  });

  test("renders RiskListSurface in browser", async ({ page }) => {
    await mockOpenUIStream(page, riskListSurface("agent_test_risk_list"));
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await submitPrompt(page, "用风险列表展示库存预警明细");

    await expect(page.locator("#messages .material-title", { hasText: "库存预警" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("库龄超过90天")).toBeVisible();
    await expect(page.locator(".openui-unsupported")).toHaveCount(0);
  });

  test("renders DataTableSurface in browser", async ({ page }) => {
    await mockOpenUIStream(page, dataTableSurface("agent_test_browser_table"));
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await submitPrompt(page, "用表格展示所有销售订单明细");

    await expect(page.getByText("OpenUI 风险表")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("table")).toHaveCount(1);
    await expect(page.locator(".openui-unsupported")).toHaveCount(0);
  });

  test("renders MetricCardsSurface in browser", async ({ page }) => {
    await mockOpenUIStream(page, metricCardsSurface("agent_test_metric_cards"));
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await submitPrompt(page, "/门店业绩");

    await expect(page.locator("#messages .material-title", { hasText: "门店业绩" })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".material-metric")).toHaveCount(3);
    await expect(page.getByText("待交付订单")).toBeVisible();
    await expect(page.locator(".openui-unsupported")).toHaveCount(0);
  });

  test("renders BarChartSurface in browser", async ({ page }) => {
    await mockOpenUIStream(page, barChartSurface("agent_test_bar_chart"));
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await submitPrompt(page, "用柱状图展示所有销售订单按车系分布");

    await expect(page.getByText("按车系销售订单分布")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.material-bar-chart[data-chart="bar"]')).toHaveCount(1);
    await expect(page.getByText("宋L")).toBeVisible();
    await expect(page.locator(".openui-unsupported")).toHaveCount(0);
  });

  test("renders PieChartSurface in browser", async ({ page }) => {
    await mockOpenUIStream(page, pieChartSurface("agent_test_pie_chart"));
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await submitPrompt(page, "分析一下线索来源构成");

    await expect(page.locator("#messages .material-title", { hasText: "线索来源构成" })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.material-pie-chart[data-chart="pie"]')).toHaveCount(1);
    await expect(page.getByText("线上线索")).toBeVisible();
    await expect(page.locator(".openui-unsupported")).toHaveCount(0);
  });

  test("renders LineChartSurface in browser", async ({ page }) => {
    await mockOpenUIStream(page, lineChartSurface("agent_test_line_chart"));
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await submitPrompt(page, "看一下最近7天成交趋势");

    await expect(page.locator("#messages .material-title", { hasText: "近7天成交趋势" })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.material-line-chart[data-chart="line"]')).toHaveCount(1);
    await expect(page.locator(".openui-unsupported")).toHaveCount(0);
  });

  test("renders AnalyticsDashboardSurface in browser", async ({ page }) => {
    await mockOpenUIStream(page, analyticsDashboardSurface("agent_test_analytics_dashboard"));
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await submitPrompt(page, "统计分析一下本月经营情况");

    await expect(page.getByText("数据分析看板")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".material-dashboard")).toHaveCount(1);
    await expect(page.locator('.material-line-chart[data-chart="line"]')).toHaveCount(1);
    await expect(page.locator("table")).toHaveCount(1);
    await expect(page.locator(".openui-unsupported")).toHaveCount(0);
  });

  test("holds structured markdown deltas while waiting for OpenUI renderer", async ({ page }) => {
    const openui = dataTableSurface("agent_test_streaming_openui_table");
    const markdownTable = [
      "### Markdown 流式表",
      "",
      "| 门店 | 风险 |",
      "| --- | --- |",
      "| 华东旗舰店 | 紧急 |"
    ].join("\n");

    await page.route("**/api/openui/chat/stream", async (route) => {
      const body = [
        `event: delta\ndata: ${JSON.stringify({ type: "delta", text: markdownTable })}`,
        `event: openui_envelope\ndata: ${JSON.stringify({ seq: 1, run_id: "run_stream_table", protocol: "openui-lang/1.0", envelope: openui[0] })}`,
        `event: openui_envelope\ndata: ${JSON.stringify({ seq: 2, run_id: "run_stream_table", protocol: "openui-lang/1.0", envelope: openui[1] })}`,
        `event: openui_envelope\ndata: ${JSON.stringify({ seq: 3, run_id: "run_stream_table", protocol: "openui-lang/1.0", envelope: openui[2] })}`,
        `event: done\ndata: ${JSON.stringify({ type: "done", answer: markdownTable, openui: [] })}`
      ].join("\n\n") + "\n\n";
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
        body
      });
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await submitPrompt(page, "请用表格展示库存风险");

    await expect(page.getByText("OpenUI 风险表")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Markdown 流式表")).toHaveCount(0);
    await expect(page.locator(".markdown .md-table-wrap")).toHaveCount(0);
    await expect(page.locator("table")).toHaveCount(1);
  });
});

async function mockOpenUIStream(page: Page, openui: unknown[]): Promise<void> {
  await page.route("**/api/openui/chat/stream", async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
      body: `event: done\ndata: ${JSON.stringify({ type: "done", answer: "OpenUI rendered", openui })}\n\n`
    });
  });
}

async function submitPrompt(page: Page, text: string): Promise<void> {
  await page.locator("#input").evaluate((element, value) => {
    element.innerHTML = "";
    element.appendChild(document.createTextNode(value));
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  }, text);
  await page.locator("#form").evaluate((form) => {
    const submit = form as HTMLFormElement;
    if (typeof submit.requestSubmit === "function") {
      submit.requestSubmit();
      return;
    }
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

function basicTextSurface(surfaceId: string, rootId: string, text: string) {
  return [
    {
      version: "v0.9",
      createSurface: {
        surfaceId,
        catalogId: "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
        root: rootId,
        sendDataModel: true
      }
    },
    {
      version: "v0.9",
      updateDataModel: {
        surfaceId,
        value: { message: text }
      }
    },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId,
        components: [
          { id: rootId, component: { Card: { children: [`${rootId}_text`] } } },
          { id: `${rootId}_text`, component: { Text: { text: { path: "/message" } } } }
        ]
      }
    }
  ];
}

function dataTableSurface(surfaceId: string) {
  return [
    {
      version: "v0.9",
      createSurface: {
        surfaceId,
        catalogId: "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
        root: "openui_table_root",
        sendDataModel: true
      }
    },
    {
      version: "v0.9",
      updateDataModel: {
        surfaceId,
        value: {
          openui: {
            protocol: "openui-bridge/0.1",
            component: "DataTableSurface",
            props: {
              title: "OpenUI 风险表",
              description: "由 OpenUI renderer 渲染",
              columns: [
                { key: "store", label: "门店" },
                { key: "risk", label: "风险" }
              ],
              rows: [
                { store: "华东旗舰店", risk: "紧急" }
              ]
            },
            actions: []
          }
        }
      }
    },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId,
        components: [{ id: "openui_table_root", component: { Card: { children: [] } } }]
      }
    }
  ];
}

function riskListSurface(surfaceId: string) {
  return openUIBridgeSurface(surfaceId, "openui_risk_root", "RiskListSurface", {
    title: "库存预警",
    risks: [
      { id: "VIN001", level: "high", tool: "dealer_vehicles", message: "库龄超过90天", mitigated: false },
      { id: "VIN002", level: "medium", tool: "dealer_vehicles", message: "合格证待确认", mitigated: false }
    ]
  });
}

function metricCardsSurface(surfaceId: string) {
  return openUIBridgeSurface(surfaceId, "openui_metrics_root", "MetricCardsSurface", {
    title: "门店业绩",
    metrics: [
      { key: "pending_delivery_order_count", label: "待交付订单", value: 2, unit: "单", trend: "warning" },
      { key: "unpaid_order_count", label: "未结清订单", value: 1, unit: "单" },
      { key: "hot_open_lead_count", label: "高意向线索", value: 5, unit: "条" }
    ]
  });
}

function barChartSurface(surfaceId: string) {
  return openUIBridgeSurface(surfaceId, "openui_bar_chart_root", "BarChartSurface", {
    title: "按车系销售订单分布",
    xKey: "series",
    yKey: "total_revenue",
    series: [
      { series: "宋L", total_revenue: 176800 },
      { series: "秦PLUS", total_revenue: 121800 }
    ]
  });
}

function pieChartSurface(surfaceId: string) {
  return openUIBridgeSurface(surfaceId, "openui_pie_chart_root", "PieChartSurface", {
    title: "线索来源构成",
    categoryKey: "source",
    valueKey: "lead_count",
    series: [
      { source: "线上线索", lead_count: 18 },
      { source: "到店", lead_count: 9 },
      { source: "转介绍", lead_count: 5 }
    ]
  });
}

function lineChartSurface(surfaceId: string) {
  return openUIBridgeSurface(surfaceId, "openui_line_chart_root", "LineChartSurface", {
    title: "近7天成交趋势",
    xKey: "date",
    yKey: "order_count",
    series: [
      { date: "06-04", order_count: 2 },
      { date: "06-05", order_count: 3 },
      { date: "06-06", order_count: 1 },
      { date: "06-07", order_count: 5 }
    ]
  });
}

function analyticsDashboardSurface(surfaceId: string) {
  return openUIBridgeSurface(surfaceId, "openui_analytics_root", "AnalyticsDashboardSurface", {
    title: "数据分析看板",
    metrics: [
      { key: "orders", label: "成交订单", value: 32, unit: "单" },
      { key: "revenue", label: "成交额", value: 368, unit: "万" }
    ],
    charts: [
      {
        kind: "line",
        title: "近7天成交趋势",
        xKey: "date",
        yKey: "order_count",
        series: [
          { date: "06-04", order_count: 2 },
          { date: "06-05", order_count: 3 },
          { date: "06-06", order_count: 1 }
        ]
      }
    ],
    insights: [{ title: "成交集中在头部顾问", summary: "王经理贡献最高。", recommendation: "复盘高转化话术。" }],
    columns: [{ key: "advisor", label: "顾问" }, { key: "order_count", label: "成交数", type: "number" }],
    rows: [{ advisor: "王经理", order_count: 12 }, { advisor: "李顾问", order_count: 8 }]
  });
}

function openUIBridgeSurface(surfaceId: string, root: string, component: string, props: Record<string, unknown>) {
  return [
    {
      version: "v0.9",
      createSurface: {
        surfaceId,
        catalogId: "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
        root,
        sendDataModel: true
      }
    },
    {
      version: "v0.9",
      updateDataModel: {
        surfaceId,
        value: {
          openui: {
            protocol: "openui-bridge/0.1",
            component,
            props,
            actions: []
          }
        }
      }
    },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId,
        components: [{ id: root, component: { Card: { children: [] } } }]
      }
    }
  ];
}
