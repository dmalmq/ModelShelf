//! `ids` — buildingSMART IDS 1.0 parser and evaluator over `ifc-model`.
//!
//! Honest-scope rules, non-negotiable:
//! - Entity-facet matching is **non-inheriting** (IDS spec: no automatic inheritance).
//! - Anything this engine cannot decide becomes `Outcome::ReviewIncomplete` with a
//!   reason. It NEVER silently passes and never counts as a fail.
//! - Geometry code-checking is out of IDS scope and out of scope here.
//!
//! PUBLIC API IS A CROSS-CRATE CONTRACT: signatures below MUST NOT change.

use ifc_model::IfcModel;

/// `<ids><info>` block.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct IdsInfo {
    pub title: String,
    pub copyright: Option<String>,
    pub version: Option<String>,
    pub description: Option<String>,
    pub author: Option<String>,
    pub date: Option<String>,
    pub purpose: Option<String>,
    pub milestone: Option<String>,
}

/// A value constraint: `simpleValue` or an `xs:restriction`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum ValueConstraint {
    Simple(String),
    Pattern(String),
    Enumeration(Vec<String>),
    Bounds {
        min_inclusive: Option<f64>,
        max_inclusive: Option<f64>,
        min_exclusive: Option<f64>,
        max_exclusive: Option<f64>,
    },
    Length {
        exact: Option<usize>,
        min: Option<usize>,
        max: Option<usize>,
    },
    /// Recognised XSD facet this engine does not implement; forces review-incomplete.
    Unsupported(String),
}

impl ValueConstraint {
    /// Match a candidate string (and its numeric interpretation when available).
    /// `None` means "cannot decide" -> review incomplete.
    pub fn matches(&self, candidate: &str, numeric: Option<f64>) -> Option<bool> {
        todo!("ids: implement")
    }
    /// Human-readable expectation for evidence records, e.g. `pattern .*Fire.*`.
    pub fn describe(&self) -> String {
        todo!("ids: implement")
    }
}

/// Requirement strength on a facet inside `<requirements>`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum Cardinality {
    #[default]
    Required,
    Optional,
    Prohibited,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct FacetMeta {
    pub cardinality: Cardinality,
    pub instructions: Option<String>,
    pub uri: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum FacetKind {
    Entity,
    Attribute,
    Classification,
    Property,
    Material,
    PartOf,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum Facet {
    Entity {
        name: ValueConstraint,
        predefined_type: Option<ValueConstraint>,
        meta: FacetMeta,
    },
    Attribute {
        name: ValueConstraint,
        value: Option<ValueConstraint>,
        meta: FacetMeta,
    },
    Classification {
        system: Option<ValueConstraint>,
        value: Option<ValueConstraint>,
        meta: FacetMeta,
    },
    Property {
        property_set: ValueConstraint,
        base_name: ValueConstraint,
        value: Option<ValueConstraint>,
        /// IDS `dataType` attribute, uppercase (e.g. `IFCLABEL`).
        data_type: Option<String>,
        meta: FacetMeta,
    },
    Material {
        value: Option<ValueConstraint>,
        meta: FacetMeta,
    },
    PartOf {
        /// Entity constraint of the whole (`<entity><name>` inside `partOf`).
        entity_name: ValueConstraint,
        entity_predefined_type: Option<ValueConstraint>,
        /// Relation name, uppercase, e.g. `IFCRELAGGREGATES`. `None` = any supported.
        relation: Option<String>,
        meta: FacetMeta,
    },
}

impl Facet {
    pub fn kind(&self) -> FacetKind {
        todo!("ids: implement")
    }
    pub fn meta(&self) -> &FacetMeta {
        todo!("ids: implement")
    }
    /// One-line human requirement text used in findings.
    pub fn describe(&self) -> String {
        todo!("ids: implement")
    }
}

/// `<applicability minOccurs maxOccurs>` count constraint.
#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize)]
pub struct Occurs {
    pub min: u32,
    /// `None` == `unbounded`.
    pub max: Option<u32>,
}

impl Default for Occurs {
    fn default() -> Self {
        Occurs { min: 0, max: None }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Specification {
    pub identifier: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub instructions: Option<String>,
    /// `ifcVersion` tokens, e.g. `["IFC4"]`. Empty = applies to any schema.
    pub ifc_versions: Vec<String>,
    pub applicability: Vec<Facet>,
    pub applicability_occurs: Occurs,
    pub requirements: Vec<Facet>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Ids {
    pub info: IdsInfo,
    pub specifications: Vec<Specification>,
}

#[derive(Debug, thiserror::Error)]
pub enum IdsError {
    #[error("malformed xml: {0}")]
    Xml(String),
    #[error("not an IDS document (missing <ids> root)")]
    NotIds,
    #[error("specification {index} is invalid: {message}")]
    Specification { index: usize, message: String },
    #[error("invalid regex in restriction: {0}")]
    Regex(String),
}

impl Ids {
    /// Parse IDS 1.0 XML. Namespace prefixes vary between authoring tools, so match on
    /// local names. Unknown elements/attributes are recorded as `Unsupported`, not errors.
    pub fn parse(xml: &str) -> Result<Ids, IdsError> {
        todo!("ids: implement")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Outcome {
    Pass,
    Fail,
    /// No object matched the applicability filter.
    NotApplicable,
    /// Engine could not decide (unsupported facet, unreadable attribute, bad regex...).
    ReviewIncomplete,
}

/// One failing (or review-incomplete) object with its evidence.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ObjectOutcome {
    pub express_id: u32,
    pub global_id: Option<String>,
    pub ifc_type: String,
    pub name: Option<String>,
    pub storey: Option<String>,
    pub facet: FacetKind,
    /// Human requirement text, e.g. `Pset_WallCommon.FireRating must exist`.
    pub requirement: String,
    pub expected: Option<String>,
    pub actual: Option<String>,
    /// Set when this object is review-incomplete rather than a clean fail.
    pub incomplete_reason: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SpecResult {
    pub identifier: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub instructions: Option<String>,
    pub outcome: Outcome,
    pub applicable_count: u32,
    pub pass_count: u32,
    pub fail_count: u32,
    pub incomplete_count: u32,
    /// Express ids of applicable objects that passed every requirement.
    pub passed: Vec<u32>,
    /// Failing and review-incomplete objects, one entry per violated facet.
    pub outcomes: Vec<ObjectOutcome>,
    /// Spec-level notes (schema mismatch, occurs violation, unsupported facet).
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Report {
    pub engine_version: String,
    pub ids_title: String,
    pub schema: String,
    pub specs: Vec<SpecResult>,
    pub total_pass: u32,
    pub total_fail: u32,
    pub total_not_applicable: u32,
    pub total_incomplete: u32,
}

/// Engine identity recorded on every run.
pub const ENGINE_VERSION: &str = concat!("modelshelf-ids/", env!("CARGO_PKG_VERSION"));

/// Evaluate every specification against one model.
pub fn evaluate(model: &IfcModel, ids: &Ids) -> Report {
    todo!("ids: implement")
}

/// Evaluate against several models as one federated delivery. Express ids are only
/// unique per model, so callers pass `(model_key, model)` and receive per-model outcomes
/// tagged with `model_key` in `ObjectOutcome::global_id` resolution order.
pub fn evaluate_federated(models: &[(String, &IfcModel)], ids: &Ids) -> Vec<(String, Report)> {
    todo!("ids: implement")
}
