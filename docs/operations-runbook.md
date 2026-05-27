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
| `A2UI_AUTH_TOKENS_FILE` | (未设置) | 推荐：tokens 文件路径，支持热重载 |
| `A2UI_AUTH_TOKENS` | (未设置) | 备用：tokens JSON 字符串，启动时一次加载 |
| `A2UI_AUTH_DISABLED` | (未设置) | `=1` 时跳过鉴权（仅 dev） |
| `A2UI_USER_QPM` | 30 | 单用户每分钟请求上限 |
| `A2UI_IP_QPM` | 60 | 单 IP 每分钟请求上限 |
| `A2UI_STREAMS_PER_USER` | 3 | 单用户最大并发 SSE 流 |
| `CHAT_STREAM_TIMEOUT_MS` | 60000 | SSE 单次响应超时 |

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
| `envelope_emitted_total` | counter | a2UI envelope 推送数 |
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

`A2UI_AUTH_TOKENS_FILE` 指向的 JSON：

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
- `auth_loaded: false` → `A2UI_AUTH_TOKENS_FILE` 未配置或文件解析失败

### 6.4 "envelope 持续被 rejected"

`envelope_rejected_total` 不应该持续涨。如果涨，看日志 `a2ui_envelope_rejected` 找具体 issue，通常是上游 plugin 输出 schema 不对——告知 plugin 作者修。

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
