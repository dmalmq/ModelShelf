# Build the ModelShelf prototype

Labels: wayfinder:map
Status: open
Assignee: unassigned

## Destination

A runnable local ModelShelf prototype that combines architectural, structural, and services models, checks versioned project information requirements, groups prioritized findings, and compares deliveries. Another AI can execute each child ticket from a fresh session using its prerequisites and acceptance evidence.

## Notes

- Accepted amendment: [reusable model modules](../../docs/adr/0001-reusable-model-modules.md). Shared contracts, format-neutral ObjectRefs, a reusable viewer core/React wrapper, and standalone reuse verification are required. Native Revit/Archicad integrations stay deferred. [VISION.md](../../VISION.md) sequences the combined ModelShelf view before extracting `packages/model-viewer`.
- Ticket 07 is the ModelShelf combined view and ObjectRef selection only. Extracting `packages/model-viewer`, the standalone example, and import-boundary packaging waits until after Wave 1.

- Execution override: the user explicitly requested tickets so another AI can build the approved plan. This map includes implementation deliverables, overriding Wayfinder's decision-only default. Charting this map does not execute the tickets.
- Use [HANDOFF.md](HANDOFF.md) as the entry point. Read [the specification](spec.md), [the starting codebase](codebase-map.md), and the chosen child ticket.
- The approved direction is Rust/Axum, local SQLite/blob storage, a separate IfcOpenShell/IfcTester worker, and Next.js. Details and boundaries remain in the linked specification and plan.
- Each child is an AFK task intended for one fresh agent context. Work one ticket per session. Ask a human only for a new product decision or inaccessible required input; record discoveries and do not silently redefine scope.
- Use poteto-mode for implementation and the installed language/frontend/testing skills as applicable. Use domain-modeling when terminology changes. The current task used Wayfinder and to-tickets to chart the work.
- First implement and verify Wave 1. The Wave 1 review-loop ticket is the milestone boundary. Wave 2 completes the rest of the approved prototype; do not claim it finished after the first milestone.
- Tickets were initially created open and unassigned; current child metadata is authoritative. Partial code is context, not evidence of completion. The started worker contract/dependencies need implementation and validation.
- 2026-09-07: tickets 03–06 are resolved. Wave 1 frontier is ticket 07. `crates/ids` is a reference/test engine; live scoring is IfcTester. Do not grow the custom IDS crate.
- Ticket 07 is the ModelShelf combined view and ObjectRef selection only. A reusable viewer package is deferred until that loop exists.
- Native issue blocking is unavailable in the local tracker. Child metadata records blockers; the read-only check-tickets.mjs command derives the current frontier.
- No external issues were published. No commits, pushes, PRs, deployment, or public sample redistribution are authorized here.

## Decisions so far

- [Restore and verify the local application baseline](issues/01-local-baseline.md) — resolved: fixed the sqlx/tokio-util feature gaps and implemented `seed.rs` (idempotent demo tenant/project/pack), so `cargo build --workspace` and `cargo test --workspace` pass again (IDS conformance unchanged at 288/307, 19 known gaps); added `scripts/qa-harness.mjs` and a root `README.md`.
- [Publish shared model contracts across Rust, Python, and the browser](issues/18-shared-model-contracts.md) — resolved: canonical JSON Schema under `schemas/model/v1/` with generated, tested consumers in `crates/model-contracts`, `packages/model-contracts-py`, and `packages/model-contracts-ts`; `scripts/verify-model-contracts.mjs` proves a real Python-produced payload is consumed by both Rust and TypeScript and that none of the three import app/database/checking-engine code. Unblocks tickets 02, 03, and 07. No caller wired in yet (out of this ticket's scope).
- [Inspect IFC through a verified worker contract](issues/03-ifc-worker-contract.md) — resolved 2026-09-07: SI prefix exponent, render-instance placement, IFC2X3 type inheritance.
- [Create deliveries from immutable source-model revisions](issues/02-immutable-deliveries.md) — resolved 2026-09-07: review correction R6 closed. Schema version 5 swaps `runs.input_provenance` so its declared default is `incomplete`, `create_run` binds it explicitly, and `dto::InputProvenance` makes an unrecognized stored value read as incomplete rather than proven. Verified in an isolated worktree: `cargo test --workspace`, both `verify-api` scenarios (revisions 21/21, including a real run reporting incomplete provenance), the migrated schema read back off disk, and the fix reverted to reproduce R6. Pinning exact run inputs stays ticket 06.
- [Process model revisions through durable jobs](issues/04-queued-ingestion.md) — resolved 2026-09-07: exclusive lock, worker PDEATHSIG/`exec`, attempt dirs, symlink containment, worker-only publish, artifact schema validation, shared Property round-trip. `verify-api --scenario worker-failure` checks the old worker is gone after checker SIGKILL.
- [Prepare reproducible Japanese and synthetic demo evidence](issues/05-demo-evidence.md) — resolved 2026-09-07: oracle v2 with IfcTester affected sets (135/3), intended vs engineLimitation, deterministic seed, `--output-dir`, pack-change counts corrected (62 ducts / 45 pipes / 43 trays).
- [Run scoped IDS checks against pinned delivery inputs](issues/06-scoped-ids-runs.md) — resolved 2026-09-07: IfcTester scores runs; membership/hashes/pack digest/scope/engine profile freeze on `run_models`; findings carry ObjectRefs; `verify-api --scenario checks` passed.
- [Open a combined delivery in the browser](issues/07-combined-viewer.md) — resolved 2026-09-07: three real BLCJ revisions share one aligned batched scene, source-specific failure and retry, revision-qualified ObjectRef selection, and verified Worker/GPU lifecycle disposal.

## Not yet specified

None is too vague to ticket at this stage. The viewer ticket and Wave 1 gate measure compatibility/performance and carry an explicit prepared-geometry fallback. Any new implementation fact that changes the destination must be recorded in the owning ticket and brought back to the user.

## Out of scope

Regulatory approval, clash/fire-code geometry checking, Revit write-back, arbitrary spreadsheet conversion, production authentication/billing, automatic acceptance of ambiguous object matches, and unrestricted third-party asset redistribution.
