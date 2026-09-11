# ModelShelf

A local BIM delivery checker: Rust/Axum service, SQLite storage, a Next.js frontend, and (later) an IfcOpenShell/IfcTester worker. See [`VISION.md`](VISION.md) for the accept/resist policy. See [`CONTEXT.md`](CONTEXT.md) for domain terms and [the GitHub ticket set](docs/agents/issue-tracker.md) for prototype work.

## Backend service (`modelshelf-checker`)

Build once:

```sh
cargo build -p modelshelf-checker
```

Commands:

```sh
# Start the HTTP API. Creates --data-dir if missing (SQLite DB + blob store).
target/debug/modelshelf-checker serve [--port 8787] [--data-dir ./data]

# Idempotently create the demo tenant/project/check pack. Safe to re-run;
# re-running does not duplicate rows or pack versions. Deliveries and models
# are not seeded here (see the ticket set for why).
target/debug/modelshelf-checker seed [--data-dir ./data] [--packs-dir packs] [--samples-dir samples/ifc]

# Usage and exit codes.
target/debug/modelshelf-checker --help   # exit 0
target/debug/modelshelf-checker bogus    # exit 2, prints usage
```

Stop the service with Ctrl-C (SIGINT) or `kill` the process; it holds no state outside `--data-dir`, so a restart against the same directory picks up where it left off.

Health check once running:

```sh
curl http://127.0.0.1:8787/api/health
```

Full contract: [`docs/contracts/http-api.md`](docs/contracts/http-api.md).

## QA harness

```sh
node scripts/qa-harness.ts
```

Node 24 runs these `.ts` scripts directly. The harness builds the service, then against its own temporary data directory and an unused port: seeds twice and checks the result is idempotent, starts `serve`, checks `/api/health` and `/api/projects` and `/api/packs`, rejects an unknown CLI command, then stops the server and deletes its own temp directories. Logs and JSON responses from each run land locally under `.omo/evidence/modelshelf-prototype/task-1/run-<timestamp>/` (gitignored).

## Frontend (`apps/web`)

```sh
cd apps/web
npm install
npm run dev       # http://localhost:3210
npm run typecheck
npm run build
```

Browser tests will use Playwright (`@playwright/test`, pinned in `apps/web/package.json`); no test specs exist yet, since there is no viewer page to test until a later ticket builds one.

## Shared model contract (`schemas/model/v1`)

The canonical JSON Schema for the wire shapes the Python worker, the Rust service,
and the browser viewer all share (`ObjectRef`, `ModelDescriptor`, `SemanticModel`,
`RenderManifest`); see [`schemas/model/v1/README.md`](schemas/model/v1/README.md)
and [`docs/adr/0001-reusable-model-modules.md`](docs/adr/0001-reusable-model-modules.md).
Generated bindings live in `crates/model-contracts`, `packages/model-contracts-py`,
and `packages/model-contracts-ts`; none of them import this repo's application,
database, or checking-engine code.

One-time setup for regenerating bindings:

```sh
cargo install cargo-typify --version 0.7.0 --locked
npm install --prefix scripts
npm install --prefix packages/model-contracts-ts
uv sync --project packages/model-contracts-py
```

```sh
node scripts/generate-model-contracts.ts           # regenerate all three languages' bindings
node scripts/generate-model-contracts.ts --check   # fail if committed bindings have drifted
node scripts/verify-model-contracts.ts             # cross-language fixture + round-trip + import-boundary proof
```

## Tests

```sh
cargo test --workspace
```

The IDS engine is a reference/test implementation, not the authoritative checker; see the conformance test output (`conformance: 288/307 ... - 19 known gaps`) and `crates/ids/tests/known-gaps.txt` for the accepted gaps.
