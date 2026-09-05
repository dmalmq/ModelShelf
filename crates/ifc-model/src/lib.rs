//! `ifc-model` — IFC (ISO 10303-21 / STEP physical file) reader and semantic accessors.
//!
//! Scope: attribute/property/classification/material/placement/spatial data. There is
//! **no geometry kernel** here: shape data is exposed as the raw representation entity
//! graph so `fingerprint` can hash it, and browser-side `web-ifc` renders geometry.
//!
//! PUBLIC API IS A CROSS-CRATE CONTRACT. Implementations may add private modules and
//! extra inherent helpers, but MUST NOT change the signatures declared here.

use std::collections::HashMap;

pub mod prelude {
    pub use crate::{
        ClassificationRef, Entity, Header, IfcModel, MaterialRef, ObjectProperties, ParseError,
        Prop, PropertySet, Provenance, SchemaId, Transform, Value,
    };
}

/// IFC schema declared in the STEP header `FILE_SCHEMA`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum SchemaId {
    Ifc2x3,
    Ifc4,
    Ifc4x1,
    Ifc4x2,
    Ifc4x3,
    Other(String),
}

impl SchemaId {
    /// Parse a `FILE_SCHEMA` token such as `IFC4X3_ADD2` (case-insensitive).
    pub fn from_token(token: &str) -> SchemaId {
        todo!("ifc-model: implement")
    }
    /// Canonical uppercase label used in evidence records, e.g. `IFC2X3`, `IFC4`.
    pub fn label(&self) -> String {
        todo!("ifc-model: implement")
    }
    /// True when an IDS `ifcVersion` token (e.g. `IFC4`, `IFC4X3_ADD2`) applies to this schema.
    pub fn matches_ids_version(&self, ids_version: &str) -> bool {
        todo!("ifc-model: implement")
    }
}

/// STEP header fields kept for evidence.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct Header {
    pub file_description: Vec<String>,
    pub file_name: Option<String>,
    pub time_stamp: Option<String>,
    pub authors: Vec<String>,
    pub organizations: Vec<String>,
    pub preprocessor_version: Option<String>,
    pub originating_system: Option<String>,
    pub authorization: Option<String>,
    pub schema_tokens: Vec<String>,
}

/// A STEP attribute value.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum Value {
    /// `$` — unset.
    Null,
    /// `*` — derived in a subtype.
    Omitted,
    /// `#123` — entity instance reference.
    Ref(u32),
    Int(i64),
    Real(f64),
    Str(String),
    /// `.WALL.` style enumeration token, stored without dots, uppercase as written.
    Enum(String),
    /// `.T.` / `.F.`
    Bool(bool),
    /// `.U.` maps to `Logical(None)`.
    Logical(Option<bool>),
    List(Vec<Value>),
    /// `IFCLABEL('x')` — a select/defined-type wrapper.
    Typed { name: String, value: Box<Value> },
}

impl Value {
    pub fn as_str(&self) -> Option<&str> {
        todo!("ifc-model: implement")
    }
    pub fn as_f64(&self) -> Option<f64> {
        todo!("ifc-model: implement")
    }
    pub fn as_i64(&self) -> Option<i64> {
        todo!("ifc-model: implement")
    }
    pub fn as_bool(&self) -> Option<bool> {
        todo!("ifc-model: implement")
    }
    pub fn as_ref_id(&self) -> Option<u32> {
        todo!("ifc-model: implement")
    }
    pub fn as_list(&self) -> Option<&[Value]> {
        todo!("ifc-model: implement")
    }
    pub fn is_null(&self) -> bool {
        todo!("ifc-model: implement")
    }
    /// Unwrap `Typed` wrappers, returning the innermost value.
    pub fn unwrap_typed(&self) -> &Value {
        todo!("ifc-model: implement")
    }
    /// Name of the outermost `Typed` wrapper, e.g. `IFCLABEL`; `None` for bare values.
    pub fn typed_name(&self) -> Option<&str> {
        todo!("ifc-model: implement")
    }
    /// IDS-comparable string form: reals use shortest round-trip formatting, booleans
    /// lowercase `true`/`false`, `Null`/`Omitted` return `None`.
    pub fn to_ids_string(&self) -> Option<String> {
        todo!("ifc-model: implement")
    }
}

/// One STEP instance: `#12= IFCWALL('guid',#5,'Name',...);`
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Entity {
    pub id: u32,
    /// Uppercase IFC class name, e.g. `IFCWALL`.
    pub ty: String,
    pub attrs: Vec<Value>,
}

impl Entity {
    pub fn attr(&self, index: usize) -> Option<&Value> {
        todo!("ifc-model: implement")
    }
}

/// Where a resolved property/classification/material came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Provenance {
    /// Attached to the occurrence itself.
    Own,
    /// Inherited from the object's `IfcTypeObject` via `IfcRelDefinesByType`.
    Type,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Prop {
    pub name: String,
    pub value: Value,
    /// IFC value type of the property, e.g. `IFCLABEL`, `IFCBOOLEAN`, `IFCLENGTHMEASURE`.
    pub data_type: Option<String>,
    /// Unit symbol when resolvable from `IfcPropertySingleValue.Unit` or project units.
    pub unit: Option<String>,
    /// `IfcPropertySingleValue`, `IfcQuantityLength`, `IfcPropertyEnumeratedValue`, ...
    pub kind: PropKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum PropKind {
    SingleValue,
    EnumeratedValue,
    ListValue,
    BoundedValue,
    TableValue,
    ReferenceValue,
    Quantity,
    /// Recognised container but value shape not supported by this reader.
    Unsupported,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PropertySet {
    /// `IfcPropertySet.Name` / `IfcElementQuantity.Name`, e.g. `Pset_WallCommon`.
    pub name: String,
    pub source: Provenance,
    /// True for `IfcElementQuantity` (quantity sets).
    pub is_quantity_set: bool,
    pub props: Vec<Prop>,
}

/// Property sets resolved for one object, occurrence sets first, then inherited type sets.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct ObjectProperties {
    pub sets: Vec<PropertySet>,
}

impl ObjectProperties {
    /// Look up one property. Occurrence values shadow inherited type values.
    pub fn get(&self, pset: &str, name: &str) -> Option<&Prop> {
        todo!("ifc-model: implement")
    }
    pub fn set(&self, pset: &str) -> Option<&PropertySet> {
        todo!("ifc-model: implement")
    }
    pub fn iter(&self) -> impl Iterator<Item = (&PropertySet, &Prop)> {
        self.sets.iter().flat_map(|s| s.props.iter().map(move |p| (s, p)))
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ClassificationRef {
    /// Classification system name (`IfcClassification.Name`) when reachable.
    pub system: Option<String>,
    /// `IfcClassificationReference.Identification` (IFC2x3: `ItemReference`).
    pub identification: Option<String>,
    pub name: Option<String>,
    pub source: Provenance,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MaterialRef {
    pub name: String,
    pub category: Option<String>,
    pub source: Provenance,
}

/// Absolute placement in project length units converted to metres.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Transform {
    pub origin: [f64; 3],
    pub x_axis: [f64; 3],
    pub y_axis: [f64; 3],
    pub z_axis: [f64; 3],
}

impl Transform {
    pub const IDENTITY: Transform = Transform {
        origin: [0.0, 0.0, 0.0],
        x_axis: [1.0, 0.0, 0.0],
        y_axis: [0.0, 1.0, 0.0],
        z_axis: [0.0, 0.0, 1.0],
    };
    /// Row-major 3x4 flattening used for storage and diff evidence.
    pub fn to_array12(&self) -> [f64; 12] {
        todo!("ifc-model: implement")
    }
    pub fn compose(&self, child: &Transform) -> Transform {
        todo!("ifc-model: implement")
    }
}

/// Result of looking up an IFC attribute by name.
#[derive(Debug, Clone, PartialEq)]
pub enum AttributeLookup<'a> {
    /// Attribute exists on this instance and holds this value (may be `Value::Null`).
    Found(&'a Value),
    /// This reader cannot resolve that attribute name for this class. Callers MUST surface
    /// this as "review incomplete", never as a pass or a fail.
    Unsupported,
}

#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    #[error("not an ISO-10303-21 file")]
    NotStepFile,
    #[error("unterminated {construct} at byte {offset}")]
    Unterminated { construct: &'static str, offset: usize },
    #[error("syntax error at byte {offset}: {message}")]
    Syntax { offset: usize, message: String },
    #[error("missing FILE_SCHEMA in header")]
    MissingSchema,
    #[error("invalid utf-8 or unsupported encoding at byte {offset}")]
    Encoding { offset: usize },
}

/// Parsed IFC file with resolved semantic indexes.
pub struct IfcModel {
    schema: SchemaId,
    header: Header,
    entities: HashMap<u32, Entity>,
    by_type: HashMap<String, Vec<u32>>,
    products: Vec<u32>,
    properties: HashMap<u32, ObjectProperties>,
    classifications: HashMap<u32, Vec<ClassificationRef>>,
    materials: HashMap<u32, Vec<MaterialRef>>,
    placements: HashMap<u32, Transform>,
    spatial_parent: HashMap<u32, u32>,
    children: HashMap<u32, Vec<u32>>,
    type_object: HashMap<u32, u32>,
    length_to_metre: f64,
}

impl IfcModel {
    /// Parse a STEP-encoded IFC file and build every semantic index eagerly.
    ///
    /// Requirements:
    /// - Handles `\X2\..\X0\`, `\S\x` and `\X\hh` STEP string escapes plus `''` quoting.
    /// - Tolerates instances spanning multiple lines and comments `/* ... */`.
    /// - Unknown/forward references are kept as `Value::Ref` and resolve lazily.
    /// - Never panics on malformed input: return `ParseError`.
    pub fn parse(bytes: &[u8]) -> Result<IfcModel, ParseError> {
        todo!("ifc-model: implement")
    }

    pub fn schema(&self) -> &SchemaId {
        &self.schema
    }
    pub fn header(&self) -> &Header {
        &self.header
    }
    /// Metre value of one project length unit (`IfcUnitAssignment` SI prefix aware).
    pub fn length_to_metre(&self) -> f64 {
        self.length_to_metre
    }
    pub fn entity_count(&self) -> usize {
        self.entities.len()
    }
    pub fn entity(&self, id: u32) -> Option<&Entity> {
        self.entities.get(&id)
    }
    pub fn deref(&self, value: &Value) -> Option<&Entity> {
        todo!("ifc-model: implement")
    }
    /// Instances of exactly this class (uppercase). IDS entity matching is
    /// non-inheriting, so no subtype expansion happens here.
    pub fn ids_of_type(&self, ty: &str) -> &[u32] {
        todo!("ifc-model: implement")
    }
    pub fn entities_of_type<'a>(&'a self, ty: &str) -> impl Iterator<Item = &'a Entity> + 'a {
        self.ids_of_type(ty).iter().filter_map(|id| self.entities.get(id))
    }
    pub fn type_names(&self) -> impl Iterator<Item = &str> {
        self.by_type.keys().map(|s| s.as_str())
    }
    /// Every `IfcProduct` occurrence (elements, spaces, spatial structure, annotations),
    /// in ascending express-id order. Type objects are excluded.
    pub fn products(&self) -> &[u32] {
        &self.products
    }
    /// True when the class is a product occurrence this reader treats as inspectable.
    pub fn is_product_type(ty: &str) -> bool {
        todo!("ifc-model: implement")
    }

    pub fn global_id(&self, id: u32) -> Option<&str> {
        todo!("ifc-model: implement")
    }
    pub fn name(&self, id: u32) -> Option<&str> {
        todo!("ifc-model: implement")
    }
    pub fn express_id_of_global_id(&self, global_id: &str) -> Option<u32> {
        todo!("ifc-model: implement")
    }
    /// Resolve an IFC attribute by name.
    ///
    /// Supported without schema tables: `GlobalId`, `OwnerHistory`, `Name`, `Description`
    /// for any `IfcRoot`; `ObjectType`, `ObjectPlacement`, `Representation`, `Tag` for
    /// product occurrences; `PredefinedType` (see `predefined_type`). Anything else
    /// returns `AttributeLookup::Unsupported`.
    pub fn attribute(&self, id: u32, attr_name: &str) -> AttributeLookup<'_> {
        todo!("ifc-model: implement")
    }
    /// IDS predefined-type resolution order: type object `PredefinedType`
    /// (`USERDEFINED` -> type `ElementType`), else occurrence `PredefinedType`
    /// (`USERDEFINED` -> occurrence `ObjectType`), else `None`.
    pub fn predefined_type(&self, id: u32) -> Option<String> {
        todo!("ifc-model: implement")
    }
    /// `IfcRelDefinesByType.RelatingType` for an occurrence.
    pub fn type_object(&self, id: u32) -> Option<u32> {
        todo!("ifc-model: implement")
    }
    pub fn properties(&self, id: u32) -> &ObjectProperties {
        todo!("ifc-model: implement")
    }
    pub fn classifications(&self, id: u32) -> &[ClassificationRef] {
        todo!("ifc-model: implement")
    }
    pub fn materials(&self, id: u32) -> &[MaterialRef] {
        todo!("ifc-model: implement")
    }
    /// Absolute transform in metres, resolved through the `IfcLocalPlacement` chain.
    pub fn placement(&self, id: u32) -> Option<&Transform> {
        self.placements.get(&id)
    }
    /// `IfcProductDefinitionShape` referenced by this product, if any.
    pub fn shape_representation(&self, id: u32) -> Option<u32> {
        todo!("ifc-model: implement")
    }
    /// Containing spatial element (`IfcRelContainedInSpatialStructure`) or aggregate
    /// parent (`IfcRelAggregates`), in that order of preference.
    pub fn spatial_parent(&self, id: u32) -> Option<u32> {
        self.spatial_parent.get(&id).copied()
    }
    /// Nearest ancestor `IfcBuildingStorey`.
    pub fn storey_of(&self, id: u32) -> Option<u32> {
        todo!("ifc-model: implement")
    }
    /// Direct children through containment or aggregation.
    pub fn children_of(&self, id: u32) -> &[u32] {
        todo!("ifc-model: implement")
    }
    /// Ancestor chain from immediate parent up to `IfcProject`.
    pub fn ancestors(&self, id: u32) -> Vec<u32> {
        todo!("ifc-model: implement")
    }
    /// Group memberships via `IfcRelAssignsToGroup` (used by the IDS `partOf` facet).
    pub fn groups_of(&self, id: u32) -> Vec<u32> {
        todo!("ifc-model: implement")
    }
    /// `IfcRelVoidsElement` / `IfcRelFillsElement` / `IfcRelNests` partners, keyed by
    /// the uppercase relationship class name.
    pub fn related_through(&self, id: u32, relation: &str) -> Vec<u32> {
        todo!("ifc-model: implement")
    }
}
