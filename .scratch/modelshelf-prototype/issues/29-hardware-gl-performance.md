# Re-measure Wave 1 viewer performance on a hardware GL host

ID: 29
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent, plan-alignment
Status: open
Assignee: unassigned
Blocked by: 09
Wave: 1
Original plan coverage: 5, performance acceptance; Wave 1 gate

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override, raised by the 2026-09-09 plan-alignment review.

## What to build

A recorded performance measurement on a host with hardware GL that either meets the plan's provisional targets or records an honest, root-caused miss with the app-side cost isolated.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), [the starting codebase](../codebase-map.md), and [the plan-alignment review](../../../docs/reviews/plan-alignment-2026-09-09.md) that raised this ticket. Inspect current source before editing. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable.

## Prerequisites

- [Prove the Wave 1 review loop and viewer performance](09-wave-one-gate.md), resolved by owner decision with two lines red.

## Ownership

`scripts/verify-viewer-inspection.mjs` perf reporting, `docs/reviews/wave-1-report.md`, the task-9 evidence directory.

Other agents may be working in this checkout. Ticket 28 restructures the same perf gate; take its changes first if it is in flight.

## Implementation boundaries

- Ticket 09's Answer records median orbit 2.5 FPS against a 30 FPS target, and states that longtask telemetry "self-contradicts under headless SwiftShader (334 entries inside a 3.5 s window), so no verdict is drawn from it". Cold 3.0 s, select p95 1.5 ms and filter about 500 ms passed. No hardware-GL measurement exists anywhere in the repository.
- The recorded root cause is software rasterization, supported by three isolations. Do not relitigate that analysis; measure on a host that removes the variable.
- The filter measurement at roughly 500 ms against a 500 ms budget has no margin. Treat it as unproven until confirmed on the same host.
- Do not lower a threshold. If a target genuinely cannot be met on real hardware, record the measurement and bring the tradeoff back to the user rather than editing the number.
- If no hardware-GL host is available to the executing agent, keep this ticket open with an explicit blocked note naming what is needed. Do not manufacture a pass.

## Acceptance criteria

- [ ] `node scripts/verify-viewer.mjs --scenario inspection --assert-perf` runs on a host whose recorded GPU string is not a software rasterizer, on the same BLCJ delivery, with the full machine record committed under the task-9 evidence directory.
- [ ] Median orbit FPS, p95 selection, filter latency, cold usable geometry, and the parsing longtask verdict each have a recorded number and a pass or fail verdict.
- [ ] `docs/reviews/wave-1-report.md` miss table is updated with the new measurement and the previous SwiftShader run is retained rather than overwritten.
- [ ] Any remaining miss has a named root cause and a stated app-side versus host-side attribution.

## Verification

- node scripts/verify-viewer.mjs --scenario inspection --assert-perf
- The recorded GPU renderer string in the results artifact

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Raised on 2026-09-09 by the plan-alignment review of tickets 01-11 and 18. Every claim below cites the file and line observed in that review. No implementation is claimed by ticket creation.
