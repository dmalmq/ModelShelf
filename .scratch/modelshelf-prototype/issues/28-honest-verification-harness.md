# Make the verification harness assert what it claims

ID: 28
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent, plan-alignment
Status: open
Assignee: unassigned
Blocked by: 09
Wave: 2
Original plan coverage: Verification strategy; ticket 08/09 acceptance

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override, raised by the 2026-09-09 plan-alignment review.

## What to build

Every named check in the verifiers can fail, performance thresholds are asserted by default, and the recorded evidence identifies the machine that produced it.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), [the starting codebase](../codebase-map.md), and [the plan-alignment review](../../../docs/reviews/plan-alignment-2026-09-09.md) that raised this ticket. Inspect current source before editing. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable.

## Prerequisites

- [Prove the Wave 1 review loop and viewer performance](09-wave-one-gate.md), which introduced the `--assert-perf` gate.

## Ownership

`scripts/verify-viewer-inspection.mjs`, `scripts/verify-viewer.mjs`, `scripts/verify-ui-deliveries.mjs`, `scripts/verify-ui-findings.mjs`, `scripts/verify-api.mjs`, `scripts/lib/`.

Other agents may be working in this checkout. Ticket 27 also edits the verification scripts. Coordinate before editing shared files.

## Implementation boundaries

- `scripts/verify-viewer-inspection.mjs:408, 415, 423, 430` call `check(true, ...)`. Four named checks pass for any code state; the surrounding waits do the real asserting, so the log overstates the proof. Replace each with the predicate already available: isolation count equality, `selectedHidden`, and `renderer.clipping`.
- `scripts/verify-viewer-inspection.mjs:492` gates all five thresholds behind `if (assertPerf) check(condition, label)`. Without the flag every threshold is logged and none is asserted, so the default run proves nothing about responsiveness. Assert by default; keep functional checks independent of the perf verdict so a slow host still proves behavior.
- The perf record in the results JSON carries platform, arch, cpus and totalMem but no CPU model and no GPU identifier; the GPU appears only as prose in `docs/reviews/wave-1-report.md`. Artifacts cannot distinguish SwiftShader from hardware GL. Record the CPU model string and the WebGL RENDERER string.
- Four verifiers import chromium from `../apps/web/node_modules/playwright/index.mjs`. Playwright is correctly locked in `apps/web`, but the relative path couples every verifier to one install layout. Resolve it through normal module resolution.
- `scripts/verify-ui-deliveries.mjs:97-98` logs a warning when the worker pre-sync fails and continues into timed assertions, so a first-run lockfile download can land inside an asserted cold timing. Fail fast or record the pre-sync wall time in evidence.
- Three of five verifiers write evidence under `.scratch/modelshelf-prototype/evidence/` while the plan mandates `.omo/evidence/modelshelf-prototype/`. Unify them or record the split as an intentional amendment; do not leave two unindexed roots.
- Do not delete a failing check to make a run green.

## Acceptance criteria

- [ ] No `check(true, ...)` remains in any verifier; each of the four replaced checks fails when its behavior is deliberately broken, demonstrated once.
- [ ] Perf thresholds are asserted without a flag, and the run exits non-zero on a miss.
- [ ] The results JSON records CPU model, GPU renderer string, browser version, RAM, model bytes, product count, and triangles.
- [ ] Every browser verifier starts with `apps/web/node_modules` resolved through normal resolution rather than a hardcoded relative path.
- [ ] A worker pre-sync failure stops the run or is recorded with its wall time in evidence.
- [ ] Evidence lands under one documented root.

## Verification

- node scripts/verify-viewer.mjs
- node scripts/verify-viewer.mjs --scenario inspection
- node scripts/verify-ui.mjs --scenario deliveries
- node scripts/verify-ui.mjs --scenario findings
- One deliberate break per replaced check, proving it fails, then reverted

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Raised on 2026-09-09 by the plan-alignment review of tickets 01-11 and 18. Every claim below cites the file and line observed in that review. No implementation is claimed by ticket creation.
