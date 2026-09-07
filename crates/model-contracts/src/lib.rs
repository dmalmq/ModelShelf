//! Rust bindings for ModelShelf's shared model contract (`schemas/model/v1`). See
//! `docs/adr/0001-reusable-model-modules.md` for what this module may and may not
//! depend on: no app, database, or checking-engine imports here.
//!
//! Types are generated from the canonical JSON Schema (`src/generated.rs`); their
//! `Deserialize` impls already reject anything schema-invalid (unknown fields,
//! missing required fields, wrong `enum`/`const`, patterns) because typify encodes
//! every constraint the schema can express directly into the type. The one rule
//! schema validation alone cannot see is `ObjectRef.objectId` uniqueness within a
//! `SemanticModel`, since JSON Schema has no "unique by sub-key" keyword; that
//! boundary check lives here as a plain function over the deserialized value.
//!
//! `ObjectRef` is mostly consumed opaquely; [`express_id_to_object_id`] exists only
//! for the Rust side of an IFC adapter that must *produce* one (today: the checker
//! service's synchronous ingestion path, ahead of the worker/job integration that
//! will eventually replace it). See `schemas/model/v1/README.md` for the algorithm
//! and its golden fixture, which the Python and TypeScript packages test against too.

mod generated;

pub use generated::{
    GeometryChunk, Instance, InstanceBoundingBox, ModelDescriptor, ModelDescriptorArtifacts,
    ModelDescriptorSchemaVersion, ModelDescriptorSourceProvenance, ModelDescriptorUpAxis,
    ObjectRef, Property, PropertyOrigin, PropertyValue, PropertyValueValue, RenderCapability,
    RenderManifest,
    RenderManifestSchemaVersion, SemanticCapability, SemanticModel, SemanticModelSchemaVersion,
    SemanticObject, SemanticObjectNativeIds, Transform,
};

use std::collections::HashMap;
use std::fmt;

/// Two different occurrences were mapped to the same `ObjectRef.objectId` within one
/// `SemanticModel`. Duplicated `globalId`s are unrelated and always allowed; this is
/// specifically about the opaque reference that is supposed to be unique per revision.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DuplicateObjectId {
    pub object_id: String,
    pub first_index: usize,
    pub duplicate_index: usize,
}

impl fmt::Display for DuplicateObjectId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "objects[{}].ref.objectId {:?} duplicates objects[{}].ref.objectId",
            self.duplicate_index, self.object_id, self.first_index
        )
    }
}

impl std::error::Error for DuplicateObjectId {}

/// The boundary check schema validation cannot express. See [`DuplicateObjectId`].
pub fn check_distinct_object_ids(model: &SemanticModel) -> Result<(), DuplicateObjectId> {
    let mut seen: HashMap<&str, usize> = HashMap::new();
    for (index, object) in model.objects.iter().enumerate() {
        let object_id = object.ref_.object_id.as_str();
        if let Some(&first_index) = seen.get(object_id) {
            return Err(DuplicateObjectId {
                object_id: object_id.to_owned(),
                first_index,
                duplicate_index: index,
            });
        }
        seen.insert(object_id, index);
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MismatchedRevisionId {
    pub index: usize,
    pub object_revision_id: String,
    pub model_revision_id: String,
}

impl fmt::Display for MismatchedRevisionId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "objects[{}].ref.revisionId {:?} does not match model revisionId {:?}",
            self.index, self.object_revision_id, self.model_revision_id
        )
    }
}

impl std::error::Error for MismatchedRevisionId {}

pub fn check_revision_ids(model: &SemanticModel) -> Result<(), MismatchedRevisionId> {
    for (index, object) in model.objects.iter().enumerate() {
        if object.ref_.revision_id.as_str() != model.revision_id.as_str() {
            return Err(MismatchedRevisionId {
                index,
                object_revision_id: object.ref_.revision_id.to_string(),
                model_revision_id: model.revision_id.to_string(),
            });
        }
    }
    Ok(())
}

#[derive(Debug)]
pub enum SemanticModelError {
    Schema(serde_json::Error),
    DuplicateObjectId(DuplicateObjectId),
    MismatchedRevisionId(MismatchedRevisionId),
}

impl fmt::Display for SemanticModelError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SemanticModelError::Schema(err) => write!(f, "schema: {err}"),
            SemanticModelError::DuplicateObjectId(err) => write!(f, "boundary: {err}"),
            SemanticModelError::MismatchedRevisionId(err) => write!(f, "boundary: {err}"),
        }
    }
}

impl std::error::Error for SemanticModelError {}

/// Parses and fully validates a `SemanticModel` payload: schema shape via
/// `Deserialize`, then the [`check_distinct_object_ids`] boundary rule.
pub fn parse_semantic_model(json: &str) -> Result<SemanticModel, SemanticModelError> {
    let model: SemanticModel = serde_json::from_str(json).map_err(SemanticModelError::Schema)?;
    check_distinct_object_ids(&model).map_err(SemanticModelError::DuplicateObjectId)?;
    check_revision_ids(&model).map_err(SemanticModelError::MismatchedRevisionId)?;
    Ok(model)
}

/// typify does not encode numeric-range keywords (`exclusiveMinimum` etc.) into the
/// generated type the way it does string `pattern`/`minLength`, so `Transform.scale`
/// deserializes as plain `[f64; 3]` with no check that each component is positive.
/// Ajv (TypeScript) and pydantic (Python) enforce this directly from the schema; this
/// closes the same gap in Rust with an explicit check after deserialization.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NonPositiveScale {
    pub axis_index: usize,
    pub value: f64,
}

impl fmt::Display for NonPositiveScale {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "transform.scale[{}] = {} is not > 0", self.axis_index, self.value)
    }
}

impl std::error::Error for NonPositiveScale {}

pub fn check_positive_scale(transform: &Transform) -> Result<(), NonPositiveScale> {
    for (axis_index, &value) in transform.scale.iter().enumerate() {
        if !(value > 0.0) {
            return Err(NonPositiveScale { axis_index, value });
        }
    }
    Ok(())
}

#[derive(Debug)]
pub enum ModelDescriptorError {
    Schema(serde_json::Error),
    Boundary(NonPositiveScale),
}

impl fmt::Display for ModelDescriptorError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ModelDescriptorError::Schema(err) => write!(f, "schema: {err}"),
            ModelDescriptorError::Boundary(err) => write!(f, "boundary: {err}"),
        }
    }
}

impl std::error::Error for ModelDescriptorError {}

/// Parses and fully validates a `ModelDescriptor` payload: schema shape via
/// `Deserialize`, then [`check_positive_scale`] (see its doc comment for why that
/// can't be pushed into the type system the way the rest of the schema is).
pub fn parse_model_descriptor(json: &str) -> Result<ModelDescriptor, ModelDescriptorError> {
    let descriptor: ModelDescriptor = serde_json::from_str(json).map_err(ModelDescriptorError::Schema)?;
    check_positive_scale(&descriptor.transform).map_err(ModelDescriptorError::Boundary)?;
    Ok(descriptor)
}

/// `RenderManifest` has no cross-field rule beyond what its `Deserialize` impl
/// already enforces, so parsing it is exactly `serde_json::from_str`; this exists
/// for a consistent `parse_*` entry point across all three contract types.
pub fn parse_render_manifest(json: &str) -> Result<RenderManifest, serde_json::Error> {
    serde_json::from_str(json)
}

pub fn parse_geometry_chunk(json: &str) -> Result<GeometryChunk, serde_json::Error> {
    serde_json::from_str(json)
}

pub fn parse_object_ref(json: &str) -> Result<ObjectRef, serde_json::Error> {
    serde_json::from_str(json)
}

/// The one deterministic, revision-scoped mapping from an IFC express ID to an
/// opaque `ObjectRef.objectId` (see `schemas/model/v1/README.md`). `revisionId` is
/// part of the hash input, not just a namespace prefix, so the same express ID in
/// two different revisions never produces a comparable-looking `objectId`.
pub fn express_id_to_object_id(revision_id: &str, express_id: u64) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(format!("{revision_id}:{express_id}").as_bytes());
    let digest = hasher.finalize();
    let hex: String = digest.iter().map(|byte| format!("{byte:02x}")).take(8).collect();
    format!("occ_{hex}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_the_golden_fixture_shared_with_python_and_typescript() {
        let fixture = include_str!("../../../schemas/model/v1/fixtures/express-id-mapping.json");
        let parsed: serde_json::Value = serde_json::from_str(fixture).expect("valid fixture JSON");
        let cases = parsed["cases"].as_array().expect("cases array");
        assert!(!cases.is_empty());
        for case in cases {
            let revision_id = case["revisionId"].as_str().expect("revisionId");
            let express_id = case["expressId"].as_u64().expect("expressId");
            let expected = case["objectId"].as_str().expect("objectId");
            assert_eq!(express_id_to_object_id(revision_id, express_id), expected);
        }
    }

    #[test]
    fn same_express_id_in_two_revisions_maps_to_different_object_ids() {
        assert_ne!(
            express_id_to_object_id("rev-arch-01", 1),
            express_id_to_object_id("rev-struct-07", 1),
        );
    }
}
