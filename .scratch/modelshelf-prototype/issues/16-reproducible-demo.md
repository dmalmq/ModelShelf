# Package and verify the complete local demo

ID: 16
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent
Status: open
Assignee: unassigned
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
