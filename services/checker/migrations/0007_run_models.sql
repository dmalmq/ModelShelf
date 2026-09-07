-- Pin the exact models a run evaluated, plus the pack digest, specification
-- scope, and engine profile frozen with the run row. Historical runs keep
-- incomplete provenance and have no run_models rows.

CREATE TABLE IF NOT EXISTS run_models (
  run_id            TEXT NOT NULL REFERENCES runs(id),
  model_revision_id TEXT NOT NULL REFERENCES model_revisions(id),
  source_model_id   TEXT NOT NULL REFERENCES source_models(id),
  source_model_name TEXT NOT NULL,
  discipline        TEXT NOT NULL,
  filename          TEXT NOT NULL,
  content_sha256    TEXT NOT NULL,
  byte_size         INTEGER NOT NULL,
  sort_index        INTEGER NOT NULL,
  PRIMARY KEY (run_id, model_revision_id)
);
CREATE INDEX IF NOT EXISTS idx_run_models_run ON run_models(run_id, sort_index);

ALTER TABLE runs ADD COLUMN ids_sha256 TEXT;
ALTER TABLE runs ADD COLUMN pack_metadata_sha256 TEXT;
ALTER TABLE runs ADD COLUMN scope_json TEXT;
ALTER TABLE runs ADD COLUMN engine_profile_json TEXT;
