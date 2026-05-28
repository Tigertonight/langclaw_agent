-- 0001_init.sql — Phase 1 base schema
-- Idempotent: safe to re-run. Schema-qualified by app_memory.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SCHEMA IF NOT EXISTS app_memory;
SET search_path TO app_memory, public;

CREATE TABLE IF NOT EXISTS memories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  agent_id        TEXT,
  category        TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  content         TEXT NOT NULL,
  source          TEXT,
  confidence      REAL DEFAULT 1.0,
  tags            TEXT[],
  metadata        JSONB DEFAULT '{}'::jsonb,
  embedding       vector,
  embedding_model TEXT,
  embedded_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  expired_at      TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_memories_tenant ON memories (business_id, user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_memories_category ON memories (business_id, user_id, category);
CREATE INDEX IF NOT EXISTS idx_memories_trgm ON memories USING gin (content gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_memories_metadata ON memories USING gin (metadata);
CREATE INDEX IF NOT EXISTS idx_memories_emb_model ON memories (embedding_model);

CREATE TABLE IF NOT EXISTS documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     TEXT NOT NULL,
  source_path     TEXT NOT NULL,
  source_hash     TEXT NOT NULL,
  title           TEXT,
  frontmatter     JSONB DEFAULT '{}'::jsonb,
  category        TEXT,
  tags            TEXT[],
  metadata        JSONB DEFAULT '{}'::jsonb,
  ingested_at     TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  UNIQUE (business_id, source_path)
);

CREATE INDEX IF NOT EXISTS idx_documents_tenant ON documents (business_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_documents_category ON documents (business_id, category);

CREATE TABLE IF NOT EXISTS document_chunks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  business_id     TEXT NOT NULL,
  chunk_index     INTEGER NOT NULL,
  heading_path    TEXT[],
  content         TEXT NOT NULL,
  char_start      INTEGER,
  char_end        INTEGER,
  embedding       vector,
  embedding_model TEXT,
  embedded_at     TIMESTAMPTZ,
  metadata        JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_chunks_doc ON document_chunks (document_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_chunks_tenant ON document_chunks (business_id);
CREATE INDEX IF NOT EXISTS idx_chunks_trgm ON document_chunks USING gin (content gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_chunks_emb_model ON document_chunks (embedding_model);

CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  agent_id        TEXT,
  session_id      TEXT NOT NULL,
  turn_index      INTEGER NOT NULL,
  role            TEXT NOT NULL,
  content         TEXT,
  tool_call       JSONB,
  tool_result     JSONB,
  metadata        JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages (business_id, user_id, session_id, turn_index);
CREATE INDEX IF NOT EXISTS idx_messages_tenant_time ON messages (business_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS conflicts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  status          TEXT NOT NULL,
  category        TEXT,
  context         JSONB NOT NULL,
  related_memory_ids UUID[],
  created_at      TIMESTAMPTZ DEFAULT now(),
  resolved_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_conflicts_open ON conflicts (business_id, user_id, status)
  WHERE status IN ('open', 'needs_user_confirmation');

CREATE TABLE IF NOT EXISTS schema_migrations (
  id              TEXT PRIMARY KEY,
  applied_at      TIMESTAMPTZ DEFAULT now()
);
