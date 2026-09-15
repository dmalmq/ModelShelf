use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::Arc;

#[cfg(unix)]
use std::os::unix::io::AsRawFd;
#[cfg(windows)]
use std::os::windows::io::AsRawHandle;

use sqlx::SqlitePool;
use tokio::sync::Notify;

use crate::error::ApiError;
use crate::worker_slot::{LiveInvocation, WorkerSlot};

pub struct DataDirLock {
    _file: File,
    data_dir: PathBuf,
}

impl DataDirLock {
    pub fn acquire(data_dir: &Path) -> anyhow::Result<DataDirLock> {
        let path = data_dir.join(".lock");
        let file = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(false)
            .open(&path)?;
        if try_lock_exclusive(&file).is_err() {
            anyhow::bail!(
                "another process already owns {}; a second server must not recover live jobs",
                data_dir.display()
            );
        }
        Ok(DataDirLock {
            _file: file,
            data_dir: data_dir.to_path_buf(),
        })
    }

    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }
}

#[derive(Debug, Default)]
pub struct Reconciled {
    pub ingestion_jobs_failed: u64,
    pub runs_failed: u64,
    pub orphan_worker: Option<LiveInvocation>,
}

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub data_dir: PathBuf,
    /// Wakes the background job worker (`jobs::spawn_worker`) as soon as a job
    /// is enqueued or retried, instead of making it poll on a fixed interval.
    pub job_notify: Arc<Notify>,
    worker: Option<Arc<WorkerSlot>>,
    _lock: Option<Arc<DataDirLock>>,
}

impl AppState {
    pub async fn open(
        data_dir: &Path,
        worker_command: String,
    ) -> anyhow::Result<(AppState, Reconciled)> {
        tokio::fs::create_dir_all(data_dir).await?;
        let lock = DataDirLock::acquire(data_dir)?;
        let pool = crate::db::open(data_dir).await?;
        let mut tx = pool.begin().await?;
        let ingestion_jobs_failed = crate::jobs::fail_interrupted(&mut tx, &lock).await?;
        let runs_failed = crate::run::fail_interrupted(&mut tx, &lock).await?;
        tx.commit().await?;
        let adopted = WorkerSlot::adopt(worker_command, &lock).await?;
        let state = AppState {
            pool,
            data_dir: data_dir.to_path_buf(),
            job_notify: Arc::new(Notify::new()),
            worker: Some(Arc::new(adopted.slot)),
            _lock: Some(Arc::new(lock)),
        };
        Ok((
            state,
            Reconciled {
                ingestion_jobs_failed,
                runs_failed,
                orphan_worker: adopted.orphan_worker,
            },
        ))
    }

    pub async fn open_for_seed(data_dir: &Path) -> anyhow::Result<AppState> {
        tokio::fs::create_dir_all(data_dir).await?;
        let pool = crate::db::open(data_dir).await?;
        Ok(AppState {
            pool,
            data_dir: data_dir.to_path_buf(),
            job_notify: Arc::new(Notify::new()),
            worker: None,
            _lock: None,
        })
    }

    pub(crate) fn worker(&self) -> Result<&WorkerSlot, ApiError> {
        self.worker.as_deref().ok_or_else(|| {
            ApiError::internal("this process does not own the data directory's worker slot")
        })
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
        let bytes = tokio::fs::read(&path)
            .await
            .map_err(|err| ApiError::internal(format!("cannot read {}: {err}", path.display())))?;
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

#[cfg(unix)]
fn try_lock_exclusive(file: &File) -> std::io::Result<()> {
    // SAFETY: `file` is an fd this process opened and still owns. LOCK_NB
    // returns immediately, so we never hold the async runtime across flock.
    let rc = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    if rc == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(windows)]
fn try_lock_exclusive(file: &File) -> std::io::Result<()> {
    #[repr(C)]
    struct Overlapped {
        internal: usize,
        internal_high: usize,
        offset: u32,
        offset_high: u32,
        event: *mut core::ffi::c_void,
    }
    const LOCKFILE_FAIL_IMMEDIATELY: u32 = 0x0000_0001;
    const LOCKFILE_EXCLUSIVE_LOCK: u32 = 0x0000_0002;
    unsafe extern "system" {
        fn LockFileEx(
            h_file: *mut core::ffi::c_void,
            flags: u32,
            reserved: u32,
            low: u32,
            high: u32,
            overlapped: *mut Overlapped,
        ) -> i32;
    }
    let mut overlapped = Overlapped {
        internal: 0,
        internal_high: 0,
        offset: 0,
        offset_high: 0,
        event: std::ptr::null_mut(),
    };
    // SAFETY: `file` is a handle this process opened and still owns.
    // LOCKFILE_FAIL_IMMEDIATELY makes the call synchronous, so `overlapped`
    // only needs to live for the duration of LockFileEx.
    let ok = unsafe {
        LockFileEx(
            file.as_raw_handle() as *mut core::ffi::c_void,
            LOCKFILE_FAIL_IMMEDIATELY | LOCKFILE_EXCLUSIVE_LOCK,
            0,
            1,
            0,
            &mut overlapped,
        )
    };
    if ok == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}
