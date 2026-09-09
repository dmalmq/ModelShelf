# Adopt Snowdon Towers as the four-discipline demo delivery

ID: 31
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent, plan-alignment
Status: open
Assignee: unassigned
Blocked by: 05, 06
Wave: 2
Original plan coverage: 4, second-dataset portion

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override, raised by the 2026-09-09 plan-alignment review.

## What to build

The four Autodesk Snowdon Towers IFC exports become a running four-discipline demo delivery with its own source-cited check pack, alongside the existing three-discipline BLCJ delivery.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), [the starting codebase](../codebase-map.md), and [the plan-alignment review](../../../docs/reviews/plan-alignment-2026-09-09.md) that raised this ticket. Inspect current source before editing. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable.

## Prerequisites

- [Prepare reproducible Japanese and synthetic demo evidence](05-demo-evidence.md) established the pack, oracle, and fixture conventions this ticket follows.
- [Run scoped IDS checks against pinned delivery inputs](06-scoped-ids-runs.md) established scoped IfcTester scoring.

## Ownership

`samples/snowdon-towers/`, `scripts/stage-snowdon-models.mjs`, a new `packs/demo/snowdon-*.ids` plus its metadata, `scripts/verify-api.mjs`, `services/ifc-worker/tests/test_demo_packs.py`.

Other agents may be working in this checkout. Do not revert their edits. Coordinate shared file/contract ownership first.

## Context already established

The dataset is staged and measured. [`samples/snowdon-towers/README.md`](../../../samples/snowdon-towers/README.md) records provenance and terms, [`manifest.json`](../../../samples/snowdon-towers/manifest.json) pins SHA-256 and per-model counts, and [`alignment.md`](../../../samples/snowdon-towers/alignment.md) records the measured frame. `node scripts/stage-snowdon-models.mjs --from <dir>` stages and verifies the four files into gitignored `samples/ifc/`.

Measured with the real worker on 2026-09-09: all four are IFC4 ReferenceView_V1.2 Revit exports, `lengthToMetre` 0.3048 (FOOT), 34,644 objects and 17,067 render primitives total, co-registered but sitting about 425 km from the world origin, with 17 GlobalIds shared between electrical and plumbing. Ingest cost was 37.5 s structure, 76.7 s electrical, 171.7 s plumbing, 331.8 s architecture.

## Implementation boundaries

- Do not commit the `.ifc` bytes. Autodesk publishes no redistribution grant; the files stay gitignored exactly as the BLCJ archives are. Only provenance metadata is tracked.
- Provenance is settled: the repository owner exported these files himself from Autodesk's Snowdon Towers Revit sample projects on 2026-08-24. They are a local export of Autodesk sample content, not a redistributed download, so the redistribution restriction above still applies to the exports.
- These exports are not byte-reproducible. Revit embeds a per-export timestamp, `VersionGUID`, and `NumberOfSaves` in the IFC header, so the pinned hashes identify exactly these files. Any evidence, object count, or oracle you record is tied to them. If they are re-exported, re-pin `manifest.json` with fresh measurements; never relax the staging hash check to accept a different export.
- The models co-register only because they were exported on `Shared Coordinates`. Do not assume a future export aligns; `samples/snowdon-towers/README.md` records the settings a functionally equivalent re-export must match.
- Author the pack against properties that were observed in the real export, never invented. Confirmed present and vendor-neutral: `Pset_WallCommon` (`FireRating` on 683 of 1,078 architectural walls, `IsExternal` 1,078, `LoadBearing` 1,061, `ThermalTransmittance` 1,060), `Pset_BeamCommon` (`LoadBearing`, `IsExternal`, `Span` on all 917 beams), `Pset_MemberCommon`, `Pset_BuildingElementProxyCommon`, `Pset_PipeSegmentOccurrence.InvertElevation` on all 3,051 pipe segments, and `Qto_*BaseQuantities`. Cite the buildingSMART property-set definition for each rule.
- Do not reuse the BLCJ pack. It targets `Rebro_PartsData` property sets that do not exist in this dataset.
- Apply source-model scope: electrical and plumbing are two MEP-family sources, and an architectural rule must not create failures against them.
- Keep the existing BLCJ delivery and its evidence intact. This is a second dataset, not a replacement.
- Do not weaken the unsupported-property diagnostics. The architectural model legitimately produces 1,197 of them.

## Acceptance criteria

- [ ] `node scripts/stage-snowdon-models.mjs` verifies all four hashes, is idempotent on re-run, and hard-fails rather than overwriting a file whose hash differs.
- [ ] A Snowdon pack with 8 to 12 specifications exists, each with a source citation, scope, severity, and category, every property confirmed present in the real export.
- [ ] A four-source delivery ingests, finalizes, and scores end to end against real processes, with pinned run inputs naming all four revisions and hashes.
- [ ] Electrical and plumbing are two distinct SourceModels sharing the MEP discipline, and a scoped architectural rule produces no findings against either.
- [ ] The combined viewer opens all four aligned, with one shared origin offset applied identically; no discipline is centred independently and geometry does not jitter at the 425 km offset.
- [ ] Imperial normalization is asserted: a length, an area, and a volume quantity each read back in SI from a FOOT-based model.
- [ ] A finding whose affected objects span electrical and plumbing selects the correct object on each side despite the 17 shared GlobalIds.
- [ ] The 1,197 architectural unsupported-property diagnostics surface as reported diagnostics, never as silent drops and never as passes.

## Verification

- node scripts/stage-snowdon-models.mjs --from "<local sample directory>"
- uv run --locked --project services/ifc-worker pytest
- node scripts/verify-api.mjs --scenario checks
- node scripts/verify-viewer.mjs
- Recorded evidence of the four-model delivery scored end to end, with per-model ingest timings

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Raised on 2026-09-09 by the plan-alignment review of tickets 01-11 and 18. Every claim below cites the file and line observed in that review. No implementation is claimed by ticket creation.
