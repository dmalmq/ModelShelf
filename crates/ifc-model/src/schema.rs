//! Attribute-position lookup backed by the official IFC EXPRESS schemas.
//!
//! `schema_tables.rs` is generated from IFC2X3 TC1 and IFC4 ADD2 TC1. Instance attribute
//! order in a STEP file is "supertype attributes first, then own", so resolving a name to
//! a position is a matter of walking the inheritance chain once per class.
//!
//! Classes outside those two schemas (e.g. IFC4X3-only entities) are simply unknown here;
//! callers fall back to structural detection and, failing that, report the attribute as
//! unreadable rather than guessing a position.

use std::collections::HashMap;
use std::sync::LazyLock;

use crate::schema_tables::SCHEMA_TABLES;

pub struct SchemaInfo {
    /// Class -> instance attribute names in STEP order.
    attrs: HashMap<&'static str, Vec<&'static str>>,
    /// Class -> ancestor chain, nearest supertype first.
    ancestors: HashMap<&'static str, Vec<&'static str>>,
}

impl SchemaInfo {
    pub fn attribute_names(&self, class: &str) -> Option<&[&'static str]> {
        self.attrs.get(class).map(|v| v.as_slice())
    }
    pub fn attribute_index(&self, class: &str, attribute: &str) -> Option<usize> {
        self.attrs
            .get(class)?
            .iter()
            .position(|candidate| candidate.eq_ignore_ascii_case(attribute))
    }
    pub fn is_subtype_of(&self, class: &str, ancestor: &str) -> bool {
        if class.eq_ignore_ascii_case(ancestor) {
            return self.attrs.contains_key(class);
        }
        self.ancestors
            .get(class)
            .map(|chain| chain.iter().any(|a| a.eq_ignore_ascii_case(ancestor)))
            .unwrap_or(false)
    }
    pub fn knows(&self, class: &str) -> bool {
        self.attrs.contains_key(class)
    }
}

static TABLES: LazyLock<HashMap<&'static str, SchemaInfo>> = LazyLock::new(build_tables);

fn build_tables() -> HashMap<&'static str, SchemaInfo> {
    let mut out: HashMap<&'static str, SchemaInfo> = HashMap::new();
    let mut current: Option<&'static str> = None;
    let mut declared: HashMap<&'static str, (Option<&'static str>, Vec<&'static str>)> =
        HashMap::new();

    let flush = |label: Option<&'static str>,
                 declared: &mut HashMap<&'static str, (Option<&'static str>, Vec<&'static str>)>,
                 out: &mut HashMap<&'static str, SchemaInfo>| {
        if let Some(label) = label {
            out.insert(label, resolve(std::mem::take(declared)));
        }
    };

    for line in SCHEMA_TABLES.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(label) = line.strip_prefix('#') {
            flush(current, &mut declared, &mut out);
            current = Some(label);
            continue;
        }
        let mut parts = line.split('|');
        let (Some(class), Some(supertype), Some(attrs)) =
            (parts.next(), parts.next(), parts.next())
        else {
            continue;
        };
        let own: Vec<&'static str> =
            attrs.split(',').map(str::trim).filter(|a| !a.is_empty()).collect();
        let supertype = if supertype.is_empty() { None } else { Some(supertype) };
        declared.insert(class, (supertype, own));
    }
    flush(current, &mut declared, &mut out);
    out
}

/// Flatten declared attributes into instance order and record ancestor chains.
fn resolve(
    declared: HashMap<&'static str, (Option<&'static str>, Vec<&'static str>)>,
) -> SchemaInfo {
    let mut attrs: HashMap<&'static str, Vec<&'static str>> = HashMap::new();
    let mut ancestors: HashMap<&'static str, Vec<&'static str>> = HashMap::new();

    for class in declared.keys().copied() {
        let mut chain: Vec<&'static str> = Vec::new();
        let mut cursor = class;
        // Bounded walk: a malformed table must not spin here.
        for _ in 0..64 {
            match declared.get(cursor).and_then(|(supertype, _)| *supertype) {
                Some(parent) => {
                    if chain.contains(&parent) {
                        break;
                    }
                    chain.push(parent);
                    cursor = parent;
                }
                None => break,
            }
        }
        let mut ordered: Vec<&'static str> = Vec::new();
        for ancestor in chain.iter().rev() {
            if let Some((_, own)) = declared.get(ancestor) {
                ordered.extend(own.iter().copied());
            }
        }
        if let Some((_, own)) = declared.get(class) {
            ordered.extend(own.iter().copied());
        }
        attrs.insert(class, ordered);
        ancestors.insert(class, chain);
    }
    SchemaInfo { attrs, ancestors }
}

/// Section key for a schema label: everything in the IFC4 family shares one table.
fn section_for(schema_label: &str) -> &'static str {
    if schema_label.starts_with("IFC2X") {
        "IFC2X3"
    } else {
        "IFC4"
    }
}

/// Look up a class, preferring the model's own schema and falling back to the other one.
///
/// The fallback matters in practice: Japanese deliveries mix IFC2X3 (図面審査) and IFC4
/// exports, and a class that only exists in the other schema is still better resolved from
/// a real table than from a guess.
pub fn info_for(schema_label: &str, class: &str) -> Option<&'static SchemaInfo> {
    let preferred = section_for(schema_label);
    if let Some(info) = TABLES.get(preferred) {
        if info.knows(class) {
            return Some(info);
        }
    }
    TABLES.values().find(|info| info.knows(class))
}

pub fn attribute_index(schema_label: &str, class: &str, attribute: &str) -> Option<usize> {
    info_for(schema_label, class)?.attribute_index(class, attribute)
}

pub fn attribute_names(schema_label: &str, class: &str) -> Option<&'static [&'static str]> {
    info_for(schema_label, class)?.attribute_names(class)
}

pub fn is_subtype_of(schema_label: &str, class: &str, ancestor: &str) -> bool {
    info_for(schema_label, class)
        .map(|info| info.is_subtype_of(class, ancestor))
        .unwrap_or(false)
}

pub fn knows_class(schema_label: &str, class: &str) -> bool {
    info_for(schema_label, class).map(|info| info.knows(class)).unwrap_or(false)
}
