//! Shared service state: the SQLite pool, the content-addressed blob store, and
//! the ingestion job queue's shared handles.

use std::fs::File;
use std::os::unix::io::AsRawFd;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use sqlx::SqlitePool;
use tokio::sync::Notify;

use crate::error::ApiError;

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub data_dir: PathBuf,
    /// Shell command template for invoking the IFC worker; `{request}` is
    /// replaced with the absolute path to that job's request.json. Overridable
    /// (see `main.rs`'s `--worker-command`) so tests can substitute a fake
    /// worker that misbehaves in specific, controlled ways.
    pub worker_command: String,
    /// Wakes the background job worker (`jobs::spawn_worker`) as soon as a job
    /// is enqueued or retried, instead of making it poll on a fixed interval.
    pub job_notify: Arc<Notify>,
    _lock: Option<Arc<File>>,
}

impl AppState {
    pub async fn open(data_dir: &Path) -> anyhow::Result<AppState> {
        Self::open_inner(data_dir, true).await
    }

    pub async fn open_for_seed(data_dir: &Path) -> anyhow::Result<AppState> {
        Self::open_inner(data_dir, false).await
    }

    async fn open_inner(data_dir: &Path, exclusive: bool) -> anyhow::Result<AppState> {
        tokio::fs::create_dir_all(data_dir).await?;
        let lock = if exclusive {
            Some(Arc::new(lock_data_dir(data_dir)?))
        } else {
            None
        };
        let pool = crate::db::open(data_dir).await?;
        if exclusive {
            crate::db::recover_interrupted_jobs(&pool).await?;
        }
        Ok(AppState {
            pool,
            data_dir: data_dir.to_path_buf(),
            worker_command: crate::jobs::DEFAULT_WORKER_COMMAND.to_owned(),
            job_notify: Arc::new(Notify::new()),
            _lock: lock,
        })
    }

    pub fn with_worker_command(mut self, worker_command: String) -> Self {
        self.worker_command = worker_command;
        self
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

fn lock_data_dir(data_dir: &Path) -> anyhow::Result<File> {
    let path = data_dir.join(".lock");
    let file = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .open(&path)?;
    let rc = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    if rc != 0 {
        anyhow::bail!(
            "another process already owns {}; a second server must not recover live jobs",
            data_dir.display()
        );
    }
    Ok(file)
}
