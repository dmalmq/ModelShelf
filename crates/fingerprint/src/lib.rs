//! `fingerprint` — deterministic content fingerprints for revision comparison.
//!
//! Identity vs state:
//! - Persistent identity is `(source model slot, IfcGlobalId)`. Fingerprints never
//!   establish identity.
//! - Fingerprints answer whether information, placement, or representation changed.
//!
//! Live path: [`normalized`]. Ingest calls [`normalized::fingerprint_normalized`]
//! over the worker's `SemanticObject` plus optional `GeometryChunk` under an
//! explicit [`normalized::FingerprintProfile`]. Comparison consumes
//! [`normalized::DerivedSnapshot`] and [`normalized::Fingerprints`]. There is one
//! `Fingerprints` type: [`normalized::Fingerprints`].
//!
//! Shape hashes object-local tessellated triangles (see
//! [`normalized::shape_preimage`]), not an IFC representation graph. This crate
//! does not depend on `ifc-model`.
//!
//! All public types and functions live in [`normalized`]. Import paths such as
//! `fingerprint::normalized::Fingerprints` are the stable cross-crate contract.

pub mod normalized;
