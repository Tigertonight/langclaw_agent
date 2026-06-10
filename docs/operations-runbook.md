# 运维 Runbook

面向值班/运维同学。覆盖部署、健康检查、备份恢复、token 轮换、常见故障判断。

## 1. 服务进程

启动命令：

```bash
npm run server
# 或直接：node dist/server/http.js
```

默认 `0.0.0.0:3000`，可通过 `HOST` / `PORT` 环境变量覆盖。

环境变量速查：

| 变量 | 默认 | 作用 |
|---|---|---|
| `PORT` | 3000 | HTTP 监听端口 |
| `HOST` | 0.0.0.0 | HTTP 监听地址 |
| `OPENUI_AUTH_TOKENS_FILE` | (未设置) | 推荐：tokens 文件路径，支持热重载 |
| `OPENUI_AUTH_TOKENS` | (未设置) | 备用：tokens JSON 字符串，启动时一次加载 |
| `OPENUI_AUTH_DISABLED` | (未设置) | `=1` 时跳过鉴权（仅 dev） |
| `OPENUI_USER_QPM` | 30 | 单用户每分钟请求上限 |
| `OPENUI_IP_QPM` | 60 | 单 IP 每分钟请求上限 |
| `OPENUI_STREAMS_PER_USER` | 3 | 单用户最大并发 SSE 流 |
| `CHAT_STREAM_TIMEOUT_MS` | 60000 | SSE 单次响应超时 |

`A2UI_*` 环境变量仍作为 legacy alias 读取；新部署请统一使用 `OPENUI_*`。

## 2. 健康检查（K8s / LB）

二段式：

| 端点 | 含义 | LB 行为 |
|---|---|---|
| `GET /health` | liveness：进程没死就 200。**不**依赖外部状态。 | 失败 → 重启 pod |
| `GET /ready` | readiness：检查数据目录可读写、tokens 已加载、关键配置可读。失败返回 503 + JSON 详情。 | 失败 → 摘流量但不重启 |

K8s 探针建议：

```yaml
livenessProbe:
  httpGet: { path: /health, port: 3000 }
  initialDelaySeconds: 5
  periodSeconds: 30
readinessProbe:
  httpGet: { path: /ready, port: 3000 }
  initialDelaySeconds: 3
  periodSeconds: 10
```

`/ready` 返回示例（失败时）：

```json
{
  "ok": false,
  "checks": {
    "config_readable": { "ok": true },
    "users_writable": { "ok": false, "detail": "EACCES: permission denied" },
    "auth_loaded": { "ok": true, "detail": "2026-05-23T04:00:00Z" }
  }
}
```

## 3. Metrics（Prometheus）

两套并存：

| 端点 | 格式 | 用途 |
|---|---|---|
| `GET /metrics` | Prometheus 文本（v0.0.4） | 给 Prometheus scraper 抓取 |
| `GET /api/metrics` | JSON | dashboard / 调试 |

Prometheus scrape 配置示例：

```yaml
scrape_configs:
  - job_name: enterprise-agent
    metrics_path: /metrics
    static_configs:
      - targets: ['agent.internal:3000']
```

关键指标：

| 名称 | 类型 | 含义 |
|---|---|---|
| `chat_request_total` | counter | 接收的对话请求数（按 tenant 分） |
| `chat_request_failed_total` | counter | 处理失败数 |
| `chat_stream_total` | counter | SSE 流式请求数 |
| `auth_failed_total` | counter | 鉴权失败数 |
| `rate_limited_total` | counter | 命中限流的请求数 |
| `envelope_emitted_total` | counter | OpenUI Lang envelope 推送数 |
| `envelope_rejected_total` | counter | envelope 校验失败数（应保持 0） |
| `tool_input_invalid_total` | counter | 工具入参 zod 校验失败数 |
| `tool_execute_failed_total` | counter | 工具执行抛异常数 |
| `plugin_extract_failed_total` | counter | plugin 抽取失败数 |
| `finalize_latency_ms` | summary | finalize 延迟（p50/p95/p99） |
| `stream_duration_ms` | summary | SSE 流总时长 |

> ⚠️ **进程重启 metrics 清零**。Prometheus scrape 间隔内的窗口数据会丢，长时间趋势靠 Prometheus 端的存储，不靠应用。

告警建议（PromQL）：

```promql
# 鉴权失败率突增
rate(auth_failed_total[5m]) > 1

# 工具执行失败率
rate(tool_execute_failed_total[5m]) > 0.5

# SSE 延迟变长
histogram_quantile(0.95, rate(finalize_latency_ms_sum[5m])) > 5000
```

## 4. Token 管理

### 文件格式

`OPENUI_AUTH_TOKENS_FILE` 指向的 JSON：

```json
{
  "tk_user_001": {
    "user_id": "u001",
    "tenant_id": "tenantA"
  },
  "tk_admin_001": {
    "user_id": "admin",
    "tenant_id": "ops",
    "is_admin": true
  },
  "tk_revoked_2025": {
    "user_id": "u099",
    "revoked_at": "2026-05-20T00:00:00Z"
  }
}
```

关键字段：
- `user_id` （必填）—— 与请求 body 的 `user_id` 必须匹配
- `tenant_id` （可选）—— 多租户标识
- `is_admin` （可选）—— 给 admin 接口用
- `revoked_at` （可选）—— 带值即视为已吊销，鉴权直接 401

### 吊销/新增 token

1. **编辑 tokens 文件**（在文件名指向的路径上）：
   - 新增：在 JSON 顶层加一条
   - 吊销：给该 token 加 `"revoked_at": "<ISO 时间>"`
   - 删除：直接移除 key

2. **触发重载**（两种方式都行）：
   - **自动**：`fs.watch` 监听文件变更，500ms 节流后自动重载（日志会打 `auth_tokens_loaded`）
   - **手动**：调用 admin 接口
     ```bash
     curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
          http://agent.internal:3000/api/admin/auth/reload
     # → {"ok":true,"size":42,"loaded_at":"2026-05-23T..."}
     ```

3. **验证**：
   - 检查日志里有无 `auth_tokens_loaded`
   - 用被吊销的 token 调用 `/api/chat` 应返回 401 `token revoked`

## 5. 备份与恢复

### 数据目录布局

```
<repo>/
├── users/                    # 必备份：用户 workspace 数据
│   └── {user_id}/
│       ├── runtime/
│       │   ├── pending-actions.json
│       │   └── a2ui-envelopes.json
│       └── tasks/
│           ├── active.json
│           └── lists/
├── data/                     # 可不备份：从 git 重新 clone 即可
│   ├── customers.json
│   └── ...
└── tokens.json (or 自定义路径)  # 必备份：访问凭证
```

### 备份脚本

每日 cron 示例：

```bash
#!/bin/bash
set -euo pipefail
TS=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR=/var/backups/agent
mkdir -p "$BACKUP_DIR"
tar czf "$BACKUP_DIR/users-$TS.tar.gz" -C /opt/agent users/
tar czf "$BACKUP_DIR/tokens-$TS.tar.gz" -C /opt/agent tokens.json
# 保留 30 天
find "$BACKUP_DIR" -name "*.tar.gz" -mtime +30 -delete
```

### 恢复步骤

1. 停服：`systemctl stop agent` 或 k8s `kubectl scale deploy/agent --replicas=0`
2. 还原 `users/` 目录：`tar xzf users-<时间戳>.tar.gz -C /opt/agent`
3. 还原 tokens 文件
4. 启服并观察 `/ready` 返回 200

> ⚠️ 文件存储是 read-modify-write 串行的（FileJsonStore + 文件锁），但**多机部署时跨节点不能保证强一致**。多机部署需要把 store adapter 换成 Redis/PG（接口已抽象，见 `docs/a2ui-production-readiness.md` §11）。

## 6. 常见故障判断

### 6.1 用户报"无法登录"

1. 看日志里有没有 `auth_failed_total` 飙升
2. `curl -H "Authorization: Bearer <用户的token>" /api/chat` 复现
3. 401 `invalid token` → tokens 文件里没这条，让用户重新申请
4. 401 `token revoked` → tokens 文件里 revoked_at 被设置了，确认是不是误吊销
5. 403 `user_id does not match token` → 前端发的 `body.user_id` 和 token 绑定的不一致，前端 bug

### 6.2 用户报"对话卡住没响应"

1. `/api/metrics` 看 `stream_duration_ms.p99` 是否异常
2. `tool_execute_failed_total` 有没有飙升
3. 看 `logs/` 里 `error` 级别日志的 `trace_id`，关联到具体请求
4. 如果是 LLM 上游慢，`finalize_latency_ms` 会涨
5. 如果是工具执行 hang，`tool_execute_failed_total` 不会涨但延迟涨——抓堆栈：`kill -USR1 <pid>` 让 node 输出诊断

### 6.3 `/ready` 返回 503

按 JSON 里 `checks` 字段判断：
- `config_readable: false` → `data/customers.json` 缺失或权限问题
- `users_writable: false` → `users/` 目录权限/磁盘满
- `auth_loaded: false` → `OPENUI_AUTH_TOKENS_FILE` 未配置或文件解析失败

### 6.4 "envelope 持续被 rejected"

`envelope_rejected_total` 不应该持续涨。如果涨，看日志 `envelope_rejected` 找具体 issue，通常是上游 plugin 输出 schema 不对——告知 plugin 作者修。

## 7. 滚动重启 / 升级

1. 灰度一台，观察 5 分钟
   - `/ready` 200
   - `auth_failed_total` / `tool_execute_failed_total` 没飙
   - `finalize_latency_ms.p95` 没异常涨
2. 全量推
3. 出问题快速回滚：保留上一版镜像 tag，`kubectl rollout undo deploy/agent`

## 8. 关键日志关键字

应用层日志走 stdout（JSON 行）。重要关键字：

| 关键字 | 含义 |
|---|---|
| `auth_tokens_loaded` | tokens 文件加载/重载成功 |
| `auth_tokens_load_failed` | tokens 文件解析失败 |
| `tool_input_invalid` | 工具入参校验失败（warn） |
| `tool_execute_failed` | 工具执行抛异常（error） |
| `plugin_extract_failed` | plugin 抽取失败（warn） |
| `chat_stream_disconnected` | 客户端断开 SSE |

每条日志带 `trace_id`，可以在 LB / 应用层关联同一个请求。

---

## 9. memory-service 运维

`services/memory-service` 是独立 HTTP 服务，承载多租户记忆 + RAG + 实体图谱。
本节覆盖启停、开关、embedding 切换、离线队列处置、ingest 回滚。

### 9.1 启停 & 健康检查

```bash
cd services/memory-service

# 1) 起 Postgres（pgvector + pg_trgm 扩展，Dockerfile.pg 自带）
docker compose up -d
# 校验：docker ps 看到 memory-service-pg 容器 healthy

# 2) 跑迁移（幂等）
npm run migrate
# 期望日志：migration_already_applied 或 applied

# 3) 起服务（dev 模式带 watch）
npm run dev
# 生产用 npm run build && npm start

# 4) 健康检查
curl -s http://localhost:4310/healthz   # 进程存活
curl -s http://localhost:4310/readyz    # DB 可达 + 扩展就绪
```

### 9.2 OpenClaw 侧的开关（Spec 1.12）

OpenClaw 通过 `src/memory/service-client.ts` 决定是否镜像写到 memory-service。
开关语义（按优先级）：

| 环境变量 | 行为 |
|---|---|
| `MEMORY_SERVICE_ENABLED=false`（或 0/no/off） | 强制关闭，即使 URL+SECRET 都配了 |
| `MEMORY_SERVICE_ENABLED=true` 但缺 URL/SECRET | warn 日志后关闭，不抛 |
| `MEMORY_SERVICE_URL` + `MEMORY_SERVICE_SECRET` 均配齐 | 启用 |
| 其他（缺 URL 或 SECRET） | 关闭（向后兼容旧部署） |

启动时打一条 info：
- `[memory-service] enabled (url=...)` — 启用
- `[memory-service] disabled by MEMORY_SERVICE_ENABLED` — 显式关
- 没看到任何一条 → 检查代码路径有没有调到 `getMemoryClient()`

故障定位"为什么 evolution 没镜像到 memory-service"：grep 启动日志里这条 info；如果 enabled
但远端没收到数据，下一步看 9.5（离线队列）。

### 9.3 Embedding 模型切换演练（reembed）

支持的 provider（在 `services/memory-service/.env` 切换）：
- `bge-m3-ollama` — 调本地 Ollama 服务，需要 `ollama pull bge-m3`（~2GB），1024 维
- `hash-fallback` — 0 依赖占位，单测/本地开发用，**召回质量不可信**

切换步骤：

```bash
cd services/memory-service

# 1) 改 .env：EMBEDDING_PROVIDER + EMBEDDING_MODEL_TAG（必须改 tag，否则 worker 不会重算）
#    例：bge-m3-ollama → bge-m3:v2 或者反过来切到 hash-fallback:v1

# 2) 重启服务（worker 启动时会扫到 embedding_model 不一致的行）
npm run dev   # 或 systemctl restart memory-service

# 3) 监控 worker 进度（structured log）
#    embedding_worker_persisted {table=document_chunks count=16 model=bge-m3:v2}
docker logs memory-service-pg | grep -i embedding   # 服务侧
docker exec memory-service-pg psql -U memory -d memory_service -c \
  "SET search_path=app_memory; SELECT embedding_model, COUNT(*) FROM document_chunks GROUP BY embedding_model;"

# 4) 手动 drain（CI / 大规模迁移用）
npm run reembed -- --target=document_chunks --batch=64
# 进度：覆盖率 / 速率 / 失败数会写 stdout

# 5) 验证：search 返回结果且 score > 0
```

注意：
- 切换期间检索 SQL `WHERE embedding_model = $current_active`，旧 model 的行**暂时检索不到**直到 worker 跑完
- 大表（>100k 行）建议先 `DROP INDEX` 向量索引，reembed 完再 `CREATE INDEX`，否则 HNSW 重建很慢

### 9.4 文档 ingest 回滚

ingest 用的是 hash 增量，重复 ingest 同一目录会全部 unchanged。回滚单篇：

```bash
# 用 grep 或 list 找到 document id
TOKEN=$(cd services/memory-service && npx tsx scripts/sign-identity-cli.ts \
  --business <biz> --user <admin>)
curl -s -H "X-Memory-Identity: $TOKEN" \
  "http://localhost:4310/v1/documents?category=internal_docs&limit=200" | jq '.items[].id'

# 软删（不物理删，可以从 DB 恢复）
curl -X DELETE -H "X-Memory-Identity: $TOKEN" \
  http://localhost:4310/v1/documents/<doc-id>
```

整个目录回滚：

```sql
-- 进 PG
docker exec -it memory-service-pg psql -U memory -d memory_service
SET search_path = app_memory;
UPDATE documents SET deleted_at = now() WHERE business_id='default' AND category='internal_docs';
-- 物理清理（确认没人 read 后）
DELETE FROM document_chunks WHERE business_id='default' AND document_id IN (
  SELECT id FROM documents WHERE deleted_at IS NOT NULL
);
DELETE FROM documents WHERE deleted_at IS NOT NULL;
```

### 9.5 离线队列查看 / 清理

OpenClaw 在 memory-service 不可用时会把写操作（createMemory / batchMessages /
createRelation）落到本地 JSONL 队列，下次成功调用前 best-effort flush。

队列文件路径（按 user 隔离）：
```
<workspace>/users/<user_id>/workspace/memory/.memory-service-queue.jsonl
```

故障定位"消息没出现在 memory-service"：

```bash
# 1) 看队列大小（每行一条 entry）
find users/*/workspace/memory/.memory-service-queue.jsonl -exec wc -l {} \;

# 2) 看队列内容（确认 ctx + payload）
tail -5 users/<user_id>/workspace/memory/.memory-service-queue.jsonl | jq

# 3) 清空（确认数据可弃后）
rm users/<user_id>/workspace/memory/.memory-service-queue.jsonl
```

下次 OpenClaw 运行有任何 memory-service 写调用时会自动 flush。也可以用 SDK 主动
触发：`new QueuedMemoryClient({...}).flush()`。

队列默认上限 1000 条，超出会丢最早的。生产环境监控这个文件大小避免堆积。

### 9.6 常见故障判断

| 症状 | 怀疑 | 处置 |
|---|---|---|
| `unauthorized` / `identity signature mismatch` | 客户端 SECRET 与服务端 `SERVICE_TOKEN_SECRET` 不一致；或 token issued_at 超过 5 分钟 | 对齐 secret；检查机器时钟 |
| 检索返回空但 grep 有结果 | embedding 还没跑（异步）或 `embedding_model` 不匹配 | 看 worker 日志、SQL 校验覆盖率 |
| ingest 报 422 invalid_request | content 超过 2MB / source_path 超长 | 切大文件；改用 streaming ingest（待加） |
| `/readyz` 503 | DB 连接池打满 / 扩展未装 | `pg_isready`；`SELECT * FROM pg_extension WHERE extname IN ('vector','pg_trgm')` |

### 9.7 Trace 续接（与 Langfuse 联动）

memory-service 在收到带 `x-trace-id` 头的请求时，会把以下 span 挂到 agent 的同一 trace 下；不带头则起独立 root trace。

| span 名 | 来源路由 | 关键 attrs |
|---|---|---|
| `memory.search.lex` / `memory.search.vector` / `memory.search.rrf` | search hybrid 流水线子 span | hits 数 |
| `memory.entity.upsert` | `POST /v1/entities` | entity_id, type |
| `memory.entity.resolve` | `POST /v1/entities/resolve` | matched, candidates |
| `memory.relation.create` | `POST /v1/relations` | relation_id, predicate |
| `memory.messages.batch` | `POST /v1/messages/batch` | inserted, total |
| `memory.create` / `memory.patch` / `memory.delete` | `/v1/memories` 写路径 | memory_id, category, reembed |
| `memory.document.ingest` / `memory.document.ingest_batch` / `memory.document.delete` | `/v1/documents` 写路径 | document_id, status, chunks_count |

读路径（list/get）刻意不发 span（量大，意义不高）。

trace_id 来自 evolution 链路：`ObservabilityPlugin` 在 `turn_start` 把 run_id→trace_id 镜像到 `activeContexts`，
`evolution-signal-plugin` 在 `turn_end` 调 `getActiveTraceContext(run_id)` 把 trace 上下文写入 `EvolutionTurnInput.traceId/runId`，
跨 SignalCollector 的异步去抖边界存活；`memory-learner.applyExtraction` 把它们注入 `CallContext` 让 memory-sdk 自动发 `x-trace-id` 头。

启用条件（同 §10.1）：memory-service 自身配齐 `LANGFUSE_HOST` + 两把 key + `OBSERVABILITY_ENABLED ≠ false`。

排查"agent trace 里看不到 memory.* span"：
1. memory-service 启动日志有没有 `[observability] enabled (host=...)`
2. agent → memory-service 的请求带没带 `x-trace-id` 头（curl/抓包）
3. agent 端 `getActiveTraceContext(run_id)` 是否能查到（通常 ObservabilityPlugin 必须先注册才会写镜像）
4. 跑 `cd services/memory-service && npm run smoke:trace` 验证 SDK 接入本身没坏

### 9.8 关键日志关键字

| 关键字 | 含义 |
|---|---|
| `migration_already_applied` | 启动迁移幂等通过 |
| `embedding_worker_persisted` | embedding worker 完成一批写入 |
| `embedding_worker_tick_failed` | worker 异常（不会停服务，下次 tick 重试） |
| `[memory-service] enabled` | OpenClaw 侧已启用镜像 |
| `[memory-service] disabled by MEMORY_SERVICE_ENABLED` | OpenClaw 侧显式关 |

### 9.9 多租户隔离 sanity check

任何 SQL / route 改动后建议跑：

```bash
cd services/memory-service && npm run smoke:all
```

跨租户隔离测试在 `scripts/smoke-routes.ts` 的 tenant scope 章节，期望"跨 business_id
调用 100% 拒绝"。

## 10. observability（Langfuse）运维

可观测性是**独立解耦**子项目，停掉本服务不影响 agent 业务（plugin 内部全部
fail-safe，emitter 抛错只 console.warn）。完整部署 runbook 在
[services/observability/docs/deploy.md](../services/observability/docs/deploy.md)。
这里只列日常 oncall 该看的东西。

### 10.1 是否启用？

| 状态 | 标志 |
|---|---|
| 启用 | `LANGFUSE_HOST` + `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY` 全配齐，且 `OBSERVABILITY_ENABLED ≠ false` |
| 启动时打印 | `[observability] enabled (host=...)` |
| 未启用 | 启动时无 enable 日志，`getEmitter()` 走 NoopAdapter，零成本 |

紧急关闭：`OBSERVABILITY_ENABLED=false`，重启 agent 服务即可。Langfuse 子项目本身不用动。

### 10.2 健康检查

```bash
# 1. Langfuse Web 健康
curl -fsS $LANGFUSE_HOST/api/public/health
# → {"status":"OK","version":"x.y.z"}

# 2. 6 个容器都 healthy
cd services/observability && docker compose ps

# 3. Worker 队列堆积（健康时 < 1000）
docker compose exec redis redis-cli -a "$REDIS_AUTH" llen langfuse:event-queue

# 4. 端到端 trace roundtrip
LANGFUSE_HOST=... LANGFUSE_PUBLIC_KEY=... LANGFUSE_SECRET_KEY=... \
  npm run obs:trace-roundtrip
```

### 10.3 trace 看不到？

排查顺序（v3 是异步队列，1-15 秒延迟正常）：

1. **查 agent 日志**有没有 `[observability]` 字样的 warn → emitter 在端上失败
2. **看 Langfuse worker**：`docker compose logs langfuse-worker --tail 100`
   - "S3 upload" error → MinIO bucket 没建好，跑 `docker compose up minio-init` 重建
   - "ClickHouse" error → ClickHouse 没起来或时区不对（必须 UTC）
3. **看 Redis 队列**：堆积过千说明 worker 处理慢，加 worker 副本或扩 ClickHouse

### 10.4 PII scrub 没生效？

- 默认 `OBS_SCRUB_ENABLED=true`，覆盖手机号 / 身份证 / 邮箱 / 中文车牌
- 跑 `npm run obs:sdk-smoke` 验证规则，若新增 PII 类型在 `packages/observability-sdk/src/scrub.ts` 加规则
- 若误伤业务字段：用 `OBS_SCRUB_DISABLED_RULES=plate,email` 单独关某条规则

### 10.5 升级

**不要跨 major 直升**。从 v2 → v3 必须先到 `langfuse/langfuse:3.29.0` 再升目标版。
小版本升级流程见 [deploy.md §升级](../services/observability/docs/deploy.md)。

### 10.6 客户私有化交付清单

- 这份 runbook §10
- [services/observability/docs/deploy.md](../services/observability/docs/deploy.md) 第一次部署
- [services/observability/docs/tag-spec.md](../services/observability/docs/tag-spec.md) tag 规范
- 客户 oncall 联系方式 + SLA 文档（待补）
