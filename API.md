# API · Enterprise Agent HTTP / SSE 接口契约

> 给前端、第三方集成、运维监控对接用。所有路径相对于 `http://<host>:<port>`，默认 `:3000`。
> 协议规则：所有响应都带 `X-Trace-Id` header（用于跨服务追溯），全部支持 `OPTIONS` 预检。

## 索引

- [鉴权与租户](#鉴权与租户)
- [健康检查](#健康检查)
- [对话](#对话)
  - `POST /api/chat` — 一次性对话
  - `POST /api/chat/stream` — SSE 流式对话（含断线续传）
- [上下文与角色](#上下文与角色)
  - `GET /api/user-context`
  - `GET /api/wecom-users`
- [命令与推荐](#命令与推荐)
  - `GET /api/commands`
  - `GET /api/recommended-commands`
- [工具与处理器](#工具与处理器)
  - `GET /api/handlers`
  - `GET /api/tools/catalog`
- [Skills](#skills)
- [附件](#附件)
- [OpenUI Lang 流式结构化 UI](#openui-lang-流式结构化-ui)
- [可观测](#可观测)
- [运维 / 管理](#运维--管理)
- [错误模型](#错误模型)
- [限流](#限流)

---

## 鉴权与租户

需要鉴权的接口接受以下任一形式（按优先级）：

| 方式 | 来源 | 用途 |
|---|---|---|
| `Authorization: Bearer <token>` | header | 标准 token（生产推荐） |
| `X-User-Id: <user_id>` | header | 内网快速接入（默认开发模式开） |
| `?user_id=<id>` / `?wecom_userid=<id>` | query | 仅 GET 接口 |
| body.`user_id` / body.`wecom_userid` | JSON body | POST 接口 |

`user_id` 必须能在 `data/users.json` 解析到记录。`tenantId` 由 token / 用户记录解析得到，未配置时为 `default`。

**生产部署务必关闭** `OPENUI_AUTH_DISABLED`，否则鉴权被旁路。`A2UI_AUTH_DISABLED` 仅作为旧兼容别名保留。详见 [DEPLOY.md §C3](DEPLOY.md#c3-配置-env生产关键项)。

---

## 健康检查

### `GET /health` — liveness

不查依赖，进程活着就 200。

**响应 200**
```json
{ "ok": true, "service": "enterprise-agent", "started_at": 1730000000000 }
```

### `GET /ready` — readiness

会查依赖（auth、关键 store）。draining 期间返回 503。

**响应 200 / 503**
```json
{
  "ok": true,
  "checks": {
    "auth": { "ok": true },
    "stores": { "ok": true }
  }
}
```

用途：k8s readiness probe / 反代健康检查。

---

## 对话

### `POST /api/chat`

非流式单轮对话，整个响应一次性返回。

**请求**
```http
POST /api/chat
Content-Type: application/json
X-User-Id: sales_001
```
```json
{
  "user_id": "sales_001",
  "message": "汉EV 卖得还行但毛利好像不太行，看下原因",
  "session_id": "sess_001",
  "debug": false,
  "attachments": [
    { "id": "att_xxx" }
  ]
}
```

**Body 字段**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `user_id` | string | 二选一 | 内部用户 ID |
| `wecom_userid` | string | 二选一 | 企业微信 userid |
| `message` | string | ✅ | 用户消息文本 |
| `session_id` | string | ⛔ | 不传则自动开新会话 |
| `debug` | boolean | ⛔ | true 时返回内部 trace 字段 |
| `attachments` | array | ⛔ | 通过 `/api/attachments` 上传后拿到的 `id` |

**响应 200**
```json
{
  "answer": "汉EV 当月销量 ... 毛利下滑主要由 ...",
  "session_id": "sess_001",
  "intent": { "code": "sales_analysis", "confidence": 0.92 },
  "tool_calls": [
    { "name": "dealer.query.sales", "duration_ms": 124, "ok": true }
  ],
  "trace_id": "tr_..."
}
```

`debug=true` 时额外返回 `route`、`runtime`、`token_budget_usage` 等字段。

---

### `POST /api/chat/stream`

SSE 流式对话，**前端聊天页用这个**。

**请求**
```http
POST /api/chat/stream
Content-Type: application/json
X-User-Id: sales_001
Last-Event-ID: tr_xxx:42      # 可选，断线续传
```
```json
{
  "user_id": "sales_001",
  "message": "看下今天的待跟进客户",
  "session_id": "sess_001",
  "since_seq": 0,
  "attachments": []
}
```

**响应**
```
HTTP/1.1 200 OK
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Trace-Id: tr_xxx
```

#### SSE 事件类型

每个事件形如：
```
id: tr_xxx:42                  ← 续传游标（Last-Event-ID 用）
event: <type>
data: <JSON>

```

| event | 含义 | 字段示例 |
|---|---|---|
| `openui_run_started` | 一次 OpenUI Lang 结构化渲染 run 开始 | `{run_id, session_id, trace_id, protocol}` |
| `route` | 路由决策结果 | `{route: {handler_type, intent_code, ...}}` |
| `thinking` | 中间思考（流式） | `{text, delta, step}` |
| `agentic_event` | agentic handler 子事件 | `{event: {kind, ...}}` |
| `delta` | 回答 token 增量 | `{text}` |
| `openui_envelope` | OpenUI Lang surface 增量事件，带 legacy envelope 兼容字段 | `{protocol, openui_event: {type, surfaceId, ...}, envelope: {createSurface/updateDataModel/updateComponents, ...}}` |
| `openui_replay_empty` | OpenUI Lang 回放无新事件 | `{trace_id, protocol}` |
| `openui_replay_done` | OpenUI Lang 回放结束 | `{..., protocol}` |
| `a2ui_run_started` / `a2ui_envelope` / `a2ui_replay_*` | legacy 事件名，仅旧 `/api/chat/stream` 路径保留 | 同 OpenUI 事件 |
| `session.updated` | session 元数据更新 | `{session: {...}}` |
| `done` | 整轮结束 | `{answer, intent, tool_calls, ...}` |
| `error` | 出错（流仍 200） | `{error, message, trace_id}` |
| `shutdown` | 服务正在 drain，请客户端重连 | `{reason: "server_draining"}` |
| `: ping <ts>` | 注释行心跳，每 15s | — |

#### 断线续传

服务端给每个事件分配 `id: <traceId>:<seq>`。客户端断开重连时：

- **EventSource**：浏览器自动用 `Last-Event-ID` header 重连
- **fetch + Reader**：在 body 里传 `since_seq: <最后收到的 seq>`

服务会从 `since_seq+1` 开始重发**未发送**的事件，已发送的事件不会重复。

**关键运维项（必读）**：
- 反代必须 **关闭 buffer**：Nginx `proxy_buffering off`、CDN bypass
- 反代 read timeout **≥ 300s**
- Body 大小 ≤ `client_max_body_size`（建议 25MB，配合附件）

---

## 上下文与角色

### `GET /api/user-context`

解析用户身份 + 角色 + 权限 + 默认门店等。

**请求**
```
GET /api/user-context?user_id=sales_001
GET /api/user-context?wecom_userid=lin_yue
```

**响应 200**
```json
{
  "user_context": {
    "user_id": "sales_001",
    "name": "林悦",
    "role": "sales",
    "department": "华东销售部",
    "default_store": null,
    "permissions": ["customer:read", "order:read", "policy:read", "leave:submit", "org:read"],
    "accessible_customer_ids": ["C001", "C002"]
  }
}
```

### `GET /api/wecom-users`

返回组织架构（mock 或 real，视 `WECOM_MODE`）。

**响应 200**
```json
{
  "users": [
    { "userid": "lin_yue", "name": "林悦", "department_name": "华东销售部",
      "position": "销售顾问", "mobile": "...", "email": "...", "direct_leader": "..." }
  ]
}
```

---

## 命令与推荐

### `GET /api/commands`

返回**当前用户可见**的全部 slash 命令（按权限过滤）。前端命令面板用。

**请求**
```
GET /api/commands?user_id=sales_001
```

**响应 200**
```json
{
  "user_id": "sales_001",
  "commands": [
    {
      "id": "follow_up_today",
      "intent_code": "sales.followup.list",
      "title": "今日待跟进",
      "triggers": ["/待跟进客户", "/今天该跟谁"]
    }
  ]
}
```

权限不足的命令直接被过滤，不会出现在响应里。

### `GET /api/recommended-commands`

返回当前用户角色的**推荐命令 chips**（4 条 ±）。前端 landing 卡片 + composer chips 用。

**请求**
```
GET /api/recommended-commands?user_id=sales_001
```

**响应 200**
```json
{
  "user_id": "sales_001",
  "role": "sales",
  "commands": [
    {
      "id": "follow_up",
      "label": "待跟进客户",
      "command": "/待跟进客户",
      "hint": "我今天该联系谁、上次聊了什么、下一步是什么"
    }
  ]
}
```

匹配规则：先按 `role` 找 `data/recommended-commands.json[role]`，没有就回落 `_default`。详见 [COMMANDS.md](COMMANDS.md)、[ROLES.md](ROLES.md)。

---

## 工具与处理器

### `GET /api/handlers`

运维 / debug 视角的处理器与意图清单。**需要 admin 权限**。

支持 `If-None-Match` ETag 协商。

**响应 200**
```json
{
  "handlers": [
    { "handler_type": "intent_query", "description": "...",
      "bound_intent_codes": ["sales.followup.list", "..."] }
  ],
  "intent_codes": [
    { "intent_code": "sales.followup.list", "handler_type": "intent_query", "description": "..." }
  ],
  "commands": [{ "id": "follow_up_today" }]
}
```

### `GET /api/tools/catalog`

工具目录（按权限 / 域 / PlanMode 过滤）。前端工具面板用。

**请求**
```
GET /api/tools/catalog?user_id=sales_001&domain=dealer&plan_mode=false&q=库存
```

| 参数 | 说明 |
|---|---|
| `user_id` | 不传则匿名（无权限过滤） |
| `domain` | 11 域之一：`memory / task / cron / transcript / evolution / gateway / agent / dealer / knowledge / workflow / system` |
| `plan_mode` | true 时只返回 PlanMode 允许的工具 |
| `q` | 名称 / 描述模糊搜索 |

**响应 200**
```json
{
  "ok": true,
  "plan_mode": false,
  "user_id": "sales_001",
  "total": 87,
  "filtered_count": 12,
  "domains": ["memory", "task", "cron", "..."],
  "plan_mode_allowed_count": 35,
  "ask_tools_count": 41,
  "deny_tools_count": 11,
  "entries": [
    {
      "name": "dealer.query.inventory",
      "description": "查询门店库存",
      "domain": "dealer",
      "risk_level": "read",
      "permission_status": "allowed",
      "input_schema": { "...": "..." }
    }
  ]
}
```

支持 ETag。

---

## Skills

### `GET /api/skills`

返回已注册 skill 列表。

```json
{
  "skills": [
    {
      "id": "dealer-sales", "name": "...", "description": "...",
      "version": "1.0.0", "enabled": true, "source": "local",
      "install_type": "builtin", "path": "skills/dealer-sales",
      "planning_style": "balanced",
      "required_permissions": ["sales_report:read"],
      "required_primitives": ["llm.chat", "rag.query"]
    }
  ]
}
```

### `POST /api/skills/install`

从本地目录安装 skill。

**请求**
```json
{ "path": "/abs/path/to/skill-dir" }
```

**响应**
```json
{ "ok": true, "installed": { "id": "...", "version": "..." } }
```

### `POST /api/skills/{id}/enabled`

启停 skill。

**请求**
```json
{ "enabled": false }
```

---

## 附件

### `POST /api/attachments`

multipart 上传，写入对象存储后返回元数据。前端拿到 `id` 后塞进 `/api/chat` 的 `attachments[]`。

**请求**
```http
POST /api/attachments
Content-Type: multipart/form-data; boundary=...
X-User-Id: sales_001

------xxx
Content-Disposition: form-data; name="files"; filename="leads.csv"
Content-Type: text/csv

<binary>
------xxx--
```

**响应 201**
```json
{
  "ok": true,
  "attachments": [
    {
      "id": "7762a9b7-c119-45d3-a412-d8812670b54a",
      "filename": "leads.csv",
      "mime_type": "text/csv",
      "size_bytes": 71,
      "kind": "text",
      "text_chars_total": 86,
      "text_chars_truncated": 0
    }
  ]
}
```

| 限制 | 默认 | env |
|---|---|---|
| 单请求文件数上限 | 5 | `ATTACHMENTS_MAX_FILES_PER_REQUEST` |
| 单文件大小上限 (MB) | 20 | `ATTACHMENTS_MAX_FILE_SIZE_MB` |
| 单附件解析后注入字符上限 | 20000 | `ATTACHMENTS_MAX_TEXT_CHARS` |

支持的 `kind`：`text / image / pdf / docx / xlsx / archive`。

**错误**
- `413 Payload Too Large` — 文件超 `ATTACHMENTS_MAX_FILE_SIZE_MB`
- `400 too_many_files` — 超 `ATTACHMENTS_MAX_FILES_PER_REQUEST`
- `503 attachments_disabled` — `ATTACHMENTS_ENABLED=false`

---

## OpenUI Lang 流式结构化 UI

当前主协议为 **OpenUI Lang `openui-lang/1.0`**。`/api/openui/*` 主响应中的 `openui` 字段是 OpenUI Lang document（`{ protocol, version, surfaces }`）；legacy A2UI v0.9 envelope 只保留在 `openui_compat`、SSE `envelope`、历史回放和 `/api/a2ui/*` 兼容路径中，供当前内置 Web 前端和旧客户端继续消费。

开发侧主入口：

- `createOpenUILangModule()`：HTTP / chat controller 默认入口。
- `buildOpenUILangResponse()`：agent result → OpenUI Lang document（`{ protocol, version, surfaces }`）的主 builder。
- `buildOpenUILangLegacyEnvelopes()` / `buildA2UIResponse()`：OpenUI Lang surface → legacy A2UI v0.9 envelope 的兼容 adapter。
- `src/a2ui/*`：仅作为 legacy alias/facade 保留；协议核心、catalog、action registry、renderer port 和 surface builder 均以 `src/openui-lang/*` 为准。

主路径：

- `GET /api/openui/capabilities`
- `GET /api/openui/history`
- `POST /api/openui/action`
- `POST /api/openui/chat`
- `POST /api/openui/chat/stream`

兼容路径 `/api/a2ui/*` 和 `/api/chat*` 仍保留，继续返回 legacy A2UI 兼容数组。

`/api/openui/chat/stream` 使用 `openui_run_started`、`openui_envelope`、`openui_replay_empty`、`openui_replay_done` 事件名；legacy `/api/chat/stream` 仍使用 `a2ui_*` 事件名。OpenUI SSE 增量事件包含主字段 `openui_event`，并保留 `envelope` 作为浏览器/历史兼容字段；OpenUI `done` 事件包含 `openui` document 和 `openui_compat` 兼容数组，不再暴露顶层 `a2ui`。

### `GET /api/openui/history`

拉取一个 session 的 OpenUI Lang 历史，用于刷新页面后恢复对话。OpenUI 主路径返回 `events[].openui_event` 和重建后的 `openui` document；legacy envelope 仅保留在 `events[].envelope` 与 `openui_compat` 中。

**请求**
```
GET /api/openui/history?user_id=sales_001&session_id=sess_001&run_id=run_xxx&since_seq=0
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `user_id` | ✅ | |
| `session_id` | ✅ | |
| `run_id` | ⛔ | 限定单次 run |
| `since_seq` | ⛔ | 增量拉取 |

**响应 200**
```json
{
  "ok": true,
  "protocol": "openui-lang/1.0",
  "run_id": "run_xxx",
  "events": [
    {
      "type": "openui_envelope",
      "protocol": "openui-lang/1.0",
      "seq": 1,
      "openui_event": { "protocol": "openui-lang/1.0", "type": "createSurface", "surfaceId": "agent_run_xxx_sources" },
      "envelope": { "version": "v0.9", "createSurface": { "...": "..." } }
    }
  ],
  "openui": {
    "protocol": "openui-lang/1.0",
    "version": "1.0",
    "surfaces": []
  },
  "openui_compat": [
    { "seq": 1, "ts": "2026-06-09T00:00:00.000Z", "envelope": { "version": "v0.9", "...": "..." } }
  ]
}
```

### `GET /api/a2ui/capabilities`

Legacy alias：同 `GET /api/openui/capabilities`。

### `GET /api/openui/capabilities`

返回当前 OpenUI Lang 服务端支持的协议、OpenUI catalog、Basic 组件、OpenUI 组件和 action 清单。Legacy A2UI catalog 仅出现在 `compatibilityCatalogIds` 中。

```json
{
  "version": "openui-lang/1.0",
  "protocol": "openui-lang/1.0",
  "compatibility_version": "v0.9",
  "compatibility_protocol": "v0.9",
  "catalog_version": "openui-lang/1.0",
  "server_capabilities": {
    "supported_openui_lang_protocols": ["openui-lang/1.0"],
    "supportedCatalogIds": ["openui.lang.catalog.basic/1.0"],
    "compatibilityCatalogIds": ["https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"],
    "supportedViewProtocols": ["openui-bridge/0.1"],
    "supported_components": ["Text", "Image", "Icon", "Video", "AudioPlayer", "Row", "Column", "List", "Card", "Tabs", "Button"],
    "supported_openui_components": ["ApprovalFlow", "TaskResumeCard", "ExpenseEstimate", "CitationDisclosure", "RuntimeSummary", "DataTableSurface", "GroupedListSurface", "RiskListSurface", "MetricCardsSurface", "LeaveRequestForm", "DealerVehicleProgress"],
    "acceptsClientDataModel": true,
    "actions": ["runtime.pending_action.confirm", "runtime.pending_action.reject", "task.resume.select", "task.resume.ignore", "openui.form.submit"]
  }
}
```

### `POST /api/openui/action`

OpenUI Lang 卡片上的按钮 / 表单回调。`POST /api/a2ui/action` 是兼容别名。

**请求**
```json
{
  "user_id": "sales_001",
  "session_id": "sess_001",
  "client_action_id": "client_uuid_001",
  "action": {
    "name": "runtime.pending_action.confirm",
    "surface_id": "tenantA_agent_run_xxx_approval",
    "context": { "pending_action_id": "pa_001" }
  }
}
```

**响应 200**
```json
{
  "ok": true,
  "action": "runtime.pending_action.confirm",
  "result": { "...": "..." },
  "openui_pipe": [],
  "a2ui_pipe": [],
  "trace_id": "tr_xxx"
}
```

权限不足返回 `{"ok": false, "error": "forbidden", "...": ...}` + HTTP 400。

### `POST /api/openui/chat`

同步聊天入口。主字段 `openui` 是 OpenUI Lang document；`openui_compat` 是 legacy envelope 兼容数组，仅用于旧渲染器/历史兼容。

**响应 200（节选）**
```json
{
  "session_id": "sess_001",
  "run_id": "run_xxx",
  "answer": "",
  "openui": {
    "protocol": "openui-lang/1.0",
    "version": "1.0",
    "surfaces": [
      {
        "protocol": "openui-lang/1.0",
        "id": "tenantA_agent_run_xxx_openui_table_sales_followups",
        "root": "openui_table_root",
        "catalog": "openui.lang.catalog.basic/1.0",
        "data": { "title": "销售线索" },
        "nodes": [
          { "id": "openui_table_root", "componentName": "Card", "children": ["openui_table_title"] }
        ],
        "view": {
          "protocol": "openui-lang/1.0",
          "component": "DataTableSurface",
          "props": { "title": "销售线索", "rows": [] }
        }
      }
    ]
  },
  "openui_compat": [
    { "version": "v0.9", "createSurface": { "...": "..." } }
  ],
  "trace_id": "tr_xxx"
}
```

---

## 可观测

### `GET /metrics`

Prometheus 格式。直接 scrape。

```
# HELP chat_request_total ...
# TYPE chat_request_total counter
chat_request_total{tenant="default"} 1234
chat_stream_total{tenant="default"} 567
attachment_upload_total 89
...
```

### `GET /api/metrics?range=15m`

JSON 格式聚合视图。`range` 可选 `5m / 15m / 1h / 24h`。

```json
{
  "metrics": { "chat_request_total": 1234, "...": "..." },
  "rate_limiter": { "ip_buckets": 12, "user_buckets": 8 },
  "runtime": { "p50_ms": 820, "p95_ms": 2400, "...": "..." }
}
```

---

## 运维 / 管理

### `POST /api/admin/auth/reload`

热重载 `data/users.json` + `data/tool-policies.json`。**需要 admin token**。

**请求**
```http
POST /api/admin/auth/reload
Authorization: Bearer <admin_token>
```

**响应 200 / 400**
```json
{ "ok": true, "reloaded": { "users": 8, "policies": 24 } }
```

---

## 错误模型

所有错误响应统一形如：

```json
{
  "error": "<error_code>",
  "message": "<human-readable>",
  "trace_id": "tr_xxx",
  "retry_after_ms": 1000
}
```

| 状态码 | error code | 含义 |
|---|---|---|
| 400 | `bad_request` | 参数不合法 |
| 400 | `attachment_validation_failed` | 附件类型 / 大小不通过 |
| 401 | `unauthorized` | 未提供身份 / 用户不存在 |
| 403 | `admin_required` | 该接口需要 admin token |
| 403 | `forbidden` | 该用户对该工具/数据没权限 |
| 404 | `not_found` | 路径不存在 |
| 413 | `payload_too_large` | 上传超限 |
| 429 | `rate_limited` | 含 `retry_after_ms` + `Retry-After` header |
| 500 | `internal_error` | 兜底 |
| 503 | `draining` / `attachments_disabled` | 临时不可用 |

SSE 流出错时仍是 200 OK，用 `event: error` 下发：
```
event: error
data: {"error":"stream_error","message":"...","trace_id":"tr_xxx"}
```

---

## 限流

服务端有三层限流（默认值，可通过 env 调）：

| 维度 | 默认 | env |
|---|---|---|
| IP 总 QPS | 100/s | `RATE_LIMIT_IP_QPS` |
| 用户总 QPS | 30/s | `RATE_LIMIT_USER_QPS` |
| 用户并发 stream 数 | 3 | `RATE_LIMIT_USER_STREAMS` |

被限流时返回 429 + `Retry-After` header。`/api/chat/stream` 跳过 user 计数（按 stream 并发上限算）。

---

## CORS

服务默认允许所有 origin（`Access-Control-Allow-Origin: *`），仅放开 `GET / POST / OPTIONS`，允许 header 包含 `Content-Type, Authorization, Last-Event-ID`，暴露 `X-Trace-Id`。

跨域上线前请收紧到具体 origin（修改 `setCors()` 或加反代层 CORS 策略）。
