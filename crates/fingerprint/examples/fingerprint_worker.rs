use std::collections::HashMap;
use std::path::PathBuf;

use fingerprint::normalized::{fingerprint_normalized, FingerprintProfile};
use model_contracts::{parse_geometry_chunk, parse_semantic_model};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 4 {
        eprintln!("usage: fingerprint_worker <semantic.json> <geometry.jsonl> <out.jsonl>");
        std::process::exit(2);
    }
    let semantic_path = PathBuf::from(&args[1]);
    let geometry_path = PathBuf::from(&args[2]);
    let out_path = PathBuf::from(&args[3]);

    let semantic_text = std::fs::read_to_string(&semantic_path).expect("read semantic.json");
    let model = parse_semantic_model(&semantic_text).expect("semantic.json validates");
    let geometry_text = std::fs::read_to_string(&geometry_path).expect("read geometry.jsonl");
    let mut chunks: HashMap<String, model_contracts::GeometryChunk> = HashMap::new();
    for line in geometry_text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let chunk = parse_geometry_chunk(line).expect("geometry chunk validates");
        chunks.insert(chunk.ref_.object_id.to_string(), chunk);
    }

    let profile = FingerprintProfile::v1();
    let mut out = String::new();
    for obj in &model.objects {
        let id = obj.ref_.object_id.to_string();
        let snap = fingerprint_normalized(obj, chunks.get(&id), &profile);
        let native = obj.native_ids.as_ref();
        let row = serde_json::json!({
            "object_id": snap.object_id,
            "profile_version": snap.profile_version,
            "profile_id": snap.profile_id,
            "classification": obj.classification.to_string(),
            "express_id": native.and_then(|n| n.express_id),
            "global_id": native.and_then(|n| n.global_id.as_ref().map(|g| g.to_string())),
            "fp_properties": snap.fingerprints.properties,
            "fp_placement": snap.fingerprints.placement,
            "fp_shape": snap.fingerprints.shape,
            "fp_combined": snap.fingerprints.combined,
        });
        out.push_str(&serde_json::to_string(&row).expect("serialize row"));
        out.push('\n');
    }
    std::fs::write(&out_path, out).expect("write snapshots");
    eprintln!(
        "fingerprinted {} objects under {}",
        model.objects.len(),
        profile.profile_version
    );
}
