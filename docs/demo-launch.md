# ModelShelf demo: reproducible local launch

This runbook reproduces the local ModelShelf demo from an empty data directory:
build, seed, serve, and drive the web app, then shut down and restart without
losing work. It records the locked dependency matrix, the one-command and
manual launch sequences, fixture acquisition, idempotent seeding, expected
outcomes, shared-contract generation, and the shutdown/restart contract.

## Locked dependency matrix

| Layer | Pin | Where it is locked |
| --- | --- | --- |
| Rust workspace | `Cargo.lock` pins every dependency; workspace edition 2021, resolver 2 | `Cargo.lock`, `Cargo.toml` |
| IFC/IDS worker | IfcOpenShell `==0.8.5`, IfcTester `==0.8.5`; Python `>=3.12,<3.14` | `services/ifc-worker/pyproject.toml`, `services/ifc-worker/uv.lock` |
| Web app + viewer package | Next `15.5.25`; Playwright `1.63.0` exact; React 19; Three.js 0.185 | `apps/web/package.json`, `apps/web/package-lock.json`, `packages/model-viewer/package.json`, `packages/model-viewer/package-lock.json` |

- The Rust workspace ships a checked-in `Cargo.lock`. No crate manifest
  declares a minimum rustc and no `rust-toolchain.toml` exists; the in-tree
  toolchain requirement is edition 2021, which needs a stable Rust that
  supports it. Build with `cargo build --workspace` from the repo root.
- The worker is invoked by the checker as
  `uv run --locked --project services/ifc-worker ifc-worker --request {request}`
  (the `DEFAULT_WORKER_COMMAND` in `services/checker/src/jobs.rs`). `--locked`
  makes `uv.lock` authoritative, so the pinned `ifcopenshell==0.8.5` and
  `ifctester==0.8.5` are what actually run.
- The web lockfile pins `next` 15.5.25. That package's `engines` field
  requires Node `^18.18.0 || ^19.8.0 || >=20.0.0`, and `@playwright/test` is
  pinned exactly to `1.63.0`. The repo's own `package.json` files declare no
  `engines` field; the subset of Node that satisfies the locked Next runtime
  (18.18+, 19.8+, or 20+) is the effective requirement.

## One local launch sequence

One command:

```sh
node scripts/demo-launch.mjs
```

`scripts/demo-launch.mjs` performs the launch exactly as the manual sequence
below: build the checker, seed the demo data, start the API, start the web dev
server, and shut both down on SIGINT.

Manual sequence (equivalent, step by step):

```sh
# 1. Build the checker once.
cargo build -p modelshelf-checker

# 2. Seed the demo tenant/project/check pack into the data directory.
#    Point --packs-dir at packs/demo so the demo pack versions are loaded
#    (see "Seeding"). Safe to re-run; re-running adds nothing.
target/debug/modelshelf-checker seed --data-dir ./data --packs-dir packs/demo

# 3. Start the HTTP API on port 8787 (default). Creates --data-dir if missing.
target/debug/modelshelf-checker serve --port 8787 --data-dir ./data

# 4. In a second terminal, start the web app on port 3210.
npm --prefix apps/web run dev
#    Open http://localhost:3210
```

Endpoints: the API listens on `http://127.0.0.1:8787` and the web dev server
on `http://localhost:3210`. Health check once the API is up:

```sh
curl http://127.0.0.1:8787/api/health
```

Full HTTP contract: `docs/contracts/http-api.md`.

## Fixture acquisition

The routine verifiers use the committed self-authored fixtures and need no
external download. The complete BLCJ sample demo needs the real sample IFC
files before deliveries can be assembled. All acquisition paths below are
checksum-verifiable and idempotent.

### BLCJ S1000 (public downloads)

```sh
node scripts/fetch-demo-models.mjs
```

- Downloads three archives from the official BLCJ sample-model page
  (`https://blcj.or.jp/archive_index/samplemodel/`), verifies each against the
  SHA-256 pinned in the script, and extracts the `.ifc` file of each into
  `samples/ifc/blcj-s1000-{architecture,structure,mep}.ifc`.
- Downloads are restricted to that public page; BLCJ prohibits unauthorized
  redistribution, so the archives and extracted files are gitignored and must
  never be committed (`samples/blcj-s1000/README.md`).
- A re-run reuses an already-verified archive. A hash mismatch (upstream file
  changed since the pin) is a hard error, never a silent overwrite.

### Snowdon Towers (operator-owned copy)

```sh
node scripts/stage-snowdon-models.mjs --from "<directory holding the four .ifc files>"
node scripts/stage-snowdon-models.mjs --from "$SNOWDON_SRC" --verify-only
```

- Copies the four Snowdon Towers IFC exports into `samples/ifc/`, verifying
  each against the SHA-256 pinned in `samples/snowdon-towers/manifest.json`.
- There is no download step: no confirmed public URL exists and Autodesk
  publishes no redistribution grant. The files must come from the operator's
  own copy of the Autodesk sample content
  (`samples/snowdon-towers/README.md`).
- `--verify-only` checks the pinned hashes without staging. A hash mismatch is
  a hard failure, never a silent overwrite. Re-running is a no-op when staged
  files already match.

### Self-authored fixtures (no download)

`packs/demo/fixtures/{base,head}.ifc` and `oracle.json` are committed to git.
Regenerate them deterministically with
`uv run --locked --project services/ifc-worker python scripts/generate-demo-fixtures.py`
which requires no external download (ticket 05). Verify it in the pinned
worker environment with `uv run --locked --project services/ifc-worker python scripts/check-demo-oracle.py`.

## Seeding

```sh
target/debug/modelshelf-checker seed --data-dir ./data --packs-dir packs/demo
```

- Creates exactly one tenant (`demo-tenant`), one project (`demo-project`),
  and one check pack (`demo-pack`) with deterministic IDs and `INSERT OR
  IGNORE` (ticket 01).
- Every `.ids`/`.xml` file directly under `--packs-dir` is loaded as a pack
  version; a file whose `ids_sha256` a prior seed already stored is skipped.
  `packs/demo` holds exactly three such files (`blcj-s1000-v1.ids`,
  `blcj-s1000-v2.ids`, `fixtures.ids`), so seeding it creates three versions of
  `demo-pack` on a fresh data directory. A real seed against `packs/demo`
  recorded `+3 pack version(s)` (`.omo/evidence/modelshelf-prototype/task-10/`).
  The root `packs/` directory itself has no direct `.ids`/`.xml` children, so
  `--packs-dir packs` seeds no versions (the README shows that form as a
  valid invocation, not a version-loading one).
- Seed does not create deliveries or models (ticket 01). The
  `--samples-dir` flag is accepted but unused.
- Idempotent: re-running adds nothing. The second run reports
  `+0 pack version(s)` and no duplicated rows.

## Expected outcomes

Health (camelCase wire fields per `docs/contracts/http-api.md`):

```json
{"status":"ok","engineVersion":"ifctester/0.8.5","parserVersion":"ifcopenshell/0.8.5","schemaVersion":8}
```

Seed output on a fresh data directory:

```text
seeded tenant=demo-tenant project=demo-project pack=demo-pack (+3 pack version(s))
```

Verification commands and what each proves:

| Command | Purpose |
| --- | --- |
| `node scripts/generate-model-contracts.mjs --check` | Fails if the committed generated bindings have drifted from the canonical `schemas/model/v1/` files (ticket 18). |
| `node scripts/verify-model-contracts.mjs` | Proves a real Python-produced payload is consumed by both Rust and TypeScript and that none of the three packages import application, database, or checking-engine code (ticket 18). |
| `node scripts/verify-viewer.mjs` | Combined scenario (default): the real BLCJ models load and align in the browser, duplicate-GlobalId revisions select independently, an empty model stays ready without bounds, and unload releases resources (ticket 07). |
| `node scripts/verify-viewer.mjs --scenario inspection` | Finding inspector: a 100+ object finding highlights every member, filters, section cut, isolation/reset, property inspection, and incomplete-evidence handling (ticket 08). |
| `node scripts/verify-viewer.mjs --scenario standalone` | Standalone example: proves `packages/model-viewer` runs in a plain browser with the checker, worker, and Next.js stopped, exercising pick, highlight, isolate, section, and unload through public exports only, with the import-boundary check (`scripts/check-viewer-imports.mjs`) green (ticket 19, landing as this ticket's prerequisite). |
| `node scripts/verify-api.mjs --scenario all` | Runs the seven API scenarios sequentially and fails (nonzero) if any fails: `revisions` (immutable delivery data model, ticket 02), `worker-failure` (job queue failure modes, ticket 04), `checks` (scoped IDS runs with pinned inputs, ticket 06), `first-loop` (upload to grouped finding to member resolution, ticket 09), `comparisons` (revision diff with match confidence, ticket 13), `finding-comparisons` (settings-gated run diff, ticket 14), and `restart` (a fresh serve process against the same data directory retains deliveries, runs, and artifacts). |
| `node scripts/verify-ui.mjs --scenario all` | Runs the three UI scenarios sequentially: `deliveries` (shelf create/upload/reuse/finalize/reload, ticket 10), `findings` (grouped findings review, ticket 11), and `comparisons` (delivery comparison screen, ticket 15) against the real checker, worker, production web build, and Chromium. |

## Shared contracts and package exports

- `schemas/model/v1/` is the canonical source of truth for the shared model
  payloads (`ObjectRef`, `ModelDescriptor`, `SemanticModel`,
  `RenderManifest`, `GeometryChunk`). Only the per-file schemas are edited by
  hand; generated bindings are produced from them (ticket 18).
- One-time setup:

  ```sh
  cargo install cargo-typify --version 0.7.0 --locked
  npm ci --prefix apps/web
  npm ci --prefix packages/model-viewer
  npm ci --prefix scripts
  npm ci --prefix packages/model-contracts-ts
  uv sync --locked --project services/ifc-worker
  uv sync --locked --project packages/model-contracts-py
  ```

- Regenerate all three languages' bindings, or check for drift:

  ```sh
  node scripts/generate-model-contracts.mjs
  node scripts/generate-model-contracts.mjs --check
  ```

- `packages/model-viewer` exposes three public exports: `"."` is the thin
  React wrapper, `"./core"` is the framework-independent rendering core, and
  `"./ifc"` is the optional real-IFC geometry driver. The app imports only
  `model-viewer` or `model-viewer/core`, never internal module paths (ticket
  19). The standalone example consumes only the framework-independent public
  core.
- The core's `modelFileUrl` resolver and the React wrapper's
  `resolveModelFileUrl` prop are required host ports. ModelShelf supplies its
  `/api/models/:revisionId/file` route; the package itself contains no
  application route or persistence assumption.

## Shutdown and restart

- Stop the service with Ctrl-C (SIGINT). `scripts/demo-launch.mjs` shuts down
  both the API and the web dev server on SIGINT.
- The checker holds no state outside its `--data-dir` (README): a restart
  against the same directory picks up where it left off, and deliveries,
  runs, and artifacts remain identical (ticket 16 acceptance; the `restart`
  API scenario proves it).
- A restart against an empty data directory starts fresh and seeds
  idempotently: no leftover rows, no duplicated pack versions.

## Where evidence lives

Ticket-16 aggregate and standalone runs write logs, JSON responses, and
screenshots under `.omo/evidence/modelshelf-prototype/ticket-16/`. The existing
ticket-owned viewer and UI scenarios retain their historical `.scratch`
directories (`07-combined-viewer`, `08-finding-inspection`, and
`11-priority-review`); each command records its own result there. Third-party
inputs and restricted samples are never committed; only provenance metadata and
evidence artifacts are tracked.

## Verification ownership

The standalone viewer, API `all` runner, UI `all` runner, and launcher are now
checked by the commands above. Their evidence is written under the ticket-owned
directories described in `Where evidence lives`; run the heavy scenarios after
dependency installation and fixture acquisition.