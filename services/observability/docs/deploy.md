# Langfuse 部署 runbook

> 本文档 = 第一次部署 + 日常运维 + 升级 + 备份/恢复 的合订本。
> 客户私有化交付时这份直接给客户运维参考。

## 前置

- Docker 25+ / Docker Compose v2
- 单机磁盘 ≥ 50 GB（ClickHouse 占大头）
- 单机内存 ≥ 8 GB（Postgres + ClickHouse + Worker + Web 加起来约 4-6 GB）
- 时区无所谓，但 **容器内一律 UTC**（compose 已强制）

## 第一次部署

```bash
cd services/observability
cp .env.example .env

# 必改的 3 个 secret（任何一个都不能用默认值上生产）
# 用 openssl 生成 32 字节十六进制，分别写到 .env 对应三行
openssl rand -hex 32   # → LANGFUSE_NEXTAUTH_SECRET
openssl rand -hex 32   # → LANGFUSE_ENCRYPTION_KEY
openssl rand -hex 32   # → LANGFUSE_SALT

# 生产环境也建议改：POSTGRES_PASSWORD / CLICKHOUSE_PASSWORD /
#                  REDIS_AUTH / MINIO_ROOT_PASSWORD / LANGFUSE_NEXTAUTH_URL

docker compose up -d

# 等 Langfuse Web 跑完 migration（首次启动 1-2 分钟）
docker compose logs -f langfuse-web | grep -m1 "ready - started server"
```

打开 http://localhost:3001：

1. 注册第一个管理员账号
2. New Organization → New Project（建议命名 `enterprise-agent`）
3. Settings → API Keys → Create new keys
4. 把 PUBLIC_KEY / SECRET_KEY 配到根项目 `.env`：

```bash
OBSERVABILITY_ENABLED=true
LANGFUSE_HOST=http://localhost:3001
LANGFUSE_PUBLIC_KEY=pk-lf-xxx
LANGFUSE_SECRET_KEY=sk-lf-xxx
```

5. 注册完后建议把 `LANGFUSE_AUTH_DISABLE_SIGNUP=true` 关闭注册（防被人扫到）。

## 关键检查点（每次部署后跑一遍）

```bash
# 1. 6 容器都是 healthy
docker compose ps

# 2. Langfuse Web 健康检查
curl -fsS http://localhost:3001/api/public/health
# → {"status":"OK","version":"x.y.z"}

# 3. ClickHouse 能 select
docker compose exec clickhouse clickhouse-client \
  -u "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" \
  --query 'SELECT 1'

# 4. MinIO 三个 bucket 都存在
docker compose exec minio-init mc ls lf/ 2>/dev/null || \
  docker compose run --rm minio-init mc ls lf/

# 5. Redis 队列没堆积（健康时应 < 1000）
docker compose exec redis redis-cli -a "$REDIS_AUTH" llen langfuse:event-queue
```

## 常见故障

### Web 启动卡 "Running migrations"

ClickHouse 还没 ready，重启 langfuse-web 即可。compose 已加 healthcheck depends_on，
但 ClickHouse 首次启动有时超过 healthcheck 的 retries 次数。

### "trace 上报后 5 秒还没出现"

这是 **预期行为**：v3 的 `/api/public/ingestion` 是异步队列（207 Accepted），
worker 批量处理后才落库。正常延迟 1-15 秒。如果超过 1 分钟还没出现：

```bash
docker compose logs langfuse-worker --tail 100
# 看 "ingestion-batch" / "S3 upload" 是否有 error
```

排查顺序：MinIO bucket 是否存在 → Redis 队列是否堆积 → Worker 日志。

### MinIO bucket 找不到

`minio-init` 容器跑失败了。手动重跑：

```bash
docker compose up minio-init
```

### 升级到新 minor

```bash
# 1. 停 Web/Worker，保留数据库
docker compose stop langfuse-web langfuse-worker

# 2. 改 docker-compose.yml 镜像 tag
#    例：langfuse/langfuse:3 → langfuse/langfuse:3.45.0

# 3. 拉新镜像并启动（migration 自动跑）
docker compose pull langfuse-web langfuse-worker
docker compose up -d

# 4. 看 web 日志确认 migration done
docker compose logs -f langfuse-web | grep -i migrat
```

**绝不要跨 major 直接升**。从 v2 → v3 必须先到 `langfuse/langfuse:3.29.0`，
再升到目标版本，否则会丢历史 trace。

## 备份

### 每日自动（推荐 cron）

```bash
# 简版：每天 02:00 dump 一次
0 2 * * * cd /opt/observability && bash scripts/backup.sh
```

`scripts/backup.sh`（待 Phase 1 末期补全）：

- `pg_dump` Postgres → `.sql.gz`，保留 30 天
- ClickHouse `BACKUP TABLE ... TO Disk('backups')`，保留 7 天（trace 量大长期意义有限）
- MinIO `mc mirror`，保留 30 天

### 恢复

```bash
# Postgres
docker compose exec -T postgres psql -U "$POSTGRES_USER" "$POSTGRES_DB" < backup.sql

# ClickHouse
docker compose exec clickhouse clickhouse-client \
  -u "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" \
  --query "RESTORE TABLE ... FROM Disk('backups', 'YYYY-MM-DD')"
```

## 容量参考

| 客户日活 | 月 trace | 月 ClickHouse 增量 | 推荐磁盘 |
|---|---|---|---|
| 1k | 30 万 | ~1 GB | 50 GB |
| 10k | 300 万 | ~10 GB | 200 GB |
| 100k | 3000 万 | ~80 GB（启用压缩）| 1 TB SSD |

数字基于平均每 trace 5 KB（含 prompt/completion）+ 6 个月保留 + ClickHouse 压缩。

## 客户私有化交付清单

1. 这份 docker-compose.yml + .env.example
2. 这份 deploy.md
3. tag 命名规范 [tag-spec.md](./tag-spec.md)
4. 备份脚本（Phase 1 末期补）
5. 客户运维联系方式 + 出问题怎么找我们的 SLA

## 不在本期范围

- HA / 多副本（用 Helm + 单独 Postgres/ClickHouse 集群）
- 跨 region 复制
- 实时告警（用 Langfuse 自带的 webhook + 客户告警系统）
