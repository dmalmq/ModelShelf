-- Normalized fingerprint evidence per object (ticket 13). Ingest stores the
-- full 64-hex BLAKE3 digests, the canonical texts that produced them, and the
-- profile that binds them. Rows written before this migration keep NULL
-- profile columns: they are legacy undiffable rows and must surface a
-- profile-mismatch error at diff time, never a fabricated snapshot. No
-- backfill: history is append-only across profile changes.

ALTER TABLE objects ADD COLUMN profile_version TEXT;
ALTER TABLE objects ADD COLUMN profile_id TEXT;
ALTER TABLE objects ADD COLUMN canonical_properties TEXT;
ALTER TABLE objects ADD COLUMN canonical_placement TEXT;
ALTER TABLE objects ADD COLUMN canonical_shape TEXT;
CREATE INDEX IF NOT EXISTS idx_objects_model_profile ON objects(model_id, profile_id);
