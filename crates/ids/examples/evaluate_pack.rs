//! Evaluate one IDS pack against one or more real IFC files directly, with no
//! service/database/worker involved — the same `ifc_model::IfcModel::parse` +
//! `ids::evaluate` path `services/checker/src/run.rs` uses for a real run, but
//! runnable standalone so a pack author can sanity-check specifications
//! against real models before wiring them into anything.
//!
//! Usage: cargo run -p ids --example evaluate_pack -- <pack.ids> <model.ifc>...

use std::fs;

fn main() {
    let mut args = std::env::args().skip(1);
    let Some(pack_path) = args.next() else {
        eprintln!("usage: evaluate_pack <pack.ids> <model.ifc>...");
        std::process::exit(2);
    };
    let model_paths: Vec<String> = args.collect();
    if model_paths.is_empty() {
        eprintln!("usage: evaluate_pack <pack.ids> <model.ifc>...");
        std::process::exit(2);
    }

    let xml = fs::read_to_string(&pack_path).unwrap_or_else(|err| {
        eprintln!("cannot read {pack_path}: {err}");
        std::process::exit(1);
    });
    let pack = ids::Ids::parse(&xml).unwrap_or_else(|err| {
        eprintln!("{pack_path} is not valid IDS: {err}");
        std::process::exit(1);
    });
    println!("pack: {} ({} specification(s))\n", pack_path, pack.specifications.len());

    for model_path in &model_paths {
        let bytes = fs::read(model_path).unwrap_or_else(|err| {
            eprintln!("cannot read {model_path}: {err}");
            std::process::exit(1);
        });
        let model = ifc_model::IfcModel::parse(&bytes).unwrap_or_else(|err| {
            eprintln!("{model_path}: parse error: {err}");
            std::process::exit(1);
        });
        let report = ids::evaluate(&model, &pack);
        println!("== {model_path} ({} products) ==", model.products().len());
        for spec in &report.specs {
            println!(
                "  [{:?}] {} — applicable={} pass={} fail={} incomplete={}",
                spec.outcome,
                spec.name,
                spec.applicable_count,
                spec.pass_count,
                spec.fail_count,
                spec.incomplete_count,
            );
            for note in &spec.notes {
                println!("      note: {note}");
            }
            for outcome in spec.outcomes.iter().take(3) {
                println!(
                    "      e.g. #{} {} {:?} — expected {:?}, actual {:?}{}",
                    outcome.express_id,
                    outcome.ifc_type,
                    outcome.name,
                    outcome.expected,
                    outcome.actual,
                    outcome
                        .incomplete_reason
                        .as_ref()
                        .map(|r| format!(" (incomplete: {r})"))
                        .unwrap_or_default(),
                );
            }
        }
        println!(
            "  totals: pass={} fail={} not_applicable={} incomplete={}\n",
            report.total_pass, report.total_fail, report.total_not_applicable, report.total_incomplete
        );
    }
}
