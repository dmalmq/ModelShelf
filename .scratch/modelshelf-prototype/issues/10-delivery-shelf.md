# Complete the reviewer delivery shelf

ID: 10
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent
Status: resolved
Assignee: omp-main-20260908-reviewer-shelf
Blocked by: 09
Wave: 2
Original plan coverage: 6

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override.

## What to build

A reviewer can create, revisit, and assemble deliveries through the application without using the test route or CLI.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), and [the starting codebase](../codebase-map.md). Inspect current files before editing. This ticket is open even if partial code exists. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable. Fingerprints describe state, not identity.

## Prerequisites

- [Prove the Wave 1 review loop and viewer performance](09-wave-one-gate.md). Read its Answer and verified interface before starting.

## Ownership

Project/delivery routes, upload/reuse/finalize forms, typed API client and status UI.

Other agents may be working in this checkout. Do not revert their edits. A dependency being resolved does not make concurrent edits to the same files safe. Coordinate shared file/contract ownership first.

## Implementation boundaries

- Compose the reusable viewer through its React export. Keep delivery/source organization and host resource loaders in the app; import generated model payloads instead of duplicating viewer types.

- Build project shelf and delivery detail pages on the verified API. Let users name sources, assign disciplines, upload revisions, and reuse unchanged revisions.
- Show draft/finalized/processing/failed states with recovery actions and input provenance. Preserve reasonable filter context across navigation.
- Keep Rust authoritative; avoid parallel business logic in Next server actions.

## Acceptance criteria

- [x] A reviewer creates two deliveries, reuses one revision, updates another, finalizes, reloads, and sees identical membership.
- [x] Invalid upload does not discard other ready sources. Two MEP sources remain distinct.
- [x] Historical runs and their exact inputs are reachable from the delivery.

## Verification

- node scripts/verify-ui.mjs --scenario deliveries
- npm --prefix apps/web run typecheck
- npm --prefix apps/web run build

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Created from the approved prototype plan on 2026-09-06. No implementation is claimed by ticket creation.

## Answer

The application now supports the delivery workflow through the project shelf and a bookmarkable delivery workspace. Rust remains authoritative for jobs, revision publication, membership, finalization, locking, and run provenance.

### Behavior

- `/` loads the selected project, creates named deliveries and source models, filters by discipline, and keeps project and filter context in the URL.
- `/deliveries/:deliveryId` lists sources by source-model ID, so two MEP sources remain separate. Each row uploads and retries its own durable job, keeps existing membership visible after a failed replacement, and requires an explicit attach or replace action.
- Membership changes refresh both the workspace and the combined viewer from Rust. Finalized and run-locked deliveries disable membership edits.
- Run history loads `RunDetail`, labels complete or incomplete provenance, and lists every pinned source name, filename, revision ID, content hash, schema, entity count, and product count.
- `scripts/verify-ui.mjs --scenario deliveries` starts the real checker, worker, production Next application, and Chromium. It uses the tracked synthetic IFC and IDS fixtures and stores logs, response snapshots, and desktop and mobile screenshots under the ticket evidence directory.

### Files

- API boundary and state parsing: `apps/web/src/lib/shelf-api.ts`
- Project shelf: `apps/web/src/components/shelf/project-shelf.tsx`
- Delivery assembly and history: `apps/web/src/components/shelf/delivery-workspace.tsx`
- Route mounts: `apps/web/src/app/page.tsx`, `apps/web/src/app/deliveries/[deliveryId]/page.tsx`
- Real browser proof: `scripts/verify-ui.mjs`
- Rust toolchain lookup for shared verifiers: `scripts/lib/checker-harness.mjs`

### Commands

```text
node scripts/verify-ui.mjs --scenario deliveries
# passed, 31 named checks, 0 failures

npm --prefix apps/web run typecheck
# passed

npm --prefix apps/web run build
# passed

node /home/daniel/.agents/skills/impeccable/scripts/detect.mjs --json apps/web/src/components/shelf/project-shelf.tsx apps/web/src/components/shelf/delivery-workspace.tsx apps/web/src/app/page.tsx 'apps/web/src/app/deliveries/[deliveryId]/page.tsx'
# []
```

An additional browser smoke check covered the populated shelf and empty delivery workspace at 1440 by 900 and 390 by 844. Both mobile pages kept `scrollWidth` equal to 390.

### Evidence

- [Structured results](../../../.omo/evidence/modelshelf-prototype/task-10/run-2026-09-08T01-43-09-662Z/snapshots/results.json)
- [Failed upload with preserved ready members](../../../.omo/evidence/modelshelf-prototype/task-10/run-2026-09-08T01-43-09-662Z/delivery-failed-upload-desktop.png)
- [Pinned run inputs on desktop](../../../.omo/evidence/modelshelf-prototype/task-10/run-2026-09-08T01-43-09-662Z/delivery-run-desktop.png)
- [Pinned run inputs on mobile](../../../.omo/evidence/modelshelf-prototype/task-10/run-2026-09-08T01-43-09-662Z/delivery-run-mobile.png)
- [Finalized delivery response](../../../.omo/evidence/modelshelf-prototype/task-10/run-2026-09-08T01-43-09-662Z/snapshots/delivery-drop2-finalized.json)
- [Pinned run response](../../../.omo/evidence/modelshelf-prototype/task-10/run-2026-09-08T01-43-09-662Z/snapshots/run-detail.json)
- [Visual smoke metrics](../../../.omo/evidence/modelshelf-prototype/task-10/run-2026-09-08T01-43-09-662Z/snapshots/visual-smoke.json)
- [Populated shelf on mobile](../../../.omo/evidence/modelshelf-prototype/task-10/run-2026-09-08T01-43-09-662Z/shelf-populated-mobile.webp)
- [Empty delivery workspace on mobile](../../../.omo/evidence/modelshelf-prototype/task-10/run-2026-09-08T01-43-09-662Z/delivery-empty-mobile.webp)
- [Architecture synthesis](../../../.omo/evidence/modelshelf-prototype/task-10/run-2026-09-08T01-43-09-662Z/snapshots/architecture-synthesis.txt)

### Downstream contract and limits

- No HTTP, database, worker, model, or viewer-core contract changed.
- Ticket 11 still owns pack selection, run creation controls, and the full grouped findings review.
- `scripts/lib/checker-harness.mjs` now uses `CARGO` when set and the standard rustup binary when Cargo is absent from `PATH`.
- The work remains uncommitted in the isolated `dmalmq/reviewer-delivery-shelf` worktree. This ticket does not authorize commits, pushes, or a pull request.
