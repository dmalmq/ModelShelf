use std::path::Path;

use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::worker_slot::{WorkerInvocation, WorkerOperation};

pub(crate) const PROTOCOL_VERSION: i64 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ProtocolV2;

impl Serialize for ProtocolV2 {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        PROTOCOL_VERSION.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for ProtocolV2 {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = i64::deserialize(deserializer)?;
        if value == PROTOCOL_VERSION {
            Ok(ProtocolV2)
        } else {
            Err(serde::de::Error::custom(format!(
                "worker protocol version mismatch: expected {PROTOCOL_VERSION}, got {value}"
            )))
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum WireOperation {
    Inspect,
    Validate,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ModelRef {
    pub path: String,
    pub sha256: String,
    pub revision_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct IdsRef {
    pub path: String,
    pub sha256: String,
    pub specification_ids: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Settings {
    pub geometry: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct WorkerRequest {
    pub protocol_version: ProtocolV2,
    #[serde(rename = "jobId")]
    pub job_id: String,
    pub operation: WireOperation,
    pub model: ModelRef,
    pub ids: Option<IdsRef>,
    pub output_dir: String,
    pub settings: Settings,
}

impl WorkerRequest {
    pub fn from_invocation(
        spec: &WorkerInvocation,
        blob_canonical: &Path,
        job_dir_canonical: &Path,
    ) -> Self {
        let (operation, ids) = match &spec.operation {
            WorkerOperation::Inspect => (WireOperation::Inspect, None),
            WorkerOperation::Validate(ids) => (
                WireOperation::Validate,
                Some(IdsRef {
                    path: ids.path.to_string_lossy().into_owned(),
                    sha256: ids.sha256.clone(),
                    specification_ids: Some(ids.specification_ids.clone()),
                }),
            ),
        };
        Self {
            protocol_version: ProtocolV2,
            job_id: spec.job_id.as_str().to_owned(),
            operation,
            model: ModelRef {
                path: blob_canonical.to_string_lossy().into_owned(),
                sha256: spec.content_sha256.clone(),
                revision_id: spec.revision_id.clone(),
            },
            ids,
            output_dir: job_dir_canonical.to_string_lossy().into_owned(),
            settings: Settings {
                geometry: spec.operation.geometry(),
            },
        }
    }

    pub fn to_pretty_json(&self) -> Result<Vec<u8>, String> {
        serde_json::to_vec_pretty(self)
            .map_err(|err| format!("cannot serialize request.json: {err}"))
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "event", deny_unknown_fields)]
pub(crate) enum WorkerEvent {
    #[serde(rename = "progress")]
    Progress {
        #[serde(rename = "protocolVersion")]
        protocol_version: ProtocolV2,
        #[serde(rename = "jobId")]
        job_id: String,
        stage: String,
    },
    #[serde(rename = "result")]
    Result {
        #[serde(rename = "protocolVersion")]
        protocol_version: ProtocolV2,
        #[serde(rename = "jobId")]
        job_id: String,
        manifest: ManifestPointer,
    },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ManifestPointer {
    pub path: String,
    pub sha256: String,
    pub size: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ArtifactRef {
    pub path: String,
    pub sha256: String,
    pub size: u64,
    pub record_count: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct JobArtifacts {
    pub descriptor: ArtifactRef,
    pub semantic: ArtifactRef,
    pub render_manifest: Option<ArtifactRef>,
    pub geometry: Option<ArtifactRef>,
    pub outcomes: ArtifactRef,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct WorkerVersions {
    pub worker: String,
    pub ifc_open_shell: String,
    pub ifc_tester: String,
    pub extraction: String,
    pub scope_semantics: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Manifest {
    pub protocol_version: ProtocolV2,
    #[serde(rename = "jobId")]
    pub job_id: String,
    pub operation: WireOperation,
    pub revision_id: String,
    pub model_sha256: String,
    pub ids_sha256: Option<String>,
    pub versions: WorkerVersions,
    pub artifacts: JobArtifacts,
    pub diagnostics: Vec<String>,
}

impl Manifest {
    pub fn from_verified_bytes(bytes: &[u8]) -> Result<Self, String> {
        serde_json::from_slice(bytes).map_err(|err| format!("invalid manifest: {err}"))
    }

    pub fn check_identity(&self, spec: &WorkerInvocation) -> Result<(), String> {
        if self.job_id != spec.job_id.as_str() {
            return Err("manifest job id does not match this job".to_owned());
        }
        if self.revision_id != spec.revision_id {
            return Err(
                "manifest revision id does not match the revision this job requested".to_owned(),
            );
        }
        if self.model_sha256 != spec.content_sha256 {
            return Err("manifest model hash does not match the uploaded content".to_owned());
        }
        let expected = match spec.operation {
            WorkerOperation::Inspect => WireOperation::Inspect,
            WorkerOperation::Validate(_) => WireOperation::Validate,
        };
        if self.operation != expected {
            return Err("manifest operation does not match this job".to_owned());
        }
        match spec.operation {
            WorkerOperation::Validate(_) if self.ids_sha256.is_none() => {
                Err("manifest idsSha256 is required for validate".to_owned())
            }
            WorkerOperation::Inspect if self.ids_sha256.is_some() => {
                Err("manifest idsSha256 must be null for inspect".to_owned())
            }
            _ => Ok(()),
        }
    }
}

#[derive(Debug)]
pub(crate) struct ParsedStdout {
    pub result: WorkerEvent,
}

pub(crate) fn parse_ndjson_stream(stdout: &str, expected_job_id: &str) -> Result<ParsedStdout, String> {
    let lines: Vec<&str> = stdout
        .lines()
        .filter(|line| !line.trim().is_empty())
        .collect();
    if lines.is_empty() {
        return Err("worker exited 0 but produced no NDJSON output".to_owned());
    }

    let mut result_index: Option<usize> = None;
    let mut result_event: Option<WorkerEvent> = None;
    for (index, line) in lines.iter().enumerate() {
        let event: WorkerEvent = serde_json::from_str(line)
            .map_err(|err| format!("malformed NDJSON on line {}: {err}", index + 1))?;
        let (job_id, is_result) = match &event {
            WorkerEvent::Progress { job_id, .. } => (job_id.as_str(), false),
            WorkerEvent::Result { job_id, .. } => (job_id.as_str(), true),
        };
        if job_id != expected_job_id {
            return Err(format!(
                "worker reported job id {:?} on line {}, expected {:?}",
                job_id,
                index + 1,
                expected_job_id
            ));
        }
        if is_result {
            if result_index.is_some() {
                return Err("worker emitted more than one terminal result event".to_owned());
            }
            result_index = Some(index);
            result_event = Some(event);
        } else if result_index.is_some() {
            return Err("a progress event followed the terminal result event".to_owned());
        }
    }
    let Some(result_index) = result_index else {
        return Err("worker exited 0 without ever emitting a terminal result event".to_owned());
    };
    if result_index != lines.len() - 1 {
        return Err("the terminal result event was not the last line of output".to_owned());
    }
    Ok(ParsedStdout {
        result: result_event.expect("result_index is set"),
    })
}

pub(crate) fn dump_envelope_goldens() -> serde_json::Value {
    let zero = "0".repeat(64);
    let one = "1".repeat(64);
    let aaa = "a".repeat(64);
    let bbb = "b".repeat(64);
    let ccc = "c".repeat(64);
    let ddd = "d".repeat(64);
    let eee = "e".repeat(64);
    let model = ModelRef {
        path: "/data/a.ifc".to_owned(),
        sha256: zero.clone(),
        revision_id: "revision-1".to_owned(),
    };
    let inspect_request = WorkerRequest {
        protocol_version: ProtocolV2,
        job_id: "job-1".to_owned(),
        operation: WireOperation::Inspect,
        model: ModelRef {
            path: model.path.clone(),
            sha256: model.sha256.clone(),
            revision_id: model.revision_id.clone(),
        },
        ids: None,
        output_dir: "/data/jobs/job-1".to_owned(),
        settings: Settings { geometry: true },
    };
    let validate_request = WorkerRequest {
        protocol_version: ProtocolV2,
        job_id: "job-1".to_owned(),
        operation: WireOperation::Validate,
        model,
        ids: Some(IdsRef {
            path: "/data/a.ids".to_owned(),
            sha256: one.clone(),
            specification_ids: Some(vec!["spec-a".to_owned()]),
        }),
        output_dir: "/data/jobs/job-1".to_owned(),
        settings: Settings { geometry: false },
    };
    let progress = WorkerEvent::Progress {
        protocol_version: ProtocolV2,
        job_id: "job-1".to_owned(),
        stage: "loading".to_owned(),
    };
    let result = WorkerEvent::Result {
        protocol_version: ProtocolV2,
        job_id: "job-1".to_owned(),
        manifest: ManifestPointer {
            path: "/data/jobs/job-1/manifest.json".to_owned(),
            sha256: one.clone(),
            size: 1234,
        },
    };
    let versions = WorkerVersions {
        worker: "0.1.0".to_owned(),
        ifc_open_shell: "0.8.5".to_owned(),
        ifc_tester: "0.8.5".to_owned(),
        extraction: "inspect-v2".to_owned(),
        scope_semantics: "scope-v1".to_owned(),
    };
    let descriptor = ArtifactRef {
        path: "/data/jobs/job-1/descriptor.json".to_owned(),
        sha256: aaa,
        size: 10,
        record_count: Some(1),
    };
    let semantic = ArtifactRef {
        path: "/data/jobs/job-1/semantic.json".to_owned(),
        sha256: bbb,
        size: 20,
        record_count: Some(2),
    };
    let inspect_manifest = Manifest {
        protocol_version: ProtocolV2,
        job_id: "job-1".to_owned(),
        operation: WireOperation::Inspect,
        revision_id: "revision-1".to_owned(),
        model_sha256: zero.clone(),
        ids_sha256: None,
        versions: versions.clone(),
        artifacts: JobArtifacts {
            descriptor: clone_artifact(&descriptor),
            semantic: clone_artifact(&semantic),
            render_manifest: Some(ArtifactRef {
                path: "/data/jobs/job-1/render-manifest.json".to_owned(),
                sha256: ccc,
                size: 30,
                record_count: Some(2),
            }),
            geometry: Some(ArtifactRef {
                path: "/data/jobs/job-1/geometry.jsonl".to_owned(),
                sha256: ddd,
                size: 40,
                record_count: Some(2),
            }),
            outcomes: ArtifactRef {
                path: "/data/jobs/job-1/outcomes.jsonl".to_owned(),
                sha256: eee.clone(),
                size: 0,
                record_count: Some(0),
            },
        },
        diagnostics: Vec::new(),
    };
    let validate_manifest = Manifest {
        protocol_version: ProtocolV2,
        job_id: "job-1".to_owned(),
        operation: WireOperation::Validate,
        revision_id: "revision-1".to_owned(),
        model_sha256: zero,
        ids_sha256: Some(one),
        versions,
        artifacts: JobArtifacts {
            descriptor,
            semantic,
            render_manifest: None,
            geometry: None,
            outcomes: ArtifactRef {
                path: "/data/jobs/job-1/outcomes.jsonl".to_owned(),
                sha256: eee,
                size: 50,
                record_count: Some(3),
            },
        },
        diagnostics: vec!["ids-note".to_owned()],
    };
    let request_inspect = to_value(&inspect_request);
    let progress_value = to_value(&progress);
    let result_value = to_value(&result);
    let manifest_inspect = to_value(&inspect_manifest);
    serde_json::json!({
        "protocolVersion": PROTOCOL_VERSION,
        "goldens": {
            "request-inspect": request_inspect,
            "request-validate": to_value(&validate_request),
            "progress-event": progress_value,
            "result-event": result_value,
            "manifest-inspect": manifest_inspect,
            "manifest-validate": to_value(&validate_manifest),
        },
        "properties": {
            "request.schema.json": object_keys(&to_value(&inspect_request)),
            "progress-event.schema.json": object_keys(&to_value(&progress)),
            "result-event.schema.json": object_keys(&to_value(&result)),
            "manifest.schema.json": object_keys(&to_value(&inspect_manifest)),
        }
    })
}

fn clone_artifact(artifact: &ArtifactRef) -> ArtifactRef {
    ArtifactRef {
        path: artifact.path.clone(),
        sha256: artifact.sha256.clone(),
        size: artifact.size,
        record_count: artifact.record_count,
    }
}

fn to_value<T: Serialize>(value: &T) -> serde_json::Value {
    serde_json::to_value(value).expect("envelope goldens serialize")
}

fn object_keys(value: &serde_json::Value) -> Vec<String> {
    value
        .as_object()
        .expect("golden object")
        .keys()
        .cloned()
        .collect()
}

#[cfg(test)]
mod goldens {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn fixtures_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../schemas/worker/v2/fixtures")
    }

    fn read_json(rel: &str) -> serde_json::Value {
        let text = fs::read_to_string(fixtures_dir().join(rel)).unwrap();
        serde_json::from_str(&text).unwrap()
    }

    #[test]
    fn valid_goldens_round_trip() {
        let request: WorkerRequest =
            serde_json::from_value(read_json("valid/request-inspect.json")).unwrap();
        assert_eq!(to_value(&request), read_json("valid/request-inspect.json"));
        let request: WorkerRequest =
            serde_json::from_value(read_json("valid/request-validate.json")).unwrap();
        assert_eq!(to_value(&request), read_json("valid/request-validate.json"));
        let progress: WorkerEvent =
            serde_json::from_value(read_json("valid/progress-event.json")).unwrap();
        assert_eq!(to_value(&progress), read_json("valid/progress-event.json"));
        let result: WorkerEvent =
            serde_json::from_value(read_json("valid/result-event.json")).unwrap();
        assert_eq!(to_value(&result), read_json("valid/result-event.json"));
        let manifest: Manifest =
            serde_json::from_value(read_json("valid/manifest-inspect.json")).unwrap();
        assert_eq!(to_value(&manifest), read_json("valid/manifest-inspect.json"));
        let manifest: Manifest =
            serde_json::from_value(read_json("valid/manifest-validate.json")).unwrap();
        assert_eq!(to_value(&manifest), read_json("valid/manifest-validate.json"));
    }

    #[test]
    fn renamed_job_id_fixture_fails() {
        let payload = read_json("invalid/schema/request-job-id-renamed.json");
        assert!(serde_json::from_value::<WorkerRequest>(payload).is_err());
    }

    #[test]
    fn stream_result_must_be_last() {
        let text = fs::read_to_string(fixtures_dir().join("invalid/stream/result-not-last.ndjson"))
            .unwrap();
        let err = parse_ndjson_stream(&text, "job-1").unwrap_err();
        assert!(
            err.contains("progress event followed") || err.contains("was not the last line"),
            "{err}"
        );
    }

    #[test]
    fn stream_two_results_is_rejected() {
        let text =
            fs::read_to_string(fixtures_dir().join("invalid/stream/two-results.ndjson")).unwrap();
        let err = parse_ndjson_stream(&text, "job-1").unwrap_err();
        assert!(
            err.contains("more than one terminal result"),
            "{err}"
        );
    }
}
