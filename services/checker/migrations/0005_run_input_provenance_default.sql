-- Version 4 declared this column DEFAULT 'complete', which let every run created since
-- claim a provenance nothing in the service can prove (ticket 06 owns pinning inputs).
-- SQLite has no ALTER COLUMN, and renaming `runs` to rebuild it would rewrite the
-- foreign-key text in `run_specs` and `findings` and force those tables to be rebuilt too.
-- Swapping the column rewrites the declared default and leaves every referencing table
-- untouched; ADD COLUMN ... NOT NULL DEFAULT backfills the existing rows as it goes.

ALTER TABLE runs ADD COLUMN input_provenance_v5 TEXT NOT NULL DEFAULT 'incomplete';
ALTER TABLE runs DROP COLUMN input_provenance;
ALTER TABLE runs RENAME COLUMN input_provenance_v5 TO input_provenance;
