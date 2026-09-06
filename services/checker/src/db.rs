//! Database bootstrap. The migration script is idempotent (`CREATE TABLE IF NOT
//! EXISTS`), so every startup re-applies it statement-by-statement and records the
//! highest applied version in `schema_migrations`.

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};
use std::str::FromStr;

pub const MIGRATION_0001: &str = include_str!("../migrations/0001_init.sql");
pub const SCHEMA_VERSION: i64 = 1;

pub async fn open(data_dir: &std::path::Path) -> anyhow::Result<SqlitePool> {
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
    migrate(&pool).await?;
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

pub async fn migrate(pool: &SqlitePool) -> anyhow::Result<()> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
           version INTEGER PRIMARY KEY,
           applied_at TEXT NOT NULL
         )",
    )
    .execute(pool)
    .await?;
    let applied: i64 = sqlx::query("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations")
        .fetch_one(pool)
        .await?
        .get("v");
    if applied < SCHEMA_VERSION {
        for statement in split_statements(MIGRATION_0001) {
            // PRAGMAs belong to the connection hook; running them per-statement here
            // is harmless but redundant.
            if statement.to_ascii_uppercase().starts_with("PRAGMA") {
                continue;
            }
            sqlx::query(statement).execute(pool).await?;
        }
        sqlx::query("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?1, ?2)")
            .bind(SCHEMA_VERSION)
            .bind(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
            .execute(pool)
            .await?;
    }
    Ok(())
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}
