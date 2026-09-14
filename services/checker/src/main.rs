//! ModelShelf checker service.
//!
//! Commands:
//!   modelshelf-checker serve [--port 8787] [--data-dir ./data]
//!   modelshelf-checker seed  [--data-dir ./data] [--packs-dir packs] [--samples-dir samples/ifc]
//!
//! Contract: docs/contracts/http-api.md + services/checker/migrations/*.sql.

mod db;
mod decisions;
mod diff;
mod dto;
mod error;
mod ids_meta;
mod jobs;
mod migrate_v2;
mod routes;
mod run;
mod seed;
mod sources;
mod state;
mod upload;
mod worker_slot;

use std::net::SocketAddr;
use std::path::PathBuf;

use tower_http::cors::CorsLayer;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::trace::TraceLayer;

use crate::state::AppState;

const MAX_BODY_BYTES: usize = 512 * 1024 * 1024;

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "modelshelf_checker=info,tower_http=info".into()),
        )
        .init();

    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(command) = args.first().map(String::as_str) else {
        usage_and_exit(2);
    };

    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("tokio runtime");

    let code = match command {
        "serve" => {
            let mut port: u16 = 8787;
            let mut data_dir = PathBuf::from("./data");
            let mut worker_command = jobs::DEFAULT_WORKER_COMMAND.to_owned();
            let mut rest = &args[1..];
            while let Some((flag, tail)) = rest.split_first() {
                match flag.as_str() {
                    "--port" => {
                        let Some((value, t2)) = tail.split_first() else {
                            eprintln!("--port needs a value");
                            usage_and_exit(2);
                        };
                        port = value.parse().unwrap_or_else(|_| {
                            eprintln!("invalid --port value: {value}");
                            std::process::exit(2);
                        });
                        rest = t2;
                    }
                    "--data-dir" => {
                        let Some((value, t2)) = tail.split_first() else {
                            eprintln!("--data-dir needs a value");
                            usage_and_exit(2);
                        };
                        data_dir = PathBuf::from(value);
                        rest = t2;
                    }
                    "--worker-command" => {
                        let Some((value, t2)) = tail.split_first() else {
                            eprintln!("--worker-command needs a value");
                            usage_and_exit(2);
                        };
                        worker_command = value.clone();
                        rest = t2;
                    }
                    other => {
                        eprintln!("unknown flag: {other}");
                        usage_and_exit(2);
                    }
                }
            }
            rt.block_on(serve(port, data_dir, worker_command))
        }
        "seed" => {
            let mut data_dir = PathBuf::from("./data");
            let mut packs_dir = PathBuf::from("packs");
            let mut samples_dir = PathBuf::from("samples/ifc");
            let mut rest = &args[1..];
            while let Some((flag, tail)) = rest.split_first() {
                let target = match flag.as_str() {
                    "--data-dir" => &mut data_dir,
                    "--packs-dir" => &mut packs_dir,
                    "--samples-dir" => &mut samples_dir,
                    other => {
                        eprintln!("unknown flag: {other}");
                        usage_and_exit(2);
                    }
                };
                let Some((value, t2)) = tail.split_first() else {
                    eprintln!("{flag} needs a value");
                    usage_and_exit(2);
                };
                *target = PathBuf::from(value);
                rest = t2;
            }
            rt.block_on(seed::run_seed(&data_dir, &packs_dir, &samples_dir))
        }
        "-h" | "--help" | "help" => {
            print_usage();
            0
        }
        other => {
            eprintln!("unknown command: {other}");
            usage_and_exit(2);
        }
    };
    std::process::exit(code);
}

fn print_usage() {
    eprintln!(
        "modelshelf-checker\n\
         \n\
         USAGE:\n\
         \x20 modelshelf-checker serve [--port 8787] [--data-dir ./data] [--worker-command <template>]\n\
         \x20 modelshelf-checker seed  [--data-dir ./data] [--packs-dir packs] [--samples-dir samples/ifc]"
    );
}

fn usage_and_exit(code: i32) -> ! {
    print_usage();
    std::process::exit(code);
}

pub fn build_router(state: AppState) -> axum::Router {
    routes::router()
        // axum's Multipart extractor enforces its own 2 MiB default independently of
        // RequestBodyLimitLayer below; a real IFC upload is routinely larger than that.
        .layer(axum::extract::DefaultBodyLimit::max(MAX_BODY_BYTES))
        .layer(RequestBodyLimitLayer::new(MAX_BODY_BYTES))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

async fn serve(port: u16, data_dir: PathBuf, worker_command: String) -> i32 {
    let (state, reconciled) = match AppState::open(&data_dir, worker_command).await {
        Ok(opened) => opened,
        Err(err) => {
            eprintln!("failed to open data dir {}: {err:#}", data_dir.display());
            return 1;
        }
    };
    tracing::info!(
        ingestion_jobs_failed = reconciled.ingestion_jobs_failed,
        runs_failed = reconciled.runs_failed,
        orphan_worker = ?reconciled.orphan_worker,
        "adopted the heavy worker slot",
    );
    jobs::spawn_worker(state.clone());
    let app = build_router(state);
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => listener,
        Err(err) => {
            eprintln!("failed to bind {addr}: {err}");
            return 1;
        }
    };
    tracing::info!(%addr, "modelshelf-checker listening");
    if let Err(err) = axum::serve(listener, app).await {
        eprintln!("server error: {err}");
        return 1;
    }
    0
}
