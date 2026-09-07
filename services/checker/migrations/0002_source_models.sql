-- Persistent named sources, immutable revisions decoupled from delivery/discipline,
-- explicit (and eventually frozen) delivery membership, and the shared occurrence ID
-- on objects. Legacy `models` rows are data-migrated into this shape by Rust code in
-- the same transaction as this DDL (see db.rs::apply_version_2) — no legacy row is
-- deleted; `models` stays queryable as historical record.

-- A persistent, named, project-owned input (e.g. "Architecture East"). Discipline is
-- metadata for filtering/grouping, never part of a source model's identity.
CREATE TABLE IF NOT EXISTS source_models (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id),
  name        TEXT NOT NULL,
  discipline  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  UNIQUE (project_id, name)
);

-- One immutable upload belonging to exactly one source model. `id` is reused as the
-- shared contract's revisionId; existing `objects.model_id` values already equal a
-- model_revisions.id because legacy `models.id` values are preserved verbatim.
CREATE TABLE IF NOT EXISTS model_revisions (
  id              TEXT PRIMARY KEY,
  source_model_id TEXT NOT NULL REFERENCES source_models(id),
  filename        TEXT NOT NULL,
  content_sha256  TEXT NOT NULL,
  byte_size       INTEGER NOT NULL,
  schema_label    TEXT NOT NULL,
  entity_count    INTEGER NOT NULL,
  product_count   INTEGER NOT NULL,
  length_to_metre REAL NOT NULL DEFAULT 1.0,
  storage_path    TEXT NOT NULL,
  header_json     TEXT,
  parse_ms        INTEGER,
  uploaded_at     TEXT NOT NULL,
  -- 'complete' for a revision this schema created; 'incomplete' for one data-migrated
  -- from a legacy `models` row, whose source-model identity was synthesized rather
  -- than authored and so cannot participate in trusted cross-delivery comparisons.
  provenance      TEXT NOT NULL DEFAULT 'complete'
);
CREATE INDEX IF NOT EXISTS idx_model_revisions_source ON model_revisions(source_model_id, uploaded_at DESC);

-- Which revision of which source model is "in" which delivery. One revision per
-- source model per delivery (the UNIQUE constraint); a second delivery can point
-- at the same model_revision_id to reuse it without copying bytes. Membership rows
-- are add/replace/remove freely until deliveries.finalized_at is set, then frozen.
CREATE TABLE IF NOT EXISTS delivery_members (
  id                TEXT PRIMARY KEY,
  delivery_id       TEXT NOT NULL REFERENCES deliveries(id),
  source_model_id   TEXT NOT NULL REFERENCES source_models(id),
  model_revision_id TEXT NOT NULL REFERENCES model_revisions(id),
  added_at          TEXT NOT NULL,
  UNIQUE (delivery_id, source_model_id)
);

-- NULL = draft (membership may still change); set once = frozen forever.
ALTER TABLE deliveries ADD COLUMN finalized_at TEXT;

-- schemas/model/v1 ObjectRef.objectId, backfilled for existing rows by Rust code in
-- the same transaction (SQLite has no built-in SHA-256) and populated by application
-- code on every future insert. Nullable at the schema level only because SQLite
-- cannot add a NOT NULL column without a constant default to an existing table.
ALTER TABLE objects ADD COLUMN ref_object_id TEXT;
