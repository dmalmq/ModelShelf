//! ModelShelf triage metadata that lives *beside* an IDS file.
//!
//! IDS has no notion of "how bad is this" — deliberately, since severity is a client
//! decision, not a standards one. The pack therefore carries a `metadata.json` mapping
//! specification identifiers to a severity band, a category and a manager-facing title.
//! Keeping it out of the XML means the IDS file stays standards-clean and portable.

use std::collections::HashMap;

use serde::Deserialize;

pub const DEFAULT_SEVERITY: &str = "medium";
pub const DEFAULT_CATEGORY_ID: &str = "other";
pub const DEFAULT_CATEGORY_LABEL: &str = "Other";

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
        match json {
            Some(text) => serde_json::from_str(text).unwrap_or_default(),
            None => PackMetadata::default(),
        }
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

/// Stable key for a finding, used to compare runs of the same pack version.
pub fn finding_key(spec_key: &str, facet: &str, requirement: &str) -> String {
    let material = format!("{spec_key}\u{1f}{facet}\u{1f}{requirement}");
    blake3::hash(material.as_bytes()).to_hex()[..32].to_owned()
}
