# OpenUI Lang 生产可用化 (Phase A + B + C 收口)

本文档记录从 PoC 到"小规模可生产"过程中补齐的能力清单，覆盖鉴权、限流、observability、持久化、多租户、续传与契约校验。

当前主协议为 **OpenUI Lang `openui-lang/1.0`**。旧 A2UI v0.9 envelope 仅作为 wire compatibility / 历史回放兼容层保留；文中出现的 `src/a2ui/*`、`A2UI_*` 或 `/api/a2ui/*` 均表示 legacy 兼容实现或旧配置别名，新接入应优先使用 `src/openui-lang/*`、`OPENUI_*` 和 `/api/openui/*`。

## 1. 鉴权 (P0-1)

- 实现位置：`src/security/auth.ts`，`TokenAuthenticator`
- 接入点：`src/server/http.ts:guardRequest()`，覆盖 `/api/openui/chat`、`/api/openui/chat/stream`、`/api/openui/action`、`/api/openui/history`
- 配置：
  - `OPENUI_AUTH_TOKENS='{"tk_abc":{"user_id":"u001","tenant_id":"tenantA"}}'`
  - 本地开发：`OPENUI_AUTH_DISABLED=1`
- 失败语义：401 (token 缺失/无效)，403 (`body.user_id` 与 token 绑定不一致)

## 2. action 防伪 (P0-2)

- `src/openui-lang/action-registry.ts:OpenUILangActionRegistry.validatePendingAction`（`src/a2ui/action-registry.ts:A2UIActionRegistry` 仅为 legacy alias）
- 校验顺序：存在 → user_id 匹配 → session_id 匹配（如果客户端给了 session）→ status===pending → 未过期
- 任意一项失败抛 `ActionError`，HTTP 层翻成 400/403/404 + 明确 `error` code

## 3. 限流 (P0-4)

- `src/security/rate-limiter.ts`
- 三层窗口：
  - per-IP QPM (默认 60)：`OPENUI_IP_QPM`
  - per-user QPM (默认 30)：`OPENUI_USER_QPM`
  - per-user 并发 SSE (默认 3)：`OPENUI_STREAMS_PER_USER`
- 命中返回 429，带 `Retry-After` 与 `retry_after_ms`

## 4. Observability (P1-7)

- `src/security/observability.ts`
- 每个请求一个 `traceId`，写入 `X-Trace-Id` 响应头，并下穿到 SSE event 的 `trace_id` 字段
- Metrics：双输出
  - `/api/metrics` JSON 格式（dashboard / 调试用）
  - `/metrics` Prometheus 文本格式 v0.0.4（scraper 抓取用），counter 输出 `*_total`，histogram 输出 `quantile=0.5/0.95/0.99` + `*_sum` + `*_count`
- 覆盖指标：
  - chat_request_total / chat_request_failed / chat_stream_total
  - envelope_emitted_total / envelope_rejected_total
  - action_invoked_total / action_forbidden_total
  - rate_limited_total / auth_failed_total
  - tool_input_invalid / tool_output_invalid / tool_execute_failed
  - plugin_extract_failed / plugin_build_failed / plugin_extract_skipped
  - finalize_latency_ms / stream_duration_ms (histogram)
- 结构化日志：`logEvent(level, msg, fields)`，所有关键路径已带 `trace_id`
- 健康检查二段式：
  - `/health` liveness（仅检查进程存活）
  - `/ready` readiness（检查 config 可读 / users 目录可写 / tokens 已加载，503 表示不就绪）
- 详细运维细节见 [`operations-runbook.md`](./operations-runbook.md)

## 5. OpenUI envelope 持久化 + 历史可见 (P0-3)

- `src/openui-lang/history-store.ts:OpenUILangHistoryStore` 是新接入的 OpenUI Lang history facade，返回 OpenUI event/document。
- `src/openui-lang/envelope-store.ts:OpenUILangEnvelopeStore` 是主存储实现；legacy 文件名 `runtime/a2ui-envelopes.json` 仅为历史兼容。
- 落盘路径：`users/{user}/workspace/runtime/a2ui-envelopes.json`（legacy 文件名，内容承载 OpenUI Lang 兼容 envelope）
- 每条 envelope 携带 `seq` (per-run 单调递增) 与 `ts`
- 上限：单 run 500 envelope，单 session 20 run（按 updated_at 滚动剔除）
- 历史接口：`GET /api/openui/history?user_id=&session_id=[&run_id=&since_seq=]`
  - 不带 run_id：返回 latestRun 的所有 envelope（页面刷新场景）
  - 带 run_id + since_seq：返回该 run 的 seq > since_seq 增量

## 6. SSE Last-Event-ID 续传 (P1-6)

- 服务端：`src/server/http.ts` POST `/api/chat/stream` 同时支持
  - HTTP `Last-Event-ID: {runId}:{seq}` header
  - body `since_seq` 字段（fetch 场景）
- 命中续传时不再触发 agent run，而是从 envelope-store latestRun 中重放 seq > sinceSeq 的内容，事件类型 `openui_envelope` (replayed=true) + `openui_replay_done`
- 前端：`src/server/chat-page.ts` 在每个 envelope 上记录 `state.lastSeq`，触发重连时将其作为 `since_seq` 回传

## 7. 多租户 surfaceId namespace (P1-8)

- `src/openui-lang/response.ts:buildOpenUILangResponse({ namespace })` 为所有 OpenUI Lang surfaceId 加 tenant 前缀；`src/a2ui/adapter.ts:buildA2UIResponse()` 仅作为 legacy envelope adapter 保留。
- chat-controller 通过 `surfacePrefix = ${tenantId}_agent` 把租户身份穿透到 streaming-translator 与 OpenUI response builder，progress surface 同样带 tenant 前缀
- 同一前端实例如果同时承载多 tenant，可以通过 surfaceId 前缀直接区分桶位

## 8. action registry + capability 反映 (P1-5)

- `OpenUILangActionRegistry`：默认实现 4 个 action (`runtime.pending_action.confirm/reject`、`task.resume.select/ignore`)；`A2UIActionRegistry` 仅为旧类名 alias。
- `register()` 让上层无需改 chat-service 就能扩展
- `capabilities().server_capabilities.actions` 自动反映已注册列表（不再是写死的字符串）

## 9. catalog contract test (P2-2)

- `src/eval/openui-adapter.ts` 末尾新增两条静态契约：
  - 所有 plugin build 出来的 component 必须落在 BASIC catalog 11 个组件内
  - 所有 Button event.name 必须出现在 capabilities.actions 列表里
- 跑法：`npm run openui:adapter`

## 10. 工具入参契约 (P1-9)

务实路径：JSON Schema 全量收紧 + 高风险工具加 zod runtime 校验。

### 10.1 JSON Schema 严格化（30+ 工具）

- 覆盖：`src/tools/*.ts`、`src/tasks/tools.ts`、`src/memory/tools.ts`、`src/evolution/tools.ts`
- 收紧项：
  - 所有 object 加 `additionalProperties: false`
  - 枚举类字段（status / priority / risk_level / target_type 等）改用 `enum`
  - id 类字段加 `pattern`（如 `^[A-Za-z0-9_.\-:]+$`）
  - 字符串加 `minLength` / `maxLength`，数值加 `minimum` / `maximum`
  - typed union 用 `oneOf`
- 目的：直接喂给 Anthropic / OpenAI / Gemini 的 tool calling 时，schema 越严格 → 模型生成越稳定 → 调用前就被结构层拦掉，不浪费一次 round-trip

### 10.2 zod runtime 校验（全量工具迁移完成）

- 实现位置：`src/tools/zod-helpers.ts:defineTool()` + `src/tools/registry.ts:validateInput()`
- 覆盖范围：所有内置工具（约 60 个）已统一走 `defineTool({ inputSchema, outputSchema, ... })`，文件包括：
  - `src/tools/sandbox-tools.ts`、`src/tools/business-tools.ts`、`src/tools/knowledge-tools.ts`
  - `src/tools/maintenance-tools.ts`、`src/tools/pending-action-tools.ts`、`src/tools/plugin-tools.ts`
  - `src/tools/runtime-inspection-tools.ts`、`src/memory/tools.ts`、`src/tasks/tools.ts`
  - `src/evolution/tools.ts`（24 个 evolution.* / skill.curator.* / memory.conflict.* 工具）
- 行为：
  - 入参用 `safeParse` 拦在 execute 前；失败返回 `{ ok: false, error: "invalid_input", data: { issues } }`，不进入工具体
  - 出参用 `ToolResultBaseSchema.passthrough()` 仅观测、不阻断（避免一上线就把现存工具锁死）
  - JSON Schema 由 `z.toJSONSchema()` 自动生成，喂给 LLM 的 tool calling 与 zod 严格一致
- 校验失败语义：通过 `tool_input_invalid` / `tool_output_invalid` metric 计数 + 结构化日志 `issues[]`

### 10.3 Plugin extract 鲁棒性

- `src/plugins/loader.ts` extract 层走 readPath + zod safeParse，结构失败时回退到 regex
- 失败路径在 `src/openui-lang/response.ts` emit `openui_surface_rejected` / `plugin_extract_failed` 相关 metric + warn 日志，不打断主流程；`src/a2ui/adapter.ts` 仅投影 legacy envelope。

### 10.4 验证

- `npm run tool:validation` （`src/eval/tool-input-validation.ts`）
- 用例覆盖：missing required / 越界 / 未知字段 / pattern 不匹配 / enum 非法 + 跨文件 sanity（knowledge / maintenance / memory / business / pending-action）+ 一条 positive control
- 期望：14 条全部命中 `invalid_input`，1 条 ok

### 10.5 错误文案兜底翻译（用户体验）

- 实现位置：`src/tools/tool-error-formatter.ts`
- 接入点：`src/tools/registry.ts` 的 6 个错误分支（unknown_tool / permission_denied / tool_unavailable / confirmation_required / invalid_input / execute_failed）
- 翻译规则：按 zod issue.code 分支生成中文（`invalid_type` / `too_small` / `too_big` / `invalid_value` / `invalid_format` / `unrecognized_keys`），字段名走 `FIELD_LABELS` 映射，工具名走 `TOOL_LABELS` 映射，未命中均 fallback 到原 path/name
- 风格：指令式（"请填写'标题'：必填项" / "'优先级' 只能是：high / medium / low"）
- 原始 zod issues 仍保留在 `result.data.issues`，供日志和调试使用
- 锁定文案：`npm run tool:error-msg` （`src/eval/tool-error-message.ts`），8 条用例覆盖 6 个错误分支

## 11. 存储扩展性（运维）

最小抽象路线：把"读 → 改 → 写回"这一段串行化，单机防并发坏文件，多机能切外置存储不改业务代码。

### 11.1 接口

- `src/runtime/store-adapter.ts:JsonFileStore`
  ```ts
  interface JsonFileStore {
    read<T>(filePath: string, defaultValue: T): Promise<T>;
    mutate<T>(filePath: string, defaultValue: T, mutator: (value: T) => T | Promise<T>): Promise<T>;
  }
  ```
- 默认实现 `FileJsonStore`：mkdir-based 文件锁（`mkdir(path + ".lock")` 原子拿锁），同进程额外串行化队列防 await race，stale lock（>2× timeout）自动回收

### 11.2 接入点

| Store | 关键路径 | 锁策略 |
|---|---|---|
| `PendingActionStore.create / .mark` | `runtime/pending-actions.json` | mutate（数组追加/状态修改） |
| `OpenUILangEnvelopeStore.append` | `runtime/a2ui-envelopes.json`（legacy 文件名） | mutate（嵌套结构读改写） |
| `TaskStore.updateActiveIndex` | `tasks/active.json` | mutate（汇总写入） |
| `TaskStore.save / .get`（单 task 单文件） | `tasks/lists/.../task.json` | 不加锁（writeFile 在 POSIX 上是 rename，本身原子） |

### 11.3 多机切换

`FileJsonStore` 是 `JsonFileStore` 的一个实现。多机部署时新写一个 `RedisJsonStore` / `KvJsonStore`，所有 store 通过 `constructor(adapter)` 注入即可，业务代码不动。

### 11.4 验证

- `npm run store:concurrency`（`src/eval/store-concurrency.ts`）
- 用例：100 并发 envelope append + 50 并发 pending action create
- 期望：seq 严格 1..100 连续，pending action id 全唯一
- 对照：直接绕过锁的实现 100 并发会丢 97 条；加锁后 0 丢失

## 12. 工具执行超时 + 取消传播 (P1)

- 实现位置：`src/tools/registry.ts:ToolRegistry.execute()`
- 超时来源：
  - 默认 30000ms，env `TOOL_EXECUTE_TIMEOUT_MS` 覆盖；构造时也可注入 `defaultTimeoutMs`
  - 单工具 `metadata.timeout_ms` 优先级最高
- 实现方式：每次 execute 内建 `AbortController`，把 `signal` 注入到 `ToolExecutionContext.signal`，工具实现可选监听以提前 abort（fetch / DB 客户端等）；超时或 parent abort 命中时，registry 用 `Promise.race` 立即返回 `{ ok: false, error: "execute_timeout" }`，不阻塞上游
- Metric：`tool_execute_timeout{tool}`，结构化日志 `tool_execute_timeout`
- 验证：`npm run tool:timeout`（`src/eval/tool-timeout.ts`，4 用例：默认超时 / 正常返回 / metadata 覆盖 / parent signal abort）

## 13. SSE 心跳 + Graceful shutdown (P1)

- 实现位置：`src/server/http.ts`
- SSE 心跳：
  - 每 `SSE_HEARTBEAT_MS`（默认 15000）发一行 `: ping {ts}` comment（被 EventSource 忽略，但能保住 LB / proxy 的连接）
  - 配合现有 Last-Event-ID 续传，断线后客户端自动从 `state.lastSeq` 恢复
- Graceful shutdown：
  - `SIGTERM` / `SIGINT` 触发：`draining = true`（`/ready` 立刻返回 503，让 LB 摘流量），`server.close()` 停止接收新连接
  - 等 in-flight SSE 流自然结束，最多 `SHUTDOWN_DRAIN_MS`（默认 30000ms）
  - 超时仍未结束：给每条连接 emit `event: shutdown` 让客户端走重连路径，再强制 `res.end()`
  - 全程结构化日志 `shutdown_started` / `shutdown_listener_closed` / `shutdown_forcing_streams` / `shutdown_complete`

## 14. OpenUI Lang 韧性三件套 (P1)

线上会被网络抖动 / plugin bug / 客户端版本差咬到的三个口子。

### 14.1 Action 幂等

- 实现位置：`src/openui-lang/idempotency-cache.ts:OpenUILangIdempotencyCache`、`src/openui-lang/module.ts:OpenUILangChatService.handleAction`；`src/a2ui/*` 仅为 legacy alias/facade。
- 行为：客户端在 `/api/openui/action` body 里带 `client_action_id`（自己生成的 uuid），server 端按 `(user_id, client_action_id)` 去重，60s 内重复请求直接返回上次结果（响应里多一个 `idempotent_replay: true` 字段）
- 设计：内存 LRU + TTL，重启清零（client retry 是秒级，重启清零可接受）；多机部署需要换 Redis adapter
- 校验：`client_action_id` 必须匹配 `^[A-Za-z0-9_.\-:]{1,128}$`，否则 400
- Metric：`action_idempotent_replay_total{action}`
- 不传 `client_action_id` 时维持原逻辑（向后兼容）

### 14.2 Envelope 大小 / 嵌套深度硬限制

- 实现位置：`src/openui-lang/response.ts:checkSurfaceWithinLimits`
- 限制（导出为 `ENVELOPE_LIMITS`）：
  - `maxSerializedBytes`: 256KB
  - `maxComponents`: 200 / surface
  - `maxDepth`: 20 层嵌套
- 行为：超限的 plugin 直接 skip，emit `envelope_rejected_total{plugin,reason}` + warn log，**不打断主流程**（其他 plugin 继续构建）
- 防御目标：plugin bug 吐出超大 / 死循环 component tree 时不会把前端搞崩

### 14.3 客户端能力协商 + 组件降级

- 实现位置：`src/openui-lang/response.ts:downgradeUnsupported`、dto `client_capabilities`
- 行为：chat 请求里带 `client_capabilities: { catalog_version?, supported_components?: string[] }`
  - 不传 → 不做降级（向后兼容老客户端）
  - 传了 supported_components → adapter 把不在列表里的 `componentName` 替换成 `Text`，文案 "（客户端不支持组件 X，已降级为文本）"
- Metric：`envelope_component_downgraded_total{plugin}`
- 目的：server 端升级 catalog（加新组件）时，老客户端不会白屏，而是看到降级文本

### 14.4 验证

- `npm run openui:resilience`（`src/eval/openui-resilience.ts`；`npm run a2ui:resilience` 为 legacy alias）
- 6 用例：components 数超限 / 嵌套深度超限 / 序列化字节超限 / 组件降级 / OpenUILangIdempotencyCache 命中 + TTL / OpenUILangIdempotencyCache LRU 驱逐

## 15. 流式增量 (Phase 1 - 已上线)

详见 `docs/a2ui-incremental-streaming-design.md`。

简述：
- `incremental-envelope-parser.ts` 容错 + stateful 累积
- `streaming-translator.ts` 把 `agentic_lifecycle` / `agentic_tool` 翻译为 progress surface，在工具实际返回前先给前端 skeleton
- finalize 时 emit `deleteSurface` 清理 progress

## 部署 checklist

```bash
export OPENUI_AUTH_TOKENS='{"tk_xxx":{"user_id":"u001","tenant_id":"tenantA"}}'
export OPENUI_USER_QPM=30
export OPENUI_IP_QPM=60
export OPENUI_STREAMS_PER_USER=3
export CHAT_STREAM_TIMEOUT_MS=60000
export TOOL_EXECUTE_TIMEOUT_MS=30000
export SSE_HEARTBEAT_MS=15000
export SHUTDOWN_DRAIN_MS=30000

npm run openui:adapter    # 静态契约 + 流式 fixture
npm run openui:resilience # envelope 限额 / 客户端能力协商 / action 幂等
npm run tool:validation # 工具入参 zod 校验
npm run tool:error-msg  # 错误文案锁定
npm run tool:timeout    # 工具超时 + 取消传播
npm run store:concurrency # 存储并发安全
npm run ops:endpoints   # health / readiness / token reload / Prometheus 输出
npm run smoke           # 端到端
npm run eval            # 全量 cases
```

## 已知限制

- 存储统一走 `JsonFileStore`，单机加锁不丢数据；多机部署需要换成 Redis/KV adapter 才能保证跨节点状态一致。
- TokenAuthenticator 支持文件加载 + `revoked_at` 字段 + `fs.watch` 热重载 + admin 接口手动重载；接入 wecom OAuth / IDP 仍是终极目标，但当前形态已可用于受控人群发布。
- Metrics 仍在内存里，进程重启清零；现已暴露 `/metrics` Prometheus 文本，scraper 端长期存储是标准方案。
