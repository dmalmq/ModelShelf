//! ModelShelf triage metadata that lives *beside* an IDS file.
//!
//! IDS has no notion of "how bad is this" — deliberately, since severity is a client
//! decision, not a standards one. The pack therefore carries a `metadata.json` mapping
//! specification identifiers to a severity band, a category and a manager-facing title.
//! Keeping it out of the XML means the IDS file stays standards-clean and portable.

use std::collections::HashMap;
use std::io::Write;
use std::process::Command;

use serde::Deserialize;

use crate::dto::DISCIPLINES;

pub const DEFAULT_SEVERITY: &str = "medium";
pub const DEFAULT_CATEGORY_ID: &str = "other";
pub const DEFAULT_CATEGORY_LABEL: &str = "Other";

pub const CHECK_ENGINE_VERSION: &str = "ifctester/0.8.5";
pub const CHECK_PARSER_VERSION: &str = "ifcopenshell/0.8.5";

const SEVERITIES: [&str; 4] = ["critical", "high", "medium", "advisory"];

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Defaults {
    pub severity: Option<String>,
    pub category_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SpecMeta {
    pub severity: Option<String>,
    pub category_id: Option<String>,
    pub title: Option<String>,
    #[serde(default)]
    pub disciplines: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PackMetadata {
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub categories: Vec<Category>,
    #[serde(default)]
    pub defaults: Defaults,
    #[serde(default)]
    pub specs: HashMap<String, SpecMeta>,
}

/// Resolved triage attributes for one specification.
#[derive(Debug, Clone)]
pub struct Triage {
    pub severity: String,
    pub category_id: String,
    pub category_label: String,
    pub title: String,
    /// Populated when the metadata referenced something it did not define.
    pub note: Option<String>,
}

impl PackMetadata {
    pub fn parse(json: Option<&str>) -> PackMetadata {
        Self::try_parse(json).unwrap_or_default()
    }

    pub fn try_parse(json: Option<&str>) -> Result<PackMetadata, String> {
        let Some(text) = json else {
            return Ok(PackMetadata::default());
        };
        let parsed: PackMetadata = serde_json::from_str(text)
            .map_err(|err| format!("pack metadata is not valid JSON: {err}"))?;
        parsed.validate()?;
        Ok(parsed)
    }

    pub fn validate(&self) -> Result<(), String> {
        if let Some(severity) = &self.defaults.severity {
            require_severity(severity)?;
        }
        if let Some(category_id) = &self.defaults.category_id {
            self.require_category(category_id)?;
        }
        for (name, spec) in &self.specs {
            if let Some(severity) = &spec.severity {
                require_severity(severity).map_err(|err| format!("{name}: {err}"))?;
            }
            if let Some(category_id) = &spec.category_id {
                self.require_category(category_id).map_err(|err| format!("{name}: {err}"))?;
            }
            if let Some(disciplines) = &spec.disciplines {
                for discipline in disciplines {
                    if !DISCIPLINES.contains(&discipline.as_str()) {
                        return Err(format!(
                            "{name}: unknown discipline `{discipline}`; expected ARCH, STRUCT, MEP or OTHER"
                        ));
                    }
                }
            }
        }
        Ok(())
    }

    fn require_category(&self, category_id: &str) -> Result<(), String> {
        if category_id == DEFAULT_CATEGORY_ID || self.categories.iter().any(|c| c.id == category_id) {
            Ok(())
        } else {
            Err(format!("category `{category_id}` is not declared in pack metadata"))
        }
    }

    /// Specification identifiers to evaluate against a source model's discipline.
    /// A spec with no `disciplines` list applies to every file.
    pub fn specification_ids_for(&self, spec_names: &[String], discipline: &str) -> Vec<String> {
        spec_names
            .iter()
            .filter(|name| match self.specs.get(*name).and_then(|meta| meta.disciplines.as_ref()) {
                None => true,
                Some(disciplines) => disciplines.iter().any(|item| item == discipline),
            })
            .cloned()
            .collect()
    }

    fn category_label(&self, id: &str) -> Option<&str> {
        self.categories.iter().find(|c| c.id == id).map(|c| c.label.as_str())
    }

    /// Triage for a specification, looked up by identifier and then by name.
    ///
    /// Anything unresolved falls back to `medium`/`other` rather than being dropped: a
    /// finding must never disappear because its metadata was missing.
    pub fn triage(&self, identifier: Option<&str>, name: &str) -> Triage {
        let entry = identifier
            .and_then(|key| self.specs.get(key))
            .or_else(|| self.specs.get(name));

        let severity = entry
            .and_then(|e| e.severity.clone())
            .or_else(|| self.defaults.severity.clone())
            .unwrap_or_else(|| DEFAULT_SEVERITY.to_owned());
        let mut note = None;
        let severity = if SEVERITIES.contains(&severity.as_str()) {
            severity
        } else {
            note = Some(format!("unknown severity `{severity}` in pack metadata"));
            DEFAULT_SEVERITY.to_owned()
        };

        let category_id = entry
            .and_then(|e| e.category_id.clone())
            .or_else(|| self.defaults.category_id.clone())
            .unwrap_or_else(|| DEFAULT_CATEGORY_ID.to_owned());
        let category_label = match self.category_label(&category_id) {
            Some(label) => label.to_owned(),
            None if category_id == DEFAULT_CATEGORY_ID => DEFAULT_CATEGORY_LABEL.to_owned(),
            None => {
                note = Some(format!("category `{category_id}` is not declared in pack metadata"));
                category_id.clone()
            }
        };

        let title = entry
            .and_then(|e| e.title.clone())
            .unwrap_or_else(|| name.to_owned());

        Triage { severity, category_id, category_label, title, note }
    }
}

fn require_severity(severity: &str) -> Result<(), String> {
    if SEVERITIES.contains(&severity) {
        Ok(())
    } else {
        Err(format!("unknown severity `{severity}`"))
    }
}

/// Stable key for a finding, used to compare runs of the same pack version.
pub fn finding_key(spec_key: &str, facet: &str, requirement: &str) -> String {
    let material = format!("{spec_key}\u{1f}{facet}\u{1f}{requirement}");
    blake3::hash(material.as_bytes()).to_hex()[..32].to_owned()
}

/// IfcTester must be able to open a pack before it is published. The custom
/// `ids` crate can accept documents the live scorer rejects.
pub fn validate_ids_with_ifctester(ids_xml: &str) -> Result<usize, String> {
    let path = std::env::temp_dir().join(format!("modelshelf-ids-{}.ids", crate::db::new_id()));
    let mut file = std::fs::File::create(&path).map_err(|err| format!("cannot write IDS for validation: {err}"))?;
    file.write_all(ids_xml.as_bytes())
        .map_err(|err| format!("cannot write IDS for validation: {err}"))?;
    file.flush().map_err(|err| format!("cannot write IDS for validation: {err}"))?;
    drop(file);

    let output = Command::new("uv")
        .args([
            "run",
            "--locked",
            "--project",
            "services/ifc-worker",
            "python",
            "-c",
            "import sys, ifctester; spec = ifctester.open(sys.argv[1]); print(len(spec.specifications))",
            &path.to_string_lossy(),
        ])
        .output();
    let _ = std::fs::remove_file(&path);
    let output = output.map_err(|err| format!("cannot invoke IfcTester: {err}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let lines: Vec<&str> = stderr.lines().collect();
        let start = lines.len().saturating_sub(8);
        return Err(format!(
            "IDS is not valid according to IfcTester: {}",
            lines[start..].join("\n")
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .trim()
        .parse::<usize>()
        .map_err(|_| format!("IfcTester did not report a specification count: {}", stdout.trim()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_severity_and_category() {
        let err = PackMetadata::try_parse(Some(
            r#"{"defaults":{"severity":"urgent"},"specs":{}}"#,
        ))
        .unwrap_err();
        assert!(err.contains("unknown severity"), "{err}");

        let err = PackMetadata::try_parse(Some(
            r#"{"categories":[{"id":"id","label":"Id"}],"specs":{"A":{"categoryId":"nope"}}}"#,
        ))
        .unwrap_err();
        assert!(err.contains("not declared"), "{err}");
    }

    #[test]
    fn scopes_specs_by_discipline() {
        let meta = PackMetadata::try_parse(Some(
            r#"{
                "categories":[{"id":"regulatory","label":"Regulatory"}],
                "specs":{
                    "Walls":{"severity":"high","categoryId":"regulatory","disciplines":["ARCH"]},
                    "Everywhere":{"severity":"medium","categoryId":"regulatory"}
                }
            }"#,
        ))
        .unwrap();
        let names = vec!["Walls".to_owned(), "Everywhere".to_owned()];
        assert_eq!(meta.specification_ids_for(&names, "ARCH"), names);
        assert_eq!(meta.specification_ids_for(&names, "MEP"), vec!["Everywhere".to_owned()]);
    }
}
