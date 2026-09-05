-- ModelShelf checker schema. Immutability rules enforced here and in the service:
--   * pack_versions rows are never updated (a change creates a new version)
--   * models rows are never updated (a new drop creates a new delivery)
--   * runs pin (delivery_id, pack_version_id, engine_version) forever
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenants (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS packs (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL
);

-- Immutable check pack version: IDS XML + ModelShelf triage metadata.
CREATE TABLE IF NOT EXISTS pack_versions (
  id            TEXT PRIMARY KEY,
  pack_id       TEXT NOT NULL REFERENCES packs(id),
  version       INTEGER NOT NULL,
  ids_xml       TEXT NOT NULL,
  ids_sha256    TEXT NOT NULL,
  metadata_json TEXT,
  notes         TEXT,
  spec_count    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  UNIQUE (pack_id, version)
);

-- A dated model drop; may hold one model per discipline slot.
CREATE TABLE IF NOT EXISTS deliveries (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id),
  label         TEXT NOT NULL,
  delivery_date TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS models (
  id             TEXT PRIMARY KEY,
  delivery_id    TEXT NOT NULL REFERENCES deliveries(id),
  -- Stable slot used to pair revisions across deliveries: ARCH | STRUCT | MEP | OTHER
  discipline     TEXT NOT NULL,
  filename       TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  byte_size      INTEGER NOT NULL,
  schema_label   TEXT NOT NULL,
  entity_count   INTEGER NOT NULL,
  product_count  INTEGER NOT NULL,
  length_to_metre REAL NOT NULL DEFAULT 1.0,
  storage_path   TEXT NOT NULL,
  header_json    TEXT,
  parse_ms       INTEGER,
  uploaded_at    TEXT NOT NULL,
  UNIQUE (delivery_id, discipline)
);

CREATE TABLE IF NOT EXISTS objects (
  id              TEXT PRIMARY KEY,
  model_id        TEXT NOT NULL REFERENCES models(id),
  express_id      INTEGER NOT NULL,
  global_id       TEXT,
  ifc_type        TEXT NOT NULL,
  name            TEXT,
  predefined_type TEXT,
  storey          TEXT,
  placement_json  TEXT,
  fp_properties   TEXT NOT NULL,
  fp_placement    TEXT NOT NULL,
  fp_shape        TEXT NOT NULL,
  fp_combined     TEXT NOT NULL,
  UNIQUE (model_id, express_id)
);
CREATE INDEX IF NOT EXISTS idx_objects_model_global ON objects(model_id, global_id);
CREATE INDEX IF NOT EXISTS idx_objects_model_type ON objects(model_id, ifc_type);
CREATE INDEX IF NOT EXISTS idx_objects_combined ON objects(model_id, fp_combined);

CREATE TABLE IF NOT EXISTS object_props (
  object_id  TEXT NOT NULL REFERENCES objects(id),
  pset       TEXT NOT NULL,
  name       TEXT NOT NULL,
  value      TEXT,
  data_type  TEXT,
  unit       TEXT,
  numeric    REAL,
  inherited  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_object_props_object ON object_props(object_id);

CREATE TABLE IF NOT EXISTS runs (
  id                   TEXT PRIMARY KEY,
  project_id           TEXT NOT NULL REFERENCES projects(id),
  delivery_id          TEXT NOT NULL REFERENCES deliveries(id),
  pack_version_id      TEXT NOT NULL REFERENCES pack_versions(id),
  engine_version       TEXT NOT NULL,
  parser_version       TEXT NOT NULL,
  status               TEXT NOT NULL, -- running | completed | failed
  error                TEXT,
  started_at           TEXT NOT NULL,
  finished_at          TEXT,
  duration_ms          INTEGER,
  pass_count           INTEGER NOT NULL DEFAULT 0,
  fail_count           INTEGER NOT NULL DEFAULT 0,
  not_applicable_count INTEGER NOT NULL DEFAULT 0,
  incomplete_count     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_runs_project ON runs(project_id, started_at DESC);

CREATE TABLE IF NOT EXISTS run_specs (
  id                   TEXT PRIMARY KEY,
  run_id               TEXT NOT NULL REFERENCES runs(id),
  spec_identifier      TEXT,
  spec_name            TEXT NOT NULL,
  outcome              TEXT NOT NULL, -- pass | fail | not_applicable | review_incomplete
  applicable_count     INTEGER NOT NULL DEFAULT 0,
  pass_count           INTEGER NOT NULL DEFAULT 0,
  fail_count           INTEGER NOT NULL DEFAULT 0,
  incomplete_count     INTEGER NOT NULL DEFAULT 0,
  notes_json           TEXT
);
CREATE INDEX IF NOT EXISTS idx_run_specs_run ON run_specs(run_id);

-- One row per distinct violated requirement, not per failing object.
CREATE TABLE IF NOT EXISTS findings (
  id             TEXT PRIMARY KEY,
  run_id         TEXT NOT NULL REFERENCES runs(id),
  -- Stable across runs: blake3_16(spec_key | facet | requirement)
  finding_key    TEXT NOT NULL,
  spec_identifier TEXT,
  spec_name      TEXT NOT NULL,
  severity       TEXT NOT NULL, -- critical | high | medium | advisory
  category_id    TEXT NOT NULL,
  category_label TEXT NOT NULL,
  facet          TEXT NOT NULL, -- entity | attribute | classification | property | material | part_of
  title          TEXT NOT NULL,
  requirement    TEXT NOT NULL,
  expected       TEXT,
  instructions   TEXT,
  object_count   INTEGER NOT NULL DEFAULT 0,
  incomplete     INTEGER NOT NULL DEFAULT 0,
  sort_index     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_findings_run ON findings(run_id, severity, category_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_findings_run_key ON findings(run_id, finding_key);

CREATE TABLE IF NOT EXISTS finding_objects (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  finding_id        TEXT NOT NULL REFERENCES findings(id),
  model_id          TEXT NOT NULL REFERENCES models(id),
  object_id         TEXT REFERENCES objects(id),
  express_id        INTEGER NOT NULL,
  global_id         TEXT,
  actual            TEXT,
  incomplete_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_finding_objects_finding ON finding_objects(finding_id);
