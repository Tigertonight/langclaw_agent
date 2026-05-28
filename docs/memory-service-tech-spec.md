# Memory Service 技术方案 & 实施 Checklist

> 决策依据：见 `docs/memory-architecture-decision.md`
> 目标：在不替换现有 OpenClaw 记忆体系的前提下，叠加多租户 + 向量检索 + 实体图谱 + HTTP 服务化能力
> 路线：Phase 1（基础服务化）→ Phase 2（实体图谱）→ Phase 3（高级消解，按需）

---

## 一、整体架构

### 1.1 服务定位

```
┌──────────────────────────────────────────────────────────┐
│                    接入方 Agent                            │
│   (OpenClaw / 其他 Agent 框架，通过 NPM SDK 接入)          │
└────────────────────┬─────────────────────────────────────┘
                     │ HTTP (REST)
                     ▼
┌──────────────────────────────────────────────────────────┐
│                  Memory Service                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │ HTTP Layer (路由 + 鉴权 + tenant 强校验)            │  │
│  ├────────────────────────────────────────────────────┤  │
│  │ Domain Layer                                        │  │
│  │  - MemoryRepo (CRUD + 检索)                         │  │
│  │  - DocumentRepo (md 文档 + chunks)                   │  │
│  │  - IngestionPipeline (parse / chunk / embed)        │  │
│  │  - EntityRepo (Phase 2)                             │  │
│  │  - RelationRepo (Phase 2)                           │  │
│  │  - MessageRepo (会话上报)                            │  │
│  │  - EntityResolver (Phase 2)                         │  │
│  ├────────────────────────────────────────────────────┤  │
│  │ Storage: PostgreSQL + pgvector + pg_trgm            │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
                     ▲
                     │
┌────────────────────┴─────────────────────────────────────┐
│                OpenClaw 整理 Agent                         │
│  - LLM evolution judge（已有）                              │
│  - 整理后通过 SDK 写入 Memory Service                       │
│  - 维护 session active entities（Phase 3）                 │
└──────────────────────────────────────────────────────────┘
```

### 1.2 与现有体系的关系

| 现有组件 | 新方案下角色 |
|---|---|
| `src/memory/memory-index.ts` | 保留，作为本地快路径 |
| `src/memory/memory-retriever.ts` | 保留，词法检索仍是 fallback |
| `src/memory/conflict-store.ts` | 保留，应用层冲突仍走本地 |
| `src/evolution/judge.ts` | 保留，整理决策不变 |
| `MemoryLearner.apply` | 改造：除了写 memory.json，还通过 SDK 写入 Memory Service |
| `transcript-plugin.ts` | 改造：除了写 jsonl，还通过 SDK 上报到 Memory Service |
| `workspace-context.ts` | 改造：增加 `business_id` 维度 |

**核心原则**：Memory Service 是**远端权威源**，本地文件系统是**离线缓存 + 降级 fallback**。

---

## 二、数据模型设计

### 2.1 Schema 总览（PostgreSQL）

```sql
-- ========== Phase 1 ==========

-- 记忆主表
CREATE TABLE memories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  agent_id        TEXT,                    -- 可空，user-level memory 时为 NULL
  category        TEXT NOT NULL,           -- user/feedback/project/reference/procedure/fact/episode
  name            TEXT NOT NULL,           -- 简短标识
  description     TEXT,                    -- 一句话描述（用于检索）
  content         TEXT NOT NULL,           -- 完整内容
  source          TEXT,                    -- 来源（manual / evolution_judge / migration）
  confidence      REAL DEFAULT 1.0,
  tags            TEXT[],
  metadata        JSONB DEFAULT '{}'::jsonb,
  embedding       VECTOR,                  -- 不写死维度，便于换模型（pgvector 支持）
  embedding_model TEXT,                    -- 当前向量由哪个模型生成（如 "bge-m3:v1"）
  embedded_at     TIMESTAMPTZ,             -- embedding 生成时间
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  expired_at      TIMESTAMPTZ,             -- 软过期
  deleted_at      TIMESTAMPTZ              -- 软删
);

CREATE INDEX idx_memories_tenant ON memories (business_id, user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_memories_category ON memories (business_id, user_id, category);
CREATE INDEX idx_memories_trgm ON memories USING gin (content gin_trgm_ops);
CREATE INDEX idx_memories_metadata ON memories USING gin (metadata);
-- 向量索引：在确定 active 模型且全表 embedding_model 一致后建
-- 换模型流程会先 DROP 此索引、重跑 embedding、再 CREATE
CREATE INDEX idx_memories_embedding ON memories USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_memories_emb_model ON memories (embedding_model);

-- 静态文档（md 文件元数据）
CREATE TABLE documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     TEXT NOT NULL,
  source_path     TEXT NOT NULL,           -- 原始 .md 文件路径或 URI
  source_hash     TEXT NOT NULL,           -- 内容 SHA-256，增量检测
  title           TEXT,
  frontmatter     JSONB DEFAULT '{}'::jsonb,
  category        TEXT,                    -- policy / manual / faq / spec / ...
  tags            TEXT[],
  metadata        JSONB DEFAULT '{}'::jsonb,
  ingested_at     TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  UNIQUE (business_id, source_path)
);

CREATE INDEX idx_documents_tenant ON documents (business_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_documents_category ON documents (business_id, category);

-- 文档切块 + 向量
CREATE TABLE document_chunks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  business_id     TEXT NOT NULL,
  chunk_index     INTEGER NOT NULL,
  heading_path    TEXT[],                  -- ["第3章", "3.2 售后流程"]，从 markdown heading 抽出
  content         TEXT NOT NULL,
  char_start      INTEGER,                 -- 在原文档中的字符起止位置，便于 highlight
  char_end        INTEGER,
  embedding       VECTOR,                  -- 不写死维度，与 memories 表保持一致
  embedding_model TEXT,                    -- 当前向量由哪个模型生成
  embedded_at     TIMESTAMPTZ,
  metadata        JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (document_id, chunk_index)
);

CREATE INDEX idx_chunks_doc ON document_chunks (document_id, chunk_index);
CREATE INDEX idx_chunks_tenant ON document_chunks (business_id);
CREATE INDEX idx_chunks_trgm ON document_chunks USING gin (content gin_trgm_ops);
-- 向量索引同 memories：换模型时 DROP → reembed → CREATE
CREATE INDEX idx_chunks_embedding ON document_chunks USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_chunks_emb_model ON document_chunks (embedding_model);

-- 会话消息上报
CREATE TABLE messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  agent_id        TEXT,
  session_id      TEXT NOT NULL,
  turn_index      INTEGER NOT NULL,
  role            TEXT NOT NULL,           -- user / assistant / tool / system
  content         TEXT,
  tool_call       JSONB,
  tool_result     JSONB,
  metadata        JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_messages_session ON messages (business_id, user_id, session_id, turn_index);
CREATE INDEX idx_messages_tenant_time ON messages (business_id, user_id, created_at DESC);

-- 冲突管理（Phase 1 简化版，复用现有状态机）
CREATE TABLE conflicts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  status          TEXT NOT NULL,           -- open / needs_user_confirmation / resolved / ignored
  category        TEXT,
  context         JSONB NOT NULL,          -- 冲突详情
  related_memory_ids UUID[],
  created_at      TIMESTAMPTZ DEFAULT now(),
  resolved_at     TIMESTAMPTZ
);

CREATE INDEX idx_conflicts_open ON conflicts (business_id, user_id, status) WHERE status IN ('open', 'needs_user_confirmation');

-- ========== Phase 2 ==========

-- 实体表
CREATE TABLE entities (
  id              TEXT PRIMARY KEY,        -- 形如 "customer:c_001" / "person:tmp_xxx"
  business_id     TEXT NOT NULL,
  type            TEXT NOT NULL,           -- customer / person / order / product / event / ...
  name            TEXT NOT NULL,
  aliases         TEXT[],
  external_ids    JSONB DEFAULT '{}'::jsonb,  -- 业务系统主键映射 {crm_id: "...", phone: "..."}
  attributes      JSONB DEFAULT '{}'::jsonb,
  embedding       VECTOR(1536),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  merged_into     TEXT REFERENCES entities(id),  -- 软合并指针
  CHECK (id LIKE business_id || ':%')      -- 强制 ID 带 tenant 前缀
);

CREATE INDEX idx_entities_tenant_type ON entities (business_id, type) WHERE merged_into IS NULL;
CREATE INDEX idx_entities_name_trgm ON entities USING gin (name gin_trgm_ops);
CREATE INDEX idx_entities_embedding ON entities USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_entities_external_ids ON entities USING gin (external_ids);

-- 关系图谱（三元组）
CREATE TABLE relations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     TEXT NOT NULL,
  subject_id      TEXT NOT NULL REFERENCES entities(id),
  predicate       TEXT NOT NULL,           -- complained_about / ordered / prefers / ...
  object_id       TEXT REFERENCES entities(id),
  object_value    JSONB,                   -- 当 object 不是实体时（数值/文本/时间）
  occurred_at     TIMESTAMPTZ,             -- 关系发生的业务时间
  source_memory_id UUID REFERENCES memories(id),
  confidence      REAL DEFAULT 1.0,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_relations_subj ON relations (business_id, subject_id, predicate);
CREATE INDEX idx_relations_obj ON relations (business_id, object_id, predicate) WHERE object_id IS NOT NULL;
CREATE INDEX idx_relations_pred ON relations (business_id, predicate, occurred_at DESC);

-- 实体合并日志（可逆）
CREATE TABLE entity_merge_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     TEXT NOT NULL,
  source_entity_id TEXT NOT NULL,          -- 被合并的
  target_entity_id TEXT NOT NULL,          -- 合并到的
  reason          TEXT,                    -- 自动 / 人工 / 业务系统主键匹配
  merged_by       TEXT,
  merged_at       TIMESTAMPTZ DEFAULT now(),
  rolled_back_at  TIMESTAMPTZ
);

-- ========== Phase 3 ==========

-- 会话级 active entities（短期，可走 Redis；这里给 PG 兜底版）
CREATE TABLE session_entities (
  business_id     TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  session_id      TEXT NOT NULL,
  ref_text        TEXT NOT NULL,           -- "张总" / "他媳妇"
  entity_id       TEXT REFERENCES entities(id),
  last_turn       INTEGER NOT NULL,
  metadata        JSONB DEFAULT '{}'::jsonb,
  PRIMARY KEY (business_id, user_id, session_id, ref_text)
);
```

### 2.2 关键设计点

**(1) tenant_id 不单独建字段，用 `(business_id, user_id)` 复合键**
- 原因：用户场景里租户即业务方，user 必属于 business
- 所有索引以 `business_id` 起头，PG 索引前缀匹配高效
- 应用层在每个 Repo 方法签名都强制要求 `(business_id, user_id)`，无法忘记

**(2) 实体 ID 强制带 business_id 前缀**
- `customer:c_001` 改为 `dealer_001:customer:c_001`
- DB CHECK 约束 + 应用层校验双重防线
- 防止跨租户实体 ID 撞车

**(3) 软删除 + 软合并**
- `deleted_at` / `merged_into` 都不真删
- 检索时 `WHERE deleted_at IS NULL AND merged_into IS NULL`
- 满足合规审计 + 可逆需求

**(4) embedding 字段允许 NULL**
- 异步生成 embedding，写入主流程不阻塞
- 后台 worker 扫描 `embedding IS NULL` 批量补全

**(5) 静态文档 vs 运行时记忆分表**
- `memories` 是 agent 对话整理出的动态记忆（增量增长，evolution judge 写入）
- `documents` + `document_chunks` 是已有 md 文档（相对稳定，pipeline ingest）
- 两类生命周期、写入路径、版本化策略不同，分表更清晰
- 检索时通过跨源接口 UNION 召回，对 agent 暴露统一 `search_knowledge` tool

**(6) 文档变更走 source_hash 增量**
- 每个 .md 算 SHA-256，对比 `documents.source_hash`
- 命中 hash → 跳过；未命中 → 删除旧 chunks 整篇重建
- 保证文档版本一致性（不会有半新半旧的 chunks）
- 删除文档级联删 chunks（ON DELETE CASCADE）

---

### 2.3 Embedding 模型替换策略

**前提**：同一时间只有一个 active 模型，不做多模型并存、不做双写。换模型 = 全量重跑 embedding。这个简化前提下，不需要影子表。

#### EmbeddingProvider 抽象（必做）

虽然不做多模型并存，接口抽象仍然必要——换模型时只动一个 Provider 文件，业务代码完全不动。

```ts
interface EmbeddingProvider {
  readonly name: string;                  // "bge-m3" / "openai-3-small" / "hash-fallback"
  readonly version: string;               // "v1" / "v2"
  readonly dimensions: number;
  readonly maxTokens: number;
  readonly batchSize: number;

  embed(texts: string[], opts?: { isQuery?: boolean }): Promise<number[][]>;
  healthCheck(): Promise<boolean>;
}

// 当前向量的 model 标识统一格式：`<name>:<version>`，如 "bge-m3:v1"
function modelTag(provider: EmbeddingProvider): string {
  return `${provider.name}:${provider.version}`;
}
```

**至少实现两个 Provider**（验证接口可替换性）：
- `BgeM3Provider` —— 推荐生产首选，本地 TEI 服务
- `HashFallbackProvider` —— 0 依赖占位，仅用于本地开发/单测

#### 配置驱动 active 模型

```yaml
# config/embedding.yaml
embedding:
  active_model: bge-m3
  active_version: v1
  providers:
    bge-m3:
      type: local-tei
      endpoint: http://embedding.internal:8080
      dimensions: 1024
      batch_size: 32
    hash-fallback:
      type: hash
      dimensions: 256
```

启动时按 `active_model` 加载对应 Provider。换模型 = 改配置 + 重启 + 走重跑流程。

#### `embedding_model` 字段的作用

不是为了多模型并存，是为了**重跑期间的安全保护**：

- 重跑过程中表里部分 chunks 是新模型向量、部分还是旧模型
- 检索时必须 `WHERE embedding_model = $current_active`，否则会把旧向量也带进来做相似度——结果是噪声
- 重跑完成后整表 `embedding_model` 一致，保护条件自然恒真

**检索 SQL 模板**：

```sql
SELECT *, (embedding <=> $1) AS distance
FROM document_chunks
WHERE business_id = $2
  AND embedding_model = $current_model_tag   -- ← 关键保护
  AND embedding IS NOT NULL
ORDER BY distance
LIMIT $3;
```

不匹配的 chunks 在重跑期间退化到纯词法检索（hybrid 模式下能 fallback），不会污染向量结果。

#### 换模型运维流程

```
1. 准备
   - 数据库快照（万一需要回滚）
   - 估算重跑时长：chunks 总数 / Provider 吞吐量
   - 选维护窗口

2. 切配置
   - 改 active_model = new-model
   - 重启服务
   - 此时新写入的 chunks 用新模型 embed，已有 chunks 还是旧模型向量
   - 检索因 model 不匹配，已有数据走词法 fallback（降级期开始）

3. DROP 向量索引
   - DROP INDEX idx_chunks_embedding;
   - DROP INDEX idx_memories_embedding;
   - 无索引时批量 UPDATE 更快

4. 跑 reembed CLI
   - memory-service reembed --target=memories --batch=64
   - memory-service reembed --target=document_chunks --batch=64
   - 扫所有 embedding_model != $new_tag 的行
   - 用新 Provider 批量算 → UPDATE embedding + embedding_model + embedded_at
   - 支持断点续传（按 id 游标记录进度）
   - 进度可观测（覆盖率 % / 速率 / 失败数）

5. 重建向量索引
   - CREATE INDEX idx_chunks_embedding ON document_chunks USING ivfflat (embedding vector_cosine_ops);
   - CREATE INDEX idx_memories_embedding ON memories USING ivfflat (embedding vector_cosine_ops);
   - 注意 ivfflat 的 lists 参数按数据量调（建议 sqrt(rows)）

6. 验证
   - 抽样查询，对比预期 top-k 召回
   - 监控检索 p99 / 召回率指标

7. 降级期结束
```

#### 降级期长度估算

| 数据规模 | BGE-M3 单卡 (~50/s) | 单 CPU (~5/s) |
|---|---|---|
| 1 万 chunks | ~3 分钟 | ~30 分钟 |
| 10 万 chunks | ~30 分钟 | ~5 小时 |
| 100 万 chunks | ~5-7 小时 | 不推荐 |

百万级以下用 GPU 一次维护窗口能搞定，可接受。

#### 不做的事（明确）

- ❌ 影子表 / 多模型并存
- ❌ 写入时双写
- ❌ A/B 检索质量自动评估（人工抽样验证就够）
- ❌ 在线热切换（接受短暂降级期）

这些后续真有需求再加，Phase 1 不做，避免过度设计。

---

### 2.4 检索策略：grep vs vector vs entity 的分工

> 设计灵感来自 Claude Code：不预先 RAG，让 agent 用 grep / read 等工具自主探索代码库。这种"agent 自主探索 + 多工具组合"的模式在某些场景下质量优于"一次性向量召回"。本服务两种范式都提供，让 agent 自己选。

#### 三种检索范式的适用场景

| 检索范式 | 适合什么 | 不适合什么 |
|---|---|---|
| **精确匹配（grep / SQL LIKE）** | 关键词、固定术语、代码片段、政策条款编号 | 同义/语义查询（"投诉" vs "不满"） |
| **向量检索（embedding）** | 碎片化叙述、语义相近、跨语言匹配 | 精确字符串、罕见术语、代码标识符 |
| **实体/关系查询（SQL on entities）** | 已知 ID 的属性查询、关系遍历、时序回溯 | 模糊的"找类似的"需求 |

#### 数据类型 ↔ 推荐检索的映射

| 数据类型 | 推荐检索 |
|---|---|
| 运行时记忆（`memories` 表，碎片化叙述） | **向量为主 + 词法 fallback** |
| 政策/手册类静态文档（叙述性） | **hybrid（向量 + 词法）** |
| 规则/配置/术语类静态文档 | **grep 优先**——精确关键词通常比向量更准 |
| 业务实体（Phase 2 `entities` 表） | **直接 SQL 查询**（按 ID / 属性） |
| 实体关系（Phase 2 `relations` 表） | **graph 查询 tool** |
| 小体量高频文档（CLAUDE.md / POLICY.md 等） | **不进 ingestion，每次 read 整篇** |

#### 设计原则

**1. 多 tool 暴露，让 agent 自主选择**

不只暴露一个 `search` tool，而是给 agent 一组细粒度工具：

```
search_knowledge       # 语义检索（向量 + 词法 hybrid）
grep_documents         # 精确字符串/正则匹配
get_document(id)       # 拿整篇文档
list_documents(filter) # 浏览文档结构
get_entity(id)         # Phase 2: 实体详情
query_relations(...)   # Phase 2: 关系查询
```

agent 像 Claude Code 那样**多轮探索 + 工具组合**，质量比"一次性 top-k 召回"更高。

**2. 小文档不进 chunking**

ingest 时按文档大小分流：
- < 2000 字符 → 整篇作为一个 chunk，不切
- ≥ 2000 字符 → 按 heading + 滑窗切分

理由：小文档切了反而损失结构上下文；agent 直接看完整文档比拼接 chunk 更准。

**3. agent prompt 引导工具选择**

在 SDK 的 tool description 里明确指引：

```ts
{
  name: "grep_documents",
  description: "在文档库中精确查找包含指定字符串/正则的内容。适合：" +
               "查找特定术语、政策条款编号、错误码、代码片段。" +
               "不适合：模糊语义查询（用 search_knowledge 代替）。"
}
```

让 agent 在 reasoning 阶段就知道选哪个。

#### 反思：什么时候不用 RAG

参考 Claude Code 的零基础设施模式，以下场景**直接绕过 RAG**：

- 高频访问的小文档（每次 read 完整文件比检索更快更准）
- 结构化精确查询（直接 SQL）
- 数据频繁变更（避免 stale embedding）
- 强 reasoning 任务（agent 多轮 grep + read 优于一次召回）

本服务通过"grep + 多 tool + 小文档不切"三个机制把这种模式部分引入，**不是替代 RAG，是补充**。

---

## 三、HTTP API 契约

### 3.1 鉴权与公共参数

所有请求 header 必带：
```
Authorization: Bearer <service_token>
X-Business-Id: dealer_001
X-User-Id: user_042
X-Agent-Id: sales_agent_v2   (可选)
X-Request-Id: <uuid>         (可选，链路追踪)
```

服务端校验 `service_token` 与 `business_id` 的归属关系，防止跨租户调用。

### 3.2 写入接口

```
POST /v1/memories
Content-Type: application/json

{
  "category": "fact",
  "name": "客户偏好",
  "description": "VIP 客户张三偏好 SUV 车型",
  "content": "...",
  "source": "evolution_judge",
  "confidence": 0.92,
  "tags": ["customer", "preference"],
  "metadata": {
    "session_id": "sess_xxx",
    "turn_index": 5
  }
}

→ 200
{
  "id": "uuid",
  "embedding_status": "queued"  // queued / done
}
```

### 3.3 检索接口

```
POST /v1/memories/search
{
  "query": "客户对售后的反馈",
  "filters": {
    "category": ["fact", "feedback"],
    "tags": ["customer"],
    "since": "2026-04-01T00:00:00Z"
  },
  "mode": "hybrid",         // lexical / vector / hybrid
  "top_k": 10,
  "rerank": true
}

→ 200
{
  "total": 42,
  "items": [
    {
      "id": "uuid",
      "category": "feedback",
      "content": "...",
      "score": 0.87,
      "score_breakdown": {
        "vector": 0.91,
        "lexical": 0.78,
        "recency": 1.0
      },
      "highlights": ["售后服务"]
    }
  ]
}
```

### 3.4 文档 ingestion 接口

```
# 单文档上传/更新（接入方提供原始 markdown）
POST /v1/documents
{
  "source_path": "docs/policies/after-sales.md",
  "content": "# 售后服务政策\n\n...",
  "category": "policy",
  "tags": ["after_sales"],
  "metadata": {}
}

→ 200
{
  "id": "uuid",
  "source_hash": "sha256:...",
  "chunks_count": 12,
  "status": "ingested"   // ingested / unchanged / failed
}

# 批量 ingest（指定目录或多文件）
POST /v1/documents/ingest
{
  "items": [
    { "source_path": "...", "content": "..." },
    ...
  ]
}

→ 200
{
  "results": [
    { "source_path": "...", "id": "uuid", "status": "ingested", "chunks_count": 12 },
    { "source_path": "...", "status": "unchanged" }
  ]
}

# 删除文档（级联删 chunks）
DELETE /v1/documents/:id
→ 200 { "deleted": true }

# 列表查询
GET /v1/documents?category=policy&page=1
```

### 3.5 跨源检索接口

```
POST /v1/knowledge/search
{
  "query": "售后服务流程",
  "sources": ["memories", "documents"],   // 可只查一种
  "filters": {
    "memories": { "category": ["fact", "feedback"] },
    "documents": { "category": ["policy", "manual"] }
  },
  "mode": "hybrid",
  "top_k": 10,
  "rerank": true
}

→ 200
{
  "total": 25,
  "items": [
    {
      "source": "documents",
      "id": "chunk_uuid",
      "document_id": "doc_uuid",
      "title": "售后服务政策",
      "heading_path": ["第3章", "3.2 退换流程"],
      "content": "...",
      "score": 0.91
    },
    {
      "source": "memories",
      "id": "mem_uuid",
      "category": "feedback",
      "content": "客户对售后流程的反馈：...",
      "score": 0.85
    }
  ]
}
```

### 3.6 精确匹配接口（grep / list / get）

> 设计意图：补充向量检索的"精确查找 + 浏览"能力。让 agent 像 Claude Code 那样自主选择工具——精确关键词用 grep，模糊语义用 search。

#### 3.6.1 文档 grep

```
POST /v1/documents/grep
{
  "pattern": "退款流程",
  "is_regex": false,             // false=字符串包含，true=正则
  "filters": {
    "category": ["policy"],
    "tags": ["after_sales"]
  },
  "scope": "content",            // content / heading / title
  "limit": 50,
  "highlight": true              // 返回匹配位置
}

→ 200
{
  "total": 8,
  "items": [
    {
      "source": "document_chunk",
      "id": "chunk_uuid",
      "document_id": "doc_uuid",
      "title": "售后服务政策",
      "heading_path": ["第3章", "3.2 退换流程"],
      "content": "...",
      "matches": [
        { "start": 42, "end": 46, "text": "退款流程" }
      ]
    }
  ]
}
```

实现：内部走 `WHERE content LIKE` 或 `WHERE content ~ $regex`，命中后返回 chunk + 匹配位置。pg_trgm 索引已经覆盖大部分场景。

#### 3.6.2 记忆 grep

```
POST /v1/memories/grep
{
  "pattern": "客户.*偏好",
  "is_regex": true,
  "filters": { "category": ["fact"] },
  "limit": 50
}
```

跟文档 grep 同形态，作用于 memories 表。

#### 3.6.3 文档结构浏览

```
GET /v1/documents/:id
→ 200
{
  "id": "...",
  "title": "...",
  "frontmatter": {...},
  "outline": [                   // heading 树
    { "level": 1, "text": "售后服务政策" },
    { "level": 2, "text": "3.1 退换条件" },
    { "level": 2, "text": "3.2 退换流程" }
  ],
  "content": "...",              // 完整 markdown（小文档直接给）
  "chunks_count": 12
}

# 文档列表（让 agent 浏览有哪些文档）
GET /v1/documents?category=policy&q=售后
→ 200
{
  "total": 5,
  "items": [
    { "id": "...", "title": "...", "category": "policy", "tags": [...] }
  ]
}
```

#### 设计要点

- **小文档完整返回**：`GET /v1/documents/:id` 对小文档（如 < 5000 字符）直接返回 `content` 字段，agent 无需再调 chunks 接口
- **outline 总是给**：让 agent 能像看目录一样规划要不要深入读
- **正则限制**：`is_regex=true` 时服务端有正则复杂度上限（防 ReDoS），且超时 1s 强制中断
- **限流单独配额**：grep 类操作 IO 较重，单独限流（高于 search 但低于 ingest）

### 3.7 消息上报接口

```
POST /v1/messages/batch
{
  "session_id": "sess_xxx",
  "messages": [
    {
      "turn_index": 0,
      "role": "user",
      "content": "...",
      "metadata": {}
    },
    {
      "turn_index": 1,
      "role": "assistant",
      "content": "...",
      "tool_call": {...}
    }
  ]
}

→ 200 { "accepted": 2 }
```

### 3.8 Phase 2 接口

```
POST /v1/entities                    # 写入/upsert 实体
POST /v1/entities/resolve            # 实体消解
GET  /v1/entities/:id                # 获取实体详情
POST /v1/entities/:id/merge          # 合并实体
POST /v1/entities/:id/unmerge        # 回滚合并

POST /v1/relations                   # 写入关系
POST /v1/relations/query             # 查询关系（subject/predicate/object 任意组合）
```

### 3.9 错误码

| HTTP | code | 含义 |
|---|---|---|
| 400 | invalid_input | 参数校验失败 |
| 401 | unauthorized | service token 无效 |
| 403 | tenant_mismatch | business_id 与 token 不匹配 |
| 404 | not_found | 资源不存在 |
| 409 | conflict | 写入冲突（需走 conflict 流程） |
| 429 | rate_limited | 超限 |
| 500 | internal_error | 服务异常 |

---

## 三-A、文档 Ingestion Pipeline 设计

### A.1 整体流程

```
.md 文件 / API payload
   │
   ▼
[1. Parse]   markdown AST + frontmatter + heading 树
   │
   ▼
[2. Hash]    SHA-256(content)，对比 documents.source_hash
   │              ├── 命中 → 返回 unchanged，跳过后续
   │              └── 未命中 → 继续
   ▼
[3. Chunk]   按 heading 切 + 滑窗细分 + overlap
   │
   ▼
[4. Embed]   批量调用 embedding 服务（异步队列）
   │
   ▼
[5. Persist] 事务：删旧 chunks → upsert document → insert chunks
   │
   ▼
完成
```

### A.2 解析（Parse）

```ts
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
```

提取：
- frontmatter（YAML）→ 写入 `documents.frontmatter`
- 一级标题 → 默认作为 `documents.title`（frontmatter 里有 title 优先用）
- heading 树 → 每个 heading 节点的层级路径（用于 chunk 标注）
- 代码块 / 表格 → 标记为不可拆分单元，chunking 时整块保留

### A.3 切块策略（Chunk）

**默认策略：层级 heading + 滑窗细分**

```
1. 按 heading 树分段，每个 leaf heading 下的内容算一个候选 chunk
2. 候选 chunk 长度 ≤ MAX_CHUNK_SIZE (1000 字符) → 直接成 chunk
3. 候选 chunk 过长 → 按段落滑窗切分：
   - window_size = 800 字符
   - overlap = 100 字符
   - 不在代码块/表格中间切
4. 候选 chunk 过短（< MIN_CHUNK_SIZE 100 字符）→ 与相邻 chunk 合并
5. 每个 chunk 携带 heading_path（从根到当前 heading 的标题数组）
```

**配置化**：chunking 策略通过环境变量或 ingest 参数可调，便于不同场景调优。

```ts
interface ChunkingConfig {
  maxChunkSize: number;       // 默认 1000
  minChunkSize: number;       // 默认 100
  windowSize: number;         // 默认 800
  overlap: number;            // 默认 100
  preserveCodeBlocks: boolean; // 默认 true
  preserveTables: boolean;     // 默认 true
}
```

### A.4 Embedding 批量化

- 每个 chunk 算一个 embedding 任务
- 入库时 `embedding` 字段先留空，写入 embedding 待处理队列
- Worker 批量取 32-64 条调本地 embedding 服务（如 BGE-M3）
- 失败的进 retry 队列，超过阈值标记为 embedding_failed
- 检索时 `embedding IS NULL` 的 chunk 退化到词法检索

### A.5 增量更新机制

| 触发方式 | 适用场景 |
|---|---|
| **API 触发** `POST /v1/documents/ingest` | 接入方完全控制何时 ingest |
| **CLI 工具** `memory-ingest <dir> --recursive` | 批量初始化 / 离线重建 |
| **git hook**（接入方侧）| post-commit 时自动调 API |
| **文件监听**（dev 环境）| chokidar 监听变更，自动 ingest |

**核心保证**：
- 同一 `(business_id, source_path)` 的文档**最多一份**
- hash 命中跳过，不重复 embed
- hash 未命中**整篇替换**（删旧 chunks → 重建），保证版本一致性
- 删除文档时 `ON DELETE CASCADE` 自动清理 chunks

### A.6 chunking 调优要点

向量检索质量约 80% 取决于 chunking。建议：

- **政策/手册类文档**：heading 切分效果好（章节结构清晰）
- **FAQ 类**：每个 Q&A 算一个 chunk
- **长文档**：必须有 overlap，否则跨段语义断裂
- **代码 / 表格**：整块保留，切碎会失去意义

可观测性：
- 记录每篇文档的 chunk 数量分布
- 检索时记录命中的 chunk 在文档中位置（首/中/尾）
- 召回率不达标时考虑调 chunk size 或换策略

### A.7 跨源检索（memories + documents）

agent 通过 `POST /v1/knowledge/search` 一次拿到两类结果：

```sql
-- 简化示意，实际用 CTE + UNION ALL + 统一 ranking
WITH mem_hits AS (
  SELECT 'memory' AS source, id, content, ... ,
         (1 - (embedding <=> $1)) AS vec_score, ...
  FROM memories
  WHERE business_id = $b AND user_id = $u AND deleted_at IS NULL
  ORDER BY vec_score DESC LIMIT 50
),
doc_hits AS (
  SELECT 'document' AS source, c.id, c.content, ... ,
         (1 - (c.embedding <=> $1)) AS vec_score, ...
  FROM document_chunks c JOIN documents d ON c.document_id = d.id
  WHERE c.business_id = $b AND d.deleted_at IS NULL
  ORDER BY vec_score DESC LIMIT 50
)
SELECT * FROM (
  SELECT * FROM mem_hits UNION ALL SELECT * FROM doc_hits
) merged ORDER BY vec_score DESC LIMIT $top_k;
```

应用层做 RRF rerank 后返回，附带 `source` 字段标识来源。

---

## 四、SDK 设计（接入方使用）

### 4.1 包结构

```
@enterprise/memory-sdk
├── src/
│   ├── client.ts          # HTTP client（带重试、超时、链路）
│   ├── identity.ts        # IdentityProvider 抽象类
│   ├── tools/
│   │   ├── retrieve.ts    # 暴露给 Agent 的读记忆 tool
│   │   ├── search.ts      # search 工具（仅 memories）
│   │   ├── knowledge.ts   # 跨源语义检索（memories + documents 向量）
│   │   ├── grep.ts        # 精确匹配（grep_documents / grep_memories）
│   │   ├── browse.ts      # 浏览类（list_documents / get_document）
│   │   ├── ingest.ts      # 文档 ingest 客户端（CLI 也复用）
│   │   └── relations.ts   # Phase 2: 关系查询工具
│   ├── hooks/
│   │   └── consolidate.ts # 写记忆 hook（接 OpenClaw）
│   └── index.ts
└── package.json
```

### 4.2 IdentityProvider 抽象类

```ts
export abstract class IdentityProvider {
  abstract getBusinessId(): Promise<string>;
  abstract getUserId(): Promise<string>;
  abstract getAgentId(): Promise<string | undefined>;
  abstract getSessionId(): Promise<string>;
}
```

接入方继承实现，把自己系统里的身份映射过来。

### 4.3 Tool 暴露

```ts
import { createMemoryTools } from "@enterprise/memory-sdk";

const tools = createMemoryTools({
  identity: myIdentityProvider,
  endpoint: "https://memory.internal/api"
});

// tools 包含：
//   语义类：retrieve_memory / search_memory / search_knowledge
//   精确类：grep_documents / grep_memories
//   浏览类：list_documents / get_document
//   关系类（Phase 2）：query_relations / get_entity / find_path
// 设计意图：让 agent 像 Claude Code 那样自主选择工具组合，而不是一次性 RAG 召回
agent.registerTools(tools);
```

### 4.4 写入 hook（OpenClaw 专用）

```ts
import { createConsolidationHook } from "@enterprise/memory-sdk";

const hook = createConsolidationHook({
  identity,
  endpoint,
  // 接 OpenClaw evolution judge 的输出
  onMemoryAction: async (action) => { /* 写入服务 */ }
});

runtime.registerPlugin(hook);
```

---

## 五、实施 TODO Checklist

### Phase 0：准备工作（1 周）

- [ ] **0.1 部署环境确认**
  - [ ] 共享 PostgreSQL 实例可用性确认（版本 ≥ 14）
  - [ ] pgvector / pg_trgm 扩展安装
  - [ ] 创建独立 schema `app_memory`，与 GBrain 等其他服务隔离
  - [ ] 数据库备份策略对齐
- [ ] **0.2 关键决策对齐**
  - [ ] 确认 user-level memory vs (user, agent) 隔离粒度
  - [ ] 确认接入方范围（只 OpenClaw / 其他 Agent 框架也支持）
  - [ ] 确认业务系统集成范围（CRM / DMS / 订单 哪些纳入 Phase 2 ground truth）
  - [ ] 确认 embedding 服务（OpenAI / 自建本地模型如 BGE-M3 / 第三方）
  - [ ] 确认文档 ingest 触发方式（API / CLI / git hook / 文件监听）
  - [ ] 盘点已有 md 文档资产（数量 / 类型 / 平均大小），决定首次 ingest 范围
- [ ] **0.3 仓库结构**
  - [ ] 决定是单独新建 `memory-service` 仓库，还是放在 monorepo 子目录
  - [ ] 决定 SDK 是独立仓库还是同仓
  - [ ] CI/CD 流水线设计

### Phase 1：基础记忆服务（2-3 周）

#### 1.1 服务骨架（3 天）
- [ ] 项目初始化：TypeScript + Fastify/Express + pg + zod
- [ ] 配置加载（环境变量 + dotenv）
- [ ] 健康检查接口 `/health`
- [ ] 结构化日志（JSON 格式 + request_id 贯穿）
- [ ] 错误处理中间件（统一错误码）
- [ ] OpenAPI 文档自动生成

#### 1.2 数据库与迁移（2 天）
- [ ] 安装 migration 工具（推荐 `node-pg-migrate` 或 `kysely`）
- [ ] Phase 1 schema 迁移脚本：memories / messages / conflicts
- [ ] 索引创建脚本
- [ ] 种子数据脚本（dev 环境）
- [ ] 迁移 rollback 测试

#### 1.3 鉴权层（2 天）
- [ ] service token 校验中间件
- [ ] tenant 强校验中间件（token ↔ business_id 绑定关系）
- [ ] rate limiting（按 business_id 限流）
- [ ] 鉴权失败的统一错误响应

#### 1.4 MemoryRepo（3 天）
- [ ] `POST /v1/memories` 写入（含输入校验）
- [ ] `GET /v1/memories/:id` 读取
- [ ] `PATCH /v1/memories/:id` 更新
- [ ] `DELETE /v1/memories/:id` 软删
- [ ] 列表查询 `GET /v1/memories?category=...&page=...`
- [ ] 单元测试覆盖核心 CRUD

#### 1.5 检索能力（4 天）
- [ ] **词法检索** SQL 实现（pg_trgm + ts_rank）
- [ ] **向量检索** SQL 实现（pgvector cosine）
- [ ] **混合检索**：RRF (Reciprocal Rank Fusion) 或加权平均
- [ ] 过滤条件：category / tags / since / 自定义 metadata
- [ ] `POST /v1/memories/search` 接口
- [ ] 检索性能压测（目标：p99 < 200ms @ 10k 记忆/租户）

#### 1.6 Embedding 抽象与异步处理（4 天）
- [ ] **EmbeddingProvider 接口定义**（name / version / dimensions / embed / healthCheck）
- [ ] **BgeM3Provider 实现**（对接本地 TEI 服务）
- [ ] **HashFallbackProvider 实现**（0 依赖占位，本地开发/单测用）
- [ ] 配置驱动 active 模型（YAML 配置 + 启动加载）
- [ ] embedding 生成 worker（扫描 `embedding IS NULL` 或 `embedding_model != $active`）
- [ ] 服务调用封装（重试 + 限流 + 超时）
- [ ] 批量优化（按 batch_size 分批调用）
- [ ] 写入时记录 `embedding_model` 标识
- [ ] 检索 SQL 强制 `WHERE embedding_model = $current_active`
- [ ] embedding 失败的降级（标记 failed + 词法 fallback）
- [ ] **reembed CLI 工具**：
  - [ ] `memory-service reembed --target=<table> --batch=<n>`
  - [ ] 断点续传（按 id 游标记录进度）
  - [ ] 进度可观测（覆盖率 / 速率 / 失败数）
  - [ ] 索引 DROP / CREATE 辅助命令
- [ ] 模型替换演练文档（runbook 步骤）

#### 1.7 文档 Ingestion Pipeline（5 天）
- [ ] markdown 解析模块（remark + frontmatter + heading 提取）
- [ ] chunking 策略实现（heading + 滑窗 + overlap，配置化）
- [ ] 代码块/表格保护逻辑（不在内部切）
- [ ] hash 增量检测（SHA-256 比对）
- [ ] `POST /v1/documents` 单文档接口
- [ ] `POST /v1/documents/ingest` 批量接口
- [ ] `DELETE /v1/documents/:id` 删除（级联 chunks）
- [ ] `GET /v1/documents` 列表查询
- [ ] 事务保证：删旧 chunks → upsert document → insert chunks 原子
- [ ] CLI 工具 `memory-ingest <dir> --recursive`（SDK 内）
- [ ] chunking 质量观测：每篇 chunk 数 / 平均长度 / 异常告警
- [ ] 至少 3 类文档（policy / manual / faq）的 chunking 效果验证

#### 1.8 跨源检索（2 天）
- [ ] `POST /v1/knowledge/search` 接口
- [ ] CTE + UNION ALL 跨表查询 SQL
- [ ] RRF rerank 实现
- [ ] 来源过滤（sources 参数）
- [ ] 每个 source 独立 filters 支持
- [ ] 性能压测：跨源检索 p99 < 300ms

#### 1.9 精确匹配 & 浏览接口（2 天）
- [ ] `POST /v1/documents/grep` 字符串/正则匹配
- [ ] `POST /v1/memories/grep`
- [ ] 正则复杂度上限 + 1s 超时（防 ReDoS）
- [ ] 匹配位置 highlight 返回
- [ ] `GET /v1/documents/:id` 含 outline + 小文档完整 content
- [ ] 小文档阈值（< 5000 字符）配置化
- [ ] grep 类操作独立限流
- [ ] tool description 文案（明确何时用 grep / 何时用 search）
- [ ] e2e 验证：agent 在 grep / search / get 间能正确选择

#### 1.10 消息上报（2 天）
- [ ] `POST /v1/messages/batch` 接口
- [ ] 批量插入优化（COPY 或 multi-value insert）
- [ ] 按 session_id 查询接口
- [ ] 消息保留策略（按时间分区或 TTL）

#### 1.11 SDK 开发（4 天）
- [ ] HTTP client 封装（fetch + 重试 + 超时 + abort signal）
- [ ] IdentityProvider 抽象类
- [ ] `retrieve_memory` tool 实现（符合 ToolDefinition 契约）
- [ ] `search_memory` tool 实现
- [ ] `search_knowledge` 跨源检索 tool
- [ ] `grep_documents` / `grep_memories` 工具
- [ ] `list_documents` / `get_document` 浏览工具
- [ ] tool description 引导 agent 选择（精确 vs 语义 vs 浏览）
- [ ] 文档 ingest 客户端 + CLI 工具
- [ ] OpenClaw 写入 hook（对接 evolution judge）
- [ ] TypeScript 类型定义完整
- [ ] SDK 单元测试 + e2e 测试
- [ ] 发布到内网 NPM 仓库

#### 1.12 OpenClaw 集成（3 天）
- [ ] `workspace-context.ts` 增加 `business_id` 维度
- [ ] `MemoryLearner` 改造：写本地 + 写远端双写
- [ ] `transcript-plugin.ts` 改造：写 jsonl + 上报远端
- [ ] 远端写入失败的降级（仅本地写入 + 离线队列重试）
- [ ] 启动配置：是否启用远端 Memory Service 的开关
- [ ] 已有 docs/ 下 markdown 资产首次 ingest（可作为试点数据）
- [ ] 现有用例回归测试（确保不破坏当前能力）

#### 1.13 监控与运维（2 天）
- [ ] Prometheus metrics（请求量 / 延迟 / 错误率，按 business_id 维度）
- [ ] 关键告警规则（5xx 突增 / p99 超阈值 / DB 连接耗尽）
- [ ] Grafana 看板（请求量 / 检索质量 / embedding 队列深度）
- [ ] runbook 文档（常见故障 + 处理步骤）

#### Phase 1 验收标准
- [ ] 多租户隔离：跨 business_id 调用 100% 拒绝
- [ ] 检索质量：测试集召回率优于现有词法检索 ≥ 20%
- [ ] 性能：p99 < 200ms（10k 记忆/租户），跨源检索 p99 < 300ms
- [ ] 文档 ingest：3 类样本文档（policy / manual / faq）chunking 效果验证通过
- [ ] 文档增量更新：未变更文档跳过率 100%（hash 命中）
- [ ] Embedding Provider 可替换：从 BgeM3 切换到 HashFallback（或反向）走完整 reembed 流程，业务代码零修改
- [ ] 多检索范式协同：测试集中至少 3 类查询（精确术语 / 模糊语义 / 文档浏览）由 agent 自主选择正确工具命中
- [ ] OpenClaw 现有用例 100% 回归通过
- [ ] SDK 文档 + 接入示例完整

---

### Phase 2：实体图谱（2-3 周）

#### 2.1 Schema 扩展（1 天）
- [ ] entities 表迁移
- [ ] relations 表迁移
- [ ] entity_merge_log 表迁移
- [ ] 现有 memories 表加 `entity_refs UUID[]` 字段反向关联

#### 2.2 EntityRepo（3 天）
- [ ] `POST /v1/entities` upsert
- [ ] `GET /v1/entities/:id`
- [ ] `PATCH /v1/entities/:id` 属性更新
- [ ] `DELETE /v1/entities/:id` 软删
- [ ] 别名管理 API
- [ ] external_ids 索引查询

#### 2.3 EntityResolver（5 天）
- [ ] **Level 1：业务系统主键匹配**
  - [ ] 适配器接口（CRM / DMS / 订单 等）
  - [ ] 至少一个业务系统适配器实现
  - [ ] 主键命中即直接返回 entity_id
- [ ] **Level 2：强属性匹配**
  - [ ] 手机号 / 邮箱 / 身份证等强字段查询
  - [ ] 多字段联合匹配
- [ ] `POST /v1/entities/resolve` 接口
- [ ] 未命中时返回候选列表（带相似度分数），由调用方/LLM 决策
- [ ] resolve 调用日志（用于后续优化）

#### 2.4 RelationRepo（3 天）
- [ ] `POST /v1/relations` 写入
- [ ] `POST /v1/relations/query`：subject/predicate/object 任意组合
- [ ] 时间范围过滤
- [ ] 关系图遍历（深度 ≤ 3）
- [ ] 性能优化：递归查询的 CTE 写法

#### 2.5 OpenClaw 整理 prompt 升级（3 天）
- [ ] evolution judge prompt 改造：输出结构化实体 + 关系
- [ ] LLM 输出 schema 校验（zod）
- [ ] 降级逻辑：LLM 输出非结构化时退回 Phase 1 文本存储
- [ ] prompt 调优 + 测试集验证

#### 2.6 Agent 工具扩展（2 天）
- [ ] `query_relations` tool（agent 可主动调）
- [ ] `get_entity` tool
- [ ] `find_path` tool（实体间路径查找，可选）
- [ ] tool 描述 prompt 优化（让 agent 知道何时调）

#### 2.7 实体合并机制（3 天）
- [ ] `POST /v1/entities/:id/merge` 接口
- [ ] merge 时关系自动迁移
- [ ] merge_log 记录
- [ ] `POST /v1/entities/:id/unmerge` 回滚
- [ ] 合并冲突检测（属性冲突 → 走 conflict 流程）

#### Phase 2 验收标准
- [ ] agentic search 端到端 case：能完成"上月投诉过 + 本月下单的客户"类查询
- [ ] 实体消解准确率：业务主键命中场景 ≥ 99%
- [ ] 实体消解准确率：强属性场景 ≥ 90%
- [ ] 关系查询性能：3 跳遍历 p99 < 500ms

---

### Phase 3：高级实体消解（按需，2-3 周）

#### 3.1 会话级 active entities（5 天）
- [ ] session_entities 表（或 Redis 实现）
- [ ] OpenClaw `conversation-context.ts` 增加 active entities 池
- [ ] LLM prompt 注入 active entities 上下文
- [ ] 指代消解 prompt 设计 + 测试

#### 3.2 跨会话实体融合（5 天）
- [ ] embedding-based 相似度计算
- [ ] 属性集合相似度（jaccard / weighted）
- [ ] 自动融合阈值策略
- [ ] 建议合并队列（人工/LLM 审核）
- [ ] 融合 dashboard

#### 3.3 实体类型扩展（按业务）
- [ ] customer / person / order / product / event 之外的领域实体
- [ ] 类型 schema 配置化（DomainPack 模式）
- [ ] 类型特定的属性 + 消解规则

---

## 六、关键风险与缓解

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| 远端服务不可用 | OpenClaw 写不进记忆 | 本地双写 + 离线队列重试，远端只是增强 |
| embedding 服务限流 | 检索质量下降 | 异步生成 + 词法 fallback |
| 跨租户 ID 撞车 | 数据污染 | DB CHECK 约束 + 应用层强校验 |
| LLM 实体抽取不稳定 | Phase 2 数据脏 | schema 校验 + 降级到文本存储 |
| 性能不达标 | 用户体验差 | 分区表 + 读写分离 + 缓存层（Redis） |
| 业务系统集成复杂 | Phase 2 进度延迟 | 第一版只接 1 个最关键系统，其他后置 |

---

## 七、依赖与外部约束

### 7.1 必需依赖

- **PostgreSQL ≥ 14** + pgvector + pg_trgm
- **Embedding 服务**：OpenAI text-embedding-3-small（默认）或本地模型
- **Node.js ≥ 20**
- **TypeScript ≥ 5**

### 7.2 推荐依赖

- **Fastify**：HTTP 框架（也可 Express）
- **kysely** 或 **drizzle**：类型安全 SQL 构建器
- **pino**：结构化日志
- **zod**：schema 校验
- **node-pg-migrate**：DB 迁移
- **vitest** / **jest**：测试
- **unified / remark / remark-frontmatter / remark-gfm**：markdown 解析
- **gray-matter**：frontmatter 提取（如不用 remark-frontmatter）

### 7.3 不依赖（明确排除）

- ❌ GBrain
- ❌ ORM（Prisma 等，类型负担过重）
- ❌ GraphQL（REST 足够）
- ❌ 消息队列（Phase 1 用 PG 队列即可，规模上去再上 Kafka/Redis）

---

## 八、里程碑

| 时间点 | 里程碑 |
|---|---|
| T+1 周 | Phase 0 完成，决策对齐 |
| T+4 周 | Phase 1 alpha：内部 demo 可用 |
| T+5 周 | Phase 1 beta：1 个真实接入方试点 |
| T+8 周 | Phase 2 alpha：agentic search demo |
| T+10 周 | Phase 2 beta：2 个接入方完整使用 |
| T+13 周 | Phase 3 完成（按需推进）|

---

## 九、与现有文档的关系

- **决策依据**：`docs/memory-architecture-decision.md`
- **解耦背景**：参见 git log（3-A 至 4-H 系列 commit）
- **接入方代码示例**：待 SDK 完成后补充至 `docs/memory-sdk-integration-guide.md`
- **运维 runbook**：待 Phase 1 完成后补充至 `docs/operations-runbook.md`
