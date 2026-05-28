# services/observability

Self-hosted Langfuse 部署 + 自建看板 + 评估 runner。

> 与 agent runtime 强解耦：agent 只通过 `packages/observability-sdk` 上报；
> 这里只负责"接住数据 + 展示分析"。停掉本服务不影响 agent 业务。

## 组成

- **Langfuse 6 组件**（Web + Worker + Postgres + ClickHouse + Redis + MinIO）
  - Trace/span 收集、UI 看板、API
  - 关键约束：所有数据库容器必须 UTC 时区（v3 已知坑）
- **dashboards/**（Phase 1 后期）
  - RAG Recall Inspector：单 trace 召回详情下钻
  - Evolution Loop Dashboard：抽取/采纳/回滚趋势
- **scripts/**
  - `smoke-langfuse-up.ts` —— 验证 4 组件起来
  - `smoke-trace-roundtrip.ts` —— 验证 SDK 上报 → API 查得到
  - `smoke-tag-isolation.ts` —— 验证 business_id tag 过滤
  - `judge-runner.ts`（Phase 2）—— LLM-as-judge 自动打分

## 快速开始

详见 [docs/deploy.md](docs/deploy.md)。粗略流程：

```bash
cd services/observability
cp .env.example .env
# 必须改的两个 secret：
#   LANGFUSE_NEXTAUTH_SECRET=$(openssl rand -hex 32)
#   LANGFUSE_ENCRYPTION_KEY=$(openssl rand -hex 32)
docker compose up -d
# 等 ~1-2 分钟 Langfuse 跑完 migration
open http://localhost:3001
# 注册管理员 → 创建 project → 拿 PUBLIC_KEY / SECRET_KEY
# 把 keys 写到根项目 .env：
#   LANGFUSE_HOST=http://localhost:3001
#   LANGFUSE_PUBLIC_KEY=pk-lf-xxx
#   LANGFUSE_SECRET_KEY=sk-lf-xxx
#   OBSERVABILITY_ENABLED=true
```

## 端口

| 端口 | 用途 |
|---|---|
| 3001 | Langfuse Web UI（避开 agent 主服务的 3000）|
| 4400 | dashboards Next.js（Phase 1 后期）|
| 9001 | MinIO 控制台（仅运维）|

Postgres / ClickHouse / Redis / MinIO API 不暴露公网。

## 不在本期范围

- HA / 多副本：docker-compose 单机够用，超大客户用 Langfuse 官方 Helm Chart
- 备份脚本：见 [docs/deploy.md §备份](docs/deploy.md)，先手动 cron
- 实时告警：Phase 3+
