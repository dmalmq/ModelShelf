//! The single heavy IFC worker slot for one data directory.
//!
//! At most one `ifc-worker` subprocess exists at a time, across ingestion and
//! IDS runs. `invoke_worker` is private to this module and only reachable
//! through `WorkerSlot::invoke`, so no call site can skip the gate, and
//! `WorkerSlot::adopt` requires a `DataDirLock`, so a process that does not
//! exclusively own the data dir (`seed`) cannot obtain a slot at all.
//! `{data_dir}/worker.slot` is created `O_EXCL` before each spawn as a loud
//! tripwire against a second invocation, and is also what verification reads to
//! observe the live process.
//!
//! Validation of the worker-v1 contract (`docs/contracts/worker-v1.md`) is
//! deliberately paranoid: a real worker never misbehaves, but the caller cannot
//! assume that, so every failure mode (malformed/truncated stdout, duplicate
//! terminal results, wrong job id, nonzero exit, bad artifact hash, a path
//! escaping the invocation's own output directory, a protocol version this
//! build does not understand) is checked explicitly and fails the invocation
//! rather than returning anything.

use std::collections::{HashMap, HashSet};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::sync::Semaphore;

use crate::db::now_iso;
use crate::state::DataDirLock;

pub struct WorkerSlot {
    data_dir: PathBuf,
    /// `{request}` is substituted with the absolute path to request.json.
    worker_command: String,
    /// One permit. Tokio's semaphore is FIFO, so waiters are served in arrival
    /// order and neither ingestion nor runs can starve the other.
    permit: Semaphore,
}

/// The one live invocation, mirrored into `{data_dir}/worker.slot` as JSON.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LiveInvocation {
    pub pid: u32,
    /// The child's own process group (`process_group(0)`), so a reconciling
    /// startup can kill the whole tree rather than just the `sh`/`exec` target.
    pub pgid: u32,
    pub kind: String,
    pub owner: String,
    pub started_at: String,
}

pub struct Adopted {
    pub slot: WorkerSlot,
    pub orphan_worker: Option<LiveInvocation>,
}

impl WorkerSlot {
    /// Convergent startup for the process residue only: kill whatever process
    /// group a stale slot file names if that process is still alive, unlink the
    /// file, and build the slot. Holding `lock` is the proof that whatever the
    /// file names belonged to a previous owner of this data dir. Row recovery is
    /// `AppState::open`'s job, so this never touches SQLite.
    pub async fn adopt(worker_command: String, lock: &DataDirLock) -> anyhow::Result<Adopted> {
        let data_dir = lock.data_dir().to_path_buf();
        let slot_path = slot_file_path(&data_dir);
        let orphan_worker = match tokio::fs::read(&slot_path).await {
            Ok(bytes) => serde_json::from_slice::<LiveInvocation>(&bytes).ok(),
            Err(err) if err.kind() == ErrorKind::NotFound => None,
            Err(err) => anyhow::bail!("cannot read {}: {err}", slot_path.display()),
        };
        if let Some(live) = &orphan_worker {
            kill_stale_process_group(live);
        }
        match tokio::fs::remove_file(&slot_path).await {
            Ok(()) => {}
            Err(err) if err.kind() == ErrorKind::NotFound => {}
            Err(err) => anyhow::bail!("cannot remove {}: {err}", slot_path.display()),
        }
        Ok(Adopted {
            slot: WorkerSlot {
                data_dir,
                worker_command,
                permit: Semaphore::new(1),
            },
            orphan_worker,
        })
    }

    /// Run one heavy worker invocation, start to validated finish. Waits for the
    /// slot, claims the slot file, spawns, waits, validates the whole worker-v1
    /// contract, and releases. No permit is handed out, so no caller can hold
    /// the slot across two invocations. `Err` is a human-readable reason; the
    /// caller decides which row records it.
    pub(crate) async fn invoke(&self, spec: WorkerInvocation) -> Result<WorkerArtifacts, String> {
        let _permit = self
            .permit
            .acquire()
            .await
            .expect("the worker slot semaphore is never closed");
        {
            let slot_file = SlotFile::claim(&self.data_dir)?;
            invoke_worker(self, spec, &slot_file).await
        }
    }

    fn blob_path(&self, sha256: &str) -> PathBuf {
        self.data_dir.join("blobs").join(sha256)
    }
}

fn slot_file_path(data_dir: &Path) -> PathBuf {
    data_dir.join("worker.slot")
}

/// `process_group(0)` makes every worker its own group leader, so a recorded
/// pid whose current pgid still matches is ours and not a reused pid.
fn kill_stale_process_group(live: &LiveInvocation) {
    let pid = live.pid as libc::pid_t;
    let pgid = live.pgid as libc::pid_t;
    // SAFETY: plain libc calls on integers; both tolerate a vanished process.
    unsafe {
        if libc::getpgid(pid) == pgid {
            libc::kill(-pgid, libc::SIGKILL);
        }
    }
}

/// RAII claim on `{data_dir}/worker.slot`: created `O_EXCL` before the spawn so a
/// second concurrent invocation cannot start, rewritten with the child's pid and
/// pgid once it exists, unlinked on drop.
struct SlotFile {
    path: PathBuf,
}

impl SlotFile {
    fn claim(data_dir: &Path) -> Result<SlotFile, String> {
        let path = slot_file_path(data_dir);
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(_) => Ok(SlotFile { path }),
            Err(err) if err.kind() == ErrorKind::AlreadyExists => Err(
                "the heavy worker slot is already occupied; refusing to start a second worker"
                    .to_owned(),
            ),
            Err(err) => Err(format!(
                "cannot claim the worker slot at {}: {err}",
                path.display()
            )),
        }
    }

    fn publish(&self, live: &LiveInvocation) -> std::io::Result<()> {
        std::fs::write(&self.path, serde_json::to_vec(live)?)
    }
}

impl Drop for SlotFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

// ---------------------------------------------------------------------------
// Invocation types
// ---------------------------------------------------------------------------

/// The protocol's `jobId` echo field, not a database id: the run path mints a
/// synthetic `{run_id}-{revision_id}` with no `ingestion_jobs` row behind it.
pub(crate) struct WorkerJobId(String);

impl WorkerJobId {
    pub fn ingest(job_id: &str) -> WorkerJobId {
        WorkerJobId(job_id.to_owned())
    }

    pub fn evaluate(run_id: &str, revision_id: &str) -> WorkerJobId {
        WorkerJobId(format!("{run_id}-{revision_id}"))
    }

    fn as_str(&self) -> &str {
        &self.0
    }
}

/// Which heavy operation to run, with the inputs that operation needs and no
/// others. Geometry is derived (inspect only), never passed.
pub(crate) enum WorkerOperation {
    Inspect,
    Validate(IdsInput),
}

impl WorkerOperation {
    fn wire_name(&self) -> &'static str {
        match self {
            WorkerOperation::Inspect => "inspect",
            WorkerOperation::Validate(_) => "validate",
        }
    }

    fn geometry(&self) -> bool {
        matches!(self, WorkerOperation::Inspect)
    }

    fn ids_json(&self) -> serde_json::Value {
        match self {
            WorkerOperation::Inspect => serde_json::Value::Null,
            WorkerOperation::Validate(ids) => serde_json::json!({
                "path": ids.path.to_string_lossy(),
                "sha256": ids.sha256,
                "specificationIds": ids.specification_ids,
            }),
        }
    }
}

pub(crate) struct IdsInput {
    pub path: PathBuf,
    pub sha256: String,
    /// Specification names, not IDS `identifier`s: that is what
    /// `ids_meta::specification_ids_for` filters and what `validate.py` looks up.
    pub specification_ids: Vec<String>,
}

pub(crate) struct WorkerInvocation {
    pub job_id: WorkerJobId,
    pub revision_id: String,
    pub content_sha256: String,
    /// Callers own their on-disk layout: `jobs/{id}/attempt-{n}` or
    /// `runs/{run_id}/{revision_id}`.
    pub output_dir: PathBuf,
    pub operation: WorkerOperation,
}

pub(crate) struct WorkerArtifacts {
    pub semantic: model_contracts::SemanticModel,
    pub descriptor: model_contracts::ModelDescriptor,
    pub outcomes: Vec<u8>,
    pub versions: WorkerVersions,
    /// Validated geometry chunks keyed by `ObjectRef.objectId` (last chunk wins,
    /// mirroring the `fingerprint_worker` example join). Empty when geometry was
    /// not requested or the render capability is not available.
    pub geometry_chunks: HashMap<String, model_contracts::GeometryChunk>,
}

// ---------------------------------------------------------------------------
// Worker protocol wire types (docs/contracts/worker-v1.md)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct EventEnvelope {
    #[serde(rename = "protocolVersion")]
    protocol_version: i64,
    #[serde(rename = "jobId")]
    job_id: String,
    event: String,
}

#[derive(Deserialize)]
struct ManifestPointer {
    path: String,
    sha256: String,
    size: u64,
}

#[derive(Deserialize)]
struct ResultEvent {
    manifest: ManifestPointer,
}

#[derive(Deserialize)]
struct ArtifactRef {
    path: String,
    sha256: String,
    size: u64,
    #[serde(rename = "recordCount")]
    record_count: Option<u64>,
}

#[derive(Deserialize)]
struct Artifacts {
    descriptor: ArtifactRef,
    semantic: ArtifactRef,
    #[serde(rename = "renderManifest")]
    render_manifest: Option<ArtifactRef>,
    geometry: Option<ArtifactRef>,
    outcomes: ArtifactRef,
}

#[derive(Deserialize, Default, Clone)]
pub(crate) struct WorkerVersions {
    #[serde(default)]
    pub worker: String,
    #[serde(default, rename = "ifcOpenShell")]
    pub ifc_open_shell: String,
    #[serde(default, rename = "ifcTester")]
    pub ifc_tester: String,
}

#[derive(Deserialize)]
struct Manifest {
    #[serde(rename = "protocolVersion")]
    protocol_version: i64,
    #[serde(rename = "jobId")]
    job_id: String,
    #[serde(rename = "revisionId")]
    revision_id: String,
    #[serde(rename = "modelSha256")]
    model_sha256: String,
    #[serde(default)]
    versions: WorkerVersions,
    artifacts: Artifacts,
}

// ---------------------------------------------------------------------------
// Invocation and validation
// ---------------------------------------------------------------------------

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn worker_command(template: &str, request_path: &Path) -> (String, Vec<String>) {
    let cmd = template.replace("{request}", &shell_quote(&request_path.to_string_lossy()));
    (
        "sh".to_owned(),
        vec!["-c".to_owned(), format!("exec {cmd}")],
    )
}

fn worker_timeout() -> Duration {
    std::env::var("MODELSHELF_WORKER_TIMEOUT_SECS")
        .ok()
        .and_then(|value| value.parse().ok())
        .map(Duration::from_secs)
        .unwrap_or(Duration::from_secs(15 * 60))
}

/// Spawns the worker in its own process group, publishes it to the slot file,
/// and waits. On timeout the whole group is killed and the direct child is still
/// reaped before returning, so the slot is never released while a worker
/// process exists.
async fn run_worker_process(
    program: &str,
    args: &[String],
    slot_file: &SlotFile,
    kind: &str,
    owner: &str,
) -> Result<std::process::Output, String> {
    let mut cmd = tokio::process::Command::new(program);
    cmd.args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    {
        // SAFETY: `pre_exec` runs in the child between fork and exec. `prctl` is
        // async-signal-safe. PDEATHSIG is how a SIGKILL of the checker also
        // kills the worker, even before `WorkerSlot::adopt` runs.
        unsafe {
            cmd.pre_exec(|| {
                libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL);
                Ok(())
            });
        }
        cmd.process_group(0);
    }
    let child = cmd
        .spawn()
        .map_err(|err| format!("cannot spawn worker: {err}"))?;
    let pid = child
        .id()
        .ok_or_else(|| "worker exited before it could be observed".to_owned())?;
    slot_file
        .publish(&LiveInvocation {
            pid,
            pgid: pid,
            kind: kind.to_owned(),
            owner: owner.to_owned(),
            started_at: now_iso(),
        })
        .map_err(|err| format!("cannot publish the worker slot: {err}"))?;
    let mut wait = std::pin::pin!(child.wait_with_output());
    match tokio::time::timeout(worker_timeout(), &mut wait).await {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(err)) => Err(format!("cannot collect worker output: {err}")),
        Err(_) => {
            #[cfg(unix)]
            {
                // SAFETY: `pid` is the child we just spawned as its own group
                // leader (`process_group(0)`), so `-pid` is that group. The
                // following `wait` reaps it before this function returns.
                unsafe {
                    libc::kill(-(pid as i32), libc::SIGKILL);
                }
            }
            let _ = wait.await;
            Err("worker exceeded the execution timeout".to_owned())
        }
    }
}

/// Lexical containment: both paths are documented as absolute, so this
/// normalises `.`/`..` components without touching the filesystem (a malicious
/// or buggy manifest may point somewhere that never gets created) and compares
/// the resulting component sequences. `base` must already be normalised.
fn is_within(base: &[std::path::Component<'_>], candidate: &Path) -> bool {
    if !candidate.is_absolute() {
        return false;
    }
    let mut normalized: Vec<std::path::Component<'_>> = Vec::new();
    for component in candidate.components() {
        match component {
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            std::path::Component::CurDir => {}
            other => normalized.push(other),
        }
    }
    normalized.len() > base.len() && normalized[..base.len()] == *base
}

fn tail_lines(text: &str, n: usize) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let start = lines.len().saturating_sub(n);
    lines[start..].join("\n")
}

async fn invoke_worker(
    slot: &WorkerSlot,
    spec: WorkerInvocation,
    slot_file: &SlotFile,
) -> Result<WorkerArtifacts, String> {
    let job_dir = &spec.output_dir;
    let job_dir_canonical = job_dir
        .canonicalize()
        .map_err(|err| format!("cannot resolve job directory: {err}"))?;
    let base_components: Vec<std::path::Component> = job_dir_canonical.components().collect();

    let blob_path_canonical = slot
        .blob_path(&spec.content_sha256)
        .canonicalize()
        .map_err(|err| format!("cannot resolve uploaded blob: {err}"))?;

    let request = serde_json::json!({
        "protocolVersion": 2,
        "jobId": spec.job_id.as_str(),
        "operation": spec.operation.wire_name(),
        "model": {
            "path": blob_path_canonical.to_string_lossy(),
            "sha256": spec.content_sha256,
            "revisionId": spec.revision_id,
        },
        "ids": spec.operation.ids_json(),
        "outputDir": job_dir_canonical.to_string_lossy(),
        "settings": {"geometry": spec.operation.geometry()},
    });
    let request_path = job_dir.join("request.json");
    tokio::fs::write(
        &request_path,
        serde_json::to_vec_pretty(&request).unwrap_or_default(),
    )
    .await
    .map_err(|err| format!("cannot write request.json: {err}"))?;

    let (program, args) = worker_command(&slot.worker_command, &request_path);
    let output = run_worker_process(
        &program,
        &args,
        slot_file,
        spec.operation.wire_name(),
        spec.job_id.as_str(),
    )
    .await?;

    let _ = tokio::fs::write(job_dir.join("stdout.log"), &output.stdout).await;
    let _ = tokio::fs::write(job_dir.join("stderr.log"), &output.stderr).await;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "worker exited with {}: {}",
            output.status,
            tail_lines(&stderr, 5)
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let lines: Vec<&str> = stdout
        .lines()
        .filter(|line| !line.trim().is_empty())
        .collect();
    if lines.is_empty() {
        return Err("worker exited 0 but produced no NDJSON output".to_owned());
    }

    let mut result_index: Option<usize> = None;
    for (index, line) in lines.iter().enumerate() {
        let envelope: EventEnvelope = serde_json::from_str(line)
            .map_err(|err| format!("malformed NDJSON on line {}: {err}", index + 1))?;
        if envelope.protocol_version != 2 {
            return Err(format!(
                "worker protocol version mismatch on line {}: expected 2, got {}",
                index + 1,
                envelope.protocol_version
            ));
        }
        if envelope.job_id != spec.job_id.as_str() {
            return Err(format!(
                "worker reported job id {:?} on line {}, expected {:?}",
                envelope.job_id,
                index + 1,
                spec.job_id.as_str()
            ));
        }
        match envelope.event.as_str() {
            "progress" => {
                if result_index.is_some() {
                    return Err("a progress event followed the terminal result event".to_owned());
                }
            }
            "result" => {
                if result_index.is_some() {
                    return Err("worker emitted more than one terminal result event".to_owned());
                }
                result_index = Some(index);
            }
            other => {
                return Err(format!(
                    "unknown NDJSON event kind {other:?} on line {}",
                    index + 1
                ));
            }
        }
    }
    let Some(result_index) = result_index else {
        return Err("worker exited 0 without ever emitting a terminal result event".to_owned());
    };
    if result_index != lines.len() - 1 {
        return Err("the terminal result event was not the last line of output".to_owned());
    }

    let result: ResultEvent = serde_json::from_str(lines[result_index])
        .map_err(|err| format!("cannot parse the terminal result event: {err}"))?;

    let manifest_path = PathBuf::from(&result.manifest.path);
    if !is_within(&base_components, &manifest_path) {
        return Err(format!(
            "manifest path {} escapes the job's own output directory",
            manifest_path.display()
        ));
    }
    let manifest_bytes = tokio::fs::read(&manifest_path)
        .await
        .map_err(|err| format!("cannot read manifest at {}: {err}", manifest_path.display()))?;
    if crate::upload::sha256_hex(&manifest_bytes) != result.manifest.sha256 {
        return Err("manifest content hash does not match the terminal result event".to_owned());
    }
    if manifest_bytes.len() as u64 != result.manifest.size {
        return Err("manifest size does not match the terminal result event".to_owned());
    }

    let manifest: Manifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|err| format!("manifest is not valid JSON: {err}"))?;
    if manifest.protocol_version != 2 {
        return Err(format!(
            "manifest protocol version mismatch: expected 2, got {}",
            manifest.protocol_version
        ));
    }
    if manifest.job_id != spec.job_id.as_str() {
        return Err("manifest job id does not match this job".to_owned());
    }
    if manifest.revision_id != spec.revision_id {
        return Err(
            "manifest revision id does not match the revision this job requested".to_owned(),
        );
    }
    if manifest.model_sha256 != spec.content_sha256 {
        return Err("manifest model hash does not match the uploaded content".to_owned());
    }

    let descriptor_bytes = verify_artifact(
        &base_components,
        &manifest.artifacts.descriptor,
        "descriptor",
    )
    .await?;
    let semantic_bytes =
        verify_artifact(&base_components, &manifest.artifacts.semantic, "semantic").await?;
    let outcomes =
        verify_artifact(&base_components, &manifest.artifacts.outcomes, "outcomes").await?;
    let render_bytes = if let Some(artifact) = &manifest.artifacts.render_manifest {
        Some(verify_artifact(&base_components, artifact, "renderManifest").await?)
    } else {
        None
    };
    let geometry_bytes = if let Some(artifact) = &manifest.artifacts.geometry {
        Some(verify_artifact(&base_components, artifact, "geometry").await?)
    } else {
        None
    };

    let descriptor_text = String::from_utf8(descriptor_bytes)
        .map_err(|err| format!("descriptor is not utf-8: {err}"))?;
    let descriptor = model_contracts::parse_model_descriptor(&descriptor_text)
        .map_err(|err| format!("descriptor failed shared-contract validation: {err}"))?;
    if descriptor.revision_id.as_str() != spec.revision_id {
        return Err(
            "descriptor revision id does not match the revision this job requested".to_owned(),
        );
    }
    if descriptor.source_provenance.content_hash.as_str() != spec.content_sha256 {
        return Err("descriptor content hash does not match the uploaded content".to_owned());
    }

    let semantic_text = String::from_utf8(semantic_bytes)
        .map_err(|err| format!("semantic artifact is not utf-8: {err}"))?;
    let semantic = model_contracts::parse_semantic_model(&semantic_text)
        .map_err(|err| format!("semantic artifact failed shared-contract validation: {err}"))?;
    if semantic.revision_id.as_str() != spec.revision_id {
        return Err(
            "semantic artifact revision id does not match the revision this job requested"
                .to_owned(),
        );
    }
    if let Some(declared) = manifest.artifacts.semantic.record_count {
        if declared != semantic.objects.len() as u64 {
            return Err(format!(
                "semantic artifact declares {declared} record(s) but contains {}",
                semantic.objects.len()
            ));
        }
    }
    match &descriptor.artifacts.semantic {
        model_contracts::SemanticCapability::Available {
            content_hash,
            object_count,
            ..
        } => {
            if content_hash.as_str() != manifest.artifacts.semantic.sha256 {
                return Err(
                    "descriptor semantic contentHash does not match the semantic artifact"
                        .to_owned(),
                );
            }
            if *object_count != semantic.objects.len() as u64 {
                return Err(
                    "descriptor semantic objectCount does not match the semantic artifact"
                        .to_owned(),
                );
            }
        }
        other => {
            return Err(format!(
                "descriptor semantic capability is {other:?}, expected available after a successful inspect"
            ));
        }
    }
    for (index, object) in semantic.objects.iter().enumerate() {
        let Some(native) = object.native_ids.as_ref() else {
            return Err(format!(
                "semantic object {index} is missing nativeIds.expressId"
            ));
        };
        let Some(express_id) = native.express_id else {
            return Err(format!(
                "semantic object {index} is missing nativeIds.expressId"
            ));
        };
        let expected_object_id =
            model_contracts::express_id_to_object_id(&spec.revision_id, express_id.get());
        if object.ref_.object_id.as_str() != expected_object_id {
            return Err(format!(
                "semantic object {index} has ref.objectId {:?}, expected {:?} per the shared contract",
                object.ref_.object_id.as_str(),
                expected_object_id
            ));
        }
    }

    let geometry_chunks = validate_render_artifacts(
        &spec.revision_id,
        &semantic,
        &descriptor,
        &manifest,
        render_bytes.as_deref(),
        geometry_bytes.as_deref(),
    )?;
    let mut chunk_map: HashMap<String, model_contracts::GeometryChunk> = HashMap::new();
    for chunk in geometry_chunks {
        chunk_map.insert(chunk.ref_.object_id.to_string(), chunk);
    }

    Ok(WorkerArtifacts {
        semantic,
        descriptor,
        outcomes,
        versions: manifest.versions,
        geometry_chunks: chunk_map,
    })
}

fn validate_render_artifacts(
    revision_id: &str,
    semantic: &model_contracts::SemanticModel,
    descriptor: &model_contracts::ModelDescriptor,
    manifest: &Manifest,
    render_bytes: Option<&[u8]>,
    geometry_bytes: Option<&[u8]>,
) -> Result<Vec<model_contracts::GeometryChunk>, String> {
    let object_ids: HashSet<&str> = semantic
        .objects
        .iter()
        .map(|object| object.ref_.object_id.as_str())
        .collect();
    match (&descriptor.artifacts.render, render_bytes, geometry_bytes) {
        (
            model_contracts::RenderCapability::Unsupported { .. }
            | model_contracts::RenderCapability::Absent
            | model_contracts::RenderCapability::Failed { .. },
            None,
            None,
        ) => Ok(Vec::new()),
        (
            model_contracts::RenderCapability::Available { content_hash, .. },
            Some(render_bytes),
            Some(geometry_bytes),
        ) => {
            let Some(geometry_ref) = &manifest.artifacts.geometry else {
                return Err(
                    "descriptor marks render available but the manifest has no geometry artifact"
                        .to_owned(),
                );
            };
            if content_hash.as_str() != geometry_ref.sha256 {
                return Err(
                    "descriptor render contentHash does not match the geometry artifact".to_owned(),
                );
            }
            let render_text = std::str::from_utf8(render_bytes)
                .map_err(|err| format!("render manifest is not utf-8: {err}"))?;
            let render = model_contracts::parse_render_manifest(render_text).map_err(|err| {
                format!("render manifest failed shared-contract validation: {err}")
            })?;
            if render.revision_id.as_str() != revision_id {
                return Err(
                    "render manifest revision id does not match the revision this job requested"
                        .to_owned(),
                );
            }
            let geometry_text = std::str::from_utf8(geometry_bytes)
                .map_err(|err| format!("geometry artifact is not utf-8: {err}"))?;
            let mut chunks = Vec::new();
            for (index, line) in geometry_text
                .lines()
                .filter(|line| !line.is_empty())
                .enumerate()
            {
                let chunk = model_contracts::parse_geometry_chunk(line).map_err(|err| {
                    format!("geometry chunk {index} failed shared-contract validation: {err}")
                })?;
                if chunk.ref_.revision_id.as_str() != revision_id {
                    return Err(format!(
                        "geometry chunk {index} revision id does not match this job"
                    ));
                }
                if !object_ids.contains(chunk.ref_.object_id.as_str()) {
                    return Err(format!(
                        "geometry chunk {index} objectId {:?} is not in the semantic artifact",
                        chunk.ref_.object_id.as_str()
                    ));
                }
                chunks.push(chunk);
            }
            if let Some(declared) = geometry_ref.record_count {
                if declared != chunks.len() as u64 {
                    return Err(format!(
                        "geometry artifact declares {declared} record(s) but contains {}",
                        chunks.len()
                    ));
                }
            }
            let chunk_ids: HashSet<&str> = chunks
                .iter()
                .map(|chunk| chunk.instance_id.as_str())
                .collect();
            for (index, instance) in render.instances.iter().enumerate() {
                if instance.ref_.revision_id.as_str() != revision_id {
                    return Err(format!(
                        "render instance {index} revision id does not match this job"
                    ));
                }
                if !object_ids.contains(instance.ref_.object_id.as_str()) {
                    return Err(format!(
                        "render instance {index} objectId {:?} is not in the semantic artifact",
                        instance.ref_.object_id.as_str()
                    ));
                }
                if !chunk_ids.contains(instance.instance_id.as_str()) {
                    return Err(format!(
                        "render instance {index} instanceId {:?} has no geometry chunk",
                        instance.instance_id.as_str()
                    ));
                }
            }
            Ok(chunks)
        }
        _ => Err(
            "descriptor render capability does not match the emitted render artifacts".to_owned(),
        ),
    }
}

async fn verify_artifact(
    base_components: &[std::path::Component<'_>],
    artifact: &ArtifactRef,
    which: &str,
) -> Result<Vec<u8>, String> {
    let path = PathBuf::from(&artifact.path);
    if !is_within(base_components, &path) {
        return Err(format!(
            "{which} artifact path escapes the job's own output directory"
        ));
    }
    let resolved = tokio::fs::canonicalize(&path).await.map_err(|err| {
        format!(
            "cannot resolve {which} artifact at {}: {err}",
            path.display()
        )
    })?;
    if !is_within(base_components, &resolved) {
        return Err(format!(
            "{which} artifact path escapes the job's own output directory via a filesystem link"
        ));
    }
    let bytes = tokio::fs::read(&resolved).await.map_err(|err| {
        format!(
            "cannot read {which} artifact at {}: {err}",
            resolved.display()
        )
    })?;
    if bytes.len() as u64 != artifact.size {
        return Err(format!("{which} artifact size does not match the manifest"));
    }
    if crate::upload::sha256_hex(&bytes) != artifact.sha256 {
        return Err(format!(
            "{which} artifact content hash does not match the manifest"
        ));
    }
    Ok(bytes)
}
