//! CLI used by scripts/verify-model-contracts.mjs to prove a real Rust consumer can
//! parse a payload another language produced. Not part of the crate's public API.
//!
//! Usage: consume <object-ref|model-descriptor|semantic-model|render-manifest> <path>

use model_contracts::{parse_model_descriptor, parse_object_ref, parse_render_manifest, parse_semantic_model};
use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [kind, path] = &args[..] else {
        eprintln!("usage: consume <object-ref|model-descriptor|semantic-model|render-manifest> <path>");
        return ExitCode::from(2);
    };
    let json = match std::fs::read_to_string(path) {
        Ok(json) => json,
        Err(err) => {
            eprintln!("cannot read {path}: {err}");
            return ExitCode::from(2);
        }
    };
    let result: Result<String, String> = match kind.as_str() {
        "object-ref" => parse_object_ref(&json).map(|v| format!("{v:?}")).map_err(|e| e.to_string()),
        "model-descriptor" => {
            parse_model_descriptor(&json).map(|v| format!("{v:?}")).map_err(|e| e.to_string())
        }
        "semantic-model" => {
            parse_semantic_model(&json).map(|v| format!("{v:?}")).map_err(|e| e.to_string())
        }
        "render-manifest" => {
            parse_render_manifest(&json).map(|v| format!("{v:?}")).map_err(|e| e.to_string())
        }
        other => {
            eprintln!("unknown kind: {other}");
            return ExitCode::from(2);
        }
    };
    match result {
        Ok(_) => {
            println!("ok");
            ExitCode::SUCCESS
        }
        Err(err) => {
            eprintln!("{err}");
            ExitCode::FAILURE
        }
    }
}
