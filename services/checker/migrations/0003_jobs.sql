-- Durable ingestion job queue. Uploading a revision returns a job immediately
-- (202); a single background worker (jobs.rs) claims queued jobs one at a time
-- so at most one heavy ifc-worker invocation ever runs concurrently, invokes the
-- authoritative worker (docs/contracts/worker-v2.md), and only inserts
-- model_revisions/objects once its output is fully validated. A job still
-- 'running' when the process exits is recovered as 'failed' on the next
-- startup (db.rs::recover_interrupted_jobs) since it can never resume.
CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id                TEXT PRIMARY KEY,
  source_model_id   TEXT NOT NULL REFERENCES source_models(id),
  filename          TEXT NOT NULL,
  content_sha256    TEXT NOT NULL,
  byte_size         INTEGER NOT NULL,
  storage_path      TEXT NOT NULL,
  status            TEXT NOT NULL, -- queued | running | completed | failed
  model_revision_id TEXT REFERENCES model_revisions(id),
  error             TEXT,
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  started_at        TEXT,
  finished_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_status ON ingestion_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_source ON ingestion_jobs(source_model_id, created_at DESC);
