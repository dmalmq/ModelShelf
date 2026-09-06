//! Idempotent demo seeding: a demo tenant, project, and check pack.
//!
//! Deliveries and models are owned by later tickets (the worker contract and
//! durable ingestion pipeline), so `--samples-dir` is accepted here only to keep
//! the CLI surface stable for those tickets; this command does not touch
//! deliveries or models.

use std::path::Path;

use sqlx::SqlitePool;

use crate::db::now_iso;
use crate::routes::insert_pack_version;
use crate::state::AppState;
use crate::upload::sha256_hex;

const DEMO_TENANT_ID: &str = "demo-tenant";
const DEMO_TENANT_NAME: &str = "Demo Tenant";
const DEMO_PROJECT_ID: &str = "demo-project";
const DEMO_PROJECT_NAME: &str = "Demo Project";
const DEMO_PACK_ID: &str = "demo-pack";
const DEMO_PACK_NAME: &str = "Demo Check Pack";

pub async fn run_seed(data_dir: &Path, packs_dir: &Path, samples_dir: &Path) -> i32 {
    let _ = samples_dir;
    match seed(data_dir, packs_dir).await {
        Ok(summary) => {
            println!("{summary}");
            0
        }
        Err(err) => {
            eprintln!("seed failed: {err:#}");
            1
        }
    }
}

struct SeedSummary {
    tenant_id: String,
    project_id: String,
    pack_id: String,
    pack_versions_added: usize,
}

impl std::fmt::Display for SeedSummary {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "seeded tenant={} project={} pack={} (+{} pack version(s))",
            self.tenant_id, self.project_id, self.pack_id, self.pack_versions_added
        )
    }
}

async fn seed(data_dir: &Path, packs_dir: &Path) -> anyhow::Result<SeedSummary> {
    let state = AppState::open(data_dir).await?;

    ensure_tenant(&state.pool, DEMO_TENANT_ID, DEMO_TENANT_NAME).await?;
    ensure_project(&state.pool, DEMO_PROJECT_ID, DEMO_TENANT_ID, DEMO_PROJECT_NAME).await?;
    ensure_pack(&state.pool, DEMO_PACK_ID, DEMO_TENANT_ID, DEMO_PACK_NAME).await?;
    let pack_versions_added = seed_pack_versions(&state, DEMO_PACK_ID, packs_dir).await?;

    Ok(SeedSummary {
        tenant_id: DEMO_TENANT_ID.to_owned(),
        project_id: DEMO_PROJECT_ID.to_owned(),
        pack_id: DEMO_PACK_ID.to_owned(),
        pack_versions_added,
    })
}

async fn ensure_tenant(pool: &SqlitePool, id: &str, name: &str) -> anyhow::Result<()> {
    sqlx::query("INSERT OR IGNORE INTO tenants (id, name, created_at) VALUES (?1, ?2, ?3)")
        .bind(id)
        .bind(name)
        .bind(now_iso())
        .execute(pool)
        .await?;
    Ok(())
}

async fn ensure_project(
    pool: &SqlitePool,
    id: &str,
    tenant_id: &str,
    name: &str,
) -> anyhow::Result<()> {
    sqlx::query(
        "INSERT OR IGNORE INTO projects (id, tenant_id, name, created_at) VALUES (?1, ?2, ?3, ?4)",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(name)
    .bind(now_iso())
    .execute(pool)
    .await?;
    Ok(())
}

async fn ensure_pack(pool: &SqlitePool, id: &str, tenant_id: &str, name: &str) -> anyhow::Result<()> {
    sqlx::query(
        "INSERT OR IGNORE INTO packs (id, tenant_id, name, description, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(name)
    .bind(Option::<String>::None)
    .bind(now_iso())
    .execute(pool)
    .await?;
    Ok(())
}

/// Load every `.ids`/`.xml` file directly under `packs_dir` (sorted, for determinism)
/// as a pack version. A file whose content hash a prior seed already stored is
/// skipped, which is what keeps repeated seeding from piling up duplicate versions.
async fn seed_pack_versions(
    state: &AppState,
    pack_id: &str,
    packs_dir: &Path,
) -> anyhow::Result<usize> {
    if !packs_dir.is_dir() {
        return Ok(0);
    }
    let mut paths: Vec<_> = std::fs::read_dir(packs_dir)?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("ids") || ext.eq_ignore_ascii_case("xml"))
                .unwrap_or(false)
        })
        .collect();
    paths.sort();

    let mut added = 0;
    for path in paths {
        let ids_xml = std::fs::read_to_string(&path)?;
        let sha = sha256_hex(ids_xml.as_bytes());
        let existing: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pack_versions WHERE pack_id = ?1 AND ids_sha256 = ?2",
        )
        .bind(pack_id)
        .bind(&sha)
        .fetch_one(&state.pool)
        .await?;
        if existing > 0 {
            continue;
        }
        let parsed = match ids::Ids::parse(&ids_xml) {
            Ok(parsed) => parsed,
            Err(err) => {
                eprintln!("skipping {}: not a valid IDS document: {err}", path.display());
                continue;
            }
        };
        let notes = path.file_name().map(|name| name.to_string_lossy().into_owned());
        insert_pack_version(state, pack_id, &ids_xml, None, notes, parsed.specifications.len() as i64)
            .await
            .map_err(|err| anyhow::anyhow!(err.message))?;
        added += 1;
    }
    Ok(added)
}
