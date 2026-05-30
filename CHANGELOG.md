# CHANGELOG

> 按重要变更聚合的历史，给客户 / 集成方 / 内部回顾用。
> 详细 commit 历史走 `git log`；本文件只记会影响"用户能用什么 / 部署该改什么 / 接口怎么变"的事项。
>
> 版本号遵循 [Semver](https://semver.org/) 精神（minor = 不破坏接口的新功能；major = 破坏性变更）。当前未发布正式 1.0，所有版本均为 0.x。

---

## [Unreleased]

### 启动体验
- **3 步起服务**：`npm install` → 编辑 `.env` 填 `LLM_API_KEY` → `npm start`
- `postinstall` 自动建运行时目录 + 复制 `.env.example → .env`
- `npm start` 自带 preflight 自检（Node 版本 / .env / 端口 / S3 可达），dist 不存在自动编译
- 附件功能未配 S3 自动降级为 503，不再上传报 500
- 新增 `npm run preflight` / `npm run start:dev`

### 部署 / 文档
- 新增 [DEPLOY.md](DEPLOY.md) 部署运行手册（本地 / 测试 / 生产三档 + 反代 + 验收 + 故障排查）
- 新增 [API.md](API.md) HTTP/SSE 接口契约（含断线续传、错误模型、限流）
- 新增 [ROLES.md](ROLES.md) 角色与权限模型
- 新增 [COMMANDS.md](COMMANDS.md) 业务命令字典
- `.env.example` 补齐 `LLM_DECISION_*` / `LLM_ANSWER_*` / `WECOM_AGENT_ID/SECRET` / `FEISHU_*` / `DINGTALK_*` / `OBSERVABILITY_*` / `A2UI_AUTH_DISABLED`
- README 顶部加跳转链接，分流"要部署"和"要开发"两类读者

### 已知问题
- `data/recommended-commands.json` 的 `sales_consultant` 与 `users.json` 的 `role: sales` 不匹配，销售顾问当前回落 `_default` 推荐命令。修法见 [COMMANDS.md §角色映射](COMMANDS.md#角色映射当前一致性问题)
- `warehouse_specialist` 在 recommended-commands 有定义但 users.json 暂无该角色账户

---

## 0.6.0 — 2026-05-29 · Landing Page + 宽屏自适应

### 新增
- **类豆包 / GPT 首页**：空会话默认进 landing 视图，hero 标题 + 4 张推荐卡片
- 卡片复用 `recommended-commands` 数据，新增 `hint` 字段做价值引导
- 点击卡片把命令 tag 注入 composer，不直接发送，留给用户编辑
- 移动端 2x2 栅格自适应；2K/4K 屏 hero/composer 自动拉宽到 1080/1200
- 旧会话兼容：仅含历史 welcome 单条消息也视为空，统一显示 landing
- 新增 6 条 Playwright 用例覆盖 landing 行为

### 部署影响
- 无破坏性变更，无需调整 `.env` 或反代
- 升级后用户首次访问从直接进 chat → 进 landing，是预期效果

---

## 0.5.0 — 2026-05-28 · Composer 推荐命令 + 附件上传

### 新增
- **推荐命令 chips**（A2）：composer 上方显示当前角色的快捷命令，点击注入 tag
- **附件上传**端到端：回形针按钮 → 拖拽 / 粘贴 → S3 兼容存储 → handler 读到附件文本
- `tag` 输入实体化：`<span class="cmd-tag">` 可视化、可点 × 删除，提交时自动序列化回 `/<command> ...`
- 本地 lucide 图标资源 `/assets/lucide.min.js`，CDN 失败也不破图

### 接口
- 新增 `POST /api/attachments`（multipart）→ 返回 `{ id, kind, mime_type, size_bytes, ... }`
- `POST /api/chat` / `chat/stream` 支持 `attachments: [{ id }]`
- 新增 `GET /api/recommended-commands?user_id=...`

### 部署影响
- ⚠️ **生产必须配置 S3 兼容对象存储**（`S3_*` env），否则附件上传不可用
- 反代 `client_max_body_size` 需 ≥ `ATTACHMENTS_MAX_FILE_SIZE_MB`（默认 20MB）
- 开发环境用 `docker compose -f docker-compose.attachments.yml up -d` 一键起 MinIO

---

## 0.4.0 — 2026-05 · Phase 9 · Observability（Langfuse 路线）

### 新增
- `packages/observability-sdk`：`TraceEmitter` 抽象 + `LangfuseAdapter` / `NoopAdapter`
- 内置 PII scrub：手机号 / 身份证 / 邮箱 / 中文车牌
- `ObservabilityPlugin`：订阅 18 个 runtime hook，按 `run_id` 维持 trace 边界
- `services/observability/`：自部署 Langfuse v3 docker-compose（PG + ClickHouse + Redis + MinIO）
- 可选 dashboards：RAG Recall Inspector + Evolution Loop Dashboard

### 接口
- 无新增 HTTP 接口；trace 通过 OpenTelemetry-compatible 协议直接上报到 Langfuse

### 部署影响
- 默认零成本：env 不配 `LANGFUSE_*` 时回落 Noop adapter
- 启用上报：`OBSERVABILITY_ENABLED=true` + `LANGFUSE_HOST` + `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY`
- 文档：[services/observability/docs/deploy.md](services/observability/docs/deploy.md)

---

## 0.3.0 — 2026-05 · Phase 7-8 · Enterprise Gateway + Hook Runtime

### 新增（Phase 7）
- **EnterpriseGateway**：6 渠道统一接入（Web / WeCom / Feishu / DingTalk / Webhook / Cron）
- 各渠道 ChannelAdapter 实现完整 inbound→submitMessage→deliver→audit 链路
- WeCom 真实接入（`WECOM_MODE=real`），其余渠道 mock + real 双轨

### 新增（Phase 8）
- **RuntimeHooks** 12 个 hook 点
- **SubagentPlugin**：监听 6 个 hook 自动追踪 evidence、注入 evolution signal、旁路重建 MEMORY.md

### 部署影响
- 启用企业微信渠道需配置 `WECOM_CORP_ID` / `WECOM_AGENT_ID` / `WECOM_AGENT_SECRET`，并在 nginx 暴露 webhook 入口

---

## 0.2.0 — 2026-05 · Phase 4-6 · Tool Catalog + Task/Cron + Skill Governance

### 新增（Phase 4）
- **ToolCatalog**：11 域分类，三级权限（read/ask/deny）
- **PlanModeGuard**：plan_only / strict / auto_confirm 三种策略
- **A2UI Workbench**：6 个 Surface builder（card / table / timeline / form / chart / markdown）
- 新增 `GET /api/tools/catalog`（含 ETag）

### 新增（Phase 5）
- **TaskStore + readHighwatermark**：按 taskListId 分别追踪已处理任务
- 9 个 task 工具：`task.list/get/create/update/complete/link_evidence/block/claim/release`
- **CronTemplates**：5 个预置经销商场景（日报 / 库存 / 工单 / 线索清零 / 财务异常）

### 新增（Phase 6）
- `evolution.diff` / `evolution.disable`：skill patch 三向对比 + 语义明确版 rollback
- `memory.inspect` / `memory.remove`：精确 / fuzzy 查找与移除（带审计 reason）

---

## 0.1.0 — 2026-04 · Phase 1-3 · Transcript + Memory + Compaction

### 新增（Phase 1）
- **BusinessQueryEngine**：统一消息入口，`submitMessage` / `submitStream` 生命周期
- **TranscriptStore**：JSONL 16 种事件
- **SQLiteTranscriptIndex**：FTS5 全文检索

### 新增（Phase 2）
- **MemoryIndex**：7 分类（user/feedback/project/reference/procedure/fact/episode）
- **MemoryRetriever**：top-k 关键词召回
- **EpisodeStore**：重要会话摘要持久化

### 新增（Phase 3）
- **TokenBudget** + **MicroCompact** + **SessionCompact** + **CompactBoundary**
- ContextAssembler 集成预算管理，返回 `compaction_needed` 信号

### 接口
- `POST /api/chat` / `chat/stream`（含 SSE 事件类型 `route / thinking / delta / done`）
- `GET /api/handlers` / `/api/commands` / `/api/user-context` / `/api/wecom-users`
- `GET /api/metrics` / `/metrics`（Prometheus）

---

## 0.0.x — 2026-03 / 04 · Intent Router v2 + Agentic Handler + TS 迁移

主要里程碑：
- 全量迁移到 TypeScript（之前是 JS）
- IntentRouter v2：从 LLM 单步判别 → 多轮修参（喂 now / last_route / recent_messages / recent_routes）
- L0 / L1 上下文：滑窗 + 用户级静态画像（default_store 自动套用）
- AgenticHandler 三流（lifecycle / assistant / tool）拆分
- 跨意图 agentic：v1 → v3 thin（propose_tool 只观察）
- 首批 dealer skill 包：sales / inventory / after-sales / analysis / finance + gross-margin-attribution

接口里程碑：
- `/api/handlers` 引入 ETag + admin 鉴权
- `/api/commands` 引入用户权限过滤
- `/metrics` JSONL collector + per-tool latency

---

## 升级注意事项汇总

升级到 0.6.x 时：

- ✅ 不需要改 `.env`
- ✅ 不需要改反代
- ✅ 数据兼容：旧 session 自动识别为空 → 显示 landing

升级到 0.5.x 时：

- ⚠️ **必须**配置 `S3_*` 一组环境变量（开发用 MinIO，生产用 OSS / S3）
- ⚠️ 反代 `client_max_body_size` 需调到 ≥ 25MB
- ⚠️ 数据库无 schema 变化，但首次启动会建 `data/attachments/*.jsonl` 索引

升级到 0.4.x 时：

- 默认零成本（Noop），无需调整
- 启用 trace 上报需起 Langfuse 服务

升级到 0.3.x（Gateway）时：

- 启用真实渠道前要先在企业微信 / 飞书 / 钉钉后台开通应用并配置 webhook 回调地址

---

## 数据 schema 兼容承诺

| 文件 | 兼容性 |
|---|---|
| `data/users.json` | 向前兼容，新字段可选 |
| `data/recommended-commands.json` | 向前兼容；key 改名需同步 users.json role |
| `data/intent-codes/*.json` | 向前兼容 |
| `data/tool-policies.json` | 向前兼容 |
| `users/*/MEMORY.md` | markdown，永远向前兼容 |
| `logs/*.jsonl` transcript | append-only，事件 schema 向前兼容 |

任何破坏性变更都会在本文件 **严正标注 ⚠️ Breaking change**，并在 commit message 第一行加 `BREAKING:` 前缀。

---

## 贡献流程

```
分支：feat/<topic> / fix/<topic> / docs/<topic>
提交：<type>(<scope>): <message>      # 见 README 风格
PR：必须含 test plan，影响接口的改动须同步更新 API.md
版本号：merge 到 main 时同步 bump CHANGELOG.md
```
