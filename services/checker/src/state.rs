//! Shared service state: the SQLite pool and the content-addressed blob store.

use std::path::{Path, PathBuf};

use sqlx::SqlitePool;

use crate::error::ApiError;

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub data_dir: PathBuf,
}

impl AppState {
    pub async fn open(data_dir: &Path) -> anyhow::Result<AppState> {
        tokio::fs::create_dir_all(data_dir).await?;
        let pool = crate::db::open(data_dir).await?;
        Ok(AppState { pool, data_dir: data_dir.to_path_buf() })
    }

    pub fn blob_path(&self, sha256: &str) -> PathBuf {
        self.data_dir.join("blobs").join(sha256)
    }

    /// Read a stored model, verifying the content hash it was ingested under.
    ///
    /// A mismatch means the evidence chain is broken, which must surface as an error
    /// rather than as a check result computed from unknown bytes.
    pub async fn read_verified_blob(
        &self,
        storage_path: &str,
        expected_sha256: &str,
    ) -> Result<Vec<u8>, ApiError> {
        let path = if Path::new(storage_path).is_absolute() {
            PathBuf::from(storage_path)
        } else {
            self.data_dir.join(storage_path)
        };
        let bytes = tokio::fs::read(&path).await.map_err(|err| {
            ApiError::internal(format!("cannot read {}: {err}", path.display()))
        })?;
        let actual = crate::upload::sha256_hex(&bytes);
        if actual != expected_sha256 {
            return Err(ApiError::internal(format!(
                "stored model {} hashes to {actual}, expected {expected_sha256}",
                path.display()
            )));
        }
        Ok(bytes)
    }
}
