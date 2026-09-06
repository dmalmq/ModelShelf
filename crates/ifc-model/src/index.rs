//! Semantic indexes over the parsed instance graph: products, properties (with type
//! inheritance), classifications, materials, absolute placements, spatial structure,
//! groups and relationships.
//!
//! Attribute positions are taken from the IFC2x3/IFC4 EXPRESS layouts that are stable
//! across both schemas. Where a position is class-specific (`PredefinedType`), the value
//! is located from the instance data instead of guessed, because a wrong index becomes a
//! wrong finding in a client report.

use std::collections::{HashMap, HashSet};

use crate::{
    ClassificationRef, Entity, MaterialRef, ObjectProperties, Prop, PropKind, PropertySet,
    Provenance, Transform, Value,
};

pub struct Indexes {
    pub by_type: HashMap<String, Vec<u32>>,
    pub products: Vec<u32>,
    pub properties: HashMap<u32, ObjectProperties>,
    pub classifications: HashMap<u32, Vec<ClassificationRef>>,
    pub materials: HashMap<u32, Vec<MaterialRef>>,
    pub placements: HashMap<u32, Transform>,
    pub spatial_parent: HashMap<u32, u32>,
    pub children: HashMap<u32, Vec<u32>>,
    pub type_object: HashMap<u32, u32>,
    pub global_ids: HashMap<String, u32>,
    pub groups: HashMap<u32, Vec<u32>>,
    pub relations: HashMap<String, HashMap<u32, Vec<u32>>>,
    /// Relationship class -> part id -> the wholes it belongs to.
    pub part_of_parents: HashMap<String, HashMap<u32, Vec<u32>>>,
    pub length_to_metre: f64,
}

type Entities = HashMap<u32, Entity>;

/// Relationship classes exposed through `IfcModel::related_through`.
const TRACKED_RELATIONS: [(&str, usize, usize); 6] = [
    ("IFCRELAGGREGATES", 4, 5),
    ("IFCRELCONTAINEDINSPATIALSTRUCTURE", 5, 4),
    ("IFCRELNESTS", 4, 5),
    ("IFCRELVOIDSELEMENT", 4, 5),
    ("IFCRELFILLSELEMENT", 4, 5),
    ("IFCRELASSIGNSTOGROUP", 6, 4),
];

pub fn build(entities: &Entities, schema_label: &str) -> Indexes {
    let mut by_type: HashMap<String, Vec<u32>> = HashMap::new();
    let mut global_ids: HashMap<String, u32> = HashMap::new();
    for (id, e) in entities {
        by_type.entry(e.ty.clone()).or_default().push(*id);
        if let Some(guid) = e.attrs.first().and_then(Value::as_str) {
            if guid.len() == 22 {
                global_ids.insert(guid.to_owned(), *id);
            }
        }
    }
    for ids in by_type.values_mut() {
        ids.sort_unstable();
    }

    let length_to_metre = resolve_length_unit(entities, &by_type);

    let (spatial_parent, children) = build_spatial(entities, &by_type);
    let type_object = build_type_links(entities, &by_type);
    let products = collect_products(entities, &by_type, &spatial_parent, &children, schema_label);

    let properties = build_properties(entities, &by_type, &type_object, schema_label);
    let classifications = build_classifications(entities, &by_type, &type_object);
    let materials = build_materials(entities, &by_type, &type_object);
    let placements = build_placements(entities, length_to_metre);
    let groups = build_groups(entities, &by_type);
    let relations = build_relations(entities, &by_type);
    let part_of_parents = build_part_of_parents(entities, &by_type);

    Indexes {
        by_type,
        products,
        properties,
        classifications,
        materials,
        placements,
        spatial_parent,
        children,
        type_object,
        global_ids,
        groups,
        relations,
        part_of_parents,
        length_to_metre,
    }
}

fn ids_of<'a>(by_type: &'a HashMap<String, Vec<u32>>, ty: &str) -> &'a [u32] {
    by_type.get(ty).map(|v| v.as_slice()).unwrap_or(&[])
}

/// Every id referenced by a value, whether it is a single reference or a set.
fn refs(value: Option<&Value>) -> Vec<u32> {
    match value {
        Some(Value::Ref(id)) => vec![*id],
        Some(Value::List(items)) => items.iter().filter_map(Value::as_ref_id).collect(),
        _ => Vec::new(),
    }
}

fn entity_ty<'a>(entities: &'a Entities, id: u32) -> Option<&'a str> {
    entities.get(&id).map(|e| e.ty.as_str())
}

// ---------------------------------------------------------------------------- units

const SI_PREFIXES: [(&str, f64); 16] = [
    ("EXA", 1e18),
    ("PETA", 1e15),
    ("TERA", 1e12),
    ("GIGA", 1e9),
    ("MEGA", 1e6),
    ("KILO", 1e3),
    ("HECTO", 1e2),
    ("DECA", 1e1),
    ("DECI", 1e-1),
    ("CENTI", 1e-2),
    ("MILLI", 1e-3),
    ("MICRO", 1e-6),
    ("NANO", 1e-9),
    ("PICO", 1e-12),
    ("FEMTO", 1e-15),
    ("ATTO", 1e-18),
];

fn prefix_factor(prefix: &str) -> f64 {
    SI_PREFIXES
        .iter()
        .find(|(name, _)| *name == prefix)
        .map(|(_, factor)| *factor)
        .unwrap_or(1.0)
}

/// Metres per project length unit. Defaults to 1.0 (metre) when the assignment is absent,
/// which is what the IFC default unit context implies.
fn resolve_length_unit(entities: &Entities, by_type: &HashMap<String, Vec<u32>>) -> f64 {
    for assignment in ids_of(by_type, "IFCUNITASSIGNMENT") {
        let Some(unit_assignment) = entities.get(assignment) else { continue };
        for unit_id in refs(unit_assignment.attrs.first()) {
            if let Some(factor) = length_unit_factor(entities, unit_id) {
                return factor;
            }
        }
    }
    1.0
}

fn length_unit_factor(entities: &Entities, unit_id: u32) -> Option<f64> {
    let unit = entities.get(&unit_id)?;
    match unit.ty.as_str() {
        "IFCSIUNIT" => {
            if unit.attrs.get(1).and_then(Value::as_str) != Some("LENGTHUNIT")
                && !matches!(unit.attrs.get(1), Some(Value::Enum(t)) if t == "LENGTHUNIT")
            {
                return None;
            }
            let prefix = match unit.attrs.get(2) {
                Some(Value::Enum(p)) => prefix_factor(p),
                _ => 1.0,
            };
            Some(prefix)
        }
        "IFCCONVERSIONBASEDUNIT" | "IFCCONVERSIONBASEDUNITWITHOFFSET" => {
            if !matches!(unit.attrs.get(1), Some(Value::Enum(t)) if t == "LENGTHUNIT") {
                return None;
            }
            let measure_id = unit.attrs.get(3).and_then(Value::as_ref_id)?;
            let measure = entities.get(&measure_id)?;
            let value = measure.attrs.first()?.unwrap_typed().as_f64()?;
            let base_id = measure.attrs.get(1).and_then(Value::as_ref_id)?;
            let base = length_unit_factor(entities, base_id).unwrap_or(1.0);
            Some(value * base)
        }
        _ => None,
    }
}

// ------------------------------------------------------------------------- products

/// Product occurrence classes this reader treats as inspectable. Used for the advisory
/// `IfcModel::is_product_type`; `products()` additionally detects products structurally,
/// so an exotic class missing from this list is still inspected.
pub const PRODUCT_CLASSES: &[&str] = &[
    "IFCSITE", "IFCBUILDING", "IFCBUILDINGSTOREY", "IFCSPACE", "IFCSPATIALZONE",
    "IFCEXTERNALSPATIALELEMENT", "IFCANNOTATION", "IFCGRID", "IFCPROXY", "IFCELEMENTASSEMBLY",
    "IFCBUILDINGELEMENTPROXY", "IFCWALL", "IFCWALLSTANDARDCASE", "IFCWALLELEMENTEDCASE",
    "IFCCURTAINWALL", "IFCSLAB", "IFCSLABSTANDARDCASE", "IFCSLABELEMENTEDCASE", "IFCROOF",
    "IFCBEAM", "IFCBEAMSTANDARDCASE", "IFCCOLUMN", "IFCCOLUMNSTANDARDCASE", "IFCMEMBER",
    "IFCMEMBERSTANDARDCASE", "IFCPLATE", "IFCPLATESTANDARDCASE", "IFCFOOTING", "IFCPILE",
    "IFCRAMP", "IFCRAMPFLIGHT", "IFCSTAIR", "IFCSTAIRFLIGHT", "IFCRAILING", "IFCCOVERING",
    "IFCDOOR", "IFCDOORSTANDARDCASE", "IFCWINDOW", "IFCWINDOWSTANDARDCASE", "IFCOPENINGELEMENT",
    "IFCOPENINGSTANDARDCASE", "IFCVOIDINGFEATURE", "IFCPROJECTIONELEMENT", "IFCSHADINGDEVICE",
    "IFCBUILDINGELEMENTPART", "IFCREINFORCINGBAR", "IFCREINFORCINGMESH", "IFCTENDON",
    "IFCTENDONANCHOR", "IFCFASTENER", "IFCMECHANICALFASTENER", "IFCDISCRETEACCESSORY",
    "IFCFURNISHINGELEMENT", "IFCFURNITURE", "IFCSYSTEMFURNITUREELEMENT", "IFCTRANSPORTELEMENT",
    "IFCFLOWSEGMENT", "IFCFLOWFITTING", "IFCFLOWTERMINAL", "IFCFLOWCONTROLLER",
    "IFCFLOWMOVINGDEVICE", "IFCFLOWSTORAGEDEVICE", "IFCFLOWTREATMENTDEVICE",
    "IFCENERGYCONVERSIONDEVICE", "IFCDISTRIBUTIONELEMENT", "IFCDISTRIBUTIONCONTROLELEMENT",
    "IFCDISTRIBUTIONCHAMBERELEMENT", "IFCDISTRIBUTIONPORT", "IFCPORT", "IFCPIPESEGMENT",
    "IFCPIPEFITTING", "IFCDUCTSEGMENT", "IFCDUCTFITTING", "IFCCABLESEGMENT", "IFCCABLEFITTING",
    "IFCCABLECARRIERSEGMENT", "IFCCABLECARRIERFITTING", "IFCAIRTERMINAL", "IFCAIRTERMINALBOX",
    "IFCSANITARYTERMINAL", "IFCLIGHTFIXTURE", "IFCELECTRICAPPLIANCE", "IFCOUTLET", "IFCSWITCHINGDEVICE",
    "IFCPROTECTIVEDEVICE", "IFCJUNCTIONBOX", "IFCPUMP", "IFCFAN", "IFCVALVE", "IFCBOILER",
    "IFCCHILLER", "IFCCOIL", "IFCTANK", "IFCFILTER", "IFCDAMPER", "IFCSENSOR", "IFCACTUATOR",
    "IFCALARM", "IFCCONTROLLER", "IFCUNITARYEQUIPMENT", "IFCUNITARYCONTROLELEMENT",
    "IFCAUDIOVISUALAPPLIANCE", "IFCCOMMUNICATIONSAPPLIANCE", "IFCFIRESUPPRESSIONTERMINAL",
    "IFCELECTRICDISTRIBUTIONBOARD", "IFCELECTRICFLOWSTORAGEDEVICE", "IFCELECTRICMOTOR",
    "IFCELECTRICGENERATOR", "IFCSOLARDEVICE", "IFCSPACEHEATER", "IFCWASTETERMINAL",
    "IFCSTACKTERMINAL", "IFCMEDICALDEVICE", "IFCBUILDINGSYSTEM", "IFCCHIMNEY", "IFCGEOGRAPHICELEMENT",
    "IFCCIVILELEMENT", "IFCBEARING", "IFCKERB", "IFCPAVEMENT", "IFCROAD", "IFCRAIL", "IFCTRACKELEMENT",
    "IFCBRIDGE", "IFCFACILITY", "IFCFACILITYPART", "IFCVIRTUALELEMENT", "IFCELEMENTCOMPONENT",
];

pub fn is_product_class(ty: &str) -> bool {
    PRODUCT_CLASSES.contains(&ty)
}

/// Index of the attribute holding `ObjectPlacement`, located from the instance data.
pub fn placement_index(entities: &Entities, e: &Entity) -> Option<usize> {
    for (i, attr) in e.attrs.iter().enumerate().skip(4).take(6) {
        if let Some(target) = attr.as_ref_id() {
            if matches!(
                entity_ty(entities, target),
                Some("IFCLOCALPLACEMENT") | Some("IFCGRIDPLACEMENT")
            ) {
                return Some(i);
            }
        }
    }
    None
}

/// Index of the attribute holding `Representation`, located from the instance data.
pub fn representation_index(entities: &Entities, e: &Entity) -> Option<usize> {
    for (i, attr) in e.attrs.iter().enumerate().skip(4).take(7) {
        if let Some(target) = attr.as_ref_id() {
            if matches!(
                entity_ty(entities, target),
                Some("IFCPRODUCTDEFINITIONSHAPE") | Some("IFCPRODUCTREPRESENTATION")
            ) {
                return Some(i);
            }
        }
    }
    None
}

fn has_guid(e: &Entity) -> bool {
    matches!(e.attrs.first(), Some(Value::Str(s)) if s.len() == 22)
}

/// Structural product test: an `IfcProduct` occurrence carries a GlobalId and either a
/// placement or a shape representation in the IFC4/IFC2x3 attribute band 4..7. Type
/// objects fail this test because their corresponding attributes are sets, not references.
fn looks_like_product(entities: &Entities, e: &Entity) -> bool {
    if !has_guid(e) || e.attrs.len() < 7 {
        return false;
    }
    if e.ty.ends_with("TYPE") || e.ty.ends_with("STYLE") {
        return false;
    }
    placement_index(entities, e).is_some() || representation_index(entities, e).is_some()
}

fn collect_products(
    entities: &Entities,
    by_type: &HashMap<String, Vec<u32>>,
    spatial_parent: &HashMap<u32, u32>,
    children: &HashMap<u32, Vec<u32>>,
    schema_label: &str,
) -> Vec<u32> {
    let mut set: HashSet<u32> = HashSet::new();
    for (id, e) in entities {
        // The schema tables answer "is this an IfcProduct" exactly; structural detection
        // only covers classes the tables do not know (e.g. IFC4X3-only entities).
        let is_product = if crate::schema::knows_class(schema_label, &e.ty) {
            crate::schema::is_subtype_of(schema_label, &e.ty, "IFCPRODUCT")
        } else {
            looks_like_product(entities, e) || (has_guid(e) && is_product_class(&e.ty))
        };
        if is_product {
            set.insert(*id);
        }
    }
    // Promote geometry-less spatial members (e.g. an IfcSpace exported without placement)
    // that participate in the spatial tree: they are still inspectable objects.
    for (child, parent) in spatial_parent {
        for candidate in [child, parent] {
            if let Some(e) = entities.get(candidate) {
                if crate::schema::knows_class(schema_label, &e.ty) {
                    continue;
                }
                if has_guid(e) && !e.ty.ends_with("TYPE") && e.attrs.len() >= 5 {
                    set.insert(*candidate);
                }
            }
        }
    }
    let _ = children;
    // IfcProject/IfcProjectLibrary are contexts, not products.
    for ty in ["IFCPROJECT", "IFCPROJECTLIBRARY"] {
        for id in ids_of(by_type, ty) {
            set.remove(id);
        }
    }
    let mut products: Vec<u32> = set.into_iter().collect();
    products.sort_unstable();
    products
}

// ------------------------------------------------------------------ spatial structure

fn build_spatial(
    entities: &Entities,
    by_type: &HashMap<String, Vec<u32>>,
) -> (HashMap<u32, u32>, HashMap<u32, Vec<u32>>) {
    let mut parent: HashMap<u32, u32> = HashMap::new();
    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();

    // Containment wins over aggregation, so apply aggregation first and let containment
    // overwrite it.
    for rel_id in ids_of(by_type, "IFCRELAGGREGATES") {
        let Some(rel) = entities.get(rel_id) else { continue };
        let Some(whole) = rel.attrs.get(4).and_then(Value::as_ref_id) else { continue };
        for part in refs(rel.attrs.get(5)) {
            parent.insert(part, whole);
            children.entry(whole).or_default().push(part);
        }
    }
    for rel_id in ids_of(by_type, "IFCRELCONTAINEDINSPATIALSTRUCTURE") {
        let Some(rel) = entities.get(rel_id) else { continue };
        let Some(structure) = rel.attrs.get(5).and_then(Value::as_ref_id) else { continue };
        for element in refs(rel.attrs.get(4)) {
            parent.insert(element, structure);
            children.entry(structure).or_default().push(element);
        }
    }
    for list in children.values_mut() {
        list.sort_unstable();
        list.dedup();
    }
    (parent, children)
}

fn build_type_links(
    entities: &Entities,
    by_type: &HashMap<String, Vec<u32>>,
) -> HashMap<u32, u32> {
    let mut map = HashMap::new();
    for rel_id in ids_of(by_type, "IFCRELDEFINESBYTYPE") {
        let Some(rel) = entities.get(rel_id) else { continue };
        let Some(type_id) = rel.attrs.get(5).and_then(Value::as_ref_id) else { continue };
        for object in refs(rel.attrs.get(4)) {
            map.insert(object, type_id);
        }
    }
    map
}

fn build_groups(
    entities: &Entities,
    by_type: &HashMap<String, Vec<u32>>,
) -> HashMap<u32, Vec<u32>> {
    let mut map: HashMap<u32, Vec<u32>> = HashMap::new();
    for rel_id in ids_of(by_type, "IFCRELASSIGNSTOGROUP") {
        let Some(rel) = entities.get(rel_id) else { continue };
        let Some(group) = rel.attrs.get(6).and_then(Value::as_ref_id) else { continue };
        for object in refs(rel.attrs.get(4)) {
            map.entry(object).or_default().push(group);
        }
    }
    for list in map.values_mut() {
        list.sort_unstable();
        list.dedup();
    }
    map
}

fn build_relations(
    entities: &Entities,
    by_type: &HashMap<String, Vec<u32>>,
) -> HashMap<String, HashMap<u32, Vec<u32>>> {
    let mut out: HashMap<String, HashMap<u32, Vec<u32>>> = HashMap::new();
    for (class, left_index, right_index) in TRACKED_RELATIONS {
        let mut map: HashMap<u32, Vec<u32>> = HashMap::new();
        for rel_id in ids_of(by_type, class) {
            let Some(rel) = entities.get(rel_id) else { continue };
            let left = refs(rel.attrs.get(left_index));
            let right = refs(rel.attrs.get(right_index));
            for l in &left {
                map.entry(*l).or_default().extend(right.iter().copied());
            }
            for r in &right {
                map.entry(*r).or_default().extend(left.iter().copied());
            }
        }
        for list in map.values_mut() {
            list.sort_unstable();
            list.dedup();
        }
        out.insert(class.to_owned(), map);
    }
    out
}

// ------------------------------------------------------------------------ properties

/// `(relation class, attribute holding the whole, attribute holding the parts)`.
const PART_OF_DIRECTIONS: [(&str, usize, usize); 6] = [
    ("IFCRELAGGREGATES", 4, 5),
    ("IFCRELASSIGNSTOGROUP", 6, 4),
    ("IFCRELCONTAINEDINSPATIALSTRUCTURE", 5, 4),
    ("IFCRELNESTS", 4, 5),
    // An opening voids its host element: the host is the whole.
    ("IFCRELVOIDSELEMENT", 4, 5),
    // A filling element fills an opening: the opening is the whole.
    ("IFCRELFILLSELEMENT", 4, 5),
];

fn build_part_of_parents(
    entities: &Entities,
    by_type: &HashMap<String, Vec<u32>>,
) -> HashMap<String, HashMap<u32, Vec<u32>>> {
    let mut out: HashMap<String, HashMap<u32, Vec<u32>>> = HashMap::new();
    for (class, whole_index, part_index) in PART_OF_DIRECTIONS {
        let mut map: HashMap<u32, Vec<u32>> = HashMap::new();
        for rel_id in ids_of(by_type, class) {
            let Some(rel) = entities.get(rel_id) else { continue };
            let wholes = refs(rel.attrs.get(whole_index));
            let parts = refs(rel.attrs.get(part_index));
            for part in parts {
                map.entry(part).or_default().extend(wholes.iter().copied());
            }
        }
        for list in map.values_mut() {
            list.sort_unstable();
            list.dedup();
        }
        out.insert(class.to_owned(), map);
    }
    out
}

fn build_properties(
    entities: &Entities,
    by_type: &HashMap<String, Vec<u32>>,
    type_object: &HashMap<u32, u32>,
    schema_label: &str,
) -> HashMap<u32, ObjectProperties> {
    let mut own: HashMap<u32, Vec<u32>> = HashMap::new();
    for rel_id in ids_of(by_type, "IFCRELDEFINESBYPROPERTIES") {
        let Some(rel) = entities.get(rel_id) else { continue };
        // IFC4 allows a set of property definitions; IFC2x3 has a single reference.
        let definitions = refs(rel.attrs.get(5));
        for object in refs(rel.attrs.get(4)) {
            own.entry(object).or_default().extend(definitions.iter().copied());
        }
    }

    let mut type_sets: HashMap<u32, Vec<u32>> = HashMap::new();
    for type_id in type_object.values().copied().collect::<HashSet<u32>>() {
        if let Some(type_entity) = entities.get(&type_id) {
            // IfcTypeObject: (GlobalId, OwnerHistory, Name, Description, ApplicableOccurrence,
            // HasPropertySets).
            let sets = refs(type_entity.attrs.get(5));
            if !sets.is_empty() {
                type_sets.insert(type_id, sets);
            }
        }
    }

    // A type object's own HasPropertySets belong to the type object as well: check packs
    // legitimately target IfcWallType and friends directly.
    for (class, ids) in by_type {
        if !crate::schema::is_subtype_of(schema_label, class, "IFCTYPEOBJECT") {
            continue;
        }
        for id in ids {
            let Some(entity) = entities.get(id) else { continue };
            let sets = refs(entity.attrs.get(5));
            if !sets.is_empty() {
                own.entry(*id).or_default().extend(sets);
            }
        }
    }

    let mut cache: HashMap<u32, Option<PropertySet>> = HashMap::new();
    let mut out: HashMap<u32, ObjectProperties> = HashMap::new();
    let owners: HashSet<u32> = own.keys().copied().chain(type_object.keys().copied()).collect();
    for object in owners {
        let mut sets: Vec<PropertySet> = Vec::new();
        if let Some(definitions) = own.get(&object) {
            for def in definitions {
                if let Some(set) = property_set(entities, *def, Provenance::Own, &mut cache, schema_label) {
                    sets.push(set);
                }
            }
        }
        if let Some(type_id) = type_object.get(&object) {
            if let Some(definitions) = type_sets.get(type_id) {
                for def in definitions {
                    if let Some(set) = property_set(entities, *def, Provenance::Type, &mut cache, schema_label) {
                        sets.push(set);
                    }
                }
            }
        }
        if !sets.is_empty() {
            out.insert(object, ObjectProperties { sets });
        }
    }
    out
}

fn property_set(
    entities: &Entities,
    id: u32,
    source: Provenance,
    cache: &mut HashMap<u32, Option<PropertySet>>,
    schema_label: &str,
) -> Option<PropertySet> {
    if let Some(hit) = cache.get(&id) {
        return hit.clone().map(|mut set| {
            set.source = source;
            set
        });
    }
    let built = build_property_set(entities, id, schema_label);
    cache.insert(id, built.clone());
    built.map(|mut set| {
        set.source = source;
        set
    })
}

fn build_property_set(entities: &Entities, id: u32, schema_label: &str) -> Option<PropertySet> {
    let e = entities.get(&id)?;
    match e.ty.as_str() {
        "IFCPROPERTYSET" => {
            let name = e.attrs.get(2).and_then(Value::as_str).unwrap_or_default().to_owned();
            let props = refs(e.attrs.get(4))
                .into_iter()
                .filter_map(|p| build_prop(entities, p))
                .collect();
            Some(PropertySet { name, source: Provenance::Own, is_quantity_set: false, props })
        }
        "IFCELEMENTQUANTITY" => {
            let name = e.attrs.get(2).and_then(Value::as_str).unwrap_or_default().to_owned();
            let props = refs(e.attrs.get(5))
                .into_iter()
                .filter_map(|p| build_prop(entities, p))
                .collect();
            Some(PropertySet { name, source: Provenance::Own, is_quantity_set: true, props })
        }
        // IFC4 material property sets.
        "IFCMATERIALPROPERTIES" => {
            let name = e.attrs.first().and_then(Value::as_str).unwrap_or_default().to_owned();
            let props = refs(e.attrs.get(2))
                .into_iter()
                .filter_map(|p| build_prop(entities, p))
                .collect();
            Some(PropertySet { name, source: Provenance::Own, is_quantity_set: false, props })
        }
        // IFC2x3 equivalent: (Material, ExtendedProperties, Description, Name).
        "IFCEXTENDEDMATERIALPROPERTIES" => {
            let name = e.attrs.get(3).and_then(Value::as_str).unwrap_or_default().to_owned();
            let props = refs(e.attrs.get(1))
                .into_iter()
                .filter_map(|p| build_prop(entities, p))
                .collect();
            Some(PropertySet { name, source: Provenance::Own, is_quantity_set: false, props })
        }
        // Predefined property sets (IfcDoorPanelProperties and friends) carry their data as
        // plain attributes. IDS treats them as ordinary properties, so expose each explicit
        // attribute beyond IfcRoot under its schema name.
        other if other.ends_with("PROPERTIES") => {
            let name = e.attrs.get(2).and_then(Value::as_str).unwrap_or_default().to_owned();
            let names = crate::schema::attribute_names(schema_label, other)?;
            let mut props = Vec::new();
            for (index, attr_name) in names.iter().enumerate().skip(4) {
                let Some(value) = e.attrs.get(index) else { continue };
                if value.is_null() {
                    continue;
                }
                props.push(Prop {
                    name: (*attr_name).to_owned(),
                    value: value.clone(),
                    data_type: value.typed_name().map(str::to_owned),
                    unit: None,
                    kind: PropKind::SingleValue,
                });
            }
            (!props.is_empty()).then_some(PropertySet {
                name,
                source: Provenance::Own,
                is_quantity_set: false,
                props,
            })
        }
        _ => None,
    }
}

/// Quantity classes and the IFC measure type of their value attribute (index 3).
const QUANTITY_TYPES: [(&str, &str); 7] = [
    ("IFCQUANTITYLENGTH", "IFCLENGTHMEASURE"),
    ("IFCQUANTITYAREA", "IFCAREAMEASURE"),
    ("IFCQUANTITYVOLUME", "IFCVOLUMEMEASURE"),
    ("IFCQUANTITYCOUNT", "IFCCOUNTMEASURE"),
    ("IFCQUANTITYWEIGHT", "IFCMASSMEASURE"),
    ("IFCQUANTITYTIME", "IFCTIMEMEASURE"),
    ("IFCQUANTITYNUMBER", "IFCNUMERICMEASURE"),
];

fn build_prop(entities: &Entities, id: u32) -> Option<Prop> {
    let e = entities.get(&id)?;
    let name = e.attrs.first().and_then(Value::as_str).unwrap_or_default().to_owned();
    if name.is_empty() {
        return None;
    }
    if let Some((_, measure)) = QUANTITY_TYPES.iter().find(|(ty, _)| *ty == e.ty) {
        let value = e.attrs.get(3).cloned().unwrap_or(Value::Null);
        let unit = e.attrs.get(2).and_then(Value::as_ref_id).and_then(|u| unit_label(entities, u));
        return Some(Prop {
            name,
            value,
            data_type: Some((*measure).to_owned()),
            unit,
            kind: PropKind::Quantity,
        });
    }
    let (value, unit_index, kind) = match e.ty.as_str() {
        "IFCPROPERTYSINGLEVALUE" => (e.attrs.get(2).cloned(), Some(3), PropKind::SingleValue),
        "IFCPROPERTYENUMERATEDVALUE" => (e.attrs.get(2).cloned(), None, PropKind::EnumeratedValue),
        "IFCPROPERTYLISTVALUE" => (e.attrs.get(2).cloned(), Some(3), PropKind::ListValue),
        // IfcPropertyBoundedValue keeps its bounds in two attributes. Both matter to a
        // range check, so they travel together as [upper, lower, setpoint].
        "IFCPROPERTYBOUNDEDVALUE" => (
            Some(Value::List(vec![
                e.attrs.get(2).cloned().unwrap_or(Value::Null),
                e.attrs.get(3).cloned().unwrap_or(Value::Null),
                e.attrs.get(5).cloned().unwrap_or(Value::Null),
            ])),
            Some(4),
            PropKind::BoundedValue,
        ),
        // A table property carries defining and defined columns; IDS compares against both.
        "IFCPROPERTYTABLEVALUE" => {
            let mut items = Vec::new();
            for index in [2usize, 3usize] {
                match e.attrs.get(index) {
                    Some(Value::List(values)) => items.extend(values.iter().cloned()),
                    Some(other) if !other.is_null() => items.push(other.clone()),
                    _ => {}
                }
            }
            (Some(Value::List(items)), None, PropKind::TableValue)
        }
        "IFCPROPERTYREFERENCEVALUE" => (e.attrs.get(3).cloned(), None, PropKind::ReferenceValue),
        _ => (None, None, PropKind::Unsupported),
    };
    let value = value.unwrap_or(Value::Null);
    let data_type = value.typed_name().map(str::to_owned).or_else(|| match &value {
        Value::List(items) => items.first().and_then(Value::typed_name).map(str::to_owned),
        _ => None,
    });
    let unit = unit_index
        .and_then(|i| e.attrs.get(i))
        .and_then(Value::as_ref_id)
        .and_then(|u| unit_label(entities, u));
    Some(Prop { name, value, data_type, unit, kind })
}

fn unit_label(entities: &Entities, id: u32) -> Option<String> {
    let unit = entities.get(&id)?;
    match unit.ty.as_str() {
        "IFCSIUNIT" => {
            let prefix = match unit.attrs.get(2) {
                Some(Value::Enum(p)) => p.clone(),
                _ => String::new(),
            };
            let name = match unit.attrs.get(3) {
                Some(Value::Enum(n)) => n.clone(),
                _ => String::new(),
            };
            Some(format!("{prefix}{name}"))
        }
        "IFCCONVERSIONBASEDUNIT" | "IFCCONVERSIONBASEDUNITWITHOFFSET" => {
            unit.attrs.get(2).and_then(Value::as_str).map(str::to_owned)
        }
        "IFCDERIVEDUNIT" => unit.attrs.get(2).and_then(Value::as_str).map(str::to_owned),
        _ => None,
    }
}

// -------------------------------------------------------------------- classifications

fn build_classifications(
    entities: &Entities,
    by_type: &HashMap<String, Vec<u32>>,
    type_object: &HashMap<u32, u32>,
) -> HashMap<u32, Vec<ClassificationRef>> {
    let mut direct: HashMap<u32, Vec<ClassificationRef>> = HashMap::new();
    for rel_id in ids_of(by_type, "IFCRELASSOCIATESCLASSIFICATION") {
        let Some(rel) = entities.get(rel_id) else { continue };
        let Some(classification) = rel.attrs.get(5).and_then(Value::as_ref_id) else { continue };
        let Some(reference) = classification_ref(entities, classification, Provenance::Own) else {
            continue;
        };
        for object in refs(rel.attrs.get(4)) {
            direct.entry(object).or_default().push(reference.clone());
        }
    }
    // Non-rooted resources (materials, profiles, ...) are classified through
    // IfcExternalReferenceRelationship rather than IfcRelAssociatesClassification.
    for rel_id in ids_of(by_type, "IFCEXTERNALREFERENCERELATIONSHIP") {
        let Some(rel) = entities.get(rel_id) else { continue };
        let Some(reference_id) = rel.attrs.get(2).and_then(Value::as_ref_id) else { continue };
        let Some(reference) = classification_ref(entities, reference_id, Provenance::Own) else {
            continue;
        };
        for object in refs(rel.attrs.get(3)) {
            direct.entry(object).or_default().push(reference.clone());
        }
    }
    let mut out = direct.clone();
    for (object, type_id) in type_object {
        if let Some(inherited) = direct.get(type_id) {
            let entry = out.entry(*object).or_default();
            for reference in inherited {
                let mut inherited_ref = reference.clone();
                inherited_ref.source = Provenance::Type;
                entry.push(inherited_ref);
            }
        }
    }
    out
}

fn classification_ref(
    entities: &Entities,
    id: u32,
    source: Provenance,
) -> Option<ClassificationRef> {
    let e = entities.get(&id)?;
    match e.ty.as_str() {
        "IFCCLASSIFICATIONREFERENCE" => {
            // IFC2x3: (Location, ItemReference, Name, ReferencedSource)
            // IFC4:   (Location, Identification, Name, ReferencedSource, Description, Sort)
            let identification = e.attrs.get(1).and_then(Value::as_str).map(str::to_owned);
            let name = e.attrs.get(2).and_then(Value::as_str).map(str::to_owned);
            let system = e
                .attrs
                .get(3)
                .and_then(Value::as_ref_id)
                .and_then(|src| classification_system_name(entities, src, 0));
            Some(ClassificationRef { system, identification, name, source })
        }
        "IFCCLASSIFICATION" => {
            let name = e.attrs.get(3).and_then(Value::as_str).map(str::to_owned);
            Some(ClassificationRef {
                system: name.clone(),
                identification: None,
                name,
                source,
            })
        }
        _ => None,
    }
}

/// Walk `ReferencedSource` up to the owning `IfcClassification` for the system name.
fn classification_system_name(entities: &Entities, id: u32, depth: u32) -> Option<String> {
    if depth > 8 {
        return None;
    }
    let e = entities.get(&id)?;
    match e.ty.as_str() {
        "IFCCLASSIFICATION" => e.attrs.get(3).and_then(Value::as_str).map(str::to_owned),
        "IFCCLASSIFICATIONREFERENCE" => e
            .attrs
            .get(3)
            .and_then(Value::as_ref_id)
            .and_then(|next| classification_system_name(entities, next, depth + 1)),
        _ => None,
    }
}

// -------------------------------------------------------------------------- materials

fn build_materials(
    entities: &Entities,
    by_type: &HashMap<String, Vec<u32>>,
    type_object: &HashMap<u32, u32>,
) -> HashMap<u32, Vec<MaterialRef>> {
    let mut direct: HashMap<u32, Vec<MaterialRef>> = HashMap::new();
    for rel_id in ids_of(by_type, "IFCRELASSOCIATESMATERIAL") {
        let Some(rel) = entities.get(rel_id) else { continue };
        let Some(material) = rel.attrs.get(5).and_then(Value::as_ref_id) else { continue };
        let mut collected = Vec::new();
        collect_materials(entities, material, Provenance::Own, 0, &mut collected);
        if collected.is_empty() {
            continue;
        }
        for object in refs(rel.attrs.get(4)) {
            direct.entry(object).or_default().extend(collected.iter().cloned());
        }
    }
    let mut out = direct.clone();
    for (object, type_id) in type_object {
        if let Some(inherited) = direct.get(type_id) {
            let entry = out.entry(*object).or_default();
            for material in inherited {
                let mut inherited_material = material.clone();
                inherited_material.source = Provenance::Type;
                entry.push(inherited_material);
            }
        }
    }
    for list in out.values_mut() {
        list.dedup_by(|a, b| a.name == b.name && a.category == b.category && a.source == b.source);
    }
    out
}

fn push_material(
    out: &mut Vec<MaterialRef>,
    name: &str,
    category: Option<String>,
    source: Provenance,
) {
    if name.is_empty() {
        return;
    }
    out.push(MaterialRef { name: name.to_owned(), category, source });
}

fn collect_materials(
    entities: &Entities,
    id: u32,
    source: Provenance,
    depth: u32,
    out: &mut Vec<MaterialRef>,
) {
    if depth > 8 {
        return;
    }
    let Some(e) = entities.get(&id) else { return };
    match e.ty.as_str() {
        "IFCMATERIAL" => {
            if let Some(name) = e.attrs.first().and_then(Value::as_str) {
                let category = e.attrs.get(2).and_then(Value::as_str).map(str::to_owned);
                out.push(MaterialRef { name: name.to_owned(), category, source });
            }
        }
        "IFCMATERIALLIST" => {
            for m in refs(e.attrs.first()) {
                collect_materials(entities, m, source, depth + 1, out);
            }
        }
        "IFCMATERIALLAYERSETUSAGE" | "IFCMATERIALPROFILESETUSAGE"
        | "IFCMATERIALPROFILESETUSAGETAPERING" => {
            if let Some(set) = e.attrs.first().and_then(Value::as_ref_id) {
                collect_materials(entities, set, source, depth + 1, out);
            }
        }
        "IFCMATERIALLAYERSET" => {
            // The layer-set name is itself a material name for IDS purposes.
            if let Some(name) = e.attrs.get(1).and_then(Value::as_str) {
                push_material(out, name, None, source);
            }
            for layer in refs(e.attrs.first()) {
                collect_materials(entities, layer, source, depth + 1, out);
            }
        }
        "IFCMATERIALLAYER" | "IFCMATERIALLAYERWITHOFFSETS" => {
            // IFC4 adds Name (3) and Category (5) on the layer itself.
            let name = e.attrs.get(3).and_then(Value::as_str).map(str::to_owned);
            let category = e.attrs.get(5).and_then(Value::as_str).map(str::to_owned);
            if let Some(name) = name.clone() {
                push_material(out, &name, category.clone(), source);
            } else if let Some(category) = category.clone() {
                push_material(out, &category.clone(), Some(category), source);
            }
            if let Some(m) = e.attrs.first().and_then(Value::as_ref_id) {
                collect_materials(entities, m, source, depth + 1, out);
            }
        }
        "IFCMATERIALPROFILESET" => {
            if let Some(name) = e.attrs.first().and_then(Value::as_str) {
                push_material(out, name, None, source);
            }
            for profile in refs(e.attrs.get(2)) {
                collect_materials(entities, profile, source, depth + 1, out);
            }
        }
        "IFCMATERIALPROFILE" | "IFCMATERIALPROFILEWITHOFFSETS" => {
            let name = e.attrs.first().and_then(Value::as_str).map(str::to_owned);
            let category = e.attrs.get(4).and_then(Value::as_str).map(str::to_owned);
            if let Some(name) = name {
                push_material(out, &name, category.clone(), source);
            } else if let Some(category) = category.clone() {
                push_material(out, &category.clone(), Some(category), source);
            }
            if let Some(m) = e.attrs.get(2).and_then(Value::as_ref_id) {
                collect_materials(entities, m, source, depth + 1, out);
            }
        }
        "IFCMATERIALCONSTITUENTSET" => {
            if let Some(name) = e.attrs.first().and_then(Value::as_str) {
                push_material(out, name, None, source);
            }
            for constituent in refs(e.attrs.get(2)) {
                collect_materials(entities, constituent, source, depth + 1, out);
            }
        }
        "IFCMATERIALCONSTITUENT" => {
            let name = e.attrs.first().and_then(Value::as_str).map(str::to_owned);
            let category = e.attrs.get(4).and_then(Value::as_str).map(str::to_owned);
            if let Some(name) = name {
                push_material(out, &name, category.clone(), source);
            } else if let Some(category) = category.clone() {
                push_material(out, &category.clone(), Some(category), source);
            }
            if let Some(m) = e.attrs.get(2).and_then(Value::as_ref_id) {
                collect_materials(entities, m, source, depth + 1, out);
            }
        }
        _ => {}
    }
}

// ------------------------------------------------------------------------ placements

/// Absolute placements for every instance that carries an `ObjectPlacement`, not just the
/// ones classified as products: callers (fingerprinting, evidence records) may ask about
/// an object the product heuristics rejected, and answering "no placement" there would be
/// a silent wrong answer.
fn build_placements(entities: &Entities, length_to_metre: f64) -> HashMap<u32, Transform> {
    let mut cache: HashMap<u32, Option<Transform>> = HashMap::new();
    let mut out = HashMap::new();
    for (id, e) in entities {
        let Some(index) = placement_index(entities, e) else { continue };
        let Some(placement_id) = e.attrs.get(index).and_then(Value::as_ref_id) else { continue };
        let mut visiting = HashSet::new();
        if let Some(transform) =
            resolve_placement(entities, placement_id, length_to_metre, &mut cache, &mut visiting)
        {
            out.insert(*id, transform);
        }
    }
    out
}

/// Resolve an `IfcLocalPlacement` chain to an absolute transform in metres.
/// `IfcGridPlacement` is not resolvable without the grid geometry, so those products stay
/// without a placement rather than receiving a guessed one.
fn resolve_placement(
    entities: &Entities,
    id: u32,
    scale: f64,
    cache: &mut HashMap<u32, Option<Transform>>,
    visiting: &mut HashSet<u32>,
) -> Option<Transform> {
    if let Some(hit) = cache.get(&id) {
        return *hit;
    }
    if !visiting.insert(id) {
        // Cyclic placement chain in a broken export: stop instead of recursing forever.
        cache.insert(id, None);
        return None;
    }
    let result = (|| {
        let e = entities.get(&id)?;
        if e.ty != "IFCLOCALPLACEMENT" {
            return None;
        }
        let relative = e
            .attrs
            .get(1)
            .and_then(Value::as_ref_id)
            .and_then(|axis| axis_placement(entities, axis, scale))
            .unwrap_or(Transform::IDENTITY);
        match e.attrs.first().and_then(Value::as_ref_id) {
            Some(parent) => {
                let parent_transform =
                    resolve_placement(entities, parent, scale, cache, visiting)
                        .unwrap_or(Transform::IDENTITY);
                Some(parent_transform.compose(&relative))
            }
            None => Some(relative),
        }
    })();
    visiting.remove(&id);
    cache.insert(id, result);
    result
}

fn axis_placement(entities: &Entities, id: u32, scale: f64) -> Option<Transform> {
    let e = entities.get(&id)?;
    match e.ty.as_str() {
        "IFCAXIS2PLACEMENT3D" => {
            let origin = e
                .attrs
                .first()
                .and_then(Value::as_ref_id)
                .and_then(|p| cartesian_point(entities, p, scale))
                .unwrap_or([0.0, 0.0, 0.0]);
            let z = e
                .attrs
                .get(1)
                .and_then(Value::as_ref_id)
                .and_then(|d| direction(entities, d))
                .unwrap_or([0.0, 0.0, 1.0]);
            let x = e
                .attrs
                .get(2)
                .and_then(Value::as_ref_id)
                .and_then(|d| direction(entities, d))
                .unwrap_or([1.0, 0.0, 0.0]);
            Some(orthonormal(origin, x, z))
        }
        "IFCAXIS2PLACEMENT2D" => {
            let origin = e
                .attrs
                .first()
                .and_then(Value::as_ref_id)
                .and_then(|p| cartesian_point(entities, p, scale))
                .unwrap_or([0.0, 0.0, 0.0]);
            let x = e
                .attrs
                .get(1)
                .and_then(Value::as_ref_id)
                .and_then(|d| direction(entities, d))
                .unwrap_or([1.0, 0.0, 0.0]);
            Some(orthonormal(origin, x, [0.0, 0.0, 1.0]))
        }
        _ => None,
    }
}

fn cartesian_point(entities: &Entities, id: u32, scale: f64) -> Option<[f64; 3]> {
    let e = entities.get(&id)?;
    if e.ty != "IFCCARTESIANPOINT" {
        return None;
    }
    let coords = e.attrs.first()?.as_list()?;
    let mut out = [0.0; 3];
    for (i, slot) in out.iter_mut().enumerate() {
        *slot = coords.get(i).and_then(Value::as_f64).unwrap_or(0.0) * scale;
    }
    Some(out)
}

fn direction(entities: &Entities, id: u32) -> Option<[f64; 3]> {
    let e = entities.get(&id)?;
    if e.ty != "IFCDIRECTION" {
        return None;
    }
    let ratios = e.attrs.first()?.as_list()?;
    let mut out = [0.0; 3];
    for (i, slot) in out.iter_mut().enumerate() {
        *slot = ratios.get(i).and_then(Value::as_f64).unwrap_or(0.0);
    }
    Some(out)
}

fn normalize(v: [f64; 3]) -> Option<[f64; 3]> {
    let len = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    if !len.is_finite() || len < 1e-12 {
        return None;
    }
    Some([v[0] / len, v[1] / len, v[2] / len])
}

fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/// Build a right-handed orthonormal frame from a Z axis and a reference X direction,
/// exactly as IFC defines `IfcAxis2Placement3D`.
fn orthonormal(origin: [f64; 3], x_ref: [f64; 3], z_ref: [f64; 3]) -> Transform {
    let z = normalize(z_ref).unwrap_or([0.0, 0.0, 1.0]);
    let projected = {
        let d = dot(x_ref, z);
        [x_ref[0] - z[0] * d, x_ref[1] - z[1] * d, x_ref[2] - z[2] * d]
    };
    let x = normalize(projected).unwrap_or_else(|| {
        // The reference direction was parallel to Z: pick any perpendicular axis.
        let candidate = if z[0].abs() < 0.9 { [1.0, 0.0, 0.0] } else { [0.0, 1.0, 0.0] };
        let d = dot(candidate, z);
        normalize([candidate[0] - z[0] * d, candidate[1] - z[1] * d, candidate[2] - z[2] * d])
            .unwrap_or([1.0, 0.0, 0.0])
    });
    let y = cross(z, x);
    Transform { origin, x_axis: x, y_axis: y, z_axis: z }
}
