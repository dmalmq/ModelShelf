//! `ids` — buildingSMART IDS 1.0 parser and evaluator over `ifc-model`.
//!
//! Reference/test engine only. Live scorecards come from IfcTester via the
//! Python worker (ticket 06). Do not add live-scoring features here.
//!
//! Honest-scope rules, non-negotiable:
//! - Entity-facet matching is **non-inheriting** (IDS spec: no automatic inheritance).
//! - Anything this engine cannot decide becomes `Outcome::ReviewIncomplete` with a
//!   reason. It NEVER silently passes and never counts as a fail.
//! - Geometry code-checking is out of IDS scope and out of scope here.
//!
//! PUBLIC API IS A CROSS-CRATE CONTRACT: signatures below MUST NOT change.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use ifc_model::{AttributeLookup, IfcModel, PropKind, Value};
use regex::Regex;

mod xml;

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

/// IDS equality tolerance epsilon. The rule is both relative and absolute so that tiny
/// areas and railway-scale lengths behave sensibly:
/// `x == v  <=>  (v - |v|*eps - eps) < x < (v + |v|*eps + eps)`.
/// Source: buildingSMART IDS `tolerance.md`.
const NUMERIC_TOLERANCE: f64 = 1e-6;

fn parse_number(text: &str) -> Option<f64> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    trimmed.parse::<f64>().ok().filter(|v| v.is_finite())
}

/// `expected == actual` under the IDS equality tolerance.
///
/// `tolerance.md` writes the bounds as strict, but its own table lists the boundary values
/// and the official test corpus expects them to pass (e.g. `1.000002` equals `1.0`). The
/// comparison is therefore inclusive: the difference is one representable step, and
/// rejecting the documented boundary would fail conformance for no practical gain.
fn numbers_equal(expected: f64, actual: f64) -> bool {
    let slack = expected.abs() * NUMERIC_TOLERANCE + NUMERIC_TOLERANCE;
    // The documented boundary values are inclusive, and computing the bound in binary
    // floating point can land one representable step below the decimal literal in the
    // corpus, so absorb a few ULPs of the slack itself.
    let margin = slack * 8.0 * f64::EPSILON;
    (actual - expected).abs() <= slack + margin
}

/// Compiled-pattern cache: IDS patterns repeat across every object in a model, and
/// recompiling per object turns a linear check into a quadratic one.
static REGEX_CACHE: LazyLock<Mutex<HashMap<String, Option<Regex>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Compile an XSD pattern. XSD patterns are implicitly anchored, and constructs the
/// `regex` crate rejects yield `None` so the caller reports review-incomplete rather than
/// inventing a verdict.
fn compiled_pattern(pattern: &str) -> Option<Regex> {
    let mut cache = REGEX_CACHE.lock().expect("regex cache poisoned");
    if let Some(hit) = cache.get(pattern) {
        return hit.clone();
    }
    let anchored = format!("^(?:{pattern})$");
    let compiled = Regex::new(&anchored).ok();
    cache.insert(pattern.to_owned(), compiled.clone());
    compiled
}

impl ValueConstraint {
    /// Match a candidate string (and its numeric interpretation when available).
    /// `None` means "cannot decide" -> review incomplete.
    pub fn matches(&self, candidate: &str, numeric: Option<f64>) -> Option<bool> {
        match self {
            ValueConstraint::Simple(expected) => {
                if let (Some(want), Some(got)) = (parse_number(expected), numeric) {
                    return Some(numbers_equal(want, got));
                }
                Some(candidate == expected)
            }
            ValueConstraint::Pattern(pattern) => {
                Some(compiled_pattern(pattern)?.is_match(candidate))
            }
            ValueConstraint::Enumeration(allowed) => Some(allowed.iter().any(|expected| {
                match (parse_number(expected), numeric) {
                    (Some(want), Some(got)) => numbers_equal(want, got),
                    _ => candidate == expected,
                }
            })),
            ValueConstraint::Bounds {
                min_inclusive,
                max_inclusive,
                min_exclusive,
                max_exclusive,
            } => {
                let Some(value) = numeric.or_else(|| parse_number(candidate)) else {
                    // A bounds restriction against a non-numeric value is a plain fail:
                    // the model does not carry a number where one was required.
                    return Some(false);
                };
                // Tolerance deliberately does NOT apply to ranges: authors express a
                // custom tolerance by widening the range itself.
                let mut ok = true;
                if let Some(bound) = min_inclusive {
                    ok &= value >= *bound;
                }
                if let Some(bound) = max_inclusive {
                    ok &= value <= *bound;
                }
                if let Some(bound) = min_exclusive {
                    ok &= value > *bound;
                }
                if let Some(bound) = max_exclusive {
                    ok &= value < *bound;
                }
                Some(ok)
            }
            ValueConstraint::Length { exact, min, max } => {
                let len = candidate.chars().count();
                let mut ok = true;
                if let Some(want) = exact {
                    ok &= len == *want;
                }
                if let Some(want) = min {
                    ok &= len >= *want;
                }
                if let Some(want) = max {
                    ok &= len <= *want;
                }
                Some(ok)
            }
            ValueConstraint::Unsupported(_) => None,
        }
    }

    /// Human-readable expectation for evidence records, e.g. `pattern .*Fire.*`.
    pub fn describe(&self) -> String {
        match self {
            ValueConstraint::Simple(value) => value.clone(),
            ValueConstraint::Pattern(pattern) => format!("pattern {pattern}"),
            ValueConstraint::Enumeration(values) => format!("one of [{}]", values.join(", ")),
            ValueConstraint::Bounds {
                min_inclusive,
                max_inclusive,
                min_exclusive,
                max_exclusive,
            } => {
                let mut parts = Vec::new();
                if let Some(v) = min_inclusive {
                    parts.push(format!(">= {v}"));
                }
                if let Some(v) = min_exclusive {
                    parts.push(format!("> {v}"));
                }
                if let Some(v) = max_inclusive {
                    parts.push(format!("<= {v}"));
                }
                if let Some(v) = max_exclusive {
                    parts.push(format!("< {v}"));
                }
                parts.join(" and ")
            }
            ValueConstraint::Length { exact, min, max } => {
                let mut parts = Vec::new();
                if let Some(v) = exact {
                    parts.push(format!("length {v}"));
                }
                if let Some(v) = min {
                    parts.push(format!("min length {v}"));
                }
                if let Some(v) = max {
                    parts.push(format!("max length {v}"));
                }
                parts.join(" and ")
            }
            ValueConstraint::Unsupported(name) => format!("unsupported restriction `{name}`"),
        }
    }

    fn is_supported(&self) -> bool {
        !matches!(self, ValueConstraint::Unsupported(_))
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
#[serde(rename_all = "snake_case")]
pub enum FacetKind {
    Entity,
    Attribute,
    Classification,
    Property,
    Material,
    PartOf,
}

impl FacetKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            FacetKind::Entity => "entity",
            FacetKind::Attribute => "attribute",
            FacetKind::Classification => "classification",
            FacetKind::Property => "property",
            FacetKind::Material => "material",
            FacetKind::PartOf => "part_of",
        }
    }
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
        match self {
            Facet::Entity { .. } => FacetKind::Entity,
            Facet::Attribute { .. } => FacetKind::Attribute,
            Facet::Classification { .. } => FacetKind::Classification,
            Facet::Property { .. } => FacetKind::Property,
            Facet::Material { .. } => FacetKind::Material,
            Facet::PartOf { .. } => FacetKind::PartOf,
        }
    }
    pub fn meta(&self) -> &FacetMeta {
        match self {
            Facet::Entity { meta, .. }
            | Facet::Attribute { meta, .. }
            | Facet::Classification { meta, .. }
            | Facet::Property { meta, .. }
            | Facet::Material { meta, .. }
            | Facet::PartOf { meta, .. } => meta,
        }
    }
    /// One-line human requirement text used in findings.
    pub fn describe(&self) -> String {
        let prefix = match self.meta().cardinality {
            Cardinality::Required => "",
            Cardinality::Optional => "optional: ",
            Cardinality::Prohibited => "prohibited: ",
        };
        let body = match self {
            Facet::Entity { name, predefined_type, .. } => match predefined_type {
                Some(pt) => format!("entity {} with predefined type {}", name.describe(), pt.describe()),
                None => format!("entity {}", name.describe()),
            },
            Facet::Attribute { name, value, .. } => match value {
                Some(v) => format!("attribute {} = {}", name.describe(), v.describe()),
                None => format!("attribute {}", name.describe()),
            },
            Facet::Classification { system, value, .. } => {
                let system = system.as_ref().map(|s| s.describe()).unwrap_or_else(|| "any".into());
                match value {
                    Some(v) => format!("classification {system} = {}", v.describe()),
                    None => format!("classification {system}"),
                }
            }
            Facet::Property { property_set, base_name, value, data_type, .. } => {
                let mut text = format!("{}.{}", property_set.describe(), base_name.describe());
                if let Some(dt) = data_type {
                    text.push_str(&format!(" [{dt}]"));
                }
                if let Some(v) = value {
                    text.push_str(&format!(" = {}", v.describe()));
                }
                text
            }
            Facet::Material { value, .. } => match value {
                Some(v) => format!("material {}", v.describe()),
                None => "material (any)".to_owned(),
            },
            Facet::PartOf { entity_name, relation, .. } => match relation {
                Some(rel) => format!("part of {} via {rel}", entity_name.describe()),
                None => format!("part of {}", entity_name.describe()),
            },
        };
        format!("{prefix}{body}")
    }

    /// The facet reduced to its "does this information exist at all" form, used for
    /// `optional` cardinality. The reduction differs per facet because the manuals differ:
    /// a property keeps its set/name identity (an optional property is still *that*
    /// property), while a classification or material only has to exist at all.
    fn carrier_only(&self) -> Facet {
        match self.clone() {
            Facet::Entity { name, meta, .. } => {
                Facet::Entity { name, predefined_type: None, meta }
            }
            Facet::Attribute { name, meta, .. } => Facet::Attribute { name, value: None, meta },
            Facet::Classification { meta, .. } => {
                Facet::Classification { system: None, value: None, meta }
            }
            Facet::Property { property_set, base_name, meta, .. } => {
                Facet::Property { property_set, base_name, value: None, data_type: None, meta }
            }
            Facet::Material { meta, .. } => Facet::Material { value: None, meta },
            other => other,
        }
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
    /// IDS treats an applicability without `minOccurs` as **required**: at least one
    /// matching entity must exist. Authors opt out with `minOccurs="0"`.
    fn default() -> Self {
        Occurs { min: 1, max: None }
    }
}

impl Occurs {
    /// `minOccurs=0 maxOccurs=0` means the applicable set must be empty and requirements
    /// are ignored, per the IDS cardinality table.
    fn is_prohibited(&self) -> bool {
        self.min == 0 && self.max == Some(0)
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

impl Specification {
    /// Stable key used to build finding keys and to compare runs.
    pub fn key(&self) -> &str {
        self.identifier.as_deref().unwrap_or(self.name.as_str())
    }
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
        let root = xml::parse(xml)?;
        if root.name != "ids" {
            return Err(IdsError::NotIds);
        }
        let info = root.child("info").map(parse_info).unwrap_or_default();
        let mut specifications = Vec::new();
        if let Some(specs) = root.child("specifications") {
            for (index, node) in specs.children_named("specification").enumerate() {
                specifications.push(parse_specification(node, index)?);
            }
        }
        Ok(Ids { info, specifications })
    }
}

fn parse_info(node: &xml::Node) -> IdsInfo {
    let text = |name: &str| node.child(name).and_then(|c| c.trimmed_text()).map(str::to_owned);
    IdsInfo {
        title: text("title").unwrap_or_else(|| "Untitled IDS".to_owned()),
        copyright: text("copyright"),
        version: text("version"),
        description: text("description"),
        author: text("author"),
        date: text("date"),
        purpose: text("purpose"),
        milestone: text("milestone"),
    }
}

fn parse_specification(node: &xml::Node, index: usize) -> Result<Specification, IdsError> {
    let name = node.attr("name").unwrap_or("Unnamed specification").to_owned();
    let ifc_versions = node
        .attr("ifcversion")
        .map(|raw| raw.split_whitespace().map(|t| t.to_ascii_uppercase()).collect())
        .unwrap_or_default();

    let applicability_node = node.child("applicability");
    let occurs = applicability_node.map(parse_occurs).unwrap_or_default();
    let applicability = applicability_node
        .map(|n| parse_facets(n, Cardinality::Required))
        .unwrap_or_default();
    let requirements = node
        .child("requirements")
        .map(|n| parse_facets(n, Cardinality::Required))
        .unwrap_or_default();

    if applicability.is_empty() && requirements.is_empty() {
        return Err(IdsError::Specification {
            index,
            message: "specification has neither applicability nor requirements".into(),
        });
    }

    Ok(Specification {
        identifier: node.attr("identifier").map(str::to_owned),
        name,
        description: node.child("description").and_then(|c| c.trimmed_text()).map(str::to_owned),
        instructions: node.attr("instructions").map(str::to_owned),
        ifc_versions,
        applicability,
        applicability_occurs: occurs,
        requirements,
    })
}

fn parse_occurs(node: &xml::Node) -> Occurs {
    let min = node.attr("minoccurs").and_then(|v| v.parse::<u32>().ok()).unwrap_or(1);
    let max = match node.attr("maxoccurs") {
        None => None,
        Some(raw) if raw.eq_ignore_ascii_case("unbounded") => None,
        Some(raw) => raw.parse::<u32>().ok(),
    };
    Occurs { min, max }
}

fn parse_facets(parent: &xml::Node, default_cardinality: Cardinality) -> Vec<Facet> {
    let mut facets = Vec::new();
    for node in &parent.children {
        let meta = FacetMeta {
            cardinality: match node.attr("cardinality") {
                Some(raw) if raw.eq_ignore_ascii_case("optional") => Cardinality::Optional,
                Some(raw) if raw.eq_ignore_ascii_case("prohibited") => Cardinality::Prohibited,
                _ => default_cardinality,
            },
            instructions: node.attr("instructions").map(str::to_owned),
            uri: node.attr("uri").map(str::to_owned),
        };
        let facet = match node.name.as_str() {
            "entity" => Some(Facet::Entity {
                name: constraint_of(node, "name")
                    .unwrap_or(ValueConstraint::Unsupported("entity name missing".into())),
                predefined_type: constraint_of(node, "predefinedtype"),
                meta,
            }),
            "attribute" => Some(Facet::Attribute {
                name: constraint_of(node, "name")
                    .unwrap_or(ValueConstraint::Unsupported("attribute name missing".into())),
                value: constraint_of(node, "value"),
                meta,
            }),
            "classification" => Some(Facet::Classification {
                system: constraint_of(node, "system"),
                value: constraint_of(node, "value"),
                meta,
            }),
            "property" => Some(Facet::Property {
                property_set: constraint_of(node, "propertyset")
                    .unwrap_or(ValueConstraint::Unsupported("propertySet missing".into())),
                base_name: constraint_of(node, "basename")
                    .unwrap_or(ValueConstraint::Unsupported("baseName missing".into())),
                value: constraint_of(node, "value"),
                data_type: node.attr("datatype").map(|v| v.to_ascii_uppercase()),
                meta,
            }),
            "material" => Some(Facet::Material { value: constraint_of(node, "value"), meta }),
            "partof" => {
                let entity = node.child("entity");
                Some(Facet::PartOf {
                    entity_name: entity
                        .and_then(|e| constraint_of(e, "name"))
                        .unwrap_or(ValueConstraint::Unsupported("partOf entity missing".into())),
                    entity_predefined_type: entity
                        .and_then(|e| constraint_of(e, "predefinedtype")),
                    relation: node.attr("relation").map(|v| v.to_ascii_uppercase()),
                    meta,
                })
            }
            _ => None,
        };
        if let Some(facet) = facet {
            facets.push(facet);
        }
    }
    facets
}

/// Read a facet parameter (`<name>`, `<value>`, ...) into a `ValueConstraint`.
fn constraint_of(parent: &xml::Node, parameter: &str) -> Option<ValueConstraint> {
    // Some IDS files in the official corpus omit the parameter wrapper and put the value
    // straight under the facet, e.g. `<entity><simpleValue>IFCWALL</simpleValue></entity>`.
    let node = match parent.child(parameter) {
        Some(node) => node,
        None if parameter == "name" => parent,
        None => return None,
    };
    if let Some(simple) = node.child("simplevalue") {
        return Some(ValueConstraint::Simple(simple.trimmed_text().unwrap_or_default().to_owned()));
    }
    if let Some(restriction) = node.child("restriction") {
        return Some(parse_restriction(restriction));
    }
    // Some tools inline the value as element text.
    node.trimmed_text().map(|text| ValueConstraint::Simple(text.to_owned()))
}

fn parse_restriction(node: &xml::Node) -> ValueConstraint {
    let mut enumeration: Vec<String> = Vec::new();
    let mut patterns: Vec<String> = Vec::new();
    let mut min_inclusive = None;
    let mut max_inclusive = None;
    let mut min_exclusive = None;
    let mut max_exclusive = None;
    let mut patterns = patterns;
    let mut exact_length = None;
    let mut min_length = None;
    let mut max_length = None;
    let mut unsupported: Option<String> = None;

    for child in &node.children {
        let value = child.attr("value").map(str::to_owned);
        match child.name.as_str() {
            "enumeration" => {
                if let Some(v) = value {
                    enumeration.push(v);
                }
            }
            // Several <xs:pattern> elements in one restriction are alternatives.
            "pattern" => {
                if let Some(v) = value {
                    patterns.push(v);
                }
            }
            "mininclusive" => min_inclusive = value.as_deref().and_then(parse_number),
            "maxinclusive" => max_inclusive = value.as_deref().and_then(parse_number),
            "minexclusive" => min_exclusive = value.as_deref().and_then(parse_number),
            "maxexclusive" => max_exclusive = value.as_deref().and_then(parse_number),
            "length" => exact_length = value.as_deref().and_then(|v| v.parse().ok()),
            "minlength" => min_length = value.as_deref().and_then(|v| v.parse().ok()),
            "maxlength" => max_length = value.as_deref().and_then(|v| v.parse().ok()),
            "annotation" | "documentation" | "whitespace" => {}
            other => unsupported = Some(other.to_owned()),
        }
    }

    if let Some(name) = unsupported {
        return ValueConstraint::Unsupported(name);
    }
    match patterns.len() {
        0 => {}
        1 => return ValueConstraint::Pattern(patterns.remove(0)),
        _ => {
            let joined =
                patterns.iter().map(|p| format!("(?:{p})")).collect::<Vec<_>>().join("|");
            return ValueConstraint::Pattern(joined);
        }
    }
    if !enumeration.is_empty() {
        return ValueConstraint::Enumeration(enumeration);
    }
    if min_inclusive.is_some()
        || max_inclusive.is_some()
        || min_exclusive.is_some()
        || max_exclusive.is_some()
    {
        return ValueConstraint::Bounds { min_inclusive, max_inclusive, min_exclusive, max_exclusive };
    }
    if exact_length.is_some() || min_length.is_some() || max_length.is_some() {
        return ValueConstraint::Length { exact: exact_length, min: min_length, max: max_length };
    }
    ValueConstraint::Unsupported("empty restriction".to_owned())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
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

/// Per-object verdict for a single facet.
#[derive(Debug, Clone)]
enum Verdict {
    Pass,
    Fail { expected: Option<String>, actual: Option<String> },
    Incomplete { reason: String },
}

impl Verdict {
    fn fail(expected: impl Into<String>, actual: impl Into<String>) -> Verdict {
        Verdict::Fail { expected: Some(expected.into()), actual: Some(actual.into()) }
    }
    fn incomplete(reason: impl Into<String>) -> Verdict {
        Verdict::Incomplete { reason: reason.into() }
    }
    fn as_bool(&self) -> Option<bool> {
        match self {
            Verdict::Pass => Some(true),
            Verdict::Fail { .. } => Some(false),
            Verdict::Incomplete { .. } => None,
        }
    }
}

/// Evaluate every specification against one model.
pub fn evaluate(model: &IfcModel, ids: &Ids) -> Report {
    let mut specs = Vec::with_capacity(ids.specifications.len());
    let mut total_pass = 0;
    let mut total_fail = 0;
    let mut total_not_applicable = 0;
    let mut total_incomplete = 0;

    for spec in &ids.specifications {
        let result = evaluate_specification(model, spec);
        total_pass += result.pass_count;
        total_fail += result.fail_count;
        total_incomplete += result.incomplete_count;
        if result.outcome == Outcome::NotApplicable {
            total_not_applicable += 1;
        }
        specs.push(result);
    }

    Report {
        engine_version: ENGINE_VERSION.to_owned(),
        ids_title: ids.info.title.clone(),
        schema: model.schema().label(),
        specs,
        total_pass,
        total_fail,
        total_not_applicable,
        total_incomplete,
    }
}

/// Evaluate against several models as one federated delivery. Express ids are only
/// unique per model, so callers pass `(model_key, model)` and receive per-model outcomes
/// tagged with `model_key` in `ObjectOutcome::global_id` resolution order.
pub fn evaluate_federated(models: &[(String, &IfcModel)], ids: &Ids) -> Vec<(String, Report)> {
    models.iter().map(|(key, model)| (key.clone(), evaluate(model, ids))).collect()
}

/// Instances a specification could apply to.
///
/// IDS applicability spans the whole model, not just placed products, so the default is
/// every instance. When the applicability pins an exact IFC class, the class index is used
/// instead — same result, but it keeps a 44k-instance model a linear scan per class rather
/// than per specification.
fn candidate_ids(model: &IfcModel, spec: &Specification) -> Vec<u32> {
    for facet in &spec.applicability {
        if let Facet::Entity { name: ValueConstraint::Simple(class), .. } = facet {
            return model.ids_of_type(class).to_vec();
        }
    }
    model.all_ids()
}

fn evaluate_specification(model: &IfcModel, spec: &Specification) -> SpecResult {
    let mut notes: Vec<String> = Vec::new();
    let mut result = SpecResult {
        identifier: spec.identifier.clone(),
        name: spec.name.clone(),
        description: spec.description.clone(),
        instructions: spec.instructions.clone(),
        outcome: Outcome::NotApplicable,
        applicable_count: 0,
        pass_count: 0,
        fail_count: 0,
        incomplete_count: 0,
        passed: Vec::new(),
        outcomes: Vec::new(),
        notes: Vec::new(),
    };

    // `ifcVersion` is authoring metadata, not an evaluation gate: the official corpus
    // checks IFC2X3-declared specifications against IFC4 models and still expects a
    // verdict. The mismatch is recorded so a reviewer can see it, but it never turns a
    // real result into "not applicable" — that would hide failures behind a version tag.
    if !spec.ifc_versions.is_empty()
        && !spec.ifc_versions.iter().any(|v| model.schema().matches_ids_version(v))
    {
        notes.push(format!(
            "specification declares {} but the model is {}; evaluated anyway",
            spec.ifc_versions.join("/"),
            model.schema().label()
        ));
    }

    let mut undecidable_applicability = 0u32;
    let mut applicable: Vec<u32> = Vec::new();
    for id in candidate_ids(model, spec) {
        let mut matched = true;
        let mut undecidable = false;
        for facet in &spec.applicability {
            match facet_holds(model, id, facet).as_bool() {
                Some(true) => {}
                Some(false) => {
                    matched = false;
                    break;
                }
                None => {
                    undecidable = true;
                    break;
                }
            }
        }
        if undecidable {
            undecidable_applicability += 1;
        } else if matched {
            applicable.push(id);
        }
    }
    if undecidable_applicability > 0 {
        notes.push(format!(
            "{undecidable_applicability} object(s) could not be tested against the applicability filter"
        ));
    }
    result.applicable_count = applicable.len() as u32;

    // `minOccurs=0 maxOccurs=0`: the applicable set must be empty; requirements ignored.
    if spec.applicability_occurs.is_prohibited() {
        if applicable.is_empty() {
            result.outcome = Outcome::Pass;
            result.pass_count = 0;
        } else {
            result.outcome = Outcome::Fail;
            result.fail_count = applicable.len() as u32;
            notes.push(format!(
                "{} object(s) matched an applicability that is prohibited (minOccurs=0, maxOccurs=0)",
                applicable.len()
            ));
            for id in &applicable {
                result.outcomes.push(object_outcome(
                    model,
                    *id,
                    spec.applicability.first().map(Facet::kind).unwrap_or(FacetKind::Entity),
                    "must not exist in the model".to_owned(),
                    Some("no matching object".to_owned()),
                    Some("object matches the prohibited applicability".to_owned()),
                    None,
                ));
            }
        }
        result.notes = notes;
        return result;
    }

    if applicable.is_empty() {
        if spec.applicability_occurs.min > 0 {
            result.outcome = Outcome::Fail;
            result.fail_count = 1;
            notes.push(format!(
                "no object matched the applicability, but at least {} was required",
                spec.applicability_occurs.min
            ));
        } else if undecidable_applicability > 0 {
            result.outcome = Outcome::ReviewIncomplete;
            result.incomplete_count = undecidable_applicability;
        } else {
            result.outcome = Outcome::NotApplicable;
        }
        result.notes = notes;
        return result;
    }

    if let Some(max) = spec.applicability_occurs.max {
        if result.applicable_count > max {
            notes.push(format!(
                "{} objects matched the applicability, but at most {max} was allowed",
                result.applicable_count
            ));
            result.fail_count += 1;
        }
    }
    if result.applicable_count < spec.applicability_occurs.min {
        notes.push(format!(
            "{} objects matched the applicability, but at least {} was required",
            result.applicable_count, spec.applicability_occurs.min
        ));
        result.fail_count += 1;
    }

    for id in applicable {
        let mut object_failed = false;
        let mut object_incomplete = false;
        for facet in &spec.requirements {
            match facet_requirement(model, id, facet) {
                Verdict::Pass => {}
                Verdict::Fail { expected, actual } => {
                    object_failed = true;
                    result.outcomes.push(object_outcome(
                        model,
                        id,
                        facet.kind(),
                        facet.describe(),
                        expected,
                        actual,
                        None,
                    ));
                }
                Verdict::Incomplete { reason } => {
                    object_incomplete = true;
                    result.outcomes.push(object_outcome(
                        model,
                        id,
                        facet.kind(),
                        facet.describe(),
                        None,
                        None,
                        Some(reason),
                    ));
                }
            }
        }
        if object_failed {
            result.fail_count += 1;
        } else if object_incomplete {
            result.incomplete_count += 1;
        } else {
            result.pass_count += 1;
            result.passed.push(id);
        }
    }

    result.outcome = if result.fail_count > 0 {
        Outcome::Fail
    } else if result.incomplete_count > 0 {
        Outcome::ReviewIncomplete
    } else {
        Outcome::Pass
    };
    result.notes = notes;
    result
}

fn object_outcome(
    model: &IfcModel,
    id: u32,
    facet: FacetKind,
    requirement: String,
    expected: Option<String>,
    actual: Option<String>,
    incomplete_reason: Option<String>,
) -> ObjectOutcome {
    ObjectOutcome {
        express_id: id,
        global_id: model.global_id(id).map(str::to_owned),
        ifc_type: model.entity(id).map(|e| e.ty.clone()).unwrap_or_else(|| "UNKNOWN".to_owned()),
        name: model.name(id).map(str::to_owned),
        storey: model.storey_of(id).and_then(|s| model.name(s)).map(str::to_owned),
        facet,
        requirement,
        expected,
        actual,
        incomplete_reason,
    }
}

/// Apply requirement cardinality on top of the plain "does this facet hold" test.
fn facet_requirement(model: &IfcModel, id: u32, facet: &Facet) -> Verdict {
    match facet.meta().cardinality {
        Cardinality::Required => facet_holds(model, id, facet),
        Cardinality::Prohibited => match facet_holds(model, id, facet) {
            Verdict::Pass => Verdict::fail("must not be present", "present"),
            Verdict::Fail { .. } => Verdict::Pass,
            other => other,
        },
        Cardinality::Optional => {
            let exists = match facet {
                // An attribute that exists but is empty still has to comply, so existence
                // here means "the attribute slot is readable", not "it has a value".
                Facet::Attribute { name, .. } => attribute_exists(model, id, name),
                other => facet_holds(model, id, &other.carrier_only()).as_bool(),
            };
            match exists {
                // Absent information is allowed; present information must comply.
                Some(false) => Verdict::Pass,
                Some(true) => facet_holds(model, id, facet),
                None => Verdict::incomplete("cannot determine whether the information exists"),
            }
        }
    }
}

fn facet_holds(model: &IfcModel, id: u32, facet: &Facet) -> Verdict {
    match facet {
        Facet::Entity { name, predefined_type, .. } => entity_facet(model, id, name, predefined_type),
        Facet::Attribute { name, value, .. } => attribute_facet(model, id, name, value),
        Facet::Classification { system, value, .. } => classification_facet(model, id, system, value),
        Facet::Property { property_set, base_name, value, data_type, .. } => {
            property_facet(model, id, property_set, base_name, value, data_type.as_deref())
        }
        Facet::Material { value, .. } => material_facet(model, id, value),
        Facet::PartOf { entity_name, entity_predefined_type, relation, .. } => {
            part_of_facet(model, id, entity_name, entity_predefined_type, relation.as_deref())
        }
    }
}

fn entity_facet(
    model: &IfcModel,
    id: u32,
    name: &ValueConstraint,
    predefined_type: &Option<ValueConstraint>,
) -> Verdict {
    if !name.is_supported() {
        return Verdict::incomplete(name.describe());
    }
    let Some(entity) = model.entity(id) else {
        return Verdict::incomplete("object is not present in the model");
    };
    // IDS entity matching is exact: subtypes never match a supertype name.
    match name.matches(&entity.ty, None) {
        Some(true) => {}
        Some(false) => return Verdict::fail(name.describe(), entity.ty.clone()),
        None => return Verdict::incomplete(name.describe()),
    }
    if let Some(constraint) = predefined_type {
        if !constraint.is_supported() {
            return Verdict::incomplete(constraint.describe());
        }
        match model.predefined_type(id) {
            Some(actual) => match constraint.matches(&actual, parse_number(&actual)) {
                Some(true) => {}
                Some(false) => return Verdict::fail(constraint.describe(), actual),
                None => return Verdict::incomplete(constraint.describe()),
            },
            None => return Verdict::fail(constraint.describe(), "(no predefined type)"),
        }
    }
    Verdict::Pass
}

/// An attribute counts as populated only when it carries real content: empty strings,
/// empty aggregates, `$` and logical unknown all fail, per the IDS test cases.
fn attribute_is_populated(value: &Value) -> bool {
    match value.unwrap_typed() {
        Value::Null | Value::Omitted | Value::Logical(None) => false,
        Value::Str(text) => !text.is_empty(),
        Value::List(items) => !items.is_empty() && items.iter().any(attribute_is_populated),
        _ => true,
    }
}

/// Fallback attribute names for classes outside the reader's schema tables.
const READABLE_ATTRIBUTES: [&str; 9] = [
    "GlobalId",
    "OwnerHistory",
    "Name",
    "Description",
    "ObjectType",
    "ObjectPlacement",
    "Representation",
    "Tag",
    "PredefinedType",
];

/// Attribute names a name restriction can match on this instance: the real schema
/// attribute list when the class is known, otherwise the small set of positions that are
/// uniform across the IFC hierarchy.
fn candidate_attribute_names(model: &IfcModel, id: u32, name: &ValueConstraint) -> Vec<String> {
    let pool: Vec<&str> = match model.attribute_names(id) {
        Some(names) => names.to_vec(),
        None => READABLE_ATTRIBUTES.to_vec(),
    };
    pool.into_iter()
        .filter(|candidate| name.matches(candidate, None).unwrap_or(false))
        .map(|candidate| candidate.to_owned())
        .collect()
}

fn attribute_facet(
    model: &IfcModel,
    id: u32,
    name: &ValueConstraint,
    value: &Option<ValueConstraint>,
) -> Verdict {
    let names: Vec<String> = match name {
        ValueConstraint::Simple(text) => vec![text.clone()],
        ValueConstraint::Enumeration(values) => values.clone(),
        ValueConstraint::Pattern(_) | ValueConstraint::Length { .. } => {
            candidate_attribute_names(model, id, name)
        }
        other => return Verdict::incomplete(other.describe()),
    };
    if names.is_empty() {
        return Verdict::incomplete(format!(
            "no attribute this engine can read matches {}",
            name.describe()
        ));
    }

    // A name restriction is satisfied by any matching attribute, so keep the best verdict
    // and only report a failure when nothing matched.
    let mut best_failure: Option<Verdict> = None;
    let mut incomplete: Option<Verdict> = None;
    for attribute_name in names {
        match single_attribute(model, id, &attribute_name, value) {
            Verdict::Pass => return Verdict::Pass,
            failure @ Verdict::Fail { .. } => {
                best_failure = best_failure.or(Some(failure));
            }
            pending @ Verdict::Incomplete { .. } => {
                incomplete = incomplete.or(Some(pending));
            }
        }
    }
    best_failure.or(incomplete).unwrap_or(Verdict::Pass)
}

fn single_attribute(
    model: &IfcModel,
    id: u32,
    attribute_name: &str,
    value: &Option<ValueConstraint>,
) -> Verdict {
    let AttributeLookup::Found(found) = model.attribute(id, attribute_name) else {
        let ty = model.entity(id).map(|e| e.ty.as_str()).unwrap_or("UNKNOWN");
        return Verdict::incomplete(format!(
            "attribute `{attribute_name}` cannot be read on {ty} by this engine"
        ));
    };
    if !attribute_is_populated(found) {
        return Verdict::fail(
            format!("attribute {attribute_name} populated"),
            describe_value(found),
        );
    }
    let Some(constraint) = value else { return Verdict::Pass };
    if !constraint.is_supported() {
        return Verdict::incomplete(constraint.describe());
    }
    let Some(text) = found.to_ids_string() else {
        // Aggregates and logical unknown are never comparable scalars.
        return Verdict::fail(constraint.describe(), describe_value(found));
    };
    match constraint.matches(&text, found.as_f64()) {
        Some(true) => Verdict::Pass,
        Some(false) => Verdict::fail(constraint.describe(), text),
        None => Verdict::incomplete(constraint.describe()),
    }
}

/// Existence test for `optional` attribute requirements: the attribute must be readable,
/// but an empty value still counts as "present" and therefore still has to comply.
fn attribute_exists(model: &IfcModel, id: u32, name: &ValueConstraint) -> Option<bool> {
    let names: Vec<String> = match name {
        ValueConstraint::Simple(text) => vec![text.clone()],
        ValueConstraint::Enumeration(values) => values.clone(),
        _ => candidate_attribute_names(model, id, name),
    };
    if names.is_empty() {
        return None;
    }
    let mut unreadable = 0usize;
    for attribute_name in &names {
        match model.attribute(id, attribute_name) {
            // An unset attribute (`$`) counts as absent, so an optional requirement is
            // satisfied. An empty string is present-but-wrong and must still be judged.
            AttributeLookup::Found(value) if !value.unwrap_typed().is_null() => {
                return Some(true)
            }
            AttributeLookup::Found(_) => {}
            AttributeLookup::Unsupported => unreadable += 1,
        }
    }
    if unreadable == names.len() {
        None
    } else {
        Some(false)
    }
}

fn describe_value(value: &Value) -> String {
    match value.unwrap_typed() {
        Value::Null | Value::Omitted => "(unset)".to_owned(),
        Value::Logical(None) => "(unknown)".to_owned(),
        Value::Str(text) if text.is_empty() => "(empty string)".to_owned(),
        Value::List(items) if items.is_empty() => "(empty list)".to_owned(),
        Value::List(_) => "(list)".to_owned(),
        other => other.to_ids_string().unwrap_or_else(|| "(unreadable)".to_owned()),
    }
}

fn classification_facet(
    model: &IfcModel,
    id: u32,
    system: &Option<ValueConstraint>,
    value: &Option<ValueConstraint>,
) -> Verdict {
    let refs = model.classifications(id);
    if refs.is_empty() {
        return Verdict::fail(
            system.as_ref().map(|s| s.describe()).unwrap_or_else(|| "any classification".into()),
            "(no classification)",
        );
    }
    for constraint in [system, value].into_iter().flatten() {
        if !constraint.is_supported() {
            return Verdict::incomplete(constraint.describe());
        }
    }
    let mut actual_systems: Vec<String> = Vec::new();
    let mut actual_values: Vec<String> = Vec::new();
    let mut undecidable: Option<String> = None;

    for reference in refs {
        let system_text = reference.system.clone().unwrap_or_default();
        actual_systems.push(system_text.clone());
        if let Some(constraint) = system {
            match constraint.matches(&system_text, parse_number(&system_text)) {
                Some(true) => {}
                Some(false) => continue,
                None => {
                    undecidable = Some(constraint.describe());
                    continue;
                }
            }
        }
        // The reference code is the identification; fall back to the human name.
        let candidates: Vec<String> = [reference.identification.clone(), reference.name.clone()]
            .into_iter()
            .flatten()
            .collect();
        actual_values.extend(candidates.iter().cloned());
        match value {
            None => return Verdict::Pass,
            Some(constraint) => {
                for candidate in &candidates {
                    match constraint.matches(candidate, parse_number(candidate)) {
                        Some(true) => return Verdict::Pass,
                        // Classification codes are hierarchical: requiring `EF_25_10`
                        // is satisfied by the sub-reference `EF_25_10_25`.
                        Some(false) => {
                            if let ValueConstraint::Simple(expected) = constraint {
                                if !expected.is_empty() && candidate.starts_with(expected.as_str())
                                {
                                    return Verdict::Pass;
                                }
                            }
                        }
                        None => undecidable = Some(constraint.describe()),
                    }
                }
            }
        }
    }
    if let Some(reason) = undecidable {
        return Verdict::incomplete(reason);
    }
    let expected = match (system, value) {
        (Some(s), Some(v)) => format!("{} = {}", s.describe(), v.describe()),
        (Some(s), None) => s.describe(),
        (None, Some(v)) => v.describe(),
        (None, None) => "any classification".to_owned(),
    };
    let actual = if value.is_some() && !actual_values.is_empty() {
        actual_values.join(", ")
    } else {
        actual_systems.join(", ")
    };
    Verdict::fail(expected, actual)
}

fn material_facet(model: &IfcModel, id: u32, value: &Option<ValueConstraint>) -> Verdict {
    let materials = model.materials(id);
    if materials.is_empty() {
        let expected = value
            .as_ref()
            .map(|v| v.describe())
            .unwrap_or_else(|| "any associated material".to_owned());
        return Verdict::fail(expected, "(no material)");
    }
    let Some(constraint) = value else { return Verdict::Pass };
    if !constraint.is_supported() {
        return Verdict::incomplete(constraint.describe());
    }
    let mut undecidable = false;
    let mut actual: Vec<String> = Vec::new();
    for material in materials {
        // Name or category satisfies the facet, per the material facet manual.
        for candidate in [Some(material.name.clone()), material.category.clone()]
            .into_iter()
            .flatten()
        {
            actual.push(candidate.clone());
            match constraint.matches(&candidate, parse_number(&candidate)) {
                Some(true) => return Verdict::Pass,
                Some(false) => {}
                None => undecidable = true,
            }
        }
    }
    if undecidable {
        return Verdict::incomplete(constraint.describe());
    }
    Verdict::fail(constraint.describe(), actual.join(", "))
}

/// Relations this engine can navigate for the `partOf` facet.
const PART_OF_RELATIONS: [&str; 6] = [
    "IFCRELAGGREGATES",
    "IFCRELASSIGNSTOGROUP",
    "IFCRELCONTAINEDINSPATIALSTRUCTURE",
    "IFCRELNESTS",
    "IFCRELVOIDSELEMENT",
    "IFCRELFILLSELEMENT",
];

fn part_of_facet(
    model: &IfcModel,
    id: u32,
    entity_name: &ValueConstraint,
    entity_predefined_type: &Option<ValueConstraint>,
    relation: Option<&str>,
) -> Verdict {
    if !entity_name.is_supported() {
        return Verdict::incomplete(entity_name.describe());
    }
    if let Some(rel) = relation {
        if !PART_OF_RELATIONS.contains(&rel) {
            return Verdict::incomplete(format!("relation `{rel}` is not supported"));
        }
    }
    let wholes = part_of_candidates(model, id, relation);
    let mut actual: Vec<String> = Vec::new();
    for whole in &wholes {
        let Some(entity) = model.entity(*whole) else { continue };
        actual.push(entity.ty.clone());
        match entity_name.matches(&entity.ty, None) {
            Some(true) => {}
            Some(false) => continue,
            None => return Verdict::incomplete(entity_name.describe()),
        }
        match entity_predefined_type {
            None => return Verdict::Pass,
            Some(constraint) => match model.predefined_type(*whole) {
                Some(pt) => match constraint.matches(&pt, parse_number(&pt)) {
                    Some(true) => return Verdict::Pass,
                    Some(false) => continue,
                    None => return Verdict::incomplete(constraint.describe()),
                },
                None => continue,
            },
        }
    }
    let actual = if actual.is_empty() { "(not part of anything)".to_owned() } else { actual.join(", ") };
    Verdict::fail(entity_name.describe(), actual)
}

/// Recursive set of "wholes" an object belongs to, following relationship direction.
///
/// Direction is what makes this useful: a wall is not "part of" the opening that voids it,
/// and a storey is not part of the beam it contains. When no relation is given, all six
/// supported relationships are traversed, as the partOf manual requires.
fn part_of_candidates(model: &IfcModel, id: u32, relation: Option<&str>) -> Vec<u32> {
    let relations: Vec<&str> = match relation {
        Some(name) => vec![name],
        None => PART_OF_RELATIONS.to_vec(),
    };
    let mut out: Vec<u32> = Vec::new();
    let mut frontier = vec![id];
    let mut seen: Vec<u32> = vec![id];
    // Bounded traversal: a malformed export can contain a cyclic decomposition.
    for _ in 0..32 {
        let mut next: Vec<u32> = Vec::new();
        for current in frontier.drain(..) {
            for name in &relations {
                for whole in model.wholes_via(current, name) {
                    if seen.contains(&whole) {
                        continue;
                    }
                    seen.push(whole);
                    out.push(whole);
                    next.push(whole);
                }
            }
        }
        if next.is_empty() {
            break;
        }
        frontier = next;
    }
    out.sort_unstable();
    out.dedup();
    out
}

/// SI conversion factor for a measure type given the project length unit.
fn measure_scale(data_type: Option<&str>, length_to_metre: f64) -> f64 {
    match data_type {
        Some("IFCLENGTHMEASURE")
        | Some("IFCPOSITIVELENGTHMEASURE")
        | Some("IFCNONNEGATIVELENGTHMEASURE") => length_to_metre,
        Some("IFCAREAMEASURE") => length_to_metre * length_to_metre,
        Some("IFCVOLUMEMEASURE") => length_to_metre * length_to_metre * length_to_metre,
        _ => 1.0,
    }
}

/// Comparable scalars carried by one IFC property, already unit-normalised.
struct PropertyValues {
    texts: Vec<String>,
    numbers: Vec<Option<f64>>,
    /// Data type of each value, when the IFC file wrapped it (`IFCLABEL('x')`).
    types: Vec<Option<String>>,
    /// `(lower, upper)` for `IfcPropertyBoundedValue`.
    bounds: Option<(Option<f64>, Option<f64>)>,
    populated: bool,
}

fn property_values(model: &IfcModel, prop: &ifc_model::Prop) -> PropertyValues {
    let scale = measure_scale(prop.data_type.as_deref(), model.length_to_metre());
    let mut texts = Vec::new();
    let mut numbers = Vec::new();
    let mut types: Vec<Option<String>> = Vec::new();
    let mut bounds = None;

    fn push(
        value: &Value,
        scale: f64,
        texts: &mut Vec<String>,
        numbers: &mut Vec<Option<f64>>,
        types: &mut Vec<Option<String>>,
    ) {
        if value.unwrap_typed().is_null() {
            return;
        }
        let number = value.as_f64().map(|v| v * scale);
        let text = match number {
            // Re-render numerics after unit conversion so string and numeric comparison
            // can never disagree.
            Some(n) => format!("{n}"),
            None => match value.to_ids_string() {
                Some(text) => text,
                None => return,
            },
        };
        texts.push(text);
        numbers.push(number);
        types.push(value.typed_name().map(str::to_owned));
    }

    match prop.kind {
        PropKind::BoundedValue => {
            // The reader packs bounded values as [upper, lower, setpoint].
            let items = prop.value.as_list().unwrap_or_default();
            let upper = items.first().and_then(Value::as_f64).map(|v| v * scale);
            let lower = items.get(1).and_then(Value::as_f64).map(|v| v * scale);
            bounds = Some((lower, upper));
            for item in items {
                push(item, scale, &mut texts, &mut numbers, &mut types);
            }
        }
        PropKind::EnumeratedValue | PropKind::ListValue | PropKind::TableValue => {
            match prop.value.as_list() {
                Some(items) => {
                    for item in items {
                        push(item, scale, &mut texts, &mut numbers, &mut types);
                    }
                }
                None => push(&prop.value, scale, &mut texts, &mut numbers, &mut types),
            }
        }
        _ => push(&prop.value, scale, &mut texts, &mut numbers, &mut types),
    }

    let populated = texts.iter().any(|t| !t.is_empty());
    PropertyValues { texts, numbers, types, bounds, populated }
}

/// Does one property satisfy the requested value constraint?
///
/// Per the property-facet manual: a single IDS value matches when *any* of the IFC values
/// matches, while a bounds restriction must hold for *all* of them. A bounded IFC property
/// is judged on its bounds, and an open bound can never prove containment in a range.
fn property_value_matches(constraint: &ValueConstraint, values: &PropertyValues) -> Option<bool> {
    if let Some((lower, upper)) = values.bounds {
        return bounded_matches(constraint, lower, upper);
    }
    if values.texts.is_empty() {
        return Some(false);
    }
    let all_must_match = matches!(constraint, ValueConstraint::Bounds { .. });
    let mut any = false;
    let mut all = true;
    let mut undecidable = false;
    for (text, number) in values.texts.iter().zip(values.numbers.iter()) {
        match constraint.matches(text, *number) {
            Some(true) => any = true,
            Some(false) => all = false,
            None => undecidable = true,
        }
    }
    if undecidable {
        return None;
    }
    Some(if all_must_match { all } else { any })
}

fn property_facet(
    model: &IfcModel,
    id: u32,
    property_set: &ValueConstraint,
    base_name: &ValueConstraint,
    value: &Option<ValueConstraint>,
    data_type: Option<&str>,
) -> Verdict {
    for constraint in [Some(property_set), Some(base_name), value.as_ref()].into_iter().flatten() {
        if !constraint.is_supported() {
            return Verdict::incomplete(constraint.describe());
        }
    }

    let properties = model.properties(id);
    let mut matched: Vec<(&ifc_model::PropertySet, &ifc_model::Prop)> = Vec::new();
    let mut undecidable: Option<String> = None;
    for (set, prop) in properties.iter() {
        match property_set.matches(&set.name, None) {
            Some(true) => {}
            Some(false) => continue,
            None => {
                undecidable = Some(property_set.describe());
                continue;
            }
        }
        match base_name.matches(&prop.name, None) {
            Some(true) => matched.push((set, prop)),
            Some(false) => continue,
            None => undecidable = Some(base_name.describe()),
        }
    }
    if let Some(reason) = undecidable {
        return Verdict::incomplete(reason);
    }
    if matched.is_empty() {
        return Verdict::fail(
            format!("{}.{}", property_set.describe(), base_name.describe()),
            "(missing)",
        );
    }
    // An occurrence value overrides the inherited type value; judging both would fail an
    // object for data it has legitimately overridden.
    if matched.iter().any(|(set, _)| set.source == ifc_model::Provenance::Own) {
        matched.retain(|(set, _)| set.source == ifc_model::Provenance::Own);
    }

    // IDS explicitly excludes complex properties, so a requirement on one is a definite
    // fail rather than an undecidable case.
    if matched.iter().all(|(_, prop)| prop.kind == PropKind::Unsupported) {
        return Verdict::fail(
            format!("{}.{} as a simple property", property_set.describe(), base_name.describe()),
            "(complex or unsupported property value)",
        );
    }

    let extracted: Vec<(String, PropertyValues)> = matched
        .iter()
        .map(|(_, prop)| (prop.name.clone(), property_values(model, prop)))
        .collect();

    if let Some(expected_type) = data_type {
        // A wrapped value's own type wins; `Prop::data_type` is the fallback for shapes
        // that carry a single measure (quantities).
        let mut actual_types: Vec<String> = Vec::new();
        let mut type_ok = false;
        for ((_, prop), (_, values)) in matched.iter().zip(extracted.iter()) {
            let mut candidates: Vec<String> = values.types.iter().flatten().cloned().collect();
            if let Some(declared) = prop.data_type.clone() {
                candidates.push(declared);
            }
            if candidates.iter().any(|t| t.eq_ignore_ascii_case(expected_type)) {
                type_ok = true;
            }
            actual_types.extend(candidates);
        }
        if !type_ok {
            actual_types.sort();
            actual_types.dedup();
            return Verdict::fail(
                format!("data type {expected_type}"),
                if actual_types.is_empty() {
                    "(unknown data type)".to_owned()
                } else {
                    actual_types.join(", ")
                },
            );
        }
    }

    if !extracted.iter().any(|(_, values)| values.populated) {
        return Verdict::fail(
            format!("{}.{} populated", property_set.describe(), base_name.describe()),
            "(empty)",
        );
    }

    let Some(constraint) = value else { return Verdict::Pass };

    // Every matching property must satisfy the requirement — a compliant value elsewhere
    // in the model does not excuse a non-compliant one.
    let mut actual: Vec<String> = Vec::new();
    let mut undecidable = false;
    let mut failed = false;
    for (_, values) in &extracted {
        actual.extend(values.texts.iter().cloned());
        match property_value_matches(constraint, values) {
            Some(true) => {}
            Some(false) => failed = true,
            None => undecidable = true,
        }
    }
    if failed {
        return Verdict::fail(constraint.describe(), actual.join(", "));
    }
    if undecidable {
        return Verdict::incomplete(constraint.describe());
    }
    Verdict::Pass
}

/// A bounded IFC property satisfies a constraint only when both of its bounds are known
/// and inside the requested range — an open bound could always fall outside it.
fn bounded_matches(
    constraint: &ValueConstraint,
    lower: Option<f64>,
    upper: Option<f64>,
) -> Option<bool> {
    if lower.is_none() && upper.is_none() {
        return Some(false);
    }
    match constraint {
        // A range requirement needs both IFC bounds inside it: an open bound could always
        // fall outside.
        ValueConstraint::Bounds { .. } => match (lower, upper) {
            (Some(low), Some(high)) => {
                let low_ok = constraint.matches(&format!("{low}"), Some(low))?;
                let high_ok = constraint.matches(&format!("{high}"), Some(high))?;
                Some(low_ok && high_ok)
            }
            _ => Some(false),
        },
        // A plain value is satisfied when the property's range contains it.
        other => {
            let target = match other {
                ValueConstraint::Simple(text) => parse_number(text),
                _ => None,
            };
            match target {
                Some(value) => {
                    let above = lower.map(|low| value >= low || numbers_equal(low, value));
                    let below = upper.map(|high| value <= high || numbers_equal(high, value));
                    Some(above.unwrap_or(true) && below.unwrap_or(true))
                }
                // Non-numeric requirement against a bounded property: compare the bounds
                // as written.
                None => {
                    for bound in [lower, upper].into_iter().flatten() {
                        if other.matches(&format!("{bound}"), Some(bound))? {
                            return Some(true);
                        }
                    }
                    Some(false)
                }
            }
        }
    }
}
