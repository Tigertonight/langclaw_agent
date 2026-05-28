# dashboards/

自建看板：**RAG Recall Inspector** + **Evolution Loop Dashboard**。

技术栈：Vite + React 18 + TypeScript + 极简 Express 后端反代 Langfuse Public API。

## 跑起来

需要先有运行中的 Langfuse（见父目录 README）+ 一对 Langfuse keys。

```bash
cd services/observability/dashboards
npm install

export DASHBOARD_ADMIN_SECRET=$(openssl rand -hex 16)   # 自己记住
export DASHBOARD_AUTH_SECRET=$(openssl rand -hex 32)
export DASHBOARD_LANGFUSE_API_URL=http://localhost:3001
export DASHBOARD_PUBLIC_KEY=pk-lf-xxx
export DASHBOARD_SECRET_KEY=sk-lf-xxx

# 一键开发：
npm run dev          # vite :4400 前端
# 另开终端
npm run serve        # express :4401 后端（dev 时 vite 走 proxy）

# 生产：
npm run build        # 产出 dist/
npm run serve        # express 同时贴 dist + /api
# 浏览器开 http://localhost:4401
```

登录用 `DASHBOARD_ADMIN_SECRET`。Langfuse 的 PUBLIC/SECRET key 全程在服务端，浏览器看不到。

## 页面

- `/` — 最近 20 条 trace 列表
- `/rag-recall` 或 `/rag-recall/:traceId` — 单 trace 召回详情下钻（vector / lex / RRF / 命中 chunk）
- `/evolution` — Evolution Loop 抽取速率 + bad cases（score < 3 的人工标注）

## 后端 API

| 路由 | 说明 |
|---|---|
| `POST /api/auth/login` | body `{secret}`，校验过下发 HMAC cookie |
| `POST /api/auth/logout` | 清 cookie |
| `GET /api/auth/me` | 查当前会话 |
| `* /api/langfuse/<path>` | 反代到 `LANGFUSE_HOST/api/public/<path>`，注入 Basic auth |

所有 `/api/langfuse/*` 都强制 admin cookie。

## 不在本期范围

- 多用户 / RBAC / SSO
- 跨 trace 聚合视图（等接入 ClickHouse 直查）
- Memory 引用足迹的 evolution_applied 链路（等 schema 稳定）
