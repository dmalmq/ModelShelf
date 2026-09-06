//! Conformance harness against the official buildingSMART IDS test corpus.
//!
//! The corpus lives outside the repository (CC-BY-ND, see `docs/limitations.md`); point
//! `IDS_TESTCASES_DIR` at it or keep it at `.local/ids-testcases`. When it is absent the
//! test skips instead of failing, so a fresh clone is not blocked on licensed data.
//!
//! Bar: `pass-*` cases must yield `Outcome::Pass` for every specification, `fail-*` cases
//! must yield at least one `Outcome::Fail`. "Review incomplete" is deliberately NOT
//! accepted as a pass — an engine that cannot decide has not verified anything.
//! Known gaps are listed in `tests/known-gaps.txt` with a reason; the harness fails if a
//! listed case starts conforming (so the file cannot rot into an alibi) and fails if the
//! overall rate drops below `MIN_CONFORMANCE`.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use ids::{Ids, Outcome};
use ifc_model::IfcModel;

/// Regression floor, not an aspiration: raise it when the engine improves.
const MIN_CONFORMANCE: f64 = 0.93;

fn corpus_dir() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("IDS_TESTCASES_DIR") {
        let path = PathBuf::from(dir);
        return path.is_dir().then_some(path);
    }
    let default =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../.local/ids-testcases");
    default.is_dir().then_some(default)
}

fn known_gaps() -> BTreeMap<String, String> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/known-gaps.txt");
    let Ok(text) = std::fs::read_to_string(path) else { return BTreeMap::new() };
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .filter_map(|line| {
            let (case, reason) = line.split_once(" - ").or_else(|| line.split_once(" — "))?;
            Some((case.trim().to_owned(), reason.trim().to_owned()))
        })
        .collect()
}

struct Case {
    key: String,
    ids_path: PathBuf,
    ifc_path: PathBuf,
    expect_pass: bool,
}

fn collect_cases(root: &Path) -> Vec<Case> {
    let mut cases = Vec::new();
    let Ok(facets) = std::fs::read_dir(root) else { return cases };
    for facet in facets.filter_map(Result::ok) {
        if !facet.path().is_dir() {
            continue;
        }
        let facet_name = facet.file_name().to_string_lossy().into_owned();
        if facet_name.starts_with('_') {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(facet.path()) else { continue };
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("ids") {
                continue;
            }
            let ifc_path = path.with_extension("ifc");
            if !ifc_path.is_file() {
                continue;
            }
            let file_name = path.file_name().unwrap_or_default().to_string_lossy().into_owned();
            let expect_pass = match file_name.split('-').next() {
                Some("pass") => true,
                Some("fail") => false,
                // `invalid-*` cases test authoring-time validation, not model checking.
                _ => continue,
            };
            cases.push(Case {
                key: format!("{facet_name}/{file_name}"),
                ids_path: path,
                ifc_path,
                expect_pass,
            });
        }
    }
    cases.sort_by(|a, b| a.key.cmp(&b.key));
    cases
}

/// `Ok(())` when the engine's verdict matches the case's expectation.
fn run_case(case: &Case) -> Result<(), String> {
    let xml = std::fs::read_to_string(&case.ids_path).map_err(|e| format!("read ids: {e}"))?;
    let ids = Ids::parse(&xml).map_err(|e| format!("parse ids: {e}"))?;
    let bytes = std::fs::read(&case.ifc_path).map_err(|e| format!("read ifc: {e}"))?;
    let model = IfcModel::parse(&bytes).map_err(|e| format!("parse ifc: {e}"))?;
    let report = ids::evaluate(&model, &ids);

    let outcomes: Vec<Outcome> = report.specs.iter().map(|s| s.outcome).collect();
    if case.expect_pass {
        if outcomes.iter().all(|o| *o == Outcome::Pass) {
            return Ok(());
        }
        let detail = report
            .specs
            .iter()
            .map(|s| {
                let reason = s
                    .outcomes
                    .first()
                    .map(|o| {
                        o.incomplete_reason.clone().unwrap_or_else(|| {
                            format!(
                                "{} expected {} actual {}",
                                o.requirement,
                                o.expected.clone().unwrap_or_default(),
                                o.actual.clone().unwrap_or_default()
                            )
                        })
                    })
                    .or_else(|| s.notes.first().cloned())
                    .unwrap_or_default();
                format!("{:?}({reason})", s.outcome)
            })
            .collect::<Vec<_>>()
            .join("; ");
        Err(format!("expected all specs to pass, got {detail}"))
    } else {
        if outcomes.iter().any(|o| *o == Outcome::Fail) {
            return Ok(());
        }
        Err(format!("expected at least one failing spec, got {outcomes:?}"))
    }
}

#[test]
fn official_ids_corpus() {
    let Some(root) = corpus_dir() else {
        eprintln!("skipping: IDS conformance corpus not available");
        return;
    };
    let cases = collect_cases(&root);
    assert!(cases.len() > 100, "expected the full corpus, found {} cases", cases.len());

    let gaps = known_gaps();
    let mut conforming = 0usize;
    let mut unexpected_failures: Vec<String> = Vec::new();
    let mut fixed_gaps: Vec<String> = Vec::new();
    let mut per_facet: BTreeMap<String, (usize, usize)> = BTreeMap::new();
    let mut seen_gaps: BTreeSet<String> = BTreeSet::new();

    for case in &cases {
        let facet = case.key.split('/').next().unwrap_or("?").to_owned();
        let entry = per_facet.entry(facet).or_insert((0, 0));
        entry.1 += 1;
        match run_case(case) {
            Ok(()) => {
                conforming += 1;
                entry.0 += 1;
                if gaps.contains_key(&case.key) {
                    fixed_gaps.push(case.key.clone());
                }
            }
            Err(reason) => {
                if gaps.contains_key(&case.key) {
                    seen_gaps.insert(case.key.clone());
                } else {
                    unexpected_failures.push(format!("{}: {reason}", case.key));
                }
            }
        }
    }

    let rate = conforming as f64 / cases.len() as f64;
    println!(
        "conformance: {conforming}/{} ({:.1}%) - {} known gaps",
        cases.len(),
        rate * 100.0,
        seen_gaps.len()
    );
    for (facet, (ok, total)) in &per_facet {
        println!("  {facet}: {ok}/{total}");
    }
    if !unexpected_failures.is_empty() {
        println!("unexpected failures ({}):", unexpected_failures.len());
        for failure in unexpected_failures.iter().take(200) {
            println!("  {failure}");
        }
    }

    assert!(
        fixed_gaps.is_empty(),
        "these cases now conform and must be removed from known-gaps.txt: {fixed_gaps:?}"
    );
    assert!(
        unexpected_failures.is_empty(),
        "{} case(s) regressed or are undocumented; add them to known-gaps.txt with a reason or fix the engine",
        unexpected_failures.len()
    );
    assert!(
        rate >= MIN_CONFORMANCE,
        "conformance {:.1}% dropped below the {:.0}% floor",
        rate * 100.0,
        MIN_CONFORMANCE * 100.0
    );
}
