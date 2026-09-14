use serde::{Deserialize, Serialize};

use crate::worker_slot::WorkerVersions;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessingVersions {
    pub worker: String,
    pub ifc_open_shell: String,
    pub ifc_tester: String,
    pub extraction: String,
    pub scope_semantics: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProcessingVersionsWire {
    pub worker: String,
    pub ifc_open_shell: String,
    pub ifc_tester: String,
    pub extraction: String,
    pub scope_semantics: String,
}

impl ProcessingVersions {
    pub fn from_worker(v: &WorkerVersions) -> Result<Self, String> {
        Ok(Self {
            worker: require_version("worker", &v.worker)?,
            ifc_open_shell: require_version("ifcOpenShell", &v.ifc_open_shell)?,
            ifc_tester: require_version("ifcTester", &v.ifc_tester)?,
            extraction: require_version("extraction", &v.extraction)?,
            scope_semantics: require_version("scopeSemantics", &v.scope_semantics)?,
        })
    }

    pub fn from_stored_json(text: Option<&str>) -> Option<Self> {
        let text = text
            .map(str::trim)
            .filter(|value| !value.is_empty() && *value != "{}")?;
        let parsed: Self = serde_json::from_str(text).ok()?;
        if [
            parsed.worker.as_str(),
            parsed.ifc_open_shell.as_str(),
            parsed.ifc_tester.as_str(),
            parsed.extraction.as_str(),
            parsed.scope_semantics.as_str(),
        ]
        .iter()
        .any(|value| value.trim().is_empty())
        {
            return None;
        }
        Some(parsed)
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("ProcessingVersions always serializes")
    }

    pub fn to_wire(&self) -> ProcessingVersionsWire {
        ProcessingVersionsWire {
            worker: self.worker.clone(),
            ifc_open_shell: self.ifc_open_shell.clone(),
            ifc_tester: self.ifc_tester.clone(),
            extraction: self.extraction.clone(),
            scope_semantics: self.scope_semantics.clone(),
        }
    }
}

fn require_version(field: &str, value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("worker manifest is missing a {field} version"));
    }
    Ok(trimmed.to_owned())
}

pub fn processing_versions_wire(stored: Option<&str>) -> Option<ProcessingVersionsWire> {
    ProcessingVersions::from_stored_json(stored).map(|versions| versions.to_wire())
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MeasuredEngine {
    pub versions: ProcessingVersions,
}

impl MeasuredEngine {
    pub fn from_invocations(invocations: &[ProcessingVersions]) -> Result<Self, String> {
        let Some(first) = invocations.first() else {
            return Err("no worker invocations to measure".to_owned());
        };
        if invocations.iter().any(|item| item != first) {
            return Err("worker versions differ across models in this run".to_owned());
        }
        Ok(Self {
            versions: first.clone(),
        })
    }

    pub fn engine_version(&self) -> String {
        format!("ifctester/{}", self.versions.ifc_tester)
    }

    pub fn parser_version(&self) -> String {
        format!("ifcopenshell/{}", self.versions.ifc_open_shell)
    }

    pub fn to_profile_json(&self) -> String {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Profile<'a> {
            worker: &'a str,
            ifc_open_shell: &'a str,
            ifc_tester: &'a str,
            extraction: &'a str,
            scope_semantics: &'a str,
            operation: &'a str,
        }
        serde_json::to_string(&Profile {
            worker: &self.versions.worker,
            ifc_open_shell: &self.versions.ifc_open_shell,
            ifc_tester: &self.versions.ifc_tester,
            extraction: &self.versions.extraction,
            scope_semantics: &self.versions.scope_semantics,
            operation: "validate",
        })
        .expect("MeasuredEngine profile always serializes")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn versions() -> ProcessingVersions {
        ProcessingVersions {
            worker: "9.9.9-test".to_owned(),
            ifc_open_shell: "1.2.3".to_owned(),
            ifc_tester: "4.5.6".to_owned(),
            extraction: "e".to_owned(),
            scope_semantics: "s".to_owned(),
        }
    }

    #[test]
    fn to_profile_json_keeps_the_measured_worker_not_the_stale_literal() {
        let engine = MeasuredEngine::from_invocations(&[versions()]).unwrap();
        let profile = engine.to_profile_json();
        assert!(profile.contains("9.9.9-test"), "{profile}");
        assert_ne!(
            profile,
            r#"{"worker":"0.1.0","ifcTester":"0.8.5","ifcOpenShell":"0.8.5","operation":"validate"}"#
        );
        let value: serde_json::Value = serde_json::from_str(&profile).unwrap();
        assert_eq!(value["worker"], "9.9.9-test");
        assert_eq!(value["ifcOpenShell"], "1.2.3");
        assert_eq!(value["ifcTester"], "4.5.6");
        assert_eq!(value["extraction"], "e");
        assert_eq!(value["scopeSemantics"], "s");
        assert_eq!(value["operation"], "validate");
        assert_eq!(engine.engine_version(), "ifctester/4.5.6");
        assert_eq!(engine.parser_version(), "ifcopenshell/1.2.3");
    }

    #[test]
    fn from_worker_rejects_an_empty_worker_string() {
        let raw = WorkerVersions {
            worker: String::new(),
            ifc_open_shell: "1".to_owned(),
            ifc_tester: "1".to_owned(),
            extraction: "1".to_owned(),
            scope_semantics: "1".to_owned(),
        };
        assert_eq!(
            ProcessingVersions::from_worker(&raw).unwrap_err(),
            "worker manifest is missing a worker version"
        );
    }

    #[test]
    fn from_worker_rejects_blank_required_fields() {
        let raw = WorkerVersions {
            worker: "1".to_owned(),
            ifc_open_shell: "1".to_owned(),
            ifc_tester: "1".to_owned(),
            extraction: "  ".to_owned(),
            scope_semantics: "1".to_owned(),
        };
        assert_eq!(
            ProcessingVersions::from_worker(&raw).unwrap_err(),
            "worker manifest is missing a extraction version"
        );
    }

    #[test]
    fn stored_empty_object_projects_null_on_the_wire() {
        assert_eq!(processing_versions_wire(Some("{}")), None);
        assert_eq!(processing_versions_wire(None), None);
        assert_eq!(
            ProcessingVersions::from_stored_json(Some(r#"{"worker":"1"}"#)),
            None
        );
        let stored = versions();
        assert_eq!(
            processing_versions_wire(Some(&stored.to_json()))
                .unwrap()
                .worker,
            "9.9.9-test"
        );
    }

    #[test]
    fn from_invocations_requires_agreement() {
        let a = versions();
        let engine = MeasuredEngine::from_invocations(&[a.clone(), a.clone()]).unwrap();
        assert_eq!(engine.versions, a);
        assert!(MeasuredEngine::from_invocations(&[]).is_err());
        let mut other = a.clone();
        other.worker = "other".to_owned();
        assert!(MeasuredEngine::from_invocations(&[a, other]).is_err());
    }
}
