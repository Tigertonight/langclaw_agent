-- 0002_phase2_entities.sql — Phase 2 实体图谱骨架（2.1）
-- entities / relations / entity_merge_log + memories.entity_refs
-- 注：Phase 2 暂只做 2.1+2.2+2.4，session_entities 留给 Phase 3。

SET search_path TO app_memory, public;

-- 实体表。id 强制带 business_id 前缀（CHECK + 应用层双重防线），
-- 使用 vector(1024) 与 Phase 1 的 bge-m3 维度一致。
CREATE TABLE IF NOT EXISTS entities (
  id              TEXT PRIMARY KEY,
  business_id     TEXT NOT NULL,
  type            TEXT NOT NULL,
  name            TEXT NOT NULL,
  aliases         TEXT[],
  external_ids    JSONB DEFAULT '{}'::jsonb,
  attributes      JSONB DEFAULT '{}'::jsonb,
  embedding       vector,
  embedding_model TEXT,
  embedded_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  merged_into     TEXT REFERENCES entities(id),
  CONSTRAINT entities_id_tenant_prefix CHECK (id LIKE business_id || ':%')
);

CREATE INDEX IF NOT EXISTS idx_entities_tenant_type
  ON entities (business_id, type)
  WHERE merged_into IS NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_entities_name_trgm
  ON entities USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_entities_external_ids
  ON entities USING gin (external_ids);
CREATE INDEX IF NOT EXISTS idx_entities_attributes
  ON entities USING gin (attributes);
CREATE INDEX IF NOT EXISTS idx_entities_emb_model
  ON entities (embedding_model);

-- 关系三元组。object_id 与 object_value 二选一（应用层校验）。
CREATE TABLE IF NOT EXISTS relations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      TEXT NOT NULL,
  subject_id       TEXT NOT NULL REFERENCES entities(id),
  predicate        TEXT NOT NULL,
  object_id        TEXT REFERENCES entities(id),
  object_value     JSONB,
  occurred_at      TIMESTAMPTZ,
  source_memory_id UUID REFERENCES memories(id),
  confidence       REAL DEFAULT 1.0,
  metadata         JSONB DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ DEFAULT now(),
  deleted_at       TIMESTAMPTZ,
  CONSTRAINT relations_object_xor
    CHECK ((object_id IS NOT NULL) <> (object_value IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_relations_subj
  ON relations (business_id, subject_id, predicate)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_relations_obj
  ON relations (business_id, object_id, predicate)
  WHERE object_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_relations_pred
  ON relations (business_id, predicate, occurred_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_relations_source_memory
  ON relations (source_memory_id)
  WHERE source_memory_id IS NOT NULL;

-- 实体合并日志（可逆）
CREATE TABLE IF NOT EXISTS entity_merge_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      TEXT NOT NULL,
  source_entity_id TEXT NOT NULL,
  target_entity_id TEXT NOT NULL,
  reason           TEXT,
  merged_by        TEXT,
  merged_at        TIMESTAMPTZ DEFAULT now(),
  rolled_back_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_entity_merge_log_target
  ON entity_merge_log (business_id, target_entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_merge_log_source
  ON entity_merge_log (business_id, source_entity_id);

-- memories 反向关联实体（数组裸列即可，Phase 2 暂无单独 join 表）
ALTER TABLE memories
  ADD COLUMN IF NOT EXISTS entity_refs TEXT[];

CREATE INDEX IF NOT EXISTS idx_memories_entity_refs
  ON memories USING gin (entity_refs);
