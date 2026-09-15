# ModelShelf

A local BIM delivery checker: Rust/Axum service, SQLite storage, a Next.js frontend, and an IfcOpenShell/IfcTester worker. See [`VISION.md`](VISION.md) for the accept/resist policy. See [`CONTEXT.md`](CONTEXT.md) for domain terms and [the GitHub ticket set](docs/agents/issue-tracker.md) for prototype work.

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

The delivery viewer is at `/deliveries/[deliveryId]`. Browser proof is listed under Verification.

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
node scripts/verify-worker-envelope.ts --check     # worker job envelope dump-lock against schemas/worker/v2
```

## Verification

Node 24 runs these `.ts` scripts directly from the repository root. Playwright is used via `scripts/verify-*.ts` importing Chromium from `apps/web`. There are no `apps/web` Playwright spec files.

| Command | Purpose |
| --- | --- |
| `node scripts/qa-harness.ts` | Build, idempotent seed, health/projects/packs, unknown CLI, temp data dir |
| `node scripts/verify-api.ts --scenario revisions` | Source-model / revision / delivery data model |
| `node scripts/verify-api.ts --scenario worker-failure` | Job queue contract |
| `node scripts/verify-api.ts --scenario checks` | Scoped IfcTester on pinned inputs |
| `node scripts/verify-api.ts --scenario first-loop` | Full review loop |
| `node scripts/verify-api.ts --scenario comparisons` | Revision comparison match confidence |
| `node scripts/verify-api.ts --scenario finding-comparisons` | Finding diffs gated on compatible settings |
| `node scripts/verify-api.ts --scenario restart` | Restart durability |
| `node scripts/verify-api.ts --scenario all` | The seven SCENARIOS in order. Not decisions. |
| `node scripts/verify-api.ts --scenario decisions` | Extra name accepted by requireScenario. Not in SCENARIOS. |
| `node scripts/verify-api.ts --scenario snowdon` | Snowdon four-discipline delivery scored against its own pack |
| `node scripts/verify-api.ts --scenario snowdon-variants` | Three Snowdon grades (none, partial, all) against one pack, with MEP revision reuse |
| `node scripts/verify-viewer.ts` | Combined delivery viewer |
| `node scripts/verify-viewer.ts --scenario inspection` | Finding inspection plus Wave-1 gates |
| `node scripts/verify-viewer.ts --scenario standalone` | Extracted viewer package example |
| `node scripts/verify-viewer.ts --scenario snowdon` | Snowdon four-model viewer with one shared origin offset |
| `node scripts/verify-ui.ts --scenario deliveries` | Delivery shelf |
| `node scripts/verify-ui.ts --scenario findings` | Prioritized findings |
| `node scripts/verify-ui.ts --scenario comparisons` | Delivery comparison screen |
| `node scripts/verify-ui.ts --scenario all` | deliveries then findings then comparisons |
| `uv run --project services/ifc-worker python scripts/check-demo-oracle.py` | Oracle vs IfcTester |
| `node scripts/verify-named-proof.ts` | NamedProof fail labels |
| `node scripts/generate-model-contracts.ts --check` | Fail if committed bindings have drifted |
| `node scripts/verify-model-contracts.ts` | Cross-language fixture, round-trip, and import-boundary proof |
| `node scripts/verify-worker-envelope.ts --check` | Worker job envelope dump-lock |
| `node scripts/check-published-tree.ts` | Tracked-tree bans; currently red on pre-existing apps/web/scripts/check-routes.mjs |
| `node scripts/check-published-claims.ts` | Join README verifier rows to live dispatchers |
| `cargo test --workspace` | Workspace unit and integration tests |

`qa-harness`, `verify-api`, `verify-ui`, `verify-viewer`, and `verify-model-contracts` write run directories under `.omo/evidence/modelshelf-prototype/` (gitignored). The other table commands print to stdout. `node scripts/check-published-tree.ts` bans tracking that directory. Published summaries are [`docs/reviews/wave-1-report.md`](docs/reviews/wave-1-report.md) and the leaf index in [`docs/demo-launch.md`](docs/demo-launch.md).

## Tests

```sh
cargo test --workspace
```

The IDS engine is a reference/test implementation, not the authoritative checker; see the conformance test output (`conformance: 288/307 ... - 19 known gaps`) and `crates/ids/tests/known-gaps.txt` for the accepted gaps.
