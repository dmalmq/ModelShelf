//! Data migration for schema version 2 (`migrations/0002_source_models.sql`), run
//! inside the same transaction as that DDL by `db::apply_version_2`. Every function
//! here is idempotent against its own output, so a rolled-back-and-retried
//! transaction never duplicates a row: the legacy-model and finalized-delivery
//! backfills key off tables that only exist after this transaction's own DDL runs
//! (so re-running is really "run once, in a fresh transaction, again"), and the
//! object-ref backfill explicitly re-selects only rows still missing one.

use sqlx::{Row, Sqlite, Transaction};

use crate::db::new_id;

struct LegacyModelRow {
    id: String,
    project_id: String,
    delivery_id: String,
    discipline: String,
    filename: String,
    content_sha256: String,
    byte_size: i64,
    schema_label: String,
    entity_count: i64,
    product_count: i64,
    length_to_metre: f64,
    storage_path: String,
    header_json: Option<String>,
    parse_ms: Option<i64>,
    uploaded_at: String,
}

/// Every pre-migration `models` row becomes its own `source_models` row (a
/// conservative identity: "do not guess lineage" — two legacy rows are never
/// merged into one source model even if they share a discipline), an immutable
/// `model_revisions` row reusing the legacy `models.id` verbatim (so
/// `objects.model_id` FKs keep pointing at a valid id with no remapping), and a
/// `delivery_members` row preserving which delivery it was already in.
pub(crate) async fn migrate_legacy_models(tx: &mut Transaction<'_, Sqlite>) -> anyhow::Result<()> {
    let legacy_models: Vec<LegacyModelRow> = sqlx::query(
        "SELECT m.id, d.project_id, m.delivery_id, m.discipline, m.filename, m.content_sha256,
                m.byte_size, m.schema_label, m.entity_count, m.product_count, m.length_to_metre,
                m.storage_path, m.header_json, m.parse_ms, m.uploaded_at
           FROM models m JOIN deliveries d ON d.id = m.delivery_id",
    )
    .fetch_all(&mut **tx)
    .await?
    .into_iter()
    .map(|row| LegacyModelRow {
        id: row.get("id"),
        project_id: row.get("project_id"),
        delivery_id: row.get("delivery_id"),
        discipline: row.get("discipline"),
        filename: row.get("filename"),
        content_sha256: row.get("content_sha256"),
        byte_size: row.get("byte_size"),
        schema_label: row.get("schema_label"),
        entity_count: row.get("entity_count"),
        product_count: row.get("product_count"),
        length_to_metre: row.get("length_to_metre"),
        storage_path: row.get("storage_path"),
        header_json: row.get("header_json"),
        parse_ms: row.get("parse_ms"),
        uploaded_at: row.get("uploaded_at"),
    })
    .collect();

    for legacy in legacy_models {
        let source_model_id = new_id();
        let name = format!("Legacy {} {}", legacy.discipline, legacy.id);
        sqlx::query(
            "INSERT INTO source_models (id, project_id, name, discipline, created_at)
             VALUES (?1,?2,?3,?4,?5)",
        )
        .bind(&source_model_id)
        .bind(&legacy.project_id)
        .bind(&name)
        .bind(&legacy.discipline)
        .bind(&legacy.uploaded_at)
        .execute(&mut **tx)
        .await?;

        sqlx::query(
            "INSERT INTO model_revisions (id, source_model_id, filename, content_sha256, byte_size,
                 schema_label, entity_count, product_count, length_to_metre, storage_path,
                 header_json, parse_ms, uploaded_at, provenance)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,'incomplete')",
        )
        .bind(&legacy.id)
        .bind(&source_model_id)
        .bind(&legacy.filename)
        .bind(&legacy.content_sha256)
        .bind(legacy.byte_size)
        .bind(&legacy.schema_label)
        .bind(legacy.entity_count)
        .bind(legacy.product_count)
        .bind(legacy.length_to_metre)
        .bind(&legacy.storage_path)
        .bind(&legacy.header_json)
        .bind(legacy.parse_ms)
        .bind(&legacy.uploaded_at)
        .execute(&mut **tx)
        .await?;

        sqlx::query(
            "INSERT INTO delivery_members (id, delivery_id, source_model_id, model_revision_id, added_at)
             VALUES (?1,?2,?3,?4,?5)",
        )
        .bind(new_id())
        .bind(&legacy.delivery_id)
        .bind(&source_model_id)
        .bind(&legacy.id)
        .bind(&legacy.uploaded_at)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

/// `objects.model_id` was declared `REFERENCES models(id)` back when a model row
/// lived one-per-delivery; a revision uploaded after this migration has no row in
/// the now-frozen `models` table at all, only in `model_revisions`, so the
/// constraint must retarget there. SQLite has no `ALTER TABLE` for changing a
/// foreign key, and `ALTER TABLE ... RENAME TO` rewrites *other* tables' FK text to
/// point at the renamed name — so `object_props` (which references `objects`) has
/// to be rebuilt too, in the same pass, or it would end up referencing a dropped
/// table. This only runs correctly with FK enforcement off for the whole
/// transaction (db::apply_version_2_on), since half-built intermediate states here
/// are exactly the kind of thing FK checks would otherwise reject mid-flight; the
/// `pragma_foreign_key_check` gate before commit is what actually verifies the
/// final state is consistent.
pub(crate) async fn rebuild_objects_foreign_key(tx: &mut Transaction<'_, Sqlite>) -> anyhow::Result<()> {
    for statement in [
        "ALTER TABLE objects RENAME TO objects_v1",
        // Renaming a table does not rename its indexes; they stay attached to
        // objects_v1 under their old names, which would collide with the
        // CREATE INDEX statements below if left in place.
        "DROP INDEX idx_objects_model_global",
        "DROP INDEX idx_objects_model_type",
        "DROP INDEX idx_objects_combined",
        "CREATE TABLE objects (
           id              TEXT PRIMARY KEY,
           model_id        TEXT NOT NULL REFERENCES model_revisions(id),
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
           ref_object_id   TEXT,
           UNIQUE (model_id, express_id)
         )",
        "INSERT INTO objects (id, model_id, express_id, global_id, ifc_type, name, predefined_type,
             storey, placement_json, fp_properties, fp_placement, fp_shape, fp_combined, ref_object_id)
           SELECT id, model_id, express_id, global_id, ifc_type, name, predefined_type,
                  storey, placement_json, fp_properties, fp_placement, fp_shape, fp_combined, ref_object_id
             FROM objects_v1",
        "CREATE INDEX idx_objects_model_global ON objects(model_id, global_id)",
        "CREATE INDEX idx_objects_model_type ON objects(model_id, ifc_type)",
        "CREATE INDEX idx_objects_combined ON objects(model_id, fp_combined)",
        "ALTER TABLE object_props RENAME TO object_props_v1",
        "DROP INDEX idx_object_props_object",
        "CREATE TABLE object_props (
           object_id  TEXT NOT NULL REFERENCES objects(id),
           pset       TEXT NOT NULL,
           name       TEXT NOT NULL,
           value      TEXT,
           data_type  TEXT,
           unit       TEXT,
           numeric    REAL,
           inherited  INTEGER NOT NULL DEFAULT 0
         )",
        "INSERT INTO object_props (object_id, pset, name, value, data_type, unit, numeric, inherited)
           SELECT object_id, pset, name, value, data_type, unit, numeric, inherited FROM object_props_v1",
        "CREATE INDEX idx_object_props_object ON object_props(object_id)",
        "DROP TABLE object_props_v1",
    ] {
        sqlx::query(statement).execute(&mut **tx).await?;
    }
    rebuild_finding_objects(tx).await?;
    let leftover = tables_referencing(tx, "objects_v1").await?;
    if !leftover.is_empty() {
        anyhow::bail!(
            "refusing to drop objects_v1 while {} still reference it: {}",
            leftover.len(),
            leftover.join(", ")
        );
    }
    sqlx::query("DROP TABLE objects_v1").execute(&mut **tx).await?;
    Ok(())
}

/// Retarget `finding_objects.object_id` at `objects(id)` and `model_id` at
/// `model_revisions(id)`, preserving row IDs, evidence columns, and the finding
/// index. Safe to run on a table that already has those targets: it copies onto
/// the same shape. Must run before any `objects_v1` drop, and again as a
/// forward repair for databases that recorded version 2 without this rebuild.
pub(crate) async fn rebuild_finding_objects(tx: &mut Transaction<'_, Sqlite>) -> anyhow::Result<()> {
    for statement in [
        "ALTER TABLE finding_objects RENAME TO finding_objects_v1",
        "DROP INDEX IF EXISTS idx_finding_objects_finding",
        "CREATE TABLE finding_objects (
           id                INTEGER PRIMARY KEY AUTOINCREMENT,
           finding_id        TEXT NOT NULL REFERENCES findings(id),
           model_id          TEXT NOT NULL REFERENCES model_revisions(id),
           object_id         TEXT REFERENCES objects(id),
           express_id        INTEGER NOT NULL,
           global_id         TEXT,
           actual            TEXT,
           incomplete_reason TEXT
         )",
        "INSERT INTO finding_objects (id, finding_id, model_id, object_id, express_id, global_id, actual, incomplete_reason)
           SELECT id, finding_id, model_id, object_id, express_id, global_id, actual, incomplete_reason
             FROM finding_objects_v1",
        "CREATE INDEX idx_finding_objects_finding ON finding_objects(finding_id)",
        "DROP TABLE finding_objects_v1",
        "DELETE FROM sqlite_sequence WHERE name = 'finding_objects'",
        "INSERT INTO sqlite_sequence (name, seq)
           SELECT 'finding_objects', COALESCE(MAX(id), 0) FROM finding_objects",
    ] {
        sqlx::query(statement).execute(&mut **tx).await?;
    }
    Ok(())
}

/// Existing runs predate pinned inputs. Stamp them incomplete so a later reader
/// does not treat reconstructed delivery membership as verified run input.
pub(crate) async fn stamp_historical_run_provenance(
    tx: &mut Transaction<'_, Sqlite>,
) -> anyhow::Result<()> {
    sqlx::query(
        "UPDATE runs
            SET input_provenance = 'incomplete',
                input_provenance_reason = 'pre-migration run inputs were not pinned; displayed models are reconstructed from current delivery membership'
          WHERE input_provenance_reason IS NULL",
    )
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Runs created after version 4 took its `'complete'` default with nothing having pinned
/// their inputs. A null reason is exactly that set: version 4 stamped every run that
/// pre-dated it with a reason of its own, which stays as written.
pub(crate) async fn stamp_unpinned_run_provenance(
    tx: &mut Transaction<'_, Sqlite>,
) -> anyhow::Result<()> {
    sqlx::query(
        "UPDATE runs SET input_provenance_reason = ?1 WHERE input_provenance_reason IS NULL",
    )
    .bind(crate::dto::UNPINNED_REASON)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn tables_referencing(
    tx: &mut Transaction<'_, Sqlite>,
    target: &str,
) -> anyhow::Result<Vec<String>> {
    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .fetch_all(&mut **tx)
    .await?;
    let mut leftover = Vec::new();
    for table in tables {
        let referenced: Vec<String> = sqlx::query_scalar(
            "SELECT \"table\" FROM pragma_foreign_key_list(?1)",
        )
        .bind(&table)
        .fetch_all(&mut **tx)
        .await?;
        if referenced.iter().any(|name| name == target) {
            leftover.push(table);
        }
    }
    leftover.sort();
    Ok(leftover)
}

/// A delivery that already had a completed run under the pre-finalization regime
/// behaved as frozen (`upload.rs` rejected new models for it); backfilling
/// `finalized_at` from that run's completion time makes the old invariant hold
/// under the new explicit mechanism too, instead of silently becoming editable.
pub(crate) async fn backfill_finalized_deliveries(tx: &mut Transaction<'_, Sqlite>) -> anyhow::Result<()> {
    sqlx::query(
        "UPDATE deliveries
            SET finalized_at = (
              SELECT MIN(finished_at) FROM runs
               WHERE runs.delivery_id = deliveries.id AND runs.status = 'completed'
            )
          WHERE finalized_at IS NULL
            AND id IN (SELECT DISTINCT delivery_id FROM runs WHERE status = 'completed')",
    )
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// SQLite has no SHA-256 function, so the shared occurrence ID
/// (`model_contracts::express_id_to_object_id`) is computed here in Rust rather
/// than in the migration's SQL. `WHERE ref_object_id IS NULL` makes this safe to
/// run again after a rollback: nothing it already filled in gets touched twice.
pub(crate) async fn backfill_object_refs(tx: &mut Transaction<'_, Sqlite>) -> anyhow::Result<()> {
    let rows: Vec<(String, String, i64)> = sqlx::query(
        "SELECT id, model_id, express_id FROM objects WHERE ref_object_id IS NULL",
    )
    .fetch_all(&mut **tx)
    .await?
    .into_iter()
    .map(|row| (row.get("id"), row.get("model_id"), row.get("express_id")))
    .collect();

    for (object_id, model_id, express_id) in rows {
        let express_id: u64 = express_id.try_into().unwrap_or(0);
        let ref_object_id = model_contracts::express_id_to_object_id(&model_id, express_id);
        sqlx::query("UPDATE objects SET ref_object_id = ?1 WHERE id = ?2")
            .bind(ref_object_id)
            .bind(object_id)
            .execute(&mut **tx)
            .await?;
    }
    Ok(())
}
