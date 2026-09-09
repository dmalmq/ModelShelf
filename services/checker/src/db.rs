//! Database bootstrap and the versioned migration runner.
//!
//! Each version's migration (DDL plus any data backfill) applies inside one
//! transaction: on success the version bump commits atomically with the work it
//! describes; on any error the whole transaction rolls back, so a retry after a
//! crash or injected fault starts from a clean, un-migrated state rather than a
//! partially-applied one. `MigrationFault` exists only so tests can prove that
//! rollback actually happens; production code always runs with `MigrationFault::None`.

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Acquire, Row, Sqlite, SqlitePool, Transaction};
use std::str::FromStr;

pub const MIGRATION_0001: &str = include_str!("../migrations/0001_init.sql");
pub const MIGRATION_0002: &str = include_str!("../migrations/0002_source_models.sql");
pub const MIGRATION_0003: &str = include_str!("../migrations/0003_jobs.sql");
pub const MIGRATION_0004: &str = include_str!("../migrations/0004_run_input_provenance.sql");
pub const MIGRATION_0005: &str =
    include_str!("../migrations/0005_run_input_provenance_default.sql");
pub const MIGRATION_0006: &str = include_str!("../migrations/0006_object_prop_record.sql");
pub const MIGRATION_0007: &str = include_str!("../migrations/0007_run_models.sql");
pub const MIGRATION_0008: &str = include_str!("../migrations/0008_fingerprint_profile.sql");
pub const SCHEMA_VERSION: i64 = 8;

pub async fn open(data_dir: &std::path::Path) -> anyhow::Result<SqlitePool> {
    let pool = connect(data_dir).await?;
    migrate(&pool).await?;
    Ok(pool)
}

/// Split from `open` so tests can drive the migration runner themselves (fault
/// injection, asserting behavior between versions) against a real connection pool
/// without going through the full `AppState::open` startup path.
async fn connect(data_dir: &std::path::Path) -> anyhow::Result<SqlitePool> {
    let blobs = data_dir.join("blobs");
    tokio::fs::create_dir_all(&blobs).await?;
    let db_path = data_dir.join("modelshelf.db");
    let url = format!("sqlite://{}", db_path.display());
    let options = SqliteConnectOptions::from_str(&url)?.create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(8)
        .after_connect(|conn, _meta| {
            Box::pin(async move {
                sqlx::query("PRAGMA journal_mode = WAL").execute(&mut *conn).await?;
                sqlx::query("PRAGMA foreign_keys = ON").execute(&mut *conn).await?;
                sqlx::query("PRAGMA busy_timeout = 5000").execute(&mut *conn).await?;
                Ok(())
            })
        })
        .connect_with(options)
        .await?;
    Ok(pool)
}

/// Split on `;` followed by optional whitespace and a newline. The schema is
/// hand-written, so no statement contains a `;` inside a string literal.
fn split_statements(script: &str) -> Vec<&str> {
    script
        .split(";\n")
        .flat_map(|chunk| chunk.split(";\r\n"))
        .map(|chunk| chunk.trim().trim_end_matches(';').trim())
        .filter(|chunk| !chunk.is_empty() && chunk.lines().any(|l| !l.trim().starts_with("--")))
        .collect()
}

/// Injected only by tests, to prove a failing migration rolls back cleanly and a
/// subsequent retry still succeeds without duplicating anything.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum MigrationFault {
    None,
    AfterLegacyModelMigration,
    AfterObjectRefBackfill,
    AfterFindingObjectsRepair,
    AfterRunProvenanceDefault,
}

pub async fn migrate(pool: &SqlitePool) -> anyhow::Result<()> {
    migrate_with_fault(pool, MigrationFault::None).await
}

pub(crate) async fn migrate_with_fault(pool: &SqlitePool, fault: MigrationFault) -> anyhow::Result<()> {
    ensure_schema_migrations_table(pool).await?;

    if current_version(pool).await? < 1 {
        apply_sql_version(pool, 1, MIGRATION_0001).await?;
    }
    if current_version(pool).await? < 2 {
        apply_version_2(pool, fault).await?;
    }
    if current_version(pool).await? < 3 {
        apply_sql_version(pool, 3, MIGRATION_0003).await?;
    }
    if current_version(pool).await? < 4 {
        apply_version_4(pool, fault).await?;
    }
    if current_version(pool).await? < 5 {
        apply_version_5(pool, fault).await?;
    }
    if current_version(pool).await? < 6 {
        apply_sql_version(pool, 6, MIGRATION_0006).await?;
    }
    if current_version(pool).await? < 7 {
        apply_sql_version(pool, 7, MIGRATION_0007).await?;
    }
    if current_version(pool).await? < 8 {
        apply_sql_version(pool, 8, MIGRATION_0008).await?;
    }
    Ok(())
}

/// Any job still 'running' when the process last exited means the worker was
/// interrupted mid-flight (crash or kill) and can never resume — it must surface
/// as a visible, explicit failure rather than stay running forever or vanish.
/// Called once on every startup, after migration.
pub async fn recover_interrupted_jobs(pool: &SqlitePool) -> anyhow::Result<()> {
    sqlx::query(
        "UPDATE ingestion_jobs SET status = 'failed',
             error = 'interrupted: the service restarted while this job was running',
             finished_at = ?1
         WHERE status = 'running'",
    )
    .bind(now_iso())
    .execute(pool)
    .await?;
    Ok(())
}

async fn ensure_schema_migrations_table(pool: &SqlitePool) -> anyhow::Result<()> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
           version INTEGER PRIMARY KEY,
           applied_at TEXT NOT NULL
         )",
    )
    .execute(pool)
    .await?;
    Ok(())
}

async fn current_version(pool: &SqlitePool) -> anyhow::Result<i64> {
    let version: i64 = sqlx::query("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations")
        .fetch_one(pool)
        .await?
        .get("v");
    Ok(version)
}

async fn record_version(tx: &mut Transaction<'_, Sqlite>, version: i64) -> anyhow::Result<()> {
    sqlx::query("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?1, ?2)")
        .bind(version)
        .bind(now_iso())
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn apply_sql_version(pool: &SqlitePool, version: i64, sql: &str) -> anyhow::Result<()> {
    let mut tx = pool.begin().await?;
    for statement in split_statements(sql) {
        if statement.to_ascii_uppercase().starts_with("PRAGMA") {
            // PRAGMAs belong to the connection hook; running them per-statement here
            // is harmless but redundant.
            continue;
        }
        sqlx::query(statement).execute(&mut *tx).await?;
    }
    record_version(&mut tx, version).await?;
    tx.commit().await?;
    Ok(())
}

/// `objects.model_id` must end up referencing `model_revisions(id)` instead of the
/// now-frozen `models(id)`, but that retarget can only be verified against real
/// data *after* `migrate_legacy_models` has populated `model_revisions` — and
/// SQLite forbids toggling `PRAGMA foreign_keys` inside an open transaction, so it
/// cannot be flipped OFF just around the rebuild and back ON before commit. This
/// runs the *entire* v2 migration on one dedicated connection with foreign key
/// enforcement off for the whole transaction, and substitutes an explicit
/// `PRAGMA foreign_key_check` gate right before commit: if that finds anything
/// inconsistent, the migration fails (and rolls back) instead of committing a
/// database SQLite would have silently allowed to drift.
async fn apply_version_2(pool: &SqlitePool, fault: MigrationFault) -> anyhow::Result<()> {
    let mut conn = pool.acquire().await?;
    sqlx::query("PRAGMA foreign_keys = OFF").execute(&mut *conn).await?;
    let result = apply_version_2_on(&mut conn, fault).await;
    // Always restore before this connection can be handed to another request,
    // regardless of whether the migration above succeeded.
    let _ = sqlx::query("PRAGMA foreign_keys = ON").execute(&mut *conn).await;
    result
}

async fn apply_version_2_on(
    conn: &mut sqlx::pool::PoolConnection<Sqlite>,
    fault: MigrationFault,
) -> anyhow::Result<()> {
    let mut tx = conn.begin().await?;
    for statement in split_statements(MIGRATION_0002) {
        sqlx::query(statement).execute(&mut *tx).await?;
    }
    crate::migrate_v2::migrate_legacy_models(&mut tx).await?;
    if fault == MigrationFault::AfterLegacyModelMigration {
        anyhow::bail!("injected fault after legacy model migration");
    }
    // Only valid once model_revisions is populated (just above): every existing
    // `objects.model_id` must already have a matching `model_revisions.id`.
    crate::migrate_v2::rebuild_objects_foreign_key(&mut tx).await?;
    crate::migrate_v2::backfill_finalized_deliveries(&mut tx).await?;
    crate::migrate_v2::backfill_object_refs(&mut tx).await?;
    if fault == MigrationFault::AfterObjectRefBackfill {
        anyhow::bail!("injected fault after object ref backfill");
    }
    let violations: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM pragma_foreign_key_check")
        .fetch_one(&mut *tx)
        .await?;
    if violations > 0 {
        anyhow::bail!("migration produced {violations} foreign-key inconsistency(ies)");
    }
    record_version(&mut tx, 2).await?;
    tx.commit().await?;
    Ok(())
}

/// Repair `finding_objects` FKs for databases that already recorded version 2
/// without rebuilding that table, and stamp historical runs as incomplete.
/// Foreign keys stay off for the whole transaction for the same reason as v2:
/// intermediate rename states would otherwise fail the check.
async fn apply_version_4(pool: &SqlitePool, fault: MigrationFault) -> anyhow::Result<()> {
    let mut conn = pool.acquire().await?;
    sqlx::query("PRAGMA foreign_keys = OFF").execute(&mut *conn).await?;
    let result = apply_version_4_on(&mut conn, fault).await;
    let _ = sqlx::query("PRAGMA foreign_keys = ON").execute(&mut *conn).await;
    result
}

async fn apply_version_4_on(
    conn: &mut sqlx::pool::PoolConnection<Sqlite>,
    fault: MigrationFault,
) -> anyhow::Result<()> {
    let mut tx = conn.begin().await?;
    for statement in split_statements(MIGRATION_0004) {
        sqlx::query(statement).execute(&mut *tx).await?;
    }
    crate::migrate_v2::rebuild_finding_objects(&mut tx).await?;
    crate::migrate_v2::stamp_historical_run_provenance(&mut tx).await?;
    if fault == MigrationFault::AfterFindingObjectsRepair {
        anyhow::bail!("injected fault after finding_objects repair");
    }
    let violations: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM pragma_foreign_key_check")
        .fetch_one(&mut *tx)
        .await?;
    if violations > 0 {
        anyhow::bail!("migration produced {violations} foreign-key inconsistency(ies)");
    }
    record_version(&mut tx, 4).await?;
    tx.commit().await?;
    Ok(())
}

/// No table is renamed here, so unlike versions 2 and 4 this needs no foreign-key juggling.
async fn apply_version_5(pool: &SqlitePool, fault: MigrationFault) -> anyhow::Result<()> {
    let mut tx = pool.begin().await?;
    for statement in split_statements(MIGRATION_0005) {
        sqlx::query(statement).execute(&mut *tx).await?;
    }
    crate::migrate_v2::stamp_unpinned_run_provenance(&mut tx).await?;
    if fault == MigrationFault::AfterRunProvenanceDefault {
        anyhow::bail!("injected fault after run provenance default swap");
    }
    record_version(&mut tx, 5).await?;
    tx.commit().await?;
    Ok(())
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn temp_pool() -> (tempfile::TempDir, SqlitePool) {
        let dir = tempfile::tempdir().expect("temp dir");
        let pool = connect(dir.path()).await.expect("connect");
        (dir, pool)
    }

    /// Two legacy `models` rows in two different deliveries (the v1 schema's own
    /// `UNIQUE(delivery_id, discipline)` made two same-discipline models in *one*
    /// delivery impossible, so two separate ARCH uploads is the realistic
    /// "unrelated legacy rows" scenario) — proving migration gives each its own
    /// `source_models` row rather than guessing they are the same source's
    /// history. Each has one `objects` row, inserted directly against the v1
    /// schema exactly as a pre-migration database would hold them.
    async fn seed_legacy_v1_data(pool: &SqlitePool) -> (String, String) {
        sqlx::query("INSERT INTO tenants (id, name, created_at) VALUES ('t1','Tenant',?1)")
            .bind(now_iso())
            .execute(pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO projects (id, tenant_id, name, created_at) VALUES ('p1','t1','Project',?1)",
        )
        .bind(now_iso())
        .execute(pool)
        .await
        .unwrap();

        let delivery_ids = ["d1".to_owned(), "d2".to_owned()];
        for delivery_id in &delivery_ids {
            sqlx::query(
                "INSERT INTO deliveries (id, project_id, label, created_at) VALUES (?1,'p1',?1,?2)",
            )
            .bind(delivery_id)
            .bind(now_iso())
            .execute(pool)
            .await
            .unwrap();
        }

        let model_ids = ["m1".to_owned(), "m2".to_owned()];
        for (index, model_id) in model_ids.iter().enumerate() {
            sqlx::query(
                "INSERT INTO models (id, delivery_id, discipline, filename, content_sha256, byte_size,
                     schema_label, entity_count, product_count, length_to_metre, storage_path, uploaded_at)
                 VALUES (?1,?2,'ARCH',?3,?4,1000,'IFC4',10,1,1.0,'blobs/x',?5)",
            )
            .bind(model_id)
            .bind(&delivery_ids[index])
            .bind(format!("legacy-{index}.ifc"))
            .bind(format!("{index:0>64}"))
            .bind(now_iso())
            .execute(pool)
            .await
            .unwrap();

            sqlx::query(
                "INSERT INTO objects (id, model_id, express_id, ifc_type, fp_properties, fp_placement,
                     fp_shape, fp_combined)
                 VALUES (?1,?2,1,'IfcWall','p','pl','s','c')",
            )
            .bind(format!("obj-{index}"))
            .bind(model_id)
            .execute(pool)
            .await
            .unwrap();
        }
        (model_ids[0].clone(), model_ids[1].clone())
    }

    #[tokio::test]
    async fn migrates_a_fresh_empty_database_to_the_latest_version() {
        let (_dir, pool) = temp_pool().await;
        migrate(&pool).await.expect("migrate");
        assert_eq!(current_version(&pool).await.unwrap(), SCHEMA_VERSION);
        let source_models: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM source_models").fetch_one(&pool).await.unwrap();
        assert_eq!(source_models, 0);
        let jobs: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM ingestion_jobs").fetch_one(&pool).await.unwrap();
        assert_eq!(jobs, 0);
    }

    #[tokio::test]
    async fn objects_foreign_key_targets_model_revisions_and_is_actually_enforced() {
        let (_dir, pool) = temp_pool().await;
        migrate(&pool).await.expect("migrate");

        sqlx::query("INSERT INTO source_models (id, project_id, name, discipline, created_at) VALUES ('s1','p1','S','ARCH',?1)")
            .bind(now_iso())
            .execute(&pool)
            .await
            .unwrap_err(); // p1 does not exist: proves FK enforcement itself is still on after the rebuild

        sqlx::query("INSERT INTO projects (id, tenant_id, name, created_at) VALUES ('p1','t1','P',?1)")
            .bind(now_iso())
            .execute(&pool)
            .await
            .unwrap_err(); // t1 does not exist either, same proof on an unrelated pre-existing table

        sqlx::query("INSERT INTO tenants (id, name, created_at) VALUES ('t1','T',?1)")
            .bind(now_iso())
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO projects (id, tenant_id, name, created_at) VALUES ('p1','t1','P',?1)")
            .bind(now_iso())
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO source_models (id, project_id, name, discipline, created_at) VALUES ('s1','p1','S','ARCH',?1)")
            .bind(now_iso())
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO model_revisions (id, source_model_id, filename, content_sha256, byte_size,
                 schema_label, entity_count, product_count, storage_path, uploaded_at)
             VALUES ('r1','s1','f','0',1,'IFC4',1,1,'blobs/x',?1)",
        )
        .bind(now_iso())
        .execute(&pool)
        .await
        .unwrap();

        let rejected = sqlx::query(
            "INSERT INTO objects (id, model_id, express_id, ifc_type, fp_properties, fp_placement, fp_shape, fp_combined)
             VALUES ('bad','does-not-exist',1,'IfcWall','p','pl','s','c')",
        )
        .execute(&pool)
        .await;
        assert!(rejected.is_err(), "the rebuilt FK must still reject a model_id absent from model_revisions");

        sqlx::query(
            "INSERT INTO objects (id, model_id, express_id, ifc_type, fp_properties, fp_placement, fp_shape, fp_combined)
             VALUES ('good','r1',1,'IfcWall','p','pl','s','c')",
        )
        .execute(&pool)
        .await
        .expect("a model_id present in model_revisions must be accepted");

        sqlx::query("INSERT INTO object_props (object_id, pset, name, value) VALUES ('does-not-exist','P','N','V')")
            .execute(&pool)
            .await
            .expect_err("object_props' FK must still be enforced against the rebuilt objects table");
        sqlx::query("INSERT INTO object_props (object_id, pset, name, value) VALUES ('good','P','N','V')")
            .execute(&pool)
            .await
            .expect("a real object id must be accepted by object_props");
    }

    #[tokio::test]
    async fn migrates_populated_v1_data_preserving_old_rows_and_synthesizing_v2_rows() {
        let (_dir, pool) = temp_pool().await;
        ensure_schema_migrations_table(&pool).await.unwrap();
        apply_sql_version(&pool, 1, MIGRATION_0001).await.unwrap();
        let (model_a, model_b) = seed_legacy_v1_data(&pool).await;

        migrate_with_fault(&pool, MigrationFault::None).await.expect("migrate");
        assert_eq!(current_version(&pool).await.unwrap(), SCHEMA_VERSION);

        let old_models: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM models").fetch_one(&pool).await.unwrap();
        assert_eq!(old_models, 2, "legacy rows must survive, never be deleted");

        let source_models: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM source_models").fetch_one(&pool).await.unwrap();
        assert_eq!(source_models, 2, "two legacy models sharing a discipline get two source models, not one");

        let revisions: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM model_revisions").fetch_one(&pool).await.unwrap();
        assert_eq!(revisions, 2);
        let members: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM delivery_members").fetch_one(&pool).await.unwrap();
        assert_eq!(members, 2);

        for model_id in [&model_a, &model_b] {
            let (revision_id, provenance): (String, String) =
                sqlx::query_as("SELECT id, provenance FROM model_revisions WHERE id = ?1")
                    .bind(model_id)
                    .fetch_one(&pool)
                    .await
                    .expect("legacy model id preserved verbatim as the revision id");
            assert_eq!(&revision_id, model_id);
            assert_eq!(provenance, "incomplete");

            let ref_object_id: Option<String> =
                sqlx::query_scalar("SELECT ref_object_id FROM objects WHERE model_id = ?1")
                    .bind(model_id)
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(
                ref_object_id,
                Some(model_contracts::express_id_to_object_id(model_id, 1)),
            );
        }
    }

    #[tokio::test]
    async fn a_failing_migration_rolls_back_completely_and_a_retry_succeeds_without_duplication() {
        let (_dir, pool) = temp_pool().await;
        ensure_schema_migrations_table(&pool).await.unwrap();
        apply_sql_version(&pool, 1, MIGRATION_0001).await.unwrap();
        seed_legacy_v1_data(&pool).await;

        let result = migrate_with_fault(&pool, MigrationFault::AfterLegacyModelMigration).await;
        assert!(result.is_err());
        assert_eq!(current_version(&pool).await.unwrap(), 1, "the failed transaction must not have committed");
        let table_exists: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'source_models'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(table_exists, 0, "the DDL itself must roll back too, not just the data it inserted");

        migrate_with_fault(&pool, MigrationFault::None).await.expect("retry after rollback must succeed");
        assert_eq!(current_version(&pool).await.unwrap(), SCHEMA_VERSION);
        let source_models: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM source_models").fetch_one(&pool).await.unwrap();
        assert_eq!(source_models, 2, "retrying must not duplicate what a prior, rolled-back attempt almost wrote");
    }

    #[tokio::test]
    async fn a_fault_during_object_ref_backfill_also_rolls_back_the_whole_version() {
        let (_dir, pool) = temp_pool().await;
        ensure_schema_migrations_table(&pool).await.unwrap();
        apply_sql_version(&pool, 1, MIGRATION_0001).await.unwrap();
        seed_legacy_v1_data(&pool).await;

        let result = migrate_with_fault(&pool, MigrationFault::AfterObjectRefBackfill).await;
        assert!(result.is_err());
        assert_eq!(current_version(&pool).await.unwrap(), 1);
        let source_models: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'source_models'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(source_models, 0);

        migrate_with_fault(&pool, MigrationFault::None).await.expect("retry must succeed");
        assert_eq!(current_version(&pool).await.unwrap(), SCHEMA_VERSION);
    }

    async fn seed_v1_pack_run_and_finding(pool: &SqlitePool, model_id: &str, object_id: &str) {
        sqlx::query(
            "INSERT INTO packs (id, tenant_id, name, created_at) VALUES ('pack1','t1','Pack',?1)",
        )
        .bind(now_iso())
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO pack_versions (id, pack_id, version, ids_xml, ids_sha256, spec_count, created_at)
             VALUES ('pv1','pack1',1,'<ids/>','0',1,?1)",
        )
        .bind(now_iso())
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO runs (id, project_id, delivery_id, pack_version_id, engine_version, parser_version,
                 status, started_at, finished_at)
             VALUES ('run-1','p1','d1','pv1','eng','par','completed',?1,?1)",
        )
        .bind(now_iso())
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO findings (id, run_id, finding_key, spec_name, severity, category_id, category_label,
                 facet, title, requirement, object_count)
             VALUES ('f1','run-1','key','Spec','high','c','Cat','property','Title','must exist',1)",
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO finding_objects (id, finding_id, model_id, object_id, express_id, actual)
             VALUES (7,'f1',?1,?2,1,'missing')",
        )
        .bind(model_id)
        .bind(object_id)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO object_props (object_id, pset, name, value, inherited)
             VALUES (?1,'Pset_WallCommon','IsExternal','true',0)",
        )
        .bind(object_id)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn finding_object_fk_targets(pool: &SqlitePool) -> Vec<(String, String)> {
        sqlx::query_as(
            "SELECT \"from\" AS from_column, \"table\" AS referenced_table
               FROM pragma_foreign_key_list('finding_objects')
              ORDER BY from_column",
        )
        .fetch_all(pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn migrates_finding_links_and_keeps_them_insertable() {
        let (_dir, pool) = temp_pool().await;
        ensure_schema_migrations_table(&pool).await.unwrap();
        apply_sql_version(&pool, 1, MIGRATION_0001).await.unwrap();
        let (model_a, _model_b) = seed_legacy_v1_data(&pool).await;
        seed_v1_pack_run_and_finding(&pool, &model_a, "obj-0").await;

        migrate_with_fault(&pool, MigrationFault::None).await.expect("migrate");

        let targets = finding_object_fk_targets(&pool).await;
        assert!(
            targets.contains(&("object_id".to_owned(), "objects".to_owned())),
            "object_id must retarget objects, got {targets:?}"
        );
        assert!(
            targets.contains(&("model_id".to_owned(), "model_revisions".to_owned())),
            "model_id must retarget model_revisions, got {targets:?}"
        );
        assert!(!targets.iter().any(|(_, table)| table == "objects_v1" || table == "models"));

        let (id, actual, express_id): (i64, Option<String>, i64) = sqlx::query_as(
            "SELECT id, actual, express_id FROM finding_objects WHERE finding_id = 'f1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(id, 7, "row ids must be preserved");
        assert_eq!(actual.as_deref(), Some("missing"));
        assert_eq!(express_id, 1);

        let prop: String = sqlx::query_scalar(
            "SELECT value FROM object_props WHERE object_id = 'obj-0' AND name = 'IsExternal'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(prop, "true");

        sqlx::query(
            "INSERT INTO finding_objects (finding_id, model_id, object_id, express_id)
             VALUES ('f1',?1,'obj-0',1)",
        )
        .bind(&model_a)
        .execute(&pool)
        .await
        .expect("inserting a finding link for a migrated revision must succeed");

        sqlx::query("INSERT INTO tenants (id, name, created_at) VALUES ('t2','T2',?1)")
            .bind(now_iso())
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO projects (id, tenant_id, name, created_at) VALUES ('p2','t1','P2',?1)",
        )
        .bind(now_iso())
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO source_models (id, project_id, name, discipline, created_at)
             VALUES ('s-new','p1','New','ARCH',?1)",
        )
        .bind(now_iso())
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO model_revisions (id, source_model_id, filename, content_sha256, byte_size,
                 schema_label, entity_count, product_count, storage_path, uploaded_at)
             VALUES ('r-new','s-new','n.ifc','1',1,'IFC4',1,1,'blobs/n',?1)",
        )
        .bind(now_iso())
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO objects (id, model_id, express_id, ifc_type, fp_properties, fp_placement, fp_shape, fp_combined)
             VALUES ('obj-new','r-new',9,'IfcWall','p','pl','s','c')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO finding_objects (finding_id, model_id, object_id, express_id)
             VALUES ('f1','r-new','obj-new',9)",
        )
        .execute(&pool)
        .await
        .expect("inserting a finding link for a newly created revision must succeed");

        let detail = crate::run::run_detail(&pool, "run-1").await.expect("run history readable");
        assert_eq!(detail.input_provenance.status, "incomplete");
        assert!(
            detail
                .input_provenance
                .reason
                .as_deref()
                .unwrap_or("")
                .contains("not pinned"),
        );
    }

    #[tokio::test]
    async fn colliding_legacy_model_id_prefixes_keep_distinct_sources() {
        let (_dir, pool) = temp_pool().await;
        ensure_schema_migrations_table(&pool).await.unwrap();
        apply_sql_version(&pool, 1, MIGRATION_0001).await.unwrap();

        sqlx::query("INSERT INTO tenants (id, name, created_at) VALUES ('t1','Tenant',?1)")
            .bind(now_iso())
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO projects (id, tenant_id, name, created_at) VALUES ('p1','t1','Project',?1)",
        )
        .bind(now_iso())
        .execute(&pool)
        .await
        .unwrap();
        for (delivery_id, model_id) in [("d1", "collide0-aaaa"), ("d2", "collide0-bbbb")] {
            sqlx::query(
                "INSERT INTO deliveries (id, project_id, label, created_at) VALUES (?1,'p1',?1,?2)",
            )
            .bind(delivery_id)
            .bind(now_iso())
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO models (id, delivery_id, discipline, filename, content_sha256, byte_size,
                     schema_label, entity_count, product_count, length_to_metre, storage_path, uploaded_at)
                 VALUES (?1,?2,'ARCH',?3,?4,1000,'IFC4',10,1,1.0,'blobs/x',?5)",
            )
            .bind(model_id)
            .bind(delivery_id)
            .bind(format!("{model_id}.ifc"))
            .bind(format!("{:0>64}", model_id.len()))
            .bind(now_iso())
            .execute(&pool)
            .await
            .unwrap();
        }

        migrate_with_fault(&pool, MigrationFault::AfterLegacyModelMigration)
            .await
            .expect_err("injected fault");
        migrate_with_fault(&pool, MigrationFault::None)
            .await
            .expect("retry after collision-prone ids must succeed");

        let names: Vec<String> =
            sqlx::query_scalar("SELECT name FROM source_models ORDER BY name").fetch_all(&pool).await.unwrap();
        assert_eq!(
            names,
            vec!["Legacy ARCH collide0-aaaa".to_owned(), "Legacy ARCH collide0-bbbb".to_owned()]
        );
        let revision_ids: Vec<String> =
            sqlx::query_scalar("SELECT id FROM model_revisions ORDER BY id").fetch_all(&pool).await.unwrap();
        assert_eq!(
            revision_ids,
            vec!["collide0-aaaa".to_owned(), "collide0-bbbb".to_owned()]
        );
    }

    /// Reconstruct the version-2 database a development checkout would have if it
    /// migrated before finding_objects was rebuilt, then prove the forward repair
    /// restores links without deleting that database.
    async fn simulate_already_version_2_with_broken_finding_objects(pool: &SqlitePool) {
        ensure_schema_migrations_table(pool).await.unwrap();
        apply_sql_version(pool, 1, MIGRATION_0001).await.unwrap();
        let (model_a, _) = seed_legacy_v1_data(pool).await;
        seed_v1_pack_run_and_finding(pool, &model_a, "obj-0").await;

        let mut conn = pool.acquire().await.unwrap();
        sqlx::query("PRAGMA foreign_keys = OFF").execute(&mut *conn).await.unwrap();
        let mut tx = conn.begin().await.unwrap();
        for statement in split_statements(MIGRATION_0002) {
            sqlx::query(statement).execute(&mut *tx).await.unwrap();
        }
        crate::migrate_v2::migrate_legacy_models(&mut tx).await.unwrap();
        // The historical rebuild: objects + object_props only. finding_objects
        // keeps its rewritten objects_v1 / models foreign keys.
        for statement in [
            "ALTER TABLE objects RENAME TO objects_v1",
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
            "DROP TABLE objects_v1",
        ] {
            sqlx::query(statement).execute(&mut *tx).await.unwrap();
        }
        crate::migrate_v2::backfill_finalized_deliveries(&mut tx).await.unwrap();
        crate::migrate_v2::backfill_object_refs(&mut tx).await.unwrap();
        record_version(&mut tx, 2).await.unwrap();
        tx.commit().await.unwrap();
        sqlx::query("PRAGMA foreign_keys = ON").execute(&mut *conn).await.unwrap();
        apply_sql_version(pool, 3, MIGRATION_0003).await.unwrap();
    }

    /// Stop exactly at version 4 so the version-5 behavior can be observed against the
    /// database shape that actually shipped it: `run-1` predates version 4 and is stamped
    /// historical by it, `run-2` is inserted afterwards and takes the `'complete'` default
    /// the application could never prove.
    async fn migrate_to_version_4_with_two_runs(pool: &SqlitePool) {
        ensure_schema_migrations_table(pool).await.unwrap();
        apply_sql_version(pool, 1, MIGRATION_0001).await.unwrap();
        let (model_a, _) = seed_legacy_v1_data(pool).await;
        seed_v1_pack_run_and_finding(pool, &model_a, "obj-0").await;
        apply_version_2(pool, MigrationFault::None).await.unwrap();
        apply_sql_version(pool, 3, MIGRATION_0003).await.unwrap();
        apply_version_4(pool, MigrationFault::None).await.unwrap();
        assert_eq!(current_version(pool).await.unwrap(), 4);

        sqlx::query(
            "INSERT INTO runs (id, project_id, delivery_id, pack_version_id, engine_version,
                 parser_version, status, started_at, pass_count)
             VALUES ('run-2','p1','d1','pv1','eng','par','completed',?1,3)",
        )
        .bind(now_iso())
        .execute(pool)
        .await
        .unwrap();
        let claimed: (String, Option<String>) = sqlx::query_as(
            "SELECT input_provenance, input_provenance_reason FROM runs WHERE id = 'run-2'",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        assert_eq!(
            claimed,
            ("complete".to_owned(), None),
            "the version-4 fixture must reproduce the unprovable claim being corrected"
        );
    }

    async fn runs_table_ddl(pool: &SqlitePool) -> String {
        sqlx::query_scalar("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'runs'")
            .fetch_one(pool)
            .await
            .unwrap()
    }

    async fn stored_provenance(pool: &SqlitePool, run_id: &str) -> (String, Option<String>) {
        sqlx::query_as(
            "SELECT input_provenance, input_provenance_reason FROM runs WHERE id = ?1",
        )
        .bind(run_id)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn seed_run_parents(pool: &SqlitePool) {
        for statement in [
            "INSERT INTO tenants (id, name, created_at) VALUES ('t1','Tenant',datetime())",
            "INSERT INTO projects (id, tenant_id, name, created_at) VALUES ('p1','t1','Project',datetime())",
            "INSERT INTO deliveries (id, project_id, label, created_at) VALUES ('d1','p1','D1',datetime())",
            "INSERT INTO packs (id, tenant_id, name, created_at) VALUES ('pack1','t1','Pack',datetime())",
            "INSERT INTO pack_versions (id, pack_id, version, ids_xml, ids_sha256, spec_count, created_at)
               VALUES ('pv1','pack1',1,'<ids/>','0',1,datetime())",
        ] {
            sqlx::query(statement).execute(pool).await.unwrap();
        }
    }

    #[tokio::test]
    async fn a_run_inserted_without_naming_input_provenance_defaults_to_incomplete() {
        let (_dir, pool) = temp_pool().await;
        migrate(&pool).await.expect("migrate");
        seed_run_parents(&pool).await;

        sqlx::query(
            "INSERT INTO runs (id, project_id, delivery_id, pack_version_id, engine_version,
                 parser_version, status, started_at)
             VALUES ('run-default','p1','d1','pv1','eng','par','running',?1)",
        )
        .bind(now_iso())
        .execute(&pool)
        .await
        .unwrap();

        assert_eq!(
            stored_provenance(&pool, "run-default").await,
            ("incomplete".to_owned(), None),
            "the declared default itself must not let a writer claim proven inputs"
        );
    }

    #[tokio::test]
    async fn version_5_downgrades_the_unprovable_complete_claim_and_keeps_historical_reasons() {
        let (_dir, pool) = temp_pool().await;
        migrate_to_version_4_with_two_runs(&pool).await;
        let historical_reason = stored_provenance(&pool, "run-1").await.1.expect("v4 reason");
        assert!(historical_reason.contains("pre-migration"), "{historical_reason}");

        migrate(&pool).await.expect("migrate to version 5");
        assert_eq!(current_version(&pool).await.unwrap(), SCHEMA_VERSION);

        assert_eq!(
            stored_provenance(&pool, "run-1").await,
            ("incomplete".to_owned(), Some(historical_reason)),
            "a run version 4 already explained keeps that explanation verbatim"
        );
        assert_eq!(
            stored_provenance(&pool, "run-2").await,
            ("incomplete".to_owned(), Some(crate::dto::UNPINNED_REASON.to_owned()))
        );

        let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM runs").fetch_one(&pool).await.unwrap();
        assert_eq!(total, 2);
        let survivors: (String, String, String, String, i64) = sqlx::query_as(
            "SELECT project_id, delivery_id, pack_version_id, status, pass_count
               FROM runs WHERE id = 'run-2'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            survivors,
            ("p1".to_owned(), "d1".to_owned(), "pv1".to_owned(), "completed".to_owned(), 3),
            "the column swap must not disturb the rest of the row"
        );
        assert!(!runs_table_ddl(&pool).await.contains("input_provenance_v5"));
    }

    #[tokio::test]
    async fn a_fault_during_the_provenance_default_swap_rolls_back_the_whole_version() {
        let (_dir, pool) = temp_pool().await;
        migrate_to_version_4_with_two_runs(&pool).await;

        migrate_with_fault(&pool, MigrationFault::AfterRunProvenanceDefault)
            .await
            .expect_err("injected fault");
        assert_eq!(current_version(&pool).await.unwrap(), 4, "failed swap must roll back");
        let ddl = runs_table_ddl(&pool).await;
        assert!(!ddl.contains("input_provenance_v5"), "half-applied swap left behind: {ddl}");
        assert!(ddl.contains("input_provenance TEXT NOT NULL DEFAULT 'complete'"), "{ddl}");
        assert_eq!(stored_provenance(&pool, "run-2").await, ("complete".to_owned(), None));

        migrate_with_fault(&pool, MigrationFault::None).await.expect("retry");
        assert_eq!(current_version(&pool).await.unwrap(), SCHEMA_VERSION);
        let ddl = runs_table_ddl(&pool).await;
        assert!(ddl.contains("input_provenance TEXT NOT NULL DEFAULT 'incomplete'"), "{ddl}");
        assert!(!ddl.contains("DEFAULT 'complete'"), "{ddl}");
        let columns: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pragma_table_info('runs') WHERE name LIKE 'input_provenance%'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(columns, 2, "the retry must not duplicate the swapped column");
        assert_eq!(
            stored_provenance(&pool, "run-2").await,
            ("incomplete".to_owned(), Some(crate::dto::UNPINNED_REASON.to_owned()))
        );
    }

    #[test]
    fn an_unrecognized_stored_provenance_resolves_to_incomplete() {
        use crate::dto::{InputProvenance, UNPINNED_REASON};

        assert_eq!(InputProvenance::from_row("complete", None), InputProvenance::Complete);
        assert_eq!(
            InputProvenance::from_row("Complete", None),
            InputProvenance::Incomplete { reason: UNPINNED_REASON.to_owned() },
            "only the exact stored literal may read as proven"
        );
        for status in ["", "COMPLETE", "pinned", "incomplete", "\u{0}complete"] {
            assert_eq!(
                InputProvenance::from_row(status, Some("stored reason")),
                InputProvenance::Incomplete { reason: "stored reason".to_owned() },
                "status {status:?}"
            );
        }
    }

    #[tokio::test]
    async fn repairs_already_version_2_finding_links_and_retries_after_fault() {
        let (_dir, pool) = temp_pool().await;
        simulate_already_version_2_with_broken_finding_objects(&pool).await;
        assert_eq!(current_version(&pool).await.unwrap(), 3);

        let before: Vec<(String, String)> = finding_object_fk_targets(&pool).await;
        assert!(
            before.iter().any(|(_, table)| table == "objects_v1" || table == "models"),
            "pre-repair fixture must still carry the broken targets, got {before:?}"
        );

        migrate_with_fault(&pool, MigrationFault::AfterFindingObjectsRepair)
            .await
            .expect_err("injected fault");
        assert_eq!(current_version(&pool).await.unwrap(), 3, "failed repair must roll back");

        migrate_with_fault(&pool, MigrationFault::None).await.expect("retry");
        assert_eq!(current_version(&pool).await.unwrap(), SCHEMA_VERSION);

        let targets = finding_object_fk_targets(&pool).await;
        assert!(targets.contains(&("object_id".to_owned(), "objects".to_owned())), "{targets:?}");
        assert!(
            targets.contains(&("model_id".to_owned(), "model_revisions".to_owned())),
            "{targets:?}"
        );
        let id: i64 = sqlx::query_scalar("SELECT id FROM finding_objects WHERE finding_id = 'f1'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(id, 7);
        sqlx::query(
            "INSERT INTO finding_objects (finding_id, model_id, object_id, express_id)
             VALUES ('f1','m1','obj-0',1)",
        )
        .execute(&pool)
        .await
        .expect("repaired FKs must accept a new link");
    }
}
