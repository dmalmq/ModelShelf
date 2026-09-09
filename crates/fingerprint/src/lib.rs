//! `fingerprint` — deterministic content fingerprints for revision comparison.
//!
//! Identity vs state, the rule this crate exists to enforce:
//! - Persistent identity comes from `(source model slot, IfcGlobalId)`. Fingerprints
//!   NEVER establish identity.
//! - Fingerprints answer "did the information / placement / representation change".
//!
//! The shape fingerprint is a **normalised representation-graph hash**, not a proof of
//! geometric equivalence: two exporters can describe the same solid differently and get
//! different shape fingerprints. Documented limitation, not a bug.
//!
//! PUBLIC API IS A CROSS-CRATE CONTRACT: signatures below MUST NOT change.
//!
//! Versioned normalized fingerprints live in [`normalized`]: the pure module over
//! the worker's authoritative `SemanticObject` + `GeometryChunk` records and an
//! explicit [`normalized::FingerprintProfile`]. The `IfcModel` API below is the
//! legacy representation-graph path and stays until its callers migrate.

pub mod normalized;

use std::collections::HashSet;

use ifc_model::{IfcModel, PropKind, Provenance, Value};

/// Normalisation tolerances. Values are rounded to these quanta before hashing.
// Not `Copy`: `ignored_property_sets` is owned data.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FpOptions {
    /// Length quantum in metres (default 1e-4 = 0.1 mm).
    pub length_quantum_m: f64,
    /// Direction-cosine quantum (default 1e-6).
    pub angle_quantum: f64,
    /// Relative quantum for unitless numeric property values (default 1e-9).
    pub numeric_quantum: f64,
    /// Property sets excluded from the property fingerprint (export noise), matched
    /// case-insensitively, e.g. `["Pset_Revit_Identity"]`.
    pub ignored_property_sets: Vec<String>,
}

impl Default for FpOptions {
    fn default() -> Self {
        FpOptions {
            length_quantum_m: 1e-4,
            angle_quantum: 1e-6,
            numeric_quantum: 1e-9,
            ignored_property_sets: Vec::new(),
        }
    }
}

/// Hex blake3 digests, 32 hex chars (128-bit prefix) — enough for change detection and
/// short enough to display.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Fingerprints {
    pub properties: String,
    pub placement: String,
    pub shape: String,
    pub combined: String,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PropSnapshot {
    pub pset: String,
    pub name: String,
    /// Canonical string form after unit normalisation and rounding.
    pub value: String,
    pub data_type: Option<String>,
    pub unit: Option<String>,
    /// SI-normalised numeric value when the property is numeric.
    pub numeric: Option<f64>,
    /// True when inherited from the type object.
    pub inherited: bool,
}

/// Everything the shelf stores per object, per model revision.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ObjectSnapshot {
    pub express_id: u32,
    pub global_id: Option<String>,
    pub ifc_type: String,
    pub name: Option<String>,
    pub predefined_type: Option<String>,
    pub storey: Option<String>,
    /// Row-major 3x4 absolute placement in metres.
    pub placement: Option<[f64; 12]>,
    pub fingerprints: Fingerprints,
    pub properties: Vec<PropSnapshot>,
}

/// Token used when an object has no placement at all, so that "unknown placement" and
/// "placed at the project origin" can never collide.
const NO_PLACEMENT: &str = "no-placement";
/// Token used when an object carries no shape representation.
const NO_SHAPE: &str = "no-shape";
/// Depth cap for the representation walk. Deeper graphs hash a marker instead of
/// recursing, which is reported through the canonical text so it stays visible.
const MAX_SHAPE_DEPTH: u32 = 64;

const UNIT_SEPARATOR: char = '\u{1f}';

/// IFC measure types whose values are expressed in the project length unit.
fn is_length_measure(data_type: Option<&str>) -> bool {
    matches!(
        data_type,
        Some("IFCLENGTHMEASURE")
            | Some("IFCPOSITIVELENGTHMEASURE")
            | Some("IFCNONNEGATIVELENGTHMEASURE")
    )
}

/// Round `value` to a quantum, mapping `-0.0` to `0.0` so signs never flip a hash.
pub fn quantize(value: f64, quantum: f64) -> f64 {
    if !value.is_finite() || !(quantum > 0.0) {
        return value;
    }
    let scaled = value / quantum;
    // Round half away from zero: `f64::round` already does this, and it keeps the
    // behaviour symmetric around zero so mirrored geometry quantizes consistently.
    let rounded = scaled.round() * quantum;
    if rounded == 0.0 {
        0.0
    } else {
        rounded
    }
}

/// Stable text for a quantized number, including non-finite values that a broken export
/// can produce. Without this, `NaN != NaN` would make a fingerprint unstable.
fn number_token(value: f64, quantum: f64) -> String {
    if value.is_nan() {
        return "nan".to_owned();
    }
    if value.is_infinite() {
        return if value.is_sign_positive() { "inf".to_owned() } else { "-inf".to_owned() };
    }
    format!("{}", quantize(value, quantum))
}

/// blake3 of `text`, first 32 hex chars.
pub fn hash_text(text: &str) -> String {
    let digest = blake3::hash(text.as_bytes());
    digest.to_hex()[..32].to_owned()
}

/// Canonical normalised text that feeds the property hash. Exposed so the UI can explain
/// *why* a fingerprint changed and so tests can assert normalisation directly.
pub fn canonical_property_text(model: &IfcModel, express_id: u32, opts: &FpOptions) -> String {
    let mut lines: Vec<String> = property_snapshots(model, express_id, opts)
        .into_iter()
        .map(|p| {
            format!(
                "{}{sep}{}{sep}{}{sep}{}{sep}{}",
                p.pset,
                p.name,
                p.data_type.unwrap_or_default(),
                p.value,
                if p.inherited { "type" } else { "own" },
                sep = UNIT_SEPARATOR
            )
        })
        .collect();
    lines.sort();
    lines.join("\n")
}

/// Property rows for one object, normalised and sorted by `(pset, name)`.
///
/// Occurrence rows and inherited type rows are both kept and tagged, so a value that
/// moved from the type to the occurrence is a visible change rather than a silent no-op.
fn property_snapshots(model: &IfcModel, express_id: u32, opts: &FpOptions) -> Vec<PropSnapshot> {
    let ignored: Vec<String> =
        opts.ignored_property_sets.iter().map(|s| s.to_ascii_lowercase()).collect();
    let mut rows: Vec<PropSnapshot> = Vec::new();
    for (set, prop) in model.properties(express_id).iter() {
        if ignored.contains(&set.name.to_ascii_lowercase()) {
            continue;
        }
        let data_type = prop.data_type.as_deref();
        let numeric = prop.value.as_f64().map(|raw| {
            let si = if is_length_measure(data_type) || prop.kind == PropKind::Quantity {
                raw * model.length_to_metre()
            } else {
                raw
            };
            let quantum = if is_length_measure(data_type) || prop.kind == PropKind::Quantity {
                opts.length_quantum_m
            } else {
                opts.numeric_quantum
            };
            quantize(si, quantum)
        });
        let value = match numeric {
            // `n` is already quantized; quantum 0 means "format, do not round again".
            Some(n) => number_token(n, 0.0),
            None => prop
                .value
                .to_ids_string()
                .unwrap_or_else(|| canonical_non_scalar(&prop.value)),
        };
        rows.push(PropSnapshot {
            pset: set.name.clone(),
            name: prop.name.clone(),
            value,
            data_type: prop.data_type.clone(),
            unit: prop.unit.clone(),
            numeric,
            inherited: set.source == Provenance::Type,
        });
    }
    rows.sort_by(|a, b| {
        (&a.pset, &a.name, a.inherited).cmp(&(&b.pset, &b.name, b.inherited))
    });
    rows
}

/// Values IDS treats as non-scalar still have to hash stably, so give each shape a token.
fn canonical_non_scalar(value: &Value) -> String {
    match value.unwrap_typed() {
        Value::Null | Value::Omitted => "(unset)".to_owned(),
        Value::Logical(None) => "(unknown)".to_owned(),
        Value::List(items) => {
            let parts: Vec<String> = items
                .iter()
                .map(|item| item.to_ids_string().unwrap_or_else(|| canonical_non_scalar(item)))
                .collect();
            format!("[{}]", parts.join(","))
        }
        Value::Ref(id) => format!("(ref:{id})"),
        other => other.to_ids_string().unwrap_or_else(|| "(unrepresentable)".to_owned()),
    }
}

fn canonical_placement_text(model: &IfcModel, express_id: u32, opts: &FpOptions) -> String {
    let Some(transform) = model.placement(express_id) else {
        return NO_PLACEMENT.to_owned();
    };
    let origin: Vec<String> = transform
        .origin
        .iter()
        .map(|v| number_token(*v, opts.length_quantum_m))
        .collect();
    let axes: Vec<String> = [transform.x_axis, transform.y_axis, transform.z_axis]
        .iter()
        .flat_map(|axis| axis.iter().map(|v| number_token(*v, opts.angle_quantum)))
        .collect();
    format!("o({}) r({})", origin.join(","), axes.join(","))
}

/// EXPRESS `SET` attributes whose emission order carries no meaning. Sorting their
/// canonical text stops an exporter reshuffle from looking like a geometry change.
fn is_unordered_attribute(ty: &str, index: usize) -> bool {
    matches!(
        (ty, index),
        ("IFCPRODUCTDEFINITIONSHAPE", 2)
            | ("IFCPRODUCTREPRESENTATION", 2)
            | ("IFCSHAPEREPRESENTATION", 3)
            | ("IFCREPRESENTATION", 3)
            | ("IFCCLOSEDSHELL", 0)
            | ("IFCOPENSHELL", 0)
            | ("IFCCONNECTEDFACESET", 0)
            | ("IFCFACE", 0)
            | ("IFCGEOMETRICSET", 0)
            | ("IFCGEOMETRICCURVESET", 0)
            | ("IFCFACEBASEDSURFACEMODEL", 0)
            | ("IFCSHELLBASEDSURFACEMODEL", 0)
    )
}

/// Canonical normalised text that feeds the shape hash.
pub fn canonical_shape_text(model: &IfcModel, express_id: u32, opts: &FpOptions) -> String {
    let Some(shape) = model.shape_representation(express_id) else {
        return NO_SHAPE.to_owned();
    };
    let mut visiting: HashSet<u32> = HashSet::new();
    entity_text(model, shape, opts, 0, &mut visiting)
}

fn entity_text(
    model: &IfcModel,
    id: u32,
    opts: &FpOptions,
    depth: u32,
    visiting: &mut HashSet<u32>,
) -> String {
    if depth > MAX_SHAPE_DEPTH {
        return "depth-limit".to_owned();
    }
    let Some(entity) = model.entity(id) else {
        return format!("missing:{id}");
    };
    if !visiting.insert(id) {
        return format!("cycle:{id}");
    }
    let mut parts: Vec<String> = Vec::with_capacity(entity.attrs.len());
    for (index, attr) in entity.attrs.iter().enumerate() {
        let text = value_text(model, &entity.ty, index, attr, opts, depth, visiting);
        parts.push(text);
    }
    visiting.remove(&id);
    format!("{}({})", entity.ty, parts.join(","))
}

fn value_text(
    model: &IfcModel,
    parent_ty: &str,
    index: usize,
    value: &Value,
    opts: &FpOptions,
    depth: u32,
    visiting: &mut HashSet<u32>,
) -> String {
    match value {
        Value::Null => "$".to_owned(),
        Value::Omitted => "*".to_owned(),
        Value::Ref(target) => entity_text(model, *target, opts, depth + 1, visiting),
        Value::Int(i) => i.to_string(),
        Value::Real(r) => {
            // Direction ratios are unitless; every other real in a representation graph is
            // a coordinate or a length in project units.
            if parent_ty == "IFCDIRECTION" {
                number_token(*r, opts.numeric_quantum)
            } else {
                number_token(*r * model.length_to_metre(), opts.length_quantum_m)
            }
        }
        Value::Str(s) => format!("'{s}'"),
        Value::Enum(e) => format!(".{e}."),
        Value::Bool(b) => b.to_string(),
        Value::Logical(None) => "unknown".to_owned(),
        Value::Logical(Some(b)) => b.to_string(),
        Value::List(items) => {
            let mut parts: Vec<String> = items
                .iter()
                .map(|item| value_text(model, parent_ty, index, item, opts, depth, visiting))
                .collect();
            if is_unordered_attribute(parent_ty, index) {
                parts.sort();
            }
            format!("({})", parts.join(","))
        }
        Value::Typed { name, value } => {
            format!(
                "{name}[{}]",
                value_text(model, parent_ty, index, value, opts, depth, visiting)
            )
        }
    }
}

/// Fingerprint one product occurrence.
pub fn fingerprint_object(model: &IfcModel, express_id: u32, opts: &FpOptions) -> Fingerprints {
    let properties = hash_text(&canonical_property_text(model, express_id, opts));
    let placement = hash_text(&canonical_placement_text(model, express_id, opts));
    let shape = hash_text(&canonical_shape_text(model, express_id, opts));
    let combined = hash_text(&format!(
        "{properties}{UNIT_SEPARATOR}{placement}{UNIT_SEPARATOR}{shape}"
    ));
    Fingerprints { properties, placement, shape, combined }
}

/// Snapshot every product occurrence in the model, ascending express id.
pub fn snapshot_model(model: &IfcModel, opts: &FpOptions) -> Vec<ObjectSnapshot> {
    model
        .products()
        .iter()
        .copied()
        .map(|id| {
            let entity_type = model
                .entity(id)
                .map(|e| e.ty.clone())
                .unwrap_or_else(|| "UNKNOWN".to_owned());
            ObjectSnapshot {
                express_id: id,
                global_id: model.global_id(id).map(str::to_owned),
                ifc_type: entity_type,
                name: model.name(id).map(str::to_owned),
                predefined_type: model.predefined_type(id),
                storey: model.storey_of(id).and_then(|s| model.name(s)).map(str::to_owned),
                placement: model.placement(id).map(|t| t.to_array12()),
                fingerprints: fingerprint_object(model, id, opts),
                properties: property_snapshots(model, id, opts),
            }
        })
        .collect()
}
