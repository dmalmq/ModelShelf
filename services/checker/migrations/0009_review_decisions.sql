-- Review decisions are immutable facts linked to one completed run.
-- A supersession only fills the predecessor's chain pointer; the decision
-- outcome, rationale and evidence references are never overwritten.
CREATE TABLE IF NOT EXISTS review_decisions (
  id                    TEXT PRIMARY KEY,
  run_id                TEXT NOT NULL REFERENCES runs(id),
  outcome               TEXT NOT NULL CHECK (outcome IN ('accept', 'reject', 'conditional_accept')),
  rationale             TEXT NOT NULL CHECK (length(trim(rationale)) > 0),
  cited_finding_ids_json TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  supersedes_decision_id TEXT REFERENCES review_decisions(id),
  superseded_by         TEXT,
  UNIQUE (run_id, supersedes_decision_id)
);

-- Exactly one current decision may exist for a run. Historical decisions have
-- superseded_by set as part of the same transaction that appends their successor.
CREATE UNIQUE INDEX IF NOT EXISTS idx_review_decisions_current
  ON review_decisions(run_id)
  WHERE superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS idx_review_decisions_run_created
  ON review_decisions(run_id, created_at DESC, id DESC);
