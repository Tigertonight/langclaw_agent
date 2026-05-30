# DEPLOY · Enterprise Agent 部署手册

> 目标读者：拿到这份代码、需要把它跑起来的运维 / 后端 / 集成方。
> 阅读时间：10 分钟；实操时间（最小可跑）：5 分钟。

按场景挑一条路线：

- **A. 本地试跑（5 分钟）** — 想先看看能不能跑、长什么样
- **B. 内网测试环境（30 分钟）** — 给业务方做 demo，含附件上传和 mock 渠道
- **C. 生产部署（1～2 小时）** — 含真实 LLM、对象存储、可观测、企业渠道

---

## 0. 前置依赖

| 依赖 | 版本 | 用途 | 是否必须 |
|---|---|---|---|
| Node.js | ≥ 18（推荐 20 LTS） | 运行时 | ✅ |
| npm | 随 Node | 安装/构建 | ✅ |
| Docker + Docker Compose | 任意近期版本 | 起 MinIO（附件） / Langfuse（observability） | B/C 必需 |
| LLM API key | — | OpenAI 兼容协议（MiniMax / DeepSeek / OpenAI / 任意兼容方） | A/B/C 都建议有，否则走本地 stub |
| 对象存储 | S3 兼容（MinIO / OSS / S3） | 附件持久化 | B/C 必需 |

确认环境：

```bash
node -v   # >= v18
npm -v
docker --version
```

---

## A. 本地试跑（3 分钟）

最快验证代码能跑、能聊天、UI 长什么样。

```bash
# 1. 安装依赖（postinstall 自动：建运行时目录 + 复制 .env.example → .env）
npm install

# 2. 编辑 .env 填一项即可：
#    LLM_API_KEY=你的_minimax_或_deepseek_或_openai_key
# 不填也能启动，preflight 会 ⚠ 提示，发消息时 LLM 调用会失败

# 3. 启动（preflight 自检 → 没编译过先编译 → 起服务）
npm start
# 访问 http://localhost:3000
```

**期望结果**：浏览器进入 landing 页，看到 4 张推荐卡片；点击或在输入框打字、回车后切到 chat 视图，能看到流式回答。

> 💡 附件上传：默认未配 S3 自动降级（按钮可见但上传返回 503）。
> 想联调，跑 `docker compose -f docker-compose.attachments.yml up -d` 即可（默认值已对齐）。

**开发热路径**（改完代码立即生效，不用每次重启）：

```bash
npm run start:dev    # 等价 npm run server，tsx 直跑 TS
```

---

## B. 内网测试环境（30 分钟）

适合给业务方做 demo / 灰度 / UAT。

### B1. 起对象存储（附件功能依赖）

```bash
docker compose -f docker-compose.attachments.yml up -d

# 验证
curl -s http://localhost:9000/minio/health/live   # 期望：HTTP 200
# 控制台 http://localhost:9001  账号 minioadmin / minioadmin
# 自动创建的 bucket：agent-attachments-dev
```

`.env` 里附件相关默认值正好对应这套 compose，无需改动。

### B2. 配置 LLM

打开 `.env`，至少：

```bash
LLM_BASE_URL=https://api.minimaxi.com/v1   # 或 https://api.deepseek.com/v1
LLM_API_KEY=sk-...
LLM_MODEL=MiniMax-M2.7                     # 或 deepseek-chat
```

> 想省成本：路由判别用便宜模型、最终回答用贵模型。打开 `.env` 里的 `LLM_DECISION_*` 和 `LLM_ANSWER_*` 注释。

### B3. 配置自检 + 启动

```bash
npm install
npm run build:ts
npm run config:check        # 检查 LLM/集成配置完整性
npm run session:smoke       # 会话持久化自检
npm run server
```

### B4. 验收清单（业务侧）

- [ ] `http://<host>:3000` 进入 landing 页，hero 标题正常显示
- [ ] 点击推荐卡片：tag 进入输入框，发送后切到 chat 视图、有流式回答
- [ ] 切换右上角角色（销售顾问 / 销售经理 / 店总 …）：推荐 chips 跟着变
- [ ] 回形针上传 1 个 PDF / Word / Excel / 图片：上传成功、能在对话里被引用
- [ ] 移动端浏览器（< 760px）：landing 卡片是 2x2，composer 没溢出

### B5. 渠道集成（按需）

集成方有企业微信 / 飞书 / 钉钉时，把 `.env` 对应渠道的 `*_MODE=real` 并填凭证（README 已列）。先保持 `mock` 模式做 UAT 没问题。

---

## C. 生产部署（1～2 小时）

### C1. 部署形态推荐

```
┌──────────────┐       ┌────────────────────┐       ┌──────────┐
│   Nginx /    │ HTTPS │  Node 进程（PM2 /  │       │  对象存储 │
│   ALB / SLB  ├──────►│  systemd / k8s）    ├──────►│ OSS / S3 │
└──────┬───────┘       │  enterprise-agent   │       └──────────┘
       │               └─────────┬──────────┘
       │ Webhook                 │
       │                         │ HTTP（可选）
       ▼                         ▼
┌──────────────┐       ┌────────────────────┐
│ 企业微信 /    │       │  Langfuse v3       │
│ 飞书 / 钉钉   │       │ （PG+CH+Redis+S3） │
└──────────────┘       └────────────────────┘
```

单实例最低规格：**2 vCPU / 4 GB RAM / 20 GB 系统盘**（不含对象存储和 Langfuse）。

### C2. 准备代码 + 依赖

```bash
# 在生产机
git clone <repo>
cd agent-openclaw-langchain-workflow-toolcall-agent
git checkout <要部署的版本 tag 或 commit>

# 推荐使用 npm ci（按 lock 严格安装，CI 友好）
npm ci

# 编译 TypeScript（生产建议跑编译产物，启动更快）
npm run build:ts
```

### C3. 配置 .env（生产关键项）

```bash
cp .env.example .env
vim .env
```

**必填**：
```bash
LLM_BASE_URL=...
LLM_API_KEY=...
LLM_MODEL=...
PORT=3000
HOST=0.0.0.0
```

**对象存储**（建议用阿里云 OSS / AWS S3 而不是自建 MinIO）：
```bash
S3_ENDPOINT=https://oss-cn-hangzhou.aliyuncs.com
S3_REGION=oss-cn-hangzhou
S3_BUCKET=your-prod-bucket
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_FORCE_PATH_STYLE=false      # OSS/AWS 默认走 virtual-hosted-style
S3_PUBLIC_BASE_URL=             # 留空 → 后端走预签名 URL（推荐）
```

**安全相关（重要）**：
```bash
# 不要设这一项！它会绕过 A2UI 鉴权
# A2UI_AUTH_DISABLED=
AGENTIC_DEBUG=                  # 生产留空
```

**渠道 / 可观测性按需启用**（参见 `.env.example` 注释）。

### C4. 启动方式（三选一）

#### C4-a. 直接 node + systemd（最简单）

```bash
# /etc/systemd/system/enterprise-agent.service
[Unit]
Description=Enterprise Agent
After=network.target

[Service]
Type=simple
User=app
WorkingDirectory=/opt/enterprise-agent
ExecStart=/usr/bin/node --env-file=.env dist/src/server/http.js
Restart=on-failure
RestartSec=5
StandardOutput=append:/var/log/enterprise-agent.log
StandardError=append:/var/log/enterprise-agent.log

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now enterprise-agent
sudo systemctl status enterprise-agent
```

> ⚠️ `npm run server` 用的是 `tsx` 直接跑 TS，**生产请用 `dist/src/server/http.js`**（即 `npm run server:build` 等价产物），更快、不依赖 dev 工具链。

#### C4-b. PM2

```bash
npm install -g pm2
pm2 start dist/src/server/http.js \
  --name enterprise-agent \
  --node-args="--env-file=.env" \
  --max-memory-restart 1G
pm2 save
pm2 startup     # 生成开机自启脚本
```

#### C4-c. Docker（自行打包）

仓库当前未提供 Dockerfile，可参考：

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY dist ./dist
COPY data ./data
COPY skills ./skills
EXPOSE 3000
CMD ["node", "--env-file=.env", "dist/src/server/http.js"]
```

挂载 `.env` 和持久化目录（`logs/`、`workspace/`、`users/`）即可。

### C5. 反向代理（Nginx 示例）

```nginx
server {
    listen 443 ssl http2;
    server_name agent.example.com;

    ssl_certificate     /etc/ssl/agent.crt;
    ssl_certificate_key /etc/ssl/agent.key;

    client_max_body_size 25m;     # 略大于 ATTACHMENTS_MAX_FILE_SIZE_MB

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;

        # SSE 流式必须关闭缓冲
        proxy_buffering    off;
        proxy_cache        off;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

### C6. 可观测（可选但推荐）

```bash
cd services/observability
docker compose up -d            # 起 PG + ClickHouse + Redis + MinIO + Langfuse
# 详见 services/observability/docs/deploy.md
```

回到主项目 `.env`：

```bash
OBSERVABILITY_ENABLED=true
LANGFUSE_HOST=http://your-langfuse-host:3001
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
```

未配置时 SDK 自动回落 Noop，零成本，主流程无影响。

---

## 部署后验收（必做）

```bash
# 1. 进程在
sudo systemctl status enterprise-agent     # 或 pm2 list

# 2. 端口监听
ss -lntp | grep 3000

# 3. 健康检查
curl -s http://127.0.0.1:3000/ | head -c 200      # 返回 HTML

# 4. 非流式 API
curl -s -X POST http://127.0.0.1:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"user_id":"sales_001","message":"你好"}' | head -c 500

# 5. 流式 API（SSE）
curl -N -X POST http://127.0.0.1:3000/api/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"user_id":"sales_001","message":"你好"}'
# 期望：连续看到 event: token / event: done

# 6. 附件上传
curl -s -X POST http://127.0.0.1:3000/api/upload \
  -F "files=@/path/to/test.csv"
# 期望：HTTP 201, body 含 attachments[].id
```

UI 侧打开域名根路径，确认 landing → chat → 历史会话恢复全链路无 console error。

---

## 持久化目录（备份关注）

| 目录 | 内容 | 备份频率建议 |
|---|---|---|
| `data/` | 业务 mock + 意图字典 + 工具策略（部分随版本控制） | 跟版本走 |
| `logs/` | 运行日志 + transcript jsonl | 按需轮转 |
| `users/` | 每用户 workspace（含 MEMORY.md / skills 覆盖） | 每日 |
| `workspace/` | session 共享工作区 | 每日 |
| 对象存储 bucket | 附件原文件 | 走云厂商 SLA |
| Langfuse PG/CH | trace 历史 | 走 services/observability/docs/deploy.md |

---

## 升级 / 回滚

```bash
# 升级
git fetch --tags
git checkout <new-tag>
npm ci
npm run build:ts
sudo systemctl restart enterprise-agent

# 回滚
git checkout <prev-tag>
npm ci
npm run build:ts
sudo systemctl restart enterprise-agent
```

> 数据兼容性约定：data/ 下 schema 变更必须在 CHANGELOG / commit message 显式标注；users/ 下 MEMORY.md 是 markdown，向前兼容。

---

## 故障排查

| 现象 | 排查方向 |
|---|---|
| 启动即退出 | 看日志，多半是 `.env` 缺必填 / Node 版本过低 |
| 聊天界面打开但发送后无响应 | 看进程日志：LLM_API_KEY 错 / base_url 不通 / 防火墙 |
| 流式回答卡住、最终一次性返回 | 反代 `proxy_buffering off` 没设 |
| 附件 413 Payload Too Large | Nginx `client_max_body_size` 太小 / `ATTACHMENTS_MAX_FILE_SIZE_MB` 不一致 |
| 附件上传 500 + S3 错误 | 检查 `S3_ENDPOINT` 网络可达、bucket 存在、AK/SK 权限 |
| 推荐 chips 不显示 | `data/recommended-commands.json` 是否随代码部署；浏览器看 `/api/recommended-commands` 响应 |
| 角色切换后 chips 不变 | `data/users.json` 里该用户 `role` 字段对得上 recommended-commands.json 的 key |
| trace 没上报到 Langfuse | `OBSERVABILITY_ENABLED=true` + 三个 LANGFUSE_* 都填了 + LANGFUSE_HOST 网络可达；查启动日志是否有 "Langfuse adapter" 字样 |

---

## 安全清单（上线前过一遍）

- [ ] `.env` 没 commit 进 git（`.gitignore` 已含）
- [ ] `A2UI_AUTH_DISABLED` **未设**
- [ ] `AGENTIC_DEBUG` **未设**
- [ ] HTTPS 证书有效，HTTP 强制 301
- [ ] 对象存储 bucket 关闭公网匿名读（除非业务允许），后端走预签名
- [ ] LLM API key 走只读/单 project 限额，不用主账户 key
- [ ] `OBS_SCRUB_ENABLED=true`（默认）保证手机号/身份证/邮箱/车牌不进 trace
- [ ] 反代加了基础限流（Nginx `limit_req_zone` / 云 WAF）
- [ ] 备份策略落实到 `users/` 和对象存储

---

## 联系 / 支持

- 仓库 issue：在源代码仓库提
- 架构疑问：先看 [README.md](README.md) → `docs/architecture.md` → `docs/architecture-intent-router.md`
- 可观测性：[services/observability/docs/deploy.md](services/observability/docs/deploy.md)

部署有阻塞，把以下三样一起贴出来：
1. `node -v` + `npm -v` + 操作系统
2. 启动命令的完整 stdout/stderr（前 100 行 + 错误前后 50 行）
3. `.env` **去掉所有 key 和 secret 后**的版本
