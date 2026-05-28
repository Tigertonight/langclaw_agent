# Trace Tag 命名规范

> 这份是 **agent runtime → Langfuse** 的契约。改这里 = 改 ADR-3（多租户隔离 by tag）。
> 任何新增 tag 必须先在这里登记，避免拼写漂移导致 dashboard 过滤失效。

## 设计原则

1. **每个 trace 必须含 5 个 root tag**：`business_id` / `user_id` / `session_id` / `channel` / `env`
2. tag 形态：Langfuse SDK 接受 `string[]`，我们用 `key:value` 字符串编码（adapter 自动转）
3. tag 值 **不含 PII**（手机号 / 邮箱 / 身份证不能进 tag，进 metadata 也要先 scrub）
4. tag 不可变。要变量请放 metadata（trace.update 可改）

## Root tag（trace 级，必填）

| tag | 取值 | 用途 |
|---|---|---|
| `business_id` | 业务方代号，例 `dealer-byd-001` | 多租户硬隔离主键。dashboard 默认按这个过滤 |
| `user_id` | 终端用户 ID（脱敏后），例 `u_a3f9...` | 单用户对话足迹回溯 |
| `session_id` | 会话 ID，例 `s_xxx` | 同会话多 turn 串起来 |
| `channel` | `web` / `wecom` / `console` / `api` | 入口分布分析 |
| `env` | `dev` / `staging` / `prod` | 区分环境，不要混库 |

## Optional tag（trace 级）

| tag | 取值 | 用途 |
|---|---|---|
| `intent` | router 命中的 intent 名，例 `knowledge_lookup` | 路由分布 / bad case 过滤 |
| `agent_role` | 子 agent 角色，例 `subagent:planner` | subagent trace 标识 |
| `parent_trace_id` | 父 trace ID | subagent 关联（也用 Langfuse 原生 parent 字段，tag 是冗余便于过滤）|

> 添加任何 optional tag 前先想：**dashboard 真的会按它过滤吗**？不会就放 metadata。

## Span 级 tag（一般不用）

Span 默认继承 trace 的 tag 集合，单独打 tag 的场景极少。若必须打，遵循同一 schema。

## 命名约束

- 只用 `[a-z0-9_:-]`，禁止空格 / 中文 / `/`
- key/value 之间 1 个冒号，例 `business_id:dealer-byd-001`
- 总长度 ≤ 64 字符（Langfuse 软限制）
- value 不要带版本号、时间戳（变量信息进 metadata）

## 演化策略

新增 tag 流程：

1. 先在这里加一行（含取值范围、用途）
2. 改 `packages/observability-sdk/src/tags.ts` 的 `TraceTags` 类型
3. 改 `src/runtime/observability-plugin.ts` 注入处
4. 跑 `obs:plugin-smoke` 验证
5. 通知 dashboard 团队过滤器需要适配

废弃 tag：保留 1 个月软删（dashboard 不再展示但允许查），1 个月后从 schema 移除。

## 反例

| ❌ 错的 | ✅ 对的 | 原因 |
|---|---|---|
| `phone:13912345678` | scrub 后写 metadata | tag 进了 PII |
| `intent:Knowledge Lookup` | `intent:knowledge_lookup` | 空格 + 大小写 |
| `version:1.2.3-beta` | metadata 字段 | tag 不放变量 |
| `business:byd001` | `business_id:dealer-byd-001` | key 不规范 + value 缺前缀 |
