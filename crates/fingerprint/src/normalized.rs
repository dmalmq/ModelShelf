//! Normalized fingerprints, Direction A (candidate implementation, arena bakeoff).
//!
//! Pure functions over the worker's authoritative normalized records
//! (`model_contracts::SemanticObject` + optional `model_contracts::GeometryChunk`)
//! plus a versioned [`FingerprintProfile`]. No `ifc-model`, parser, HTTP, DB, or
//! async imports anywhere in this module.
//!
//! Direction A decisions (see `DESIGN.md`, alternatives in `RATIONALE.md`):
//! - `profile_id` = full BLAKE3 hex of the canonical profile JSON.
//! - Shape canonicalization quantizes vertices, builds one token per triangle
//!   (within-triangle vertex order preserved, winding is significant), sorts the
//!   triangle tokens lexicographically, and joins them.
//! - Properties prefer `siValue` for `length`/`area`/`volume` dimensions, each
//!   with its own quantum (`length_quantum_m`, `area_quantum_m2`,
//!   `volume_quantum_m3`).
//!
//! # Quantization boundary honesty
//!
//! Rounding is half away from zero (`f64::round`), so a value sitting exactly on
//! a half-quantum boundary snaps away from zero, and exporter noise straddling
//! any boundary flips the hash. That is inherent to quantization, not a defect:
//! quanta must stay comfortably larger than exporter noise. Non-finite inputs
//! (`NaN`, `+/-Inf`) hash to fixed tokens (`nan`, `inf`, `-inf`) so a broken
//! export still fingerprints stably instead of poisoning every comparison
//! (`NaN != NaN`).

use model_contracts::{
    GeometryChunk, GeometryChunkStatus, PropertyOrigin, PropertyValueDimension, PropertyValueValue,
    SemanticObject,
};

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

/// Which normalized-profile version produced a fingerprint set.
///
/// The profile travels with every [`DerivedSnapshot`] as [`DerivedSnapshot::profile_id`].
/// A consumer comparing two snapshots whose profile ids differ MUST treat them as
/// incomparable (see [`fingerprint_with_expected_profile`]) — never silently
/// overwrite stored history with a differently-profiled recompute.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FingerprintProfile {
    /// e.g. `"fp-v1"`. Bump when any canonicalization rule changes.
    pub profile_version: String,
    /// Normalized-record producer, e.g. `"inspect-v2"`.
    pub extraction: String,
    /// Hash algorithm label, e.g. `"blake3-256"`. Informational: the code always
    /// hashes with BLAKE3-256; the label pins that choice into the profile id.
    pub algorithm: String,
    /// Units policy, e.g. `"si-metre"`: dimensional values arrive SI-normalized.
    pub units_policy: String,
    /// Must be `false` for object-local geometry (matches the worker's
    /// `use-world-coords: false`). Part of the profile so a future world-coords
    /// mode can never collide with object-local hashes.
    pub use_world_coords: bool,
    /// Length quantum in metres (default 1e-4 = 0.1 mm).
    pub length_quantum_m: f64,
    /// Area quantum in m^2 (default 1e-8 = length_quantum^2).
    pub area_quantum_m2: f64,
    /// Volume quantum in m^3 (default 1e-12 = length_quantum^3).
    pub volume_quantum_m3: f64,
    /// Direction-cosine quantum for placement rotation entries (default 1e-6).
    pub angle_quantum: f64,
    /// Absolute quantum for unitless numeric property values (default 1e-9).
    pub numeric_quantum: f64,
    /// Property sets excluded from the property fingerprint (export noise),
    /// matched case-insensitively, e.g. `["Pset_Revit_Identity"]`.
    pub ignored_property_sets: Vec<String>,
}

impl FingerprintProfile {
    /// The current production profile. Alias of `default_fp_v1`.
    pub fn v1() -> Self {
        Self::default_fp_v1()
    }

    /// The initial profile every caller should use unless it has a reason not to.
    pub fn default_fp_v1() -> Self {
        FingerprintProfile {
            profile_version: "fp-v1".to_owned(),
            extraction: "inspect-v2".to_owned(),
            algorithm: "blake3-256".to_owned(),
            units_policy: "si-metre".to_owned(),
            use_world_coords: false,
            length_quantum_m: 1e-4,
            area_quantum_m2: 1e-8,
            volume_quantum_m3: 1e-12,
            angle_quantum: 1e-6,
            numeric_quantum: 1e-9,
            ignored_property_sets: Vec::new(),
        }
    }

    /// Canonical profile JSON. Hand-formatted with fixed key order and
    /// shortest-round-trip float rendering so the text — and therefore the
    /// [`FingerprintProfile::profile_id`] — is byte-stable across platforms and
    /// JSON libraries. Ignored psets are lowercased and sorted so set order and
    /// case never fork the profile identity.
    pub fn canonical_json(&self) -> String {
        let mut ignored: Vec<String> =
            self.ignored_property_sets.iter().map(|s| s.to_lowercase()).collect();
        ignored.sort();
        let ignored_json = ignored
            .iter()
            .map(|s| format!("\"{}\"", json_escape(s)))
            .collect::<Vec<_>>()
            .join(",");
        format!(
            "{{\"algorithm\":\"{alg}\",\"angleQuantum\":{aq},\"areaQuantumM2\":{arq},\"extraction\":\"{ext}\",\"ignoredPropertySets\":[{ign}],\"lengthQuantumM\":{lq},\"numericQuantum\":{nq},\"profileVersion\":\"{pv}\",\"unitsPolicy\":\"{up}\",\"useWorldCoords\":{uwc},\"volumeQuantumM3\":{vrq}}}",
            alg = json_escape(&self.algorithm),
            aq = fmt_float(self.angle_quantum),
            arq = fmt_float(self.area_quantum_m2),
            ext = json_escape(&self.extraction),
            ign = ignored_json,
            lq = fmt_float(self.length_quantum_m),
            nq = fmt_float(self.numeric_quantum),
            pv = json_escape(&self.profile_version),
            up = json_escape(&self.units_policy),
            uwc = if self.use_world_coords { "true" } else { "false" },
            vrq = fmt_float(self.volume_quantum_m3),
        )
    }

    /// Full 64-char lowercase BLAKE3 hex of [`FingerprintProfile::canonical_json`].
    pub fn profile_id(&self) -> String {
        hash_text(&self.canonical_json())
    }

    /// True when `pset` is ignored under this profile (case-insensitive).
    pub fn ignores_pset(&self, pset: &str) -> bool {
        self.ignored_property_sets.iter().any(|i| i.eq_ignore_ascii_case(pset))
    }
}

fn json_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

/// Shortest-round-trip float rendering (`Display`), with `-0.0` normalized to
/// `0` and non-finite values spelled out so the canonical text stays stable.
fn fmt_float(v: f64) -> String {
    if v.is_nan() {
        return "null".to_owned(); // a profile quantum must be finite; spell, don't crash
    }
    if v.is_infinite() {
        return if v.is_sign_positive() { "1e999" } else { "-1e999" }.to_owned();
    }
    if v == 0.0 {
        return "0".to_owned();
    }
    format!("{}", v)
}

// ---------------------------------------------------------------------------
// Snapshot types
// ---------------------------------------------------------------------------

/// Four full 64-char lowercase BLAKE3 hex digests plus their binding digest.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Fingerprints {
    pub properties: String,
    pub placement: String,
    pub shape: String,
    /// `BLAKE3(properties_fp + placement_fp + shape_fp + profile_id)`.
    /// Binds the components to the profile that produced them.
    pub combined: String,
}

/// Everything the shelf stores per object, per model revision.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DerivedSnapshot {
    /// Opaque `ObjectRef.objectId`. Native `expressId`/`globalId` are provenance
    /// only and never enter any hash (see `canonical_*_text`).
    pub object_id: String,
    /// Human-readable profile version (for example `fp-v1`). Greppable in
    /// storage and logs. Compared by equality.
    pub profile_version: String,
    /// Machine identity of the profile. Compared by equality. Any rule or
    /// quantum change forks this digest.
    pub profile_id: String,
    pub fingerprints: Fingerprints,
    /// Canonical texts are stored for explainability (why did it change?).
    pub canonical_properties: String,
    pub canonical_placement: String,
    pub canonical_shape: String,
}

/// Returned by [`fingerprint_with_expected_profile`] when the caller's profile
/// does not match the stored one. The caller must re-extract under the stored
/// profile or version-migrate explicitly — never overwrite history in place.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProfileMismatch {
    pub expected: String,
    pub actual: String,
}

impl std::fmt::Display for ProfileMismatch {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "fingerprint profile mismatch: stored {} but computed {}",
            self.expected, self.actual
        )
    }
}

impl std::error::Error for ProfileMismatch {}

// ---------------------------------------------------------------------------
// Hashing / quantization primitives
// ---------------------------------------------------------------------------

/// BLAKE3 of `text`, full 64 lowercase hex chars. Never truncated.
pub fn hash_text(text: &str) -> String {
    blake3::hash(text.as_bytes()).to_hex().to_string()
}

/// Round `value` to `quantum`, mapping `-0.0` to `0.0` so signs never flip a hash.
///
/// - Non-finite inputs and non-positive quanta pass through untouched (the
///   caller renders them via [`number_token`]).
/// - Ties round half away from zero (`f64::round`), symmetric around zero so
///   mirrored geometry quantizes consistently. Pinned by test
///   `quantization_half_quantum_tie_goes_away_from_zero`.
pub fn quantize(value: f64, quantum: f64) -> f64 {
    if !value.is_finite() || !(quantum > 0.0) {
        return value;
    }
    let rounded = (value / quantum).round() * quantum;
    if rounded == 0.0 { 0.0 } else { rounded }
}

/// Stable text for a number: quantized rendering, with fixed tokens for
/// non-finite values so `NaN` fingerprints stably (`nan`) instead of poisoning
/// the hash, and `+/-Inf` as `inf` / `-inf`.
fn number_token(value: f64, quantum: f64) -> String {
    if value.is_nan() {
        return "nan".to_owned();
    }
    if value.is_infinite() {
        return if value.is_sign_positive() { "inf".to_owned() } else { "-inf".to_owned() };
    }
    let q = quantize(value, quantum);
    if q == 0.0 {
        "0".to_owned()
    } else {
        format!("{}", q)
    }
}

const UNIT_SEPARATOR: char = '\u{1f}';
const VALUE_SEPARATOR: char = '\u{1e}';

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

/// Canonical normalized text feeding the property hash.
///
/// Rules:
/// - Ignored psets (case-insensitive) are dropped.
/// - For `length`/`area`/`volume` dimensions the worker-supplied `siValue`
///   (already SI metres/m^2/m^3) is quantized with the matching quantum and the
///   raw `value`/`originalUnit` are ignored entirely — so `1000 mm`, `1 m`, and
///   `1 m` from any project scale hash equal. `originalUnit` is honored by
///   *trusting* it (never re-applying a project scale), never hashed.
/// - A dimensional entry with no `siValue` falls back to its raw value.
/// - Dimensionless numbers quantize with `numeric_quantum`; strings are
///   length-prefixed (`str:<len>:<text>`) so separator bytes inside a value can
///   never forge a row; bools/null get tagged tokens so JSON `1` vs `"1"` vs
///   `true` never collide.
/// - `ordered=false` value lists are sorted; `ordered=true` lists keep author
///   order. Rows carry the `occurrence`/`type` origin tag, so a value moving
///   between type and occurrence changes the hash. Rows sort by
///   `(pset, name, origin)`; native ids never appear.
pub fn canonical_property_text(obj: &SemanticObject, profile: &FingerprintProfile) -> String {
    let mut rows: Vec<String> = Vec::with_capacity(obj.properties.len());
    for prop in &obj.properties {
        let pset: &str = &prop.pset;
        if profile.ignores_pset(pset) {
            continue;
        }
        let name: &str = &prop.name;
        let origin = match prop.origin {
            PropertyOrigin::Occurrence => "occurrence",
            PropertyOrigin::Type => "type",
        };
        let mut vals: Vec<String> =
            prop.values.iter().map(|v| property_value_token(v, profile)).collect();
        if !prop.ordered {
            vals.sort();
        }
        rows.push(format!(
            "{}{}{}{}{}{}{}",
            pset,
            UNIT_SEPARATOR,
            name,
            UNIT_SEPARATOR,
            origin,
            UNIT_SEPARATOR,
            vals.join(&VALUE_SEPARATOR.to_string())
        ));
    }
    rows.sort();
    rows.join("\n")
}

fn property_value_token(
    v: &model_contracts::PropertyValue,
    profile: &FingerprintProfile,
) -> String {
    if let (Some(dim), Some(si)) = (v.dimension, v.si_value) {
        let q = match dim {
            PropertyValueDimension::Length => profile.length_quantum_m,
            PropertyValueDimension::Area => profile.area_quantum_m2,
            PropertyValueDimension::Volume => profile.volume_quantum_m3,
        };
        let tag = match dim {
            PropertyValueDimension::Length => "len",
            PropertyValueDimension::Area => "area",
            PropertyValueDimension::Volume => "vol",
        };
        return format!("{}:{}", tag, number_token(si, q));
    }
    match &v.value {
        PropertyValueValue::Number(n) => format!("num:{}", number_token(*n, profile.numeric_quantum)),
        PropertyValueValue::String(s) => format!("str:{}:{}", s.chars().count(), s),
        PropertyValueValue::Boolean(b) => format!("bool:{}", b),
        PropertyValueValue::Null => "null".to_owned(),
    }
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

/// Token for a missing placement. Deliberately distinct from an origin-zero
/// matrix so "unknown placement" and "placed at the project origin" never collide.
pub const NO_PLACEMENT: &str = "no-placement";

/// Canonical normalized text feeding the placement hash.
///
/// The 3x4 row-major matrix is in metres. Translations (indices 3, 7, 11)
/// quantize with `length_quantum_m`; the nine rotation entries quantize with
/// `angle_quantum`, so a pure move and a pure rotation both land here (and only
/// here). `None` renders as [`NO_PLACEMENT`].
pub fn canonical_placement_text(obj: &SemanticObject, profile: &FingerprintProfile) -> String {
    match obj.placement {
        None => NO_PLACEMENT.to_owned(),
        Some(m) => {
            let toks: Vec<String> = m
                .iter()
                .enumerate()
                .map(|(i, v)| {
                    let is_translation = i == 3 || i == 7 || i == 11;
                    let q = if is_translation {
                        profile.length_quantum_m
                    } else {
                        profile.angle_quantum
                    };
                    number_token(*v, q)
                })
                .collect();
            toks.join(",")
        }
    }
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

/// No `GeometryChunk` was joined for this object (caller never supplied one).
pub const SHAPE_MISSING: &str = "shape-missing:no-chunk";
/// Chunk says the object legitimately has no geometry.
pub const SHAPE_ABSENT: &str = "shape-absent";

/// Stable preimage feeding the shape hash. Exporter reason strings embed
/// unstable text (exception messages, versions), so they never enter the hash.
/// Use `canonical_shape_text` for the display form carrying the reason.
pub fn shape_preimage(chunk: Option<&GeometryChunk>, profile: &FingerprintProfile) -> String {
    let chunk = match chunk {
        None => return SHAPE_MISSING.to_owned(),
        Some(c) => c,
    };
    match chunk.status {
        GeometryChunkStatus::Absent => SHAPE_ABSENT.to_owned(),
        GeometryChunkStatus::Unsupported => "shape-unsupported".to_owned(),
        GeometryChunkStatus::Available => shape_available_preimage(chunk, profile),
    }
}

fn shape_available_preimage(chunk: &GeometryChunk, profile: &FingerprintProfile) -> String {
    if chunk.vertices.len() % 3 != 0 {
        return "shape-corrupt:vertex-arity".to_owned();
    }
    if chunk.triangles.len() % 3 != 0 {
        return "shape-corrupt:index-arity".to_owned();
    }
    if chunk.triangles.is_empty() {
        return "shape-available:empty".to_owned();
    }
    let n_verts = chunk.vertices.len() / 3;
    let vertex_token = |vi: u64| -> Option<String> {
        let vi = vi as usize;
        if vi >= n_verts {
            return None;
        }
        let (x, y, z) =
            (chunk.vertices[vi * 3], chunk.vertices[vi * 3 + 1], chunk.vertices[vi * 3 + 2]);
        Some(format!(
            "{},{},{}",
            number_token(x, profile.length_quantum_m),
            number_token(y, profile.length_quantum_m),
            number_token(z, profile.length_quantum_m)
        ))
    };
    let mut tris: Vec<String> = Vec::with_capacity(chunk.triangles.len() / 3);
    for tri in chunk.triangles.chunks_exact(3) {
        match (vertex_token(tri[0]), vertex_token(tri[1]), vertex_token(tri[2])) {
            (Some(a), Some(b), Some(c)) => tris.push(format!("{}|{}|{}", a, b, c)),
            _ => return "shape-corrupt:index-range".to_owned(),
        }
    }
    tris.sort();
    format!("shape-available:\n{}", tris.join("\n"))
}

/// Display form of the shape state. Object-local triangles only
/// (`use_world_coords: false` is pinned in the profile). Within-triangle vertex
/// order is preserved (winding is significant). Triangle tokens sort
/// lexicographically so exporter emission order never looks like a geometry
/// change. Malformed payloads hash stable `shape-corrupt:*` markers instead of
/// panicking. `absent` / `unsupported` / missing-chunk each get their own token
/// so those states can never collide. Unsupported reasons are display-only.
/// They never enter the hash. See `shape_preimage`.
pub fn canonical_shape_text(
    chunk: Option<&GeometryChunk>,
    profile: &FingerprintProfile,
) -> String {
    let preimage = shape_preimage(chunk, profile);
    if preimage == "shape-unsupported" {
        if let Some(c) = chunk {
            if let Some(reason) = c.reason.as_ref() {
                if !reason.is_empty() {
                    return format!("shape-unsupported // reason: {}", reason);
                }
            }
        }
    }
    preimage
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/// Fingerprint one normalized object. Pure: no I/O, no globals.
pub fn fingerprint_normalized(
    obj: &SemanticObject,
    chunk: Option<&GeometryChunk>,
    profile: &FingerprintProfile,
) -> DerivedSnapshot {
    let canonical_properties = canonical_property_text(obj, profile);
    let canonical_placement = canonical_placement_text(obj, profile);
    let canonical_shape = canonical_shape_text(chunk, profile);
    let profile_id = profile.profile_id();
    let properties = hash_text(&canonical_properties);
    let placement = hash_text(&canonical_placement);
    let shape = hash_text(&shape_preimage(chunk, profile));
    let combined = hash_text(&format!(
        "{}\n{}\n{}\n{}",
        properties, placement, shape, profile_id
    ));
    DerivedSnapshot {
        object_id: obj.ref_.object_id.to_string(),
        profile_version: profile.profile_version.clone(),
        profile_id,
        fingerprints: Fingerprints { properties, placement, shape, combined },
        canonical_properties,
        canonical_placement,
        canonical_shape,
    }
}

/// Like `fingerprint_normalized`, but refuses to produce a snapshot when the
/// caller's profile id differs from the stored `expected_profile_id`.
/// History is append-only across profile changes: mismatch errors, never
/// overwrites.
pub fn fingerprint_with_expected_profile(
    obj: &SemanticObject,
    chunk: Option<&GeometryChunk>,
    profile: &FingerprintProfile,
    expected_profile_id: &str,
) -> Result<DerivedSnapshot, ProfileMismatch> {
    let actual = profile.profile_id();
    if actual != expected_profile_id {
        return Err(ProfileMismatch { expected: expected_profile_id.to_owned(), actual });
    }
    Ok(fingerprint_normalized(obj, chunk, profile))
}

/// Refuse to compare snapshots fingerprinted under different profiles.
pub fn require_same_profile(a: &DerivedSnapshot, b: &DerivedSnapshot) -> Result<(), ProfileMismatch> {
    if a.profile_id != b.profile_id {
        return Err(ProfileMismatch { expected: a.profile_id.clone(), actual: b.profile_id.clone() });
    }
    Ok(())
}

/// Refuse to trust a stored snapshot against a live profile it was not made with.
pub fn verify_profile(
    snapshot: &DerivedSnapshot,
    profile: &FingerprintProfile,
) -> Result<(), ProfileMismatch> {
    let actual = profile.profile_id();
    if snapshot.profile_id != actual {
        return Err(ProfileMismatch {
            expected: snapshot.profile_id.clone(),
            actual,
        });
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests — rubric criteria 2-6, fixtures built in code (no IFC, no services).
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use model_contracts::{ObjectRef, Property, PropertyValue};

    fn is_full_hex(s: &str) -> bool {
        s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
    }

    fn obj_ref(id: &str) -> ObjectRef {
        ObjectRef {
            object_id: id.parse().unwrap(),
            revision_id: "rev-1".parse().unwrap(),
        }
    }

    fn prop(
        pset: &str,
        name: &str,
        origin: PropertyOrigin,
        ordered: bool,
        values: Vec<PropertyValue>,
    ) -> Property {
        Property {
            name: name.parse().unwrap(),
            ordered,
            origin,
            pset: pset.parse().unwrap(),
            values,
        }
    }

    fn dim_val(
        dim: PropertyValueDimension,
        si: f64,
        raw: PropertyValueValue,
        unit: &str,
    ) -> PropertyValue {
        PropertyValue {
            dimension: Some(dim),
            original_unit: Some(unit.to_owned()),
            si_value: Some(si),
            value: raw,
        }
    }

    fn raw_val(raw: PropertyValueValue) -> PropertyValue {
        PropertyValue { dimension: None, original_unit: None, si_value: None, value: raw }
    }

    fn base_object() -> SemanticObject {
        SemanticObject {
            classification: "IfcWall".parse().unwrap(),
            name: Some("Wall-1".to_owned()),
            native_ids: None,
            placement: Some([1.0, 0.0, 0.0, 2.0, 0.0, 1.0, 0.0, 3.0, 0.0, 0.0, 1.0, 4.0]),
            properties: vec![
                prop(
                    "Pset_WallCommon",
                    "Length",
                    PropertyOrigin::Occurrence,
                    false,
                    vec![dim_val(
                        PropertyValueDimension::Length,
                        5.0,
                        PropertyValueValue::Number(5000.0),
                        "mm",
                    )],
                ),
                prop(
                    "Pset_WallCommon",
                    "FireRating",
                    PropertyOrigin::Type,
                    false,
                    vec![raw_val(PropertyValueValue::String("F60".to_owned()))],
                ),
            ],
            ref_: obj_ref("obj-1"),
            storey: Some("L01".to_owned()),
        }
    }

    fn base_chunk() -> GeometryChunk {
        GeometryChunk {
            instance_id: "inst-1".parse().unwrap(),
            reason: None,
            ref_: obj_ref("obj-1"),
            status: GeometryChunkStatus::Available,
            // Two triangles forming a quad in z=0.
            triangles: vec![0, 1, 2, 0, 2, 3],
            vertices: vec![
                0.0, 0.0, 0.0, //
                1.0, 0.0, 0.0, //
                1.0, 1.0, 0.0, //
                0.0, 1.0, 0.0,
            ],
        }
    }

    fn profile() -> FingerprintProfile {
        FingerprintProfile::default_fp_v1()
    }

    // -- Rubric 2: full digests, profile id persisted ------------------------

    #[test]
    fn all_fingerprints_and_profile_id_are_full_blake3_hex() {
        let snap = fingerprint_normalized(&base_object(), Some(&base_chunk()), &profile());
        assert!(is_full_hex(&snap.fingerprints.properties), "{}", snap.fingerprints.properties);
        assert!(is_full_hex(&snap.fingerprints.placement), "{}", snap.fingerprints.placement);
        assert!(is_full_hex(&snap.fingerprints.shape), "{}", snap.fingerprints.shape);
        assert!(is_full_hex(&snap.fingerprints.combined), "{}", snap.fingerprints.combined);
        assert!(is_full_hex(&snap.profile_id), "{}", snap.profile_id);
        assert_eq!(snap.profile_id, profile().profile_id());
        assert_eq!(snap.object_id, "obj-1");
        // A profile change forks the id AND the combined digest.
        let mut other = profile();
        other.length_quantum_m = 1e-3;
        assert_ne!(other.profile_id(), profile().profile_id());
        let snap2 = fingerprint_normalized(&base_object(), Some(&base_chunk()), &other);
        assert_ne!(snap2.fingerprints.combined, snap.fingerprints.combined);
    }

    #[test]
    fn profile_mismatch_errors_instead_of_overwriting() {
        let err = fingerprint_with_expected_profile(
            &base_object(),
            Some(&base_chunk()),
            &profile(),
            "deadbeef",
        )
        .unwrap_err();
        assert_eq!(err.expected, "deadbeef");
        assert_eq!(err.actual, profile().profile_id());
        assert!(fingerprint_with_expected_profile(
            &base_object(),
            Some(&base_chunk()),
            &profile(),
            &profile().profile_id(),
        )
        .is_ok());
    }

    // -- Rubric 3: unit equivalence ------------------------------------------

    #[test]
    fn metre_and_millimetre_lengths_hash_equal() {
        let mut a = base_object();
        let mut b = base_object();
        // Same SI value, different raw value + original unit (and no re-scaling).
        a.properties[0].values =
            vec![dim_val(PropertyValueDimension::Length, 2.5, PropertyValueValue::Number(2500.0), "mm")];
        b.properties[0].values =
            vec![dim_val(PropertyValueDimension::Length, 2.5, PropertyValueValue::Number(2.5), "m")];
        assert_eq!(
            canonical_property_text(&a, &profile()),
            canonical_property_text(&b, &profile())
        );
        assert_eq!(
            fingerprint_normalized(&a, None, &profile()).fingerprints.properties,
            fingerprint_normalized(&b, None, &profile()).fingerprints.properties
        );
    }

    #[test]
    fn area_and_volume_units_hash_equal() {
        let area_mm = dim_val(
            PropertyValueDimension::Area,
            3.0,
            PropertyValueValue::Number(3_000_000.0),
            "mm2",
        );
        let area_m =
            dim_val(PropertyValueDimension::Area, 3.0, PropertyValueValue::Number(3.0), "m2");
        let vol_mm = dim_val(
            PropertyValueDimension::Volume,
            4.0,
            PropertyValueValue::Number(4_000_000_000.0),
            "mm3",
        );
        let vol_m =
            dim_val(PropertyValueDimension::Volume, 4.0, PropertyValueValue::Number(4.0), "m3");
        let mut a = base_object();
        a.properties.push(prop("P", "A", PropertyOrigin::Occurrence, false, vec![area_mm]));
        a.properties.push(prop("P", "V", PropertyOrigin::Occurrence, false, vec![vol_mm]));
        let mut b = base_object();
        b.properties.push(prop("P", "A", PropertyOrigin::Occurrence, false, vec![area_m]));
        b.properties.push(prop("P", "V", PropertyOrigin::Occurrence, false, vec![vol_m]));
        assert_eq!(
            fingerprint_normalized(&a, None, &profile()).fingerprints.properties,
            fingerprint_normalized(&b, None, &profile()).fingerprints.properties
        );
    }

    #[test]
    fn distinct_area_volume_quanta_apply_per_dimension() {
        // 5e-9 differs only at length scale, not at area/volume scale... instead
        // pin that each dimension uses its own quantum: nudge siValue by half
        // the area quantum and confirm the area token does not move.
        let p = profile();
        assert_eq!(number_token(3.0, p.area_quantum_m2), number_token(3.0 + 0.4e-8, p.area_quantum_m2));
        assert_ne!(number_token(3.0, p.area_quantum_m2), number_token(3.0 + 0.6e-8, p.area_quantum_m2));
        assert_eq!(number_token(4.0, p.volume_quantum_m3), number_token(4.0 + 0.4e-12, p.volume_quantum_m3));
    }

    // -- Rubric 4: component isolation ---------------------------------------

    fn fps(obj: &SemanticObject, chunk: Option<&GeometryChunk>) -> Fingerprints {
        fingerprint_normalized(obj, chunk, &profile()).fingerprints
    }

    #[test]
    fn property_only_edit_moves_only_properties() {
        let base = fps(&base_object(), Some(&base_chunk()));
        let mut changed = base_object();
        changed.properties[1].values = vec![raw_val(PropertyValueValue::String("F90".to_owned()))];
        let next = fps(&changed, Some(&base_chunk()));
        assert_ne!(base.properties, next.properties);
        assert_eq!(base.placement, next.placement);
        assert_eq!(base.shape, next.shape);
    }

    #[test]
    fn move_only_edit_moves_only_placement() {
        let base = fps(&base_object(), Some(&base_chunk()));
        let mut moved = base_object();
        let mut m = moved.placement.unwrap();
        m[3] += 1.0; // +1 m in x
        moved.placement = Some(m);
        let next = fps(&moved, Some(&base_chunk()));
        assert_eq!(base.properties, next.properties);
        assert_ne!(base.placement, next.placement);
        assert_eq!(base.shape, next.shape);
    }

    #[test]
    fn rotation_only_edit_moves_only_placement() {
        let base = fps(&base_object(), Some(&base_chunk()));
        let mut rot = base_object();
        let mut m = rot.placement.unwrap();
        m[0] = 0.0; // 90-degree rotation about z, same translation
        m[1] = -1.0;
        m[4] = 1.0;
        m[5] = 0.0;
        rot.placement = Some(m);
        let next = fps(&rot, Some(&base_chunk()));
        assert_eq!(base.properties, next.properties);
        assert_ne!(base.placement, next.placement);
        assert_eq!(base.shape, next.shape);
    }

    #[test]
    fn shape_only_edit_moves_only_shape() {
        let base = fps(&base_object(), Some(&base_chunk()));
        let mut chunk = base_chunk();
        chunk.vertices[0] += 0.01; // 10 mm, well above the 0.1 mm quantum
        let next = fps(&base_object(), Some(&chunk));
        assert_eq!(base.properties, next.properties);
        assert_eq!(base.placement, next.placement);
        assert_ne!(base.shape, next.shape);
    }

    #[test]
    fn sub_quantum_edits_change_nothing() {
        let base = fps(&base_object(), Some(&base_chunk()));
        let mut tiny = base_object();
        let mut m = tiny.placement.unwrap();
        m[3] += 1e-6; // 1 um << 0.1 mm quantum
        tiny.placement = Some(m);
        let mut chunk = base_chunk();
        chunk.vertices[0] += 1e-6;
        let next = fps(&tiny, Some(&chunk));
        assert_eq!(base, next);
    }

    #[test]
    fn triangle_reorder_and_unordered_value_reorder_are_noops() {
        // Reverse triangle emission order.
        let mut chunk = base_chunk();
        chunk.triangles = vec![0, 2, 3, 0, 1, 2];
        // Reverse an unordered value list.
        let mut obj = base_object();
        obj.properties[0].values.push(dim_val(
            PropertyValueDimension::Length,
            6.0,
            PropertyValueValue::Number(6000.0),
            "mm",
        ));
        let mut obj2 = obj.clone();
        obj2.properties[0].values.reverse();
        let next = fps(&obj2, Some(&chunk));
        // Rebuild `base` with the same extra value so only ordering differs.
        let base2 = fps(&obj, Some(&base_chunk()));
        assert_eq!(base2, next);
    }

    #[test]
    fn ordered_value_reorder_changes_properties() {
        let mut a = base_object();
        a.properties.push(prop(
            "P",
            "Layers",
            PropertyOrigin::Occurrence,
            true,
            vec![
                raw_val(PropertyValueValue::String("a".to_owned())),
                raw_val(PropertyValueValue::String("b".to_owned())),
            ],
        ));
        let mut b = a.clone();
        b.properties[2].values.reverse();
        assert_ne!(
            fps(&a, None).properties,
            fps(&b, None).properties,
            "ordered=true must keep author order"
        );
    }

    #[test]
    fn occurrence_vs_type_origin_change_is_visible() {
        let a = base_object();
        let mut b = base_object();
        b.properties[1].origin = PropertyOrigin::Occurrence; // was Type
        assert_ne!(fps(&a, None).properties, fps(&b, None).properties);
    }

    #[test]
    fn ignored_psets_match_case_insensitively() {
        let mut p = profile();
        p.ignored_property_sets = vec!["pset_revit_identity".to_owned()];
        let mut a = base_object();
        a.properties.push(prop(
            "Pset_Revit_Identity",
            "Id",
            PropertyOrigin::Occurrence,
            false,
            vec![raw_val(PropertyValueValue::Number(1.0))],
        ));
        let mut b = a.clone();
        b.properties[2].values = vec![raw_val(PropertyValueValue::Number(2.0))];
        assert_eq!(
            fingerprint_normalized(&a, None, &p).fingerprints.properties,
            fingerprint_normalized(&b, None, &p).fingerprints.properties
        );
    }

    #[test]
    fn native_ids_never_enter_hashes() {
        let a = base_object();
        let mut b = base_object();
        b.native_ids = Some(model_contracts::SemanticObjectNativeIds {
            express_id: Some(999.try_into().unwrap()),
            global_id: Some("3B7U$m8X1Axw8J$V9LkQm".parse().unwrap()),
        });
        assert_eq!(fps(&a, None), fps(&b, None));
    }

    #[test]
    fn missing_placement_differs_from_origin_zero() {
        let mut missing = base_object();
        missing.placement = None;
        let mut origin = base_object();
        origin.placement = Some([1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0]);
        assert_eq!(canonical_placement_text(&missing, &profile()), NO_PLACEMENT);
        assert_ne!(
            fps(&missing, None).placement,
            fps(&origin, None).placement
        );
    }

    #[test]
    fn shape_states_are_distinct_tokens() {
        let p = profile();
        let missing = canonical_shape_text(None, &p);
        let absent = canonical_shape_text(
            Some(&GeometryChunk {
                status: GeometryChunkStatus::Absent,
                triangles: vec![],
                vertices: vec![],
                instance_id: "i".parse().unwrap(),
                reason: None,
                ref_: obj_ref("obj-1"),
            }),
            &p,
        );
        let unsupported = canonical_shape_text(
            Some(&GeometryChunk {
                status: GeometryChunkStatus::Unsupported,
                triangles: vec![],
                vertices: vec![],
                instance_id: "i".parse().unwrap(),
                reason: Some("brep".to_owned()),
                ref_: obj_ref("obj-1"),
            }),
            &p,
        );
        let available = canonical_shape_text(Some(&base_chunk()), &p);
        assert_ne!(missing, absent);
        assert_ne!(absent, unsupported);
        assert_ne!(unsupported, available);
        assert_ne!(missing, available);
    }
    #[test]
    fn unsupported_reasons_are_display_only_and_hash_stable() {
        let p = profile();
        let chunk_a = GeometryChunk {
            status: GeometryChunkStatus::Unsupported,
            triangles: vec![],
            vertices: vec![],
            instance_id: "i".parse().unwrap(),
            reason: Some("IfcOpenShell 0.8.0: Boolean failed".to_owned()),
            ref_: obj_ref("obj-1"),
        };
        let chunk_b = GeometryChunk {
            reason: Some("totally different exporter text".to_owned()),
            ..chunk_a.clone()
        };
        assert_eq!(shape_preimage(Some(&chunk_a), &p), "shape-unsupported");
        assert_eq!(
            fps(&base_object(), Some(&chunk_a)).shape,
            fps(&base_object(), Some(&chunk_b)).shape
        );
        assert_ne!(
            canonical_shape_text(Some(&chunk_a), &p),
            canonical_shape_text(Some(&chunk_b), &p)
        );
    }

    #[test]
    fn snapshots_carry_human_readable_profile_version() {
        let snap = fingerprint_normalized(&base_object(), Some(&base_chunk()), &profile());
        assert_eq!(snap.profile_version, "fp-v1");
        assert_eq!(snap.profile_version, profile().profile_version);
    }

    #[test]
    fn cross_profile_snapshots_are_rejected() {
        let a = fingerprint_normalized(&base_object(), Some(&base_chunk()), &profile());
        let mut other = profile();
        other.profile_version = "fp-v2-test".to_owned();
        let b = fingerprint_normalized(&base_object(), Some(&base_chunk()), &other);
        assert!(require_same_profile(&a, &b).is_err());
        assert!(verify_profile(&a, &profile()).is_ok());
        assert!(verify_profile(&a, &other).is_err());
    }

    // -- Rubric 5: quantization boundary -------------------------------------

    #[test]
    fn quantization_half_quantum_tie_goes_away_from_zero() {
        // Pinned behavior: f64::round ties go half away from zero. Documented
        // consequence: values exactly on a boundary snap outward, and noise
        // straddling any boundary flips the hash — quanta must exceed noise.
        let q = 1e-4;
        assert_eq!(quantize(0.5 * q, q), q);
        assert_eq!(quantize(-0.5 * q, q), -q);
        assert_eq!(quantize(1.5 * q, q), 2.0 * q);
        assert_eq!(quantize(0.4999 * q, q), 0.0);
        assert_eq!(quantize(-0.0, q), 0.0);
        assert!(quantize(-0.0, q).is_sign_positive());
        // Non-positive quanta: passthrough, never divide by zero.
        assert_eq!(quantize(1.234, 0.0), 1.234);
        assert_eq!(quantize(1.234, -1.0), 1.234);
    }

    #[test]
    fn nan_and_inf_are_stable_and_distinct() {
        let p = profile();
        assert_eq!(number_token(f64::NAN, p.length_quantum_m), "nan");
        assert_eq!(number_token(f64::INFINITY, p.length_quantum_m), "inf");
        assert_eq!(number_token(f64::NEG_INFINITY, p.length_quantum_m), "-inf");
        // Two NaN-carrying objects hash equal (no NaN != NaN poisoning).
        let mut a = base_object();
        a.properties.push(prop(
            "P",
            "Broken",
            PropertyOrigin::Occurrence,
            false,
            vec![raw_val(PropertyValueValue::Number(f64::NAN))],
        ));
        let b = a.clone();
        assert_eq!(fps(&a, None), fps(&b, None));
        // +Inf vs -Inf differ.
        let mut c = a.clone();
        c.properties[2].values = vec![raw_val(PropertyValueValue::Number(f64::INFINITY))];
        let mut d = a.clone();
        d.properties[2].values = vec![raw_val(PropertyValueValue::Number(f64::NEG_INFINITY))];
        assert_ne!(fps(&c, None), fps(&d, None));
    }

    #[test]
    fn corrupt_geometry_hashes_stably_without_panicking() {
        let p = profile();
        let mut bad = base_chunk();
        bad.triangles = vec![0, 1]; // bad arity
        assert_eq!(canonical_shape_text(Some(&bad), &p), "shape-corrupt:index-arity");
        let mut bad2 = base_chunk();
        bad2.triangles = vec![0, 1, 99]; // out of range
        assert_eq!(canonical_shape_text(Some(&bad2), &p), "shape-corrupt:index-range");
        let mut bad3 = base_chunk();
        bad3.vertices = vec![1.0, 2.0]; // bad arity
        assert_eq!(canonical_shape_text(Some(&bad3), &p), "shape-corrupt:vertex-arity");
    }
}
