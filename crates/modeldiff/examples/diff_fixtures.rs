//! Parses two real IFC files, fingerprints both, and runs `modeldiff::diff`
//! directly — no service/database involved — printing each object's
//! classification keyed by GlobalId. Used to independently verify
//! `packs/demo/fixtures/oracle.json` against the fixtures
//! `scripts/generate-demo-fixtures.py` produced.
//!
//! Usage: cargo run -p modeldiff --example diff_fixtures -- <base.ifc> <head.ifc>

use std::fs;

use fingerprint::FpOptions;
use ifc_model::IfcModel;
use modeldiff::{ChangeKind, DiffOptions};

fn main() {
    let mut args = std::env::args().skip(1);
    let (Some(base_path), Some(head_path)) = (args.next(), args.next()) else {
        eprintln!("usage: diff_fixtures <base.ifc> <head.ifc>");
        std::process::exit(2);
    };

    let base_bytes = fs::read(&base_path).expect("read base");
    let head_bytes = fs::read(&head_path).expect("read head");
    let base_model = IfcModel::parse(&base_bytes).expect("parse base");
    let head_model = IfcModel::parse(&head_bytes).expect("parse head");

    let opts = FpOptions::default();
    let base_snapshots = fingerprint::snapshot_model(&base_model, &opts);
    let head_snapshots = fingerprint::snapshot_model(&head_model, &opts);
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
