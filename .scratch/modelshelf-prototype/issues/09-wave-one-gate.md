# Prove the Wave 1 review loop and viewer performance

ID: 09
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent
Status: open
Assignee: unassigned
Blocked by: 08
Wave: 1
Original plan coverage: 5 and Wave 1 acceptance

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override.

## What to build

One repeatable command proves upload → checked delivery → grouped finding → correct highlighted object, with measured responsiveness.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), and [the starting codebase](../codebase-map.md). Inspect current files before editing. This ticket is open even if partial code exists. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable. Fingerprints describe state, not identity.

## Prerequisites

- [Inspect a real finding in its model context](08-finding-inspection.md). Read its Answer and verified interface before starting.

## Ownership

Cross-service integration harness and viewer measurements; fixes only where the integrated workflow fails.

Other agents may be working in this checkout. Do not revert their edits. A dependency being resolved does not make concurrent edits to the same files safe. Coordinate shared file/contract ownership first.

## Implementation boundaries

- Include the standalone viewer reuse gate and import-boundary checks in Wave 1 acceptance. If prepared geometry is needed, adapt the loader rather than altering selection/render contracts or checking evidence.

- Run the real Rust service, Python worker, and browser against isolated data. Seed/upload a delivery and pack, poll run completion, page objects, and select one in the combined viewer.
- Record machine/browser, input bytes/object/triangle counts, cold usable geometry time, orbit FPS, selection/filter latency, UI long tasks, and resource use.
- If browser IFC conversion misses the plan targets, implement the planned cached worker-prepared GLB chunks with revision-qualified mappings, then repeat measurements. Do not silently weaken thresholds.

## Acceptance criteria

- [ ] The standalone example still works with all application services stopped, and shared contracts regenerate without drift after integration.

- [ ] scripts/verify-api.mjs --scenario first-loop passes without mocked checker or viewer results.
- [ ] On the recorded local demo setup: median orbit at least 30 FPS, p95 selection below 200 ms, filters below 500 ms, no parsing-induced UI task over 200 ms, cold usable geometry within 15 seconds.
- [ ] A worker crash, invalid IFC, and missing geometry produce honest failure/incomplete states while retained results remain readable.
- [ ] Wave 1 completion report distinguishes proven behavior from remaining Wave 2 features.

## Verification

- node scripts/verify-viewer.mjs --scenario standalone
- node scripts/generate-model-contracts.mjs --check

- cargo test --workspace
- uv run --locked --project services/ifc-worker pytest
- npm --prefix apps/web run typecheck && npm --prefix apps/web run build
- node scripts/verify-api.mjs --scenario first-loop
- node scripts/verify-viewer.mjs

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Created from the approved prototype plan on 2026-09-06. No implementation is claimed by ticket creation.
