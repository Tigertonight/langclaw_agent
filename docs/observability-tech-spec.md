# 可观测性平台 · 技术方案 + 实施 Checklist

> 配套阅读：`observability-architecture-decision.md`（ADR）。本文档是 ADR 落地到代码的工程方案 + 任务拆解。

## 0. 整体架构

```
┌──────────────────────────────────────────────────────────────────┐
│                  EnterpriseAgent runtime（现有）                   │
│                                                                   │
│  ┌─────────────────────┐    ┌──────────────────────────────┐    │
│  │  RuntimeHooks (12)  │───→│  ObservabilityPlugin (新增)   │    │
│  │  message_received   │    │  - 订阅 12 个 hook 点          │    │
│  │  before_route       │    │  - 把每个 hook 转 span 上报    │    │
│  │  after_route        │    │  - 严格异步、严格只读           │    │
│  │  before_tool_call   │    └──────────────┬───────────────┘    │
│  │  after_tool_call    │                   │                     │
│  │  agent_finish       │                   ▼                     │
│  │  ...                │    ┌──────────────────────────────┐    │
│  └─────────────────────┘    │  TraceEmitter 接口（薄抽象）   │    │
│                             │  packages/observability-sdk    │    │
│                             └──────────────┬───────────────┘    │
│                                            │                     │
│                             ┌──────────────▼───────────────┐    │
│                             │  LangfuseAdapter（默认实现）  │    │
│                             │  调用 langfuse-node SDK        │    │
│                             └──────────────┬───────────────┘    │
└────────────────────────────────────────────┼─────────────────────┘
                                             │ HTTP（batch / async）
                                             ▼
┌──────────────────────────────────────────────────────────────────┐
│              services/observability/（新增独立子项目）              │
│                                                                   │
│  docker-compose.yml: Langfuse 4 组件                              │
│    ├─ langfuse-web (3000)       Langfuse UI + Public API         │
│    ├─ langfuse-worker            后台任务                         │
│    ├─ postgres                   trace metadata                   │
│    ├─ clickhouse                 大量 span 数据                    │
│    ├─ redis                      队列                             │
│    └─ minio (S3)                 大对象（prompt/completion）       │
│                                                                   │
│  dashboards/ (Next.js, 端口 4400)                                 │
│    ├─ /rag-recall/[traceId]     RAG 召回下钻                      │
│    ├─ /evolution                Evolution 闭环                    │
│    └─ 调用 Langfuse Public API（按 business_id tag 过滤）          │
│                                                                   │
│  scripts/                                                         │
│    ├─ judge-runner.ts           Phase 2: LLM-as-judge 跑批         │
│    └─ smoke-*.ts                烟囱测试                           │
└──────────────────────────────────────────────────────────────────┘

memory-service / 其他服务也通过 packages/observability-sdk 上报，
trace_id 串联可达全链路。
```

## 1. 数据模型映射

### 1.1 我们的事件 → Langfuse 概念

| 我们的事件 | Langfuse 类型 | parent | 关键 metadata |
|---|---|---|---|
| 一次用户消息进入 | **Trace**（root） | - | business_id / user_id / channel / session_id |
| 路由决策 | Span | trace | candidate_intents / chosen_intent / score / reason |
| 工具调用 | Span | trace 或父 span | tool_name / input / output / duration_ms / status |
| LLM 调用 | **Generation** | trace 或父 span | model / prompt / completion / token_input / token_output / cost |
| memory 召回 | Span | trace | query / k / chunks_returned / scores / business_id |
| RAG 检索（memory-service 侧） | Span | trace（继承自 agent 的 trace_id） | query / vector_score / lex_score / rrf_score / chunks |
| evolution 抽取 | Span | trace | source_session / extracted_memories / extracted_entities |
| subagent spawn | Trace（子 trace，linked） | - | parent_trace_id / agent_role |

### 1.2 Trace 标识规范

每个 trace 必须带这些 tag（用于过滤/聚合）：
- `business_id`（必填）—— 多租户硬隔离
- `user_id`（必填）
- `channel`（web / wecom / feishu / dingtalk / webhook / cron）
- `session_id`（必填）
- `intent`（路由决策后的 intent，after_route 时补充）
- `env`（dev / staging / prod）

每个 trace 有这些 metadata（用于下钻）：
- `prompt_version`（如果用了 prompt 模板）
- `model_used`
- `tools_called`（数组）
- `evolution_signals`（如果命中演化）
- `error_code`（失败时）

### 1.3 PII Scrub 规则

trace 上报前必须过 PII scrubber：
- 手机号 / 身份证 / 邮箱 → 替换为 `[REDACTED:phone]` / `[REDACTED:idcard]` / `[REDACTED:email]`
- 客户姓名（如果有标记）→ 替换为 `客户#{hash}`
- VIN 码 / 车牌 → 部分保留（前 3 位 + ***）
- prompt / completion 默认全文上报，但提供白名单/黑名单字段配置

scrub 规则集中在 `packages/observability-sdk/src/scrub.ts`，可由各项目复用。

## 2. 工程边界 + 目录结构

### 2.1 packages/observability-sdk（新增）

```
packages/observability-sdk/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                  // 出口
│   ├── emitter.ts                // TraceEmitter 接口
│   ├── adapters/
│   │   ├── langfuse.ts           // LangfuseAdapter（默认）
│   │   └── noop.ts               // NoopAdapter（测试/未配置时）
│   ├── scrub.ts                  // PII scrub
│   ├── tags.ts                   // Tag/metadata 类型定义
│   └── factory.ts                // getEmitter() —— 类似 getMemoryClient()
└── scripts/
    └── smoke.ts                  // SDK 自测
```

**对外 API（精简版）**：
```typescript
export interface TraceEmitter {
  startTrace(input: TraceInput): TraceHandle;
  flush(): Promise<void>;
}
export interface TraceHandle {
  span(input: SpanInput): SpanHandle;
  generation(input: GenerationInput): SpanHandle;
  score(name: string, value: number, comment?: string): void;
  end(output?: unknown, error?: Error): void;
}
export interface SpanHandle {
  childSpan(input: SpanInput): SpanHandle;
  end(output?: unknown, error?: Error): void;
}

export function getEmitter(): TraceEmitter; // 类似 getMemoryClient
export function __resetEmitterForTests(): void;
```

**激活语义**（参考 service-client.ts 的开关风格）：
- `OBSERVABILITY_ENABLED=false` → 强制 Noop
- 缺 `LANGFUSE_HOST` / `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` → Noop（向后兼容）
- 全配齐 → LangfuseAdapter
- 启动时打一条 info 日志便于排查

### 2.2 services/observability（新增独立子项目）

```
services/observability/
├── README.md                     // 部署说明
├── .env.example
├── docker-compose.yml            // Langfuse 4 组件
├── docker-compose.override.yml   // 开发环境用
├── package.json                  // 自建面板 + 脚本依赖
├── tsconfig.json
├── docs/
│   ├── deploy.md                 // 部署 runbook
│   ├── tag-spec.md               // tag 命名规范
│   └── faq.md
├── dashboards/                   // 自建面板（Next.js）
│   ├── package.json
│   ├── next.config.js
│   ├── pages/
│   │   ├── index.tsx             // 首页 / business 选择
│   │   ├── rag-recall/[traceId].tsx
│   │   └── evolution/index.tsx
│   ├── lib/
│   │   ├── langfuse-api.ts       // 调用 Public API 的封装
│   │   └── auth.ts               // 简单管理员 auth
│   └── components/
└── scripts/
    ├── judge-runner.ts           // Phase 2: LLM-as-judge
    ├── smoke-langfuse-up.ts      // 验证 Langfuse 起来
    ├── smoke-trace-roundtrip.ts  // 端到端 trace 上报+查询
    └── smoke-tag-isolation.ts    // 验证 business_id tag 过滤
```

### 2.3 Agent runtime 侧改动（最小化）

```
src/
├── runtime/
│   └── plugins/
│       └── observability-plugin.ts  // 新增，~150 行
└── memory/
    └── service-client.ts             // 不改
```

memory-service 侧另行引 sdk（在 services/memory-service 内部），不在本期主线。

## 3. 详细模块设计

### 3.1 ObservabilityPlugin

订阅 12 个 hook，生成对应 trace/span：

| Hook | Trace/Span 行为 |
|---|---|
| `message_received` | startTrace（root）+ 注入 traceId 到 ctx |
| `before_route` | trace.span("route") |
| `after_route` | route span end + tag(intent=...) |
| `before_tool_call` | span("tool:" + tool_name) |
| `after_tool_call` | tool span end + 错误信息 |
| `before_prompt_build` | span("prompt_build") |
| `agent_finish` | span("llm") 用 generation 类型 |
| `session_end` | trace.end() + flush 异步触发 |
| `before_evolution_judge` | span("evolution_judge") |
| `after_evolution_apply` | span("evolution_apply") + 抽取结果挂 metadata |
| `subagent_spawn` | 启子 trace + link parent |
| `subagent_finish` | 子 trace.end() |

**关键约束**：
- 所有 hook 回调必须 `try { ... } catch (e) { logger.warn(e) }` 包住
- 任何 await 都不能阻塞业务（用 `setImmediate` 异步化）
- TraceHandle 通过 ctx 在 hook 之间传递（runtime 已支持 ctx 透传）

### 3.2 Langfuse 自部署

参考官方 `docker-compose.yml`，4 个组件：

```yaml
services:
  langfuse-web:
    image: langfuse/langfuse:latest
    ports: ["3001:3000"]
    environment:
      DATABASE_URL: postgresql://...
      CLICKHOUSE_URL: http://clickhouse:8123
      REDIS_HOST: redis
      LANGFUSE_S3_EVENT_UPLOAD_BUCKET: langfuse
      ...
  langfuse-worker:
    image: langfuse/langfuse-worker:latest
  postgres:
    image: postgres:16
  clickhouse:
    image: clickhouse/clickhouse-server:latest
  redis:
    image: redis:7
  minio:
    image: minio/minio
```

具体版本锁到 minor，避免被动升级 breaking。

**端口规划**：
- Langfuse UI: 3001（避开 agent 主服务的 3000）
- Dashboards: 4400
- Postgres: 内部不暴露
- ClickHouse: 内部不暴露
- Redis: 内部不暴露
- MinIO: 9000（内部用）/ 9001（控制台）

### 3.3 自建面板：RAG Recall Inspector

**路由**：`/rag-recall/[traceId]`

**展示**：
```
┌─────────────────────────────────────────────┐
│ Trace: tr_xxx                               │
│ User Query: "凯美瑞 2024 款保养周期"          │
├─────────────────────────────────────────────┤
│ 召回过程（来自 memory-service span）          │
│  ┌─ 向量检索 (top 10) ─┐ ┌─ Lex (top 10) ─┐│
│  │ 1. chunk#abc 0.89   │ │ 1. chunk#def    ││
│  │ 2. chunk#ghi 0.85   │ │ 2. chunk#abc    ││
│  │ ...                 │ │ ...             ││
│  └─────────────────────┘ └─────────────────┘│
│                                             │
│  RRF 融合结果（top 5 → LLM）                  │
│   1. chunk#abc  RRF=0.0312  ★引用            │
│   2. chunk#ghi  RRF=0.0287                  │
│   3. chunk#def  RRF=0.0265  ★引用            │
│   ...                                       │
├─────────────────────────────────────────────┤
│ LLM 引用了哪几条？（从 completion 抽 citation）│
│  [1] chunk#abc                              │
│  [3] chunk#def                              │
└─────────────────────────────────────────────┘
```

**数据来源**：调 Langfuse API `GET /api/public/traces/:traceId` 拿 spans，按 `name` 过滤出 `memory.search.*`。

### 3.4 自建面板：Evolution Loop Dashboard

**路由**：`/evolution`

**展示**：
```
┌──────────────────────────────────────────────────────────┐
│ 时间窗口: 最近 7 天   business: [选择]  环境: prod        │
├──────────────────────────────────────────────────────────┤
│ 抽取速率: 234 条 memory / 56 个 entity / 89 条 relation   │
│ 采纳率:   78% (有被后续召回过)                            │
│ 回滚率:   3% (被人工 evolution.disable)                   │
├──────────────────────────────────────────────────────────┤
│ 单条 memory 引用足迹（点击展开）                           │
│ memory_id: m_xxx  "客户王总偏好高配车型"                   │
│   抽取于: 2026-05-20 trace#tr_aaa                          │
│   被召回: 12 次（最近 trace#tr_zzz）                       │
│   影响输出: 8 次（出现在 LLM completion 中）               │
├──────────────────────────────────────────────────────────┤
│ Bad cases（人工标注 score < 3 的 trace）                   │
│   tr_xxx  2026-05-26  "未识别意图"        [回放]           │
│   tr_yyy  2026-05-25  "工具调用错"        [回放]           │
└──────────────────────────────────────────────────────────┘
```

### 3.5 LLM-as-judge runner（Phase 2）

定时任务 cron: `0 */6 * * *`

输入：最近 6 小时 score 字段为空的 trace（最多 N 条）
处理：
1. 拉 trace 全文
2. 给 judge prompt（评估对话质量、是否回答正确、tool 选择是否合理）
3. judge 输出 1-5 分 + 文字理由
4. 调 Langfuse API `POST /api/public/scores` 写回分数

**judge prompt 单独管理**，每改一次 prompt 等于一次 model 升级，要做 A/B。

## 4. 配置 + 环境变量

### 4.1 agent runtime 侧（.env）

```bash
OBSERVABILITY_ENABLED=true
LANGFUSE_HOST=http://localhost:3001
LANGFUSE_PUBLIC_KEY=pk-lf-xxx
LANGFUSE_SECRET_KEY=sk-lf-xxx
LANGFUSE_FLUSH_INTERVAL_MS=2000
LANGFUSE_FLUSH_AT=20

# PII scrub
OBS_SCRUB_ENABLED=true
OBS_SCRUB_FIELDS=phone,id_card,email,plate
```

### 4.2 services/observability/.env.example

```bash
# Langfuse
LANGFUSE_NEXTAUTH_SECRET=...
LANGFUSE_DATABASE_URL=postgresql://...
LANGFUSE_CLICKHOUSE_URL=http://clickhouse:8123
LANGFUSE_REDIS_HOST=redis
LANGFUSE_S3_EVENT_UPLOAD_BUCKET=langfuse
LANGFUSE_S3_EVENT_UPLOAD_ACCESS_KEY=...
LANGFUSE_S3_EVENT_UPLOAD_SECRET_KEY=...

# Dashboards
DASHBOARD_AUTH_SECRET=...
DASHBOARD_LANGFUSE_API_URL=http://langfuse-web:3000
DASHBOARD_PUBLIC_KEY=...
DASHBOARD_SECRET_KEY=...

# Judge runner (Phase 2)
JUDGE_LLM_BASE_URL=...
JUDGE_LLM_API_KEY=...
JUDGE_LLM_MODEL=...
```

## 5. 验证 + 验收标准

### 5.1 SDK 自测（packages/observability-sdk/scripts/smoke.ts）
- ✓ `OBSERVABILITY_ENABLED=false` → Noop
- ✓ 缺 LANGFUSE_HOST → Noop（不抛）
- ✓ 全配齐 → LangfuseAdapter，能 startTrace/span/end
- ✓ scrub 各类型 PII

### 5.2 Plugin 集成测（src/eval/observability-plugin-smoke.ts）
- ✓ 一次完整对话产出 1 个 root trace
- ✓ trace 包含 span: route / tool / llm
- ✓ tag 包含 business_id / user_id / session_id
- ✓ Langfuse 服务挂掉时业务不受影响

### 5.3 Service 烟囱（services/observability/scripts/smoke-trace-roundtrip.ts）
- ✓ Langfuse 4 组件 docker compose 起得来
- ✓ SDK 上报后 5 秒内能在 Public API 查到
- ✓ business_id tag 过滤生效（跨 business 100% 拒绝）

### 5.4 端到端验证
- ✓ 跑一次 dealer-smoke 对话，所有路径都有 trace
- ✓ Dashboard 能正常显示 RAG 召回详情
- ✓ Dashboard 能正常显示 Evolution 数据

## 6. 部署/运维

### 6.1 部署模式
- **本地开发**：docker compose up -d，Langfuse 跑在 :3001
- **客户私有化**：客户机器跑同一份 docker-compose（4 组件 + 自建面板），agent 上报到内网地址
- **超大客户**：单独起一套 Langfuse，独立配置

### 6.2 备份
- Postgres：每日 pg_dump + 30 天保留
- ClickHouse：表级 backup + 7 天保留（trace 大头，长期留存意义有限）
- MinIO：bucket 级备份 + 30 天保留
- 备份脚本入 services/observability/scripts/backup.sh

### 6.3 容量估算（参考）
- 每 trace 平均 ~5 KB（含 prompt/completion）
- 客户日活 10000 对话 × 30 天 = 300 万 trace ≈ 1.5 GB / 月
- ClickHouse 占大头，PG/Redis 都很小
- 单机 SSD 100 GB 可撑 5 个客户 × 6 个月

### 6.4 运维 runbook 关键检查点（写到 services/observability/docs/deploy.md）
- Langfuse Web 健康：`GET /api/public/health`
- ClickHouse 健康：`SELECT 1`
- Worker 队列堆积：Redis llen
- agent 上报失败率：Langfuse 自带 metrics

## 7. 实施 Checklist

> 推荐顺序：自上而下，每完成一项打勾。所有 P0 完成 = 可观测性 MVP 上线。

### Phase 1：MVP（P0，目标 4-6 周）

#### A. SDK 包（packages/observability-sdk）
- [ ] A1. 初始化包结构（package.json / tsconfig / 入口文件）
- [ ] A2. 设计并实现 `TraceEmitter` 接口（src/emitter.ts）
- [ ] A3. 实现 `LangfuseAdapter`（src/adapters/langfuse.ts）
- [ ] A4. 实现 `NoopAdapter`（src/adapters/noop.ts）
- [ ] A5. 实现 `getEmitter()` 工厂 + 开关语义（参考 getMemoryClient）
- [ ] A6. 实现 PII scrub（src/scrub.ts，含手机/邮箱/身份证/车牌正则）
- [ ] A7. 写 SDK smoke 脚本（覆盖开关、scrub、adapter 切换）
- [ ] A8. 加 npm script `obs:sdk-smoke`

#### B. Agent runtime 集成
- [ ] B1. 新增 `src/runtime/plugins/observability-plugin.ts`
- [ ] B2. 订阅 12 个 hook，最小可工作版本（trace + 主要 span）
- [ ] B3. 在 ctx 透传 trace handle，子 span 能找到 parent
- [ ] B4. 异常处理：所有 hook 回调 try/catch + 日志
- [ ] B5. 在 BusinessQueryEngine 启动时注册 plugin（可由 ENV 控制）
- [ ] B6. 写集成 smoke `src/eval/observability-plugin-smoke.ts`
- [ ] B7. 加 npm script `obs:plugin-smoke`

#### C. Service 子项目骨架
- [ ] C1. 创建 `services/observability/` 目录 + README + .env.example
- [ ] C2. 写 docker-compose.yml（Langfuse 4 组件）
- [ ] C3. 验证 docker compose up -d 能起来 + 登录 admin 创建 project + 拿 keys
- [ ] C4. 写 deploy 文档（services/observability/docs/deploy.md）
- [ ] C5. 写 tag 命名规范（services/observability/docs/tag-spec.md）

#### D. 端到端连通
- [ ] D1. 配 .env 把 SDK 指向本地 Langfuse
- [ ] D2. 跑 dealer-smoke 对话，登 Langfuse UI 看到 trace
- [ ] D3. 验证 business_id tag 过滤可用
- [ ] D4. 写 services/observability/scripts/smoke-trace-roundtrip.ts

#### E. RAG Recall Inspector（自建面板 1）
- [ ] E1. 初始化 dashboards/ Next.js 项目
- [ ] E2. 实现 langfuse-api.ts 封装（auth + 拉 trace）
- [ ] E3. 实现 /rag-recall/[traceId] 页面
- [ ] E4. 简单 admin auth（用 .env secret 即可，不上正式 SSO）
- [ ] E5. 部署到 docker-compose（端口 4400）

#### F. Evolution Loop Dashboard（自建面板 2）
- [ ] F1. 实现 /evolution 页面（统计区 + memory 引用足迹 + bad cases）
- [ ] F2. 接 Langfuse score API 拉人工标注

#### G. 文档 + 验收
- [ ] G1. 把 ADR + 本 spec 加入 docs/index（如果有）
- [ ] G2. 在主 README 加可观测性章节
- [ ] G3. 把可观测性 runbook 加入 docs/operations-runbook.md
- [ ] G4. PoC 客户场景演练一次（自己跑一遍假装是客户）

### Phase 2：自动评估 + 离线队列（P1，Phase 1 完成后启动）
- [ ] H1. LLM-as-judge runner（services/observability/scripts/judge-runner.ts）
- [ ] H2. judge prompt 版本管理 + A/B 切换
- [ ] H3. 离线 JSONL 队列 + forwarder（替换 SDK 内置 batch）
- [ ] H4. 队列健康监控（堆积量告警）

### Phase 3：客户开放（P2，PoC 成熟后）
- [ ] I1. 给客户管理员的限权 dashboard 视图
- [ ] I2. 客户敏感信息额外脱敏配置（per-business）
- [ ] I3. 多客户 / 私有化部署 tooling

## 8. 不在本期范围

- 实时告警（Phase 3+）
- 通用 APM
- 基础设施监控
- 日志聚合
- 给最终用户看 trace

## 9. 风险 + 缓解（同步 ADR-风险登记）

见 ADR 文档第 11 节。本期重点防范：
1. **Langfuse 自部署翻车** —— 第一周专门挪一天验证 docker-compose 跑起来
2. **PII 误上报** —— scrub 必须在 Phase 1 上线前测过
3. **plugin 阻塞业务** —— 集成 smoke 必须验证 Langfuse 离线时业务不受影响

## 10. 责任 + 时间线（草稿）

| 阶段 | 工作 | 估时 |
|---|---|---|
| Phase 1 | A + B + C + D | 3 周 |
| Phase 1 | E + F | 1.5 周 |
| Phase 1 | G + 联调 buffer | 1 周 |
| Phase 2 | H | 2 周（视 PoC 节奏插入） |
| Phase 3 | I | 待定 |

按当前节奏，**Phase 1 落地约 4-6 周**。如果 PoC 客户在 4 周内进来，可优先做 A/B/C/D（端到端先通），E/F 顺延 1-2 周。

---

更新记录：

| 日期 | 修改 |
|---|---|
| 2026-05-28 | v0.1 初稿 |
