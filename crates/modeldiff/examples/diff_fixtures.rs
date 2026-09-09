//! Diffs two revisions from the worker's normalized artifacts — no IFC parser,
//! service, or database involved — printing each object's classification keyed
//! by GlobalId. Used to independently verify `packs/demo/fixtures/oracle.json`
//! against the fixtures `scripts/generate-demo-fixtures.py` produced.
//!
//! Produce the inputs by running the real worker over each fixture:
//!   uv run --locked --project services/ifc-worker ifc-worker --request <job>.json
//! then point this at the `semantic.json` / `geometry.jsonl` pair it wrote.
//!
//! Usage: cargo run -p modeldiff --example diff_fixtures -- \
//!          <base-semantic.json> <base-geometry.jsonl> \
//!          <head-semantic.json> <head-geometry.jsonl>

use std::collections::HashMap;
use std::fs;

use fingerprint::normalized::FingerprintProfile;
use fingerprint::{snapshot_from_normalized, ObjectSnapshot};
use model_contracts::{parse_geometry_chunk, parse_semantic_model, GeometryChunk};
use modeldiff::{ChangeKind, DiffOptions};

/// Join one revision's semantic records with its geometry chunks by `ObjectRef`,
/// exactly as the checker does at ingestion.
fn load(semantic_path: &str, geometry_path: &str, profile: &FingerprintProfile) -> Vec<ObjectSnapshot> {
    let semantic_text = fs::read_to_string(semantic_path).expect("read semantic.json");
    let model = parse_semantic_model(&semantic_text).expect("semantic.json validates");
    let mut chunks: HashMap<String, GeometryChunk> = HashMap::new();
    if !geometry_path.is_empty() {
        let geometry_text = fs::read_to_string(geometry_path).expect("read geometry.jsonl");
        for line in geometry_text.lines().filter(|line| !line.trim().is_empty()) {
            let chunk = parse_geometry_chunk(line).expect("geometry chunk validates");
            chunks.insert(chunk.ref_.object_id.to_string(), chunk);
        }
    }
    model
        .objects
        .iter()
        .map(|object| {
            snapshot_from_normalized(object, chunks.get(object.ref_.object_id.as_str()), profile)
        })
        .collect()
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [base_semantic, base_geometry, head_semantic, head_geometry] = args.as_slice() else {
        eprintln!(
            "usage: diff_fixtures <base-semantic.json> <base-geometry.jsonl> \
             <head-semantic.json> <head-geometry.jsonl>"
        );
        std::process::exit(2);
    };

    let profile = FingerprintProfile::v1();
    let base_snapshots = load(base_semantic, base_geometry, &profile);
    let head_snapshots = load(head_semantic, head_geometry, &profile);
    println!("base objects: {}, head objects: {}", base_snapshots.len(), head_snapshots.len());

    let diff = modeldiff::diff(&base_snapshots, &head_snapshots, &DiffOptions::default());
    println!(
        "summary: added={} removed={} unchanged={} moved={} shape_changed={} properties_changed={} mixed={} uncertain_matches={}",
        diff.summary.added,
        diff.summary.removed,
        diff.summary.unchanged,
        diff.summary.moved,
        diff.summary.shape_changed,
        diff.summary.properties_changed,
        diff.summary.mixed,
        diff.summary.uncertain_matches,
    );

    let mut by_kind: std::collections::HashMap<&str, Vec<String>> = std::collections::HashMap::new();
    for change in &diff.changes {
        let global_id = change
            .head
            .as_ref()
            .or(change.base.as_ref())
            .and_then(|r| r.global_id.clone())
            .unwrap_or_else(|| "(none)".to_owned());
        let name = change
            .head
            .as_ref()
            .or(change.base.as_ref())
            .and_then(|r| r.name.clone())
            .unwrap_or_default();
        let kind = match change.kind {
            ChangeKind::Added => "added",
            ChangeKind::Removed => "removed",
            ChangeKind::Unchanged => "unchanged",
            ChangeKind::Moved => "moved",
            ChangeKind::ShapeChanged => "shape_changed",
            ChangeKind::PropertiesChanged => "properties_changed",
            ChangeKind::Mixed => "mixed",
        };
        by_kind.entry(kind).or_default().push(format!("{name} [{global_id}] notes={:?}", change.notes));
    }
    for (kind, mut entries) in by_kind {
        entries.sort();
        println!("\n-- {kind} ({}) --", entries.len());
        for entry in entries.iter().filter(|e| !e.starts_with("Repeat-")) {
            println!("  {entry}");
        }
        let repeats = entries.iter().filter(|e| e.starts_with("Repeat-")).count();
        if repeats > 0 {
            println!("  ... plus {repeats} Repeat-* object(s)");
        }
    }
}
