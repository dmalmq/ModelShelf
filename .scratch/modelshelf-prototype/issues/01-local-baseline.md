# Restore and verify the local application baseline

ID: 01
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent
Status: resolved
Assignee: claude-code-session-013vF1LacyxtZHAHMb3iU6PT
Blocked by: none
Wave: 1
Original plan coverage: 1

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override.

## What to build

A fresh local data directory can be seeded, the Rust service starts, and another agent can run checks without touching user data.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), and [the starting codebase](../codebase-map.md). Inspect current files before editing. This ticket is open even if partial code exists. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable. Fingerprints describe state, not identity.

## Prerequisites

None. This ticket is on the initial frontier.

## Ownership

Rust service bootstrap, seed command, root launch documentation, isolated QA harness; coordinate browser package-lock edits.

Other agents may be working in this checkout. Do not revert their edits. A dependency being resolved does not make concurrent edits to the same files safe. Coordinate shared file/contract ownership first.

## Implementation boundaries

- Record the existing compile failures before editing. Repair missing seed implementation and dependency features without weakening library tests.
- Make demo tenant/project/pack seeding idempotent. Build a process-owning QA harness with isolated ports, temporary data, captured logs, and reliable cleanup. Lock the browser test driver.
- Document help, start, stop, and seed commands. Do not build the project shelf in this ticket.

## Acceptance criteria

- [x] Full Rust workspace compiles and existing tests pass; known IDS gaps remain explicitly identified.
- [x] Two seed executions produce one copy of each seeded entity.
- [x] Health responds from a real process; an unknown CLI command exits nonzero with useful help.
- [x] The harness removes only its own processes/data and does not use a hardcoded occupied port.

## Verification

- cargo test --workspace
- cargo run -p modelshelf-checker -- --help
- Run serve with a temporary --data-dir and unused --port; curl /api/health.
- Create scripts/qa-harness.mjs with a smoke scenario for start, seed twice, invalid CLI, and cleanup.

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Created from the approved prototype plan on 2026-09-06. No implementation is claimed by ticket creation.

## Answer

### Baseline recorded before editing

`cargo build --workspace` failed with 73 errors, all from three root causes (full log: `.omo/evidence/modelshelf-prototype/task-1/run-*/build.log` captures the post-fix build; the pre-fix error text is reproduced below since fixing it removed it from any log):

1. `services/checker/Cargo.toml` depended on `sqlx` without its `macros` feature, so every `#[derive(sqlx::FromRow)]` in `src/dto.rs` failed with `E0433: cannot find FromRow in sqlx`, cascading into ~60 "trait bound not satisfied" errors at every `query_as` call site.
2. `tokio-util` was depended on without its `io` feature, so `use tokio_util::io::ReaderStream;` in `src/routes.rs` failed with `E0432: unresolved import`.
3. `src/main.rs` declared `mod seed;` but `services/checker/src/seed.rs` did not exist (`E0583: file not found for module`).

### Changes

- `services/checker/Cargo.toml`: added `"macros"` to the `sqlx` feature list and `features = ["io"]` to `tokio-util`.
- `services/checker/src/seed.rs` (new): `run_seed(data_dir, packs_dir, samples_dir) -> i32`, called from the existing `main.rs` CLI dispatch (unchanged). Idempotently creates one tenant (`demo-tenant`), one project (`demo-project`), and one check pack (`demo-pack`) using deterministic IDs and `INSERT OR IGNORE`, so re-running never duplicates rows. If `--packs-dir` contains `.ids`/`.xml` files, each is loaded as a pack version via the existing `routes::insert_pack_version` helper, skipped if a version with the same `ids_sha256` already exists for that pack (so re-seeding the same file doesn't allocate a new version). `--samples-dir` is accepted and intentionally unused: delivery/model ingestion depends on the worker contract and durable jobs (tickets 03/04), which this ticket does not build (see "Do not build the project shelf in this ticket").
- `README.md` (new, repo root): build/serve/seed/stop/health commands, the QA harness, frontend commands, and the test command, plus a pointer to the IDS conformance baseline.
- `scripts/qa-harness.mjs` (new): builds the service, then runs a real end-to-end smoke scenario against its own temp data dir and an OS-assigned free port (never a hardcoded one): unknown CLI command (expects nonzero exit + usage text), `--help` (expects exit 0 + usage text), seed run twice (expects identical stdout, i.e. no growth), `serve` started as a real child process, polls `/api/health` over real HTTP, reads back `/api/projects` and `/api/packs` and asserts exactly one of each, then in a `finally` block kills the server and removes only the two temp directories it created. Exits nonzero if any check fails.
- `apps/web/package.json` / `apps/web/package-lock.json`: added `@playwright/test` as an exact-pinned devDependency (`1.63.0`) per "lock the browser test driver." No test specs were added; `apps/web/src/app/` has no page/layout yet (per `codebase-map.md`), so there is nothing for a browser test to exercise until a later ticket builds the viewer.

No other source files were touched. `crates/*` and their tests are untouched.

### Commands and results

```
$ cargo test --workspace
... 29 tests across fingerprint/ids/ifc-model/modeldiff, all passed, 0 failed
$ cargo test -p ids --test conformance -- --nocapture
conformance: 288/307 (93.8%) - 19 known gaps      # unchanged from the recorded baseline
$ cargo run -p modelshelf-checker -- --help
exit 0, prints USAGE
$ cargo run -p modelshelf-checker -- bogus
exit 2, prints "unknown command: bogus" + USAGE
$ node scripts/qa-harness.mjs
ok - cargo build succeeds
ok - unknown command exits nonzero
ok - unknown command prints usage
ok - --help exits zero
ok - --help prints usage
ok - first seed exits zero
ok - second seed exits zero
ok - seed is idempotent (same ids, no growth reported)
ok - health responds with status ok
ok - health reports engine/parser/schema versions
ok - exactly one seeded project
ok - exactly one seeded pack
all checks passed
$ pgrep -fa modelshelf-checker   # after the harness run: no output
$ ls /tmp | grep modelshelf-qa   # after the harness run: no output
```

Manual confirmation of a real `serve` process against a temp `--data-dir` and an unused port, and of pack-version idempotency against a real IDS file (`.local/ids-testcases/tolerance/pass-comparison_tolerance_for_floating_point_negative_high_number_lower_bound.ids`, copied into a temp packs dir): first seed reported `+1 pack version(s)`, second reported `+0`, and `pack_versions` held exactly one row.

Evidence: `.omo/evidence/modelshelf-prototype/task-1/` — `seed.log`, `serve.log`, `health-response.json` from the manual pass, plus one `run-<timestamp>/` subdirectory per `qa-harness.mjs` execution (`build.log`, `seed.log`, `serve.log`, `health-response.json`, `projects-response.json`, `packs-response.json`, `invalid-cli.log`).

### Limits and downstream notes

- Seed only creates tenant/project/pack (and pack versions from a packs-dir, if given); it creates no deliveries or models, so `GET /api/projects/:id` will show zero deliveries after seeding alone. That's intentional per this ticket's boundary, not a bug — tickets 02/04 own delivery/model ingestion.
- `--samples-dir` is currently a no-op. Whichever ticket wires sample IFC ingestion into seed (04, or 05's demo-evidence prep) should read this note rather than assume it already loads samples.
- `@playwright/test` is pinned but its browser binaries are not downloaded (`npx playwright install` was not run) and no spec files exist; the ticket that builds the first browser-testable page (07) should run that install and can build directly on `scripts/qa-harness.mjs`'s pattern for isolated ports/data dirs if it wants a similar harness for UI scenarios.
- `apps/web`'s existing `npm audit` reports 2 pre-existing vulnerabilities in Next's bundled `postcss` (unrelated to this ticket's Playwright addition, fixed only by a breaking Next major-version bump) — left untouched as out of scope.
- Concurrent session note: while this ticket was in progress, another session added `.scratch/modelshelf-prototype/issues/18-shared-model-contracts.md` and `docs/adr/0001-reusable-model-modules.md`. Neither was read in depth beyond confirming they don't touch `services/checker`'s bootstrap or `apps/web`'s package lock, so there's no conflict with this ticket's edits.

### Post-resolution fix (found by an independent review, applied while starting ticket 04)

An independent review (`.omo/evidence/modelshelf-prototype/task-1/review/`) found a real bug in `scripts/qa-harness.mjs`'s cleanup: it checked `serverProcess.killed` to decide whether to wait for an "exit" event, but `.killed` only reflects "did we call `.kill()`", not "has the process actually exited". If the server crashed on its own before cleanup ran, the code still awaited an "exit" event that had already fired once, before the listener was attached — Node emits that event exactly once, so the `await` never resolved. Reproduced directly (a stub process that exits immediately hangs the old cleanup indefinitely) and confirmed the fix resolves in ~175ms instead. Root cause and fix:

- Added `stopProcess()`/updated `waitForHealth()` in `scripts/lib/checker-harness.mjs` (extracted from this file during ticket 02): check `exitCode`/`signalCode` (not `.killed`) to detect an already-exited child; `waitForHealth` now takes the spawned `child` and fails fast if it exits while still polling, instead of waiting out the full timeout; `stopProcess` bounds the SIGTERM wait and escalates to SIGKILL if it expires.
- Moved `serve.log` writing into `qa-harness.mjs`'s and `verify-api.mjs`'s `finally` blocks (previously only written on the happy path, so a failure before that point lost the one log most useful for diagnosing it).
- Also applied the review's coverage suggestion: `qa-harness.mjs` now seeds with a real `.ids` file (`.local/ids-testcases/...`) and asserts the pack has exactly one *version* after two seed runs, not just that tenant/project/pack counts stayed at one under an empty packs dir (which never exercised the pack-version idempotency path at all).
- Verified: both scripts still pass end-to-end against the real service; a direct repro of the crash scenario against the fixed `stopProcess`/`waitForHealth` fails fast with no hang, and manual process/temp-dir checks after every run confirm nothing is left behind.

No other review findings applied here — package-lock lockfile findings and the reviewer's own probe artifacts were outside this fix's scope.
