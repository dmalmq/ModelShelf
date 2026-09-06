-- Historical run input provenance plus the finding_objects FK repair applied in
-- Rust (migrate_v2::rebuild_finding_objects) in the same transaction. Existing
-- runs cannot prove which revisions they evaluated; new runs default to complete
-- and ticket 06 owns pinning those inputs.

ALTER TABLE runs ADD COLUMN input_provenance TEXT NOT NULL DEFAULT 'complete';
ALTER TABLE runs ADD COLUMN input_provenance_reason TEXT;
