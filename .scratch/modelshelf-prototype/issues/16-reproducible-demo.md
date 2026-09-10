# Package and verify the complete local demo

ID: 16
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent
Status: resolved
Assignee: CL202502004-daniel-session
Blocked by: 15
Wave: 2
Original plan coverage: 10

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override.

## What to build

A fresh agent or developer can start the full prototype, reproduce its demo, and understand its limits.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), and [the starting codebase](../codebase-map.md). Inspect current files before editing. This ticket is open even if partial code exists. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable. Fingerprints describe state, not identity.

## Prerequisites

- [Review model and finding changes visually](15-comparison-screen.md). Read its Answer and verified interface before starting.

## Ownership

Run/setup documentation, QA launch scripts, limitations/support profile and reference status documentation.

Other agents may be working in this checkout. Do not revert their edits. A dependency being resolved does not make concurrent edits to the same files safe. Coordinate shared file/contract ownership first.

## Implementation boundaries

- Document package exports, shared-contract generation, and the standalone viewer launch/test command alongside ModelShelf setup. State that IFC exports from Revit/Archicad are supported inputs, while native RVT/PLN remains deferred.

- Document locked dependencies, one local launch sequence, fixture acquisition, idempotent seed, expected outcomes, and process shutdown/restart.
- Keep self-authored test fixtures available for routine checks without restricted external downloads. Document BLCJ acquisition separately.
- Update stale docs and supported-profile statements. Run all verification on the integrated app, including performance and restart persistence.

## Acceptance criteria

- [ ] A fresh consumer can run the standalone viewer example without the ModelShelf backend; documented generation and boundary checks pass.

- [ ] Documented commands work from an empty data directory. Restart retains deliveries/runs/artifacts.
- [ ] All routine checks run on deterministic self-authored inputs; the Japanese sample demo has reproducible acquisition and separate evidence.
- [ ] No documentation implies full regulatory approval, universal IDS support, or cross-exporter shape equivalence.

## Verification

- node scripts/generate-model-contracts.mjs --check
- node scripts/verify-model-contracts.mjs
- node scripts/verify-viewer.mjs --scenario standalone

- cargo test --workspace
- uv run --locked --project services/ifc-worker pytest
- npm --prefix apps/web run typecheck && npm --prefix apps/web run build
- node scripts/verify-api.mjs --scenario all
- node scripts/verify-ui.mjs --scenario all
- node scripts/verify-viewer.mjs

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Created from the approved prototype plan on 2026-09-06. No implementation is claimed by ticket creation.

2026-09-09, [plan-alignment review](../../../docs/reviews/plan-alignment-2026-09-09.md): three plan-named deliverables are absent and this ticket owns them. `scripts/verify-api.mjs` accepts only `revisions|worker-failure|checks|first-loop` and `scripts/verify-ui.mjs` only `findings|deliveries`, so the plan's final acceptance commands `--scenario all` exit 2 rather than running. No `comparisons` scenario exists anywhere in `scripts/`. `docs/limitations.md` does not exist; supported-profile and shape-hash facts are scattered across worker constants, `docs/contracts/http-api.md` rule 11, and ticket prose.

## Answer

Implemented and verified the complete local demo. The reusable viewer extraction
landed as the prerequisite package work required by this ticket; ticket 19
remains open for its own lifecycle and follow-up work.

### Implementation

- Added `packages/model-viewer` with public exports `model-viewer`,
  `model-viewer/core`, and `model-viewer/ifc`. The core is framework-independent
  and uses generic viewer models, opaque revision-qualified object references,
  renderer ownership, delivery state, and host-supplied ports. The React
  wrapper is thin; the optional IFC driver owns the real `web-ifc` worker.
- Migrated the shelf, review, and comparison surfaces to the package's public
  exports. Deleted the duplicate `apps/web/src/components/viewer/**`
  implementation and removed direct `three`, `web-ifc`, and `@types/three`
  dependencies from the app.
- Added the application-only `viewer-adapter.ts`. ModelShelf supplies the
  required `modelFileUrl` core resolver and `resolveModelFileUrl` wrapper prop
  through `/api/models/:revisionId/file`; the package has no application route
  or persistence assumption.
- Added a plain-browser standalone example with deterministic self-authored IFC
  fixtures, public-export-only imports, and the
  `scripts/check-viewer-imports.mjs` boundary checker. The checker also runs
  controlled invalid-import fixtures so forbidden core and app-internal imports
  fail rather than merely being absent in the current tree.
- Added `scripts/demo-launch.mjs` for build, idempotent seed, API, web dev
  server, and coordinated SIGINT shutdown. Added the locked-dependency,
  fixture-acquisition, restart, package-export, and evidence runbook at
  `docs/demo-launch.md`.
- Added `docs/limitations.md` covering supported Revit/Archicad IFC inputs,
  deferred native RVT/PLN, IFC/IDS profile limits, geometry and fingerprint
  limits, CJK fonts, GPU-less performance, worker protocol scope, and sample
  redistribution terms.
- Made incomplete review findings selectable and rendered an explicit
  not-counted-as-pass evidence state instead of silently dropping them.
- `README.md` was intentionally left unchanged because ticket 30 owns its
  broader entrypoint and reference corrections.

### Verification

- `PATH="$HOME/.cargo/bin:$PATH" node scripts/generate-model-contracts.mjs --check`
  and `PATH="$HOME/.cargo/bin:$PATH" node scripts/verify-model-contracts.mjs`:
  passed generated-binding, Rust, Python, TypeScript, and cross-language checks.
- `PATH="$HOME/.cargo/bin:$PATH" cargo test --workspace`: 102 tests passed
  across 16 suites; 19 existing warnings.
- `uv run --locked --project services/ifc-worker pytest`: 49 passed, 19
  skipped.
- `npm --prefix apps/web run typecheck` and `npm --prefix apps/web run build`:
  both passed.
- `node scripts/check-viewer-imports.mjs`: host-independent core and public
  app import boundaries passed; controlled invalid-import fixtures were
  rejected.
- `node scripts/verify-viewer.mjs --scenario standalone`: all 9 standalone
  checks passed with ModelShelf services stopped. The result is recorded in
  [the standalone evidence](../../../.omo/evidence/modelshelf-prototype/ticket-16/standalone/run-2026-09-09T08-21-23-700Z/results.json).
- `node scripts/verify-viewer.mjs --scenario combined`: all combined viewer
  checks passed, including shared-origin alignment, batched resources,
  revision-qualified duplicate-GlobalId selection, empty geometry, retry, and
  repeated disposal. See
  [the combined evidence](../evidence/07-combined-viewer/results.json).
- `node scripts/verify-viewer.mjs --scenario inspection`: all 22 checks passed,
  including the 107-member highlight, storey isolation, hidden selection,
  section cut, picking, and incomplete-finding explanation. See
  [the inspection evidence](../evidence/08-finding-inspection/results.json).
- `node scripts/verify-api.mjs --scenario all`: all seven scenarios passed
  (175 checks total), including restart persistence. See the
  [ticket-16 aggregate](../../../.omo/evidence/modelshelf-prototype/ticket-16/run-2026-09-09T08-22-15-025Z/summary.json)
  and [restart state](../../../.omo/evidence/modelshelf-prototype/ticket-16/run-2026-09-09T08-22-53-322Z/restart-state.json).
- `node scripts/verify-ui.mjs --scenario all`: deliveries, findings, and
  comparisons all passed after the incomplete-finding and async-selection
  fixes. The latest run is recorded under
  [ticket-15's browser evidence](../../../.omo/evidence/modelshelf-prototype/ticket-15/run-2026-09-09T09-43-44-916Z/).
- The clean launcher smoke started from an empty data directory, returned API
  health and web `200`, seeded `+3` pack versions, stopped with exit 0, then
  restarted the same directory with `+0` pack versions and the same project
  row, health response, and web `200`. See
  [the launcher smoke log](../../../.omo/evidence/modelshelf-prototype/ticket-16/demo-launch-smoke-2026-09-09.log).
- The oracle check passed in the pinned worker environment:
  `uv run --locked --project services/ifc-worker python scripts/check-demo-oracle.py`.

### Performance and remaining limitations

The successful inspection run recorded these unchanged gates on this
GPU-less/SwiftShader host: cold usable geometry 4,087 ms against a 15 s gate
(met); median orbit 1.2 FPS against 30 FPS (not met); p95 selection 1.9 ms
against 200 ms (met); filtering 2,443 ms against 500 ms (not met); and maximum
non-render UI task 1,881 ms against 200 ms (not met). No threshold was lowered
or failing check weakened. Ticket 29 owns the hardware-GL re-measurement.

Native RVT/PLN inputs, exhaustive exporter coverage, universal/regulatory IDS
support, physical-equivalence claims from shape hashes, host-independent CJK
font rendering, and unrestricted third-party sample redistribution remain
unsupported or deferred as documented. The worker protocol remains scoped to
ticket 25, and fingerprint rotation/unit-normalization follow-up remains
scoped to ticket 34.

### Downstream contract

Consumers must use the package public exports. Hosts provide
`modelFileUrl(model)` to the core and `resolveModelFileUrl(model)` to the React
wrapper; ModelShelf's adapter resolves `/api/models/:revisionId/file`. Finding
and severity concepts remain application-owned.
