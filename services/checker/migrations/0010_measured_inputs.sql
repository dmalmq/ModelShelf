-- Forward only. Do not UPDATE runs.input_provenance. Do not rewrite engine_profile_json.
ALTER TABLE model_revisions ADD COLUMN processing_versions_json TEXT NOT NULL DEFAULT '{}';
