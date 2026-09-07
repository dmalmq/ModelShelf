-- Persist the shared Property record as evidence. Scalar columns remain a search projection.
ALTER TABLE object_props ADD COLUMN record_json TEXT;
