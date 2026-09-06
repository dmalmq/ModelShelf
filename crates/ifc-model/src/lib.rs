//! `ifc-model` — IFC (ISO 10303-21 / STEP physical file) reader and semantic accessors.
//!
//! Scope: attribute/property/classification/material/placement/spatial data. There is
//! **no geometry kernel** here: shape data is exposed as the raw representation entity
//! graph so `fingerprint` can hash it, and browser-side `web-ifc` renders geometry.
//!
//! PUBLIC API IS A CROSS-CRATE CONTRACT. Implementations may add private modules and
//! extra inherent helpers, but MUST NOT change the signatures declared here.

use std::collections::HashMap;

mod index;
mod parse;
mod schema;
mod schema_tables;

pub mod prelude {
    pub use crate::{
        ClassificationRef, Entity, Header, IfcModel, MaterialRef, ObjectProperties, ParseError,
        Prop, PropertySet, Provenance, SchemaId, Transform, Value,
    };
}

/// Parser identity recorded on every run alongside the engine version.
pub const PARSER_VERSION: &str = concat!("modelshelf-ifc/", env!("CARGO_PKG_VERSION"));

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
        match normalise_schema_family(token).as_str() {
            "IFC2X3" => SchemaId::Ifc2x3,
            "IFC4" => SchemaId::Ifc4,
            "IFC4X1" => SchemaId::Ifc4x1,
            "IFC4X2" => SchemaId::Ifc4x2,
            "IFC4X3" => SchemaId::Ifc4x3,
            _ => SchemaId::Other(token.trim().to_ascii_uppercase()),
        }
    }
    /// Canonical uppercase label used in evidence records, e.g. `IFC2X3`, `IFC4`.
    pub fn label(&self) -> String {
        match self {
            SchemaId::Ifc2x3 => "IFC2X3".to_owned(),
            SchemaId::Ifc4 => "IFC4".to_owned(),
            SchemaId::Ifc4x1 => "IFC4X1".to_owned(),
            SchemaId::Ifc4x2 => "IFC4X2".to_owned(),
            SchemaId::Ifc4x3 => "IFC4X3".to_owned(),
            SchemaId::Other(other) => other.clone(),
        }
    }
    /// True when an IDS `ifcVersion` token (e.g. `IFC4`, `IFC4X3_ADD2`) applies to this
    /// schema. Comparison is by schema family: addenda and corrigenda of the same family
    /// are treated as the same target, cross-family tokens never match.
    pub fn matches_ids_version(&self, ids_version: &str) -> bool {
        let requested = normalise_schema_family(ids_version);
        if requested.is_empty() {
            return true;
        }
        requested == normalise_schema_family(&self.label())
    }
}

/// Reduce a schema token to its family: `IFC4X3_ADD2` -> `IFC4X3`, `Ifc2x3 TC1` -> `IFC2X3`.
fn normalise_schema_family(token: &str) -> String {
    let upper: String = token
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_uppercase();
    for family in ["IFC2X2", "IFC2X3", "IFC4X1", "IFC4X2", "IFC4X3", "IFC4"] {
        if upper.starts_with(family) {
            return family.to_owned();
        }
    }
    upper
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
        match self {
            Value::Str(s) => Some(s.as_str()),
            Value::Enum(s) => Some(s.as_str()),
            Value::Typed { value, .. } => value.as_str(),
            _ => None,
        }
    }
    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Value::Real(r) => Some(*r),
            Value::Int(i) => Some(*i as f64),
            Value::Typed { value, .. } => value.as_f64(),
            _ => None,
        }
    }
    pub fn as_i64(&self) -> Option<i64> {
        match self {
            Value::Int(i) => Some(*i),
            Value::Real(r) if r.fract() == 0.0 && r.is_finite() => Some(*r as i64),
            Value::Typed { value, .. } => value.as_i64(),
            _ => None,
        }
    }
    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Value::Bool(b) => Some(*b),
            Value::Logical(inner) => *inner,
            Value::Typed { value, .. } => value.as_bool(),
            _ => None,
        }
    }
    pub fn as_ref_id(&self) -> Option<u32> {
        match self {
            Value::Ref(id) => Some(*id),
            Value::Typed { value, .. } => value.as_ref_id(),
            _ => None,
        }
    }
    pub fn as_list(&self) -> Option<&[Value]> {
        match self {
            Value::List(items) => Some(items.as_slice()),
            Value::Typed { value, .. } => value.as_list(),
            _ => None,
        }
    }
    pub fn is_null(&self) -> bool {
        matches!(self, Value::Null | Value::Omitted)
    }
    /// Unwrap `Typed` wrappers, returning the innermost value.
    pub fn unwrap_typed(&self) -> &Value {
        match self {
            Value::Typed { value, .. } => value.unwrap_typed(),
            other => other,
        }
    }
    /// Name of the outermost `Typed` wrapper, e.g. `IFCLABEL`; `None` for bare values.
    pub fn typed_name(&self) -> Option<&str> {
        match self {
            Value::Typed { name, .. } => Some(name.as_str()),
            _ => None,
        }
    }
    /// IDS-comparable string form: reals use shortest round-trip formatting, booleans
    /// lowercase `true`/`false`, `Null`/`Omitted` return `None`.
    ///
    /// Lists, references and logical-unknown return `None` because IDS treats them as
    /// undecidable/always-failing rather than as comparable scalars.
    pub fn to_ids_string(&self) -> Option<String> {
        match self {
            Value::Str(s) => Some(s.clone()),
            Value::Enum(e) => Some(e.clone()),
            Value::Int(i) => Some(i.to_string()),
            Value::Real(r) => {
                if r.is_finite() {
                    Some(format!("{r}"))
                } else {
                    None
                }
            }
            Value::Bool(b) => Some(b.to_string()),
            Value::Logical(Some(b)) => Some(b.to_string()),
            Value::Typed { value, .. } => value.to_ids_string(),
            Value::Logical(None) | Value::Null | Value::Omitted | Value::Ref(_) | Value::List(_) => {
                None
            }
        }
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
        self.attrs.get(index)
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
        let mut inherited: Option<&Prop> = None;
        for set in &self.sets {
            if set.name != pset {
                continue;
            }
            for prop in &set.props {
                if prop.name != name {
                    continue;
                }
                match set.source {
                    Provenance::Own => return Some(prop),
                    Provenance::Type => inherited = inherited.or(Some(prop)),
                }
            }
        }
        inherited
    }
    pub fn set(&self, pset: &str) -> Option<&PropertySet> {
        self.sets
            .iter()
            .find(|s| s.name == pset && s.source == Provenance::Own)
            .or_else(|| self.sets.iter().find(|s| s.name == pset))
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
    /// Row-major 3x4 flattening used for storage and diff evidence:
    /// `[xx,xy,xz, yx,yy,yz, zx,zy,zz, ox,oy,oz]`.
    pub fn to_array12(&self) -> [f64; 12] {
        [
            self.x_axis[0],
            self.x_axis[1],
            self.x_axis[2],
            self.y_axis[0],
            self.y_axis[1],
            self.y_axis[2],
            self.z_axis[0],
            self.z_axis[1],
            self.z_axis[2],
            self.origin[0],
            self.origin[1],
            self.origin[2],
        ]
    }
    /// Compose a child placement expressed in this frame into the same frame as `self`.
    pub fn compose(&self, child: &Transform) -> Transform {
        let rotate = |v: [f64; 3]| -> [f64; 3] {
            [
                self.x_axis[0] * v[0] + self.y_axis[0] * v[1] + self.z_axis[0] * v[2],
                self.x_axis[1] * v[0] + self.y_axis[1] * v[1] + self.z_axis[1] * v[2],
                self.x_axis[2] * v[0] + self.y_axis[2] * v[1] + self.z_axis[2] * v[2],
            ]
        };
        let offset = rotate(child.origin);
        Transform {
            origin: [
                self.origin[0] + offset[0],
                self.origin[1] + offset[1],
                self.origin[2] + offset[2],
            ],
            x_axis: rotate(child.x_axis),
            y_axis: rotate(child.y_axis),
            z_axis: rotate(child.z_axis),
        }
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
    global_ids: HashMap<String, u32>,
    groups: HashMap<u32, Vec<u32>>,
    relations: HashMap<String, HashMap<u32, Vec<u32>>>,
    part_of_parents: HashMap<String, HashMap<u32, Vec<u32>>>,
    length_to_metre: f64,
    empty_properties: ObjectProperties,
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
        let parsed = parse::parse_file(bytes)?;
        let indexes = index::build(&parsed.entities, &parsed.schema.label());
        Ok(IfcModel {
            schema: parsed.schema,
            header: parsed.header,
            entities: parsed.entities,
            by_type: indexes.by_type,
            products: indexes.products,
            properties: indexes.properties,
            classifications: indexes.classifications,
            materials: indexes.materials,
            placements: indexes.placements,
            spatial_parent: indexes.spatial_parent,
            children: indexes.children,
            type_object: indexes.type_object,
            global_ids: indexes.global_ids,
            groups: indexes.groups,
            relations: indexes.relations,
            part_of_parents: indexes.part_of_parents,
            length_to_metre: indexes.length_to_metre,
            empty_properties: ObjectProperties::default(),
        })
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
        value.as_ref_id().and_then(|id| self.entities.get(&id))
    }
    /// Instances of exactly this class (uppercase). IDS entity matching is
    /// non-inheriting, so no subtype expansion happens here.
    pub fn ids_of_type(&self, ty: &str) -> &[u32] {
        let key = ty.to_ascii_uppercase();
        self.by_type.get(&key).map(|v| v.as_slice()).unwrap_or(&[])
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
    /// Every instance id, ascending.
    ///
    /// IDS applicability is not limited to products — specifications legitimately target
    /// tasks, actors, materials and other non-placed entities — so an evaluator needs the
    /// full instance set, not just `products()`.
    pub fn all_ids(&self) -> Vec<u32> {
        let mut ids: Vec<u32> = self.entities.keys().copied().collect();
        ids.sort_unstable();
        ids
    }
    /// True when the class is a product occurrence this reader treats as inspectable.
    ///
    /// Advisory only: `products()` additionally detects products structurally, so a class
    /// missing from this list is still inspected when the instance carries a GlobalId and
    /// a placement or shape representation.
    pub fn is_product_type(ty: &str) -> bool {
        let upper = ty.to_ascii_uppercase();
        schema::is_subtype_of("IFC4", &upper, "IFCPRODUCT")
            || schema::is_subtype_of("IFC2X3", &upper, "IFCPRODUCT")
    }

    pub fn global_id(&self, id: u32) -> Option<&str> {
        let e = self.entities.get(&id)?;
        match e.attrs.first() {
            Some(Value::Str(s)) if s.len() == 22 => Some(s.as_str()),
            _ => None,
        }
    }
    pub fn name(&self, id: u32) -> Option<&str> {
        let e = self.entities.get(&id)?;
        if !self.is_root(e) {
            return None;
        }
        e.attrs.get(2).and_then(Value::as_str)
    }
    pub fn express_id_of_global_id(&self, global_id: &str) -> Option<u32> {
        self.global_ids.get(global_id).copied()
    }
    /// Explicit attribute names of this instance's class, in STEP order, when the class
    /// belongs to a schema this reader has tables for. Used to expand IDS attribute-name
    /// restrictions against what actually exists.
    pub fn attribute_names(&self, id: u32) -> Option<&'static [&'static str]> {
        let e = self.entities.get(&id)?;
        schema::attribute_names(&self.schema.label(), &e.ty)
    }
    /// Resolve an IFC attribute by name.
    ///
    /// Positions come from the generated IFC2X3/IFC4 schema tables, so any explicit
    /// attribute of a known class resolves exactly. For classes outside those schemas the
    /// reader falls back to the positions that are uniform across the IFC hierarchy
    /// (`IfcRoot` 0..3, plus placement/representation located from the instance data) and
    /// otherwise returns `AttributeLookup::Unsupported` so callers report "review
    /// incomplete" instead of inventing a verdict.
    pub fn attribute(&self, id: u32, attr_name: &str) -> AttributeLookup<'_> {
        let Some(e) = self.entities.get(&id) else { return AttributeLookup::Unsupported };
        let attr = |index: usize| -> AttributeLookup<'_> {
            match e.attrs.get(index) {
                Some(value) => AttributeLookup::Found(value),
                None => AttributeLookup::Unsupported,
            }
        };
        if let Some(index) = schema::attribute_index(&self.schema.label(), &e.ty, attr_name) {
            return attr(index);
        }
        if schema::knows_class(&self.schema.label(), &e.ty) {
            // The class is known and simply has no such attribute: that is a definite
            // "does not exist", which the caller must not read as a value.
            return AttributeLookup::Unsupported;
        }
        let root = self.is_root(e);
        match attr_name {
            "GlobalId" if root => attr(0),
            "OwnerHistory" if root => attr(1),
            "Name" if root => attr(2),
            "Description" if root => attr(3),
            "ObjectPlacement" => match index::placement_index(&self.entities, e) {
                Some(i) => attr(i),
                None => AttributeLookup::Unsupported,
            },
            "Representation" => match index::representation_index(&self.entities, e) {
                Some(i) => attr(i),
                None => AttributeLookup::Unsupported,
            },
            "PredefinedType" => match self.predefined_type_index(e) {
                Some(i) => attr(i),
                None => AttributeLookup::Unsupported,
            },
            _ => AttributeLookup::Unsupported,
        }
    }
    /// Resolve the effective predefined type, following the IDS entity-facet rules.
    ///
    /// The type object is consulted first, then the occurrence. `USERDEFINED` redirects to
    /// the user label (`ElementType`/`ProcessType`/`ResourceType` on a type object,
    /// `ObjectType` on an occurrence) and keeps the literal `USERDEFINED` when no label is
    /// present. `NOTDEFINED` is treated as "no value" so an occurrence can override a
    /// type that was exported as `NOTDEFINED`.
    pub fn predefined_type(&self, id: u32) -> Option<String> {
        if let Some(type_id) = self.type_object(id) {
            if let Some(resolved) = self.own_predefined_type(type_id) {
                return Some(resolved);
            }
        }
        self.own_predefined_type(id)
    }

    /// Predefined type declared on one instance, with the `USERDEFINED` redirect applied.
    fn own_predefined_type(&self, id: u32) -> Option<String> {
        let e = self.entities.get(&id)?;
        let raw = self
            .predefined_type_index(e)
            .and_then(|i| e.attrs.get(i))
            .and_then(Value::as_str)?;
        if raw == "USERDEFINED" {
            for label_attr in ["ElementType", "ProcessType", "ResourceType", "ObjectType"] {
                if let Some(index) =
                    schema::attribute_index(&self.schema.label(), &e.ty, label_attr)
                {
                    if let Some(label) =
                        e.attrs.get(index).and_then(Value::as_str).filter(|s| !s.is_empty())
                    {
                        return Some(label.to_owned());
                    }
                }
            }
            // No user label: the enumeration value itself is still the answer.
            return Some(raw.to_owned());
        }
        if raw == "NOTDEFINED" {
            return None;
        }
        Some(raw.to_owned())
    }

    /// `IfcRelDefinesByType.RelatingType` for an occurrence.
    pub fn type_object(&self, id: u32) -> Option<u32> {
        self.type_object.get(&id).copied()
    }
    pub fn properties(&self, id: u32) -> &ObjectProperties {
        self.properties.get(&id).unwrap_or(&self.empty_properties)
    }
    pub fn classifications(&self, id: u32) -> &[ClassificationRef] {
        self.classifications.get(&id).map(|v| v.as_slice()).unwrap_or(&[])
    }
    pub fn materials(&self, id: u32) -> &[MaterialRef] {
        self.materials.get(&id).map(|v| v.as_slice()).unwrap_or(&[])
    }
    /// Absolute transform in metres, resolved through the `IfcLocalPlacement` chain.
    pub fn placement(&self, id: u32) -> Option<&Transform> {
        self.placements.get(&id)
    }
    /// `IfcProductDefinitionShape` referenced by this product, if any.
    pub fn shape_representation(&self, id: u32) -> Option<u32> {
        let e = self.entities.get(&id)?;
        let index = index::representation_index(&self.entities, e)?;
        e.attrs.get(index).and_then(Value::as_ref_id)
    }
    /// Containing spatial element (`IfcRelContainedInSpatialStructure`) or aggregate
    /// parent (`IfcRelAggregates`), in that order of preference.
    pub fn spatial_parent(&self, id: u32) -> Option<u32> {
        self.spatial_parent.get(&id).copied()
    }
    /// Nearest ancestor `IfcBuildingStorey`.
    pub fn storey_of(&self, id: u32) -> Option<u32> {
        let mut current = id;
        for _ in 0..64 {
            let parent = self.spatial_parent.get(&current).copied()?;
            if self.entities.get(&parent).map(|e| e.ty.as_str()) == Some("IFCBUILDINGSTOREY") {
                return Some(parent);
            }
            current = parent;
        }
        None
    }
    /// Direct children through containment or aggregation.
    pub fn children_of(&self, id: u32) -> &[u32] {
        self.children.get(&id).map(|v| v.as_slice()).unwrap_or(&[])
    }
    /// Ancestor chain from immediate parent up to `IfcProject`.
    pub fn ancestors(&self, id: u32) -> Vec<u32> {
        let mut out = Vec::new();
        let mut current = id;
        // Bounded walk: a malformed export can contain a cyclic spatial tree.
        for _ in 0..64 {
            match self.spatial_parent.get(&current).copied() {
                Some(parent) if !out.contains(&parent) => {
                    out.push(parent);
                    current = parent;
                }
                _ => break,
            }
        }
        out
    }
    /// Group memberships via `IfcRelAssignsToGroup` (used by the IDS `partOf` facet).
    pub fn groups_of(&self, id: u32) -> Vec<u32> {
        self.groups.get(&id).cloned().unwrap_or_default()
    }
    /// Direct "wholes" this object belongs to through one relationship class.
    ///
    /// Direction matters for the IDS `partOf` facet: a wall is not part of its opening.
    /// Supported relations: `IFCRELAGGREGATES`, `IFCRELASSIGNSTOGROUP`,
    /// `IFCRELCONTAINEDINSPATIALSTRUCTURE`, `IFCRELNESTS`, `IFCRELVOIDSELEMENT`,
    /// `IFCRELFILLSELEMENT`.
    pub fn wholes_via(&self, id: u32, relation: &str) -> Vec<u32> {
        let key = relation.to_ascii_uppercase();
        self.part_of_parents
            .get(&key)
            .and_then(|map| map.get(&id))
            .cloned()
            .unwrap_or_default()
    }
    /// `IfcRelVoidsElement` / `IfcRelFillsElement` / `IfcRelNests` partners, keyed by
    /// the uppercase relationship class name. Direction-agnostic; use `wholes_via` when
    /// direction matters.
    pub fn related_through(&self, id: u32, relation: &str) -> Vec<u32> {
        let key = relation.to_ascii_uppercase();
        self.relations
            .get(&key)
            .and_then(|map| map.get(&id))
            .cloned()
            .unwrap_or_default()
    }

    /// `IfcRoot` layout check: GlobalId, OwnerHistory, Name, Description.
    fn is_root(&self, e: &Entity) -> bool {
        e.attrs.len() >= 4 && matches!(e.attrs.first(), Some(Value::Str(s)) if s.len() == 22)
    }

    fn is_product(&self, e: &Entity) -> bool {
        self.products.binary_search(&e.id).is_ok()
    }

    /// Locate `PredefinedType` on an instance.
    ///
    /// The schema tables answer this exactly for known classes. For unknown classes the
    /// trailing attribute is used when it holds an enumeration — most IFC element classes
    /// declare `PredefinedType` last — and otherwise nothing is reported, because a wrong
    /// position becomes a wrong finding.
    fn predefined_type_index(&self, e: &Entity) -> Option<usize> {
        if let Some(index) =
            schema::attribute_index(&self.schema.label(), &e.ty, "PredefinedType")
        {
            return (index < e.attrs.len()).then_some(index);
        }
        if schema::knows_class(&self.schema.label(), &e.ty) {
            return None;
        }
        let last = e.attrs.len().checked_sub(1)?;
        if last < 5 {
            return None;
        }
        match e.attrs.get(last) {
            Some(Value::Enum(_)) => Some(last),
            _ => None,
        }
    }
}
