# Derive graded compliance variants from the Snowdon delivery

ID: 32
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent, plan-alignment
Status: open
Assignee: unassigned
Blocked by: 31
Wave: 2
Original plan coverage: 4, fixture portion; 8,9 comparison inputs

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override, raised by the 2026-09-09 plan-alignment review.

## What to build

Three deliveries of the same building whose compliance against one pack is known in advance — none, partial, and all — so the application's reported state and its delivery-to-delivery comparison can both be checked against a stored oracle.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), [the starting codebase](../codebase-map.md), and [the plan-alignment review](../../../docs/reviews/plan-alignment-2026-09-09.md) that raised this ticket. Inspect current source before editing. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable.

## Prerequisites

- [Adopt Snowdon Towers as the four-discipline demo delivery](31-snowdon-demo-delivery.md). Its pack defines what "complies" means; this ticket is meaningless without it.

## Ownership

A new variant generator under `scripts/`, `packs/demo/` variant oracle, `samples/snowdon-towers/`, `scripts/verify-api.mjs`.

Other agents may be working in this checkout. Tickets 13, 14 and 15 consume this oracle; agree the oracle shape with their owners before finalizing it.

## Design decided with the owner on 2026-09-09

- The real export is the **partial** grade. It is already naturally mixed: 683 of 1,078 architectural walls carry `Pset_WallCommon.FireRating`, 395 do not, and of those 683, 287 carry the value `NR` against 293 `2 HR`, 70 `4 HR`, and 28 `1 HR`. Do not synthesize a middle grade; measured messiness is the point.
- The **none** and **all** grades are derived from that base by an explicit, recorded, deterministic mutation.
- Considered and rejected for grading: editing the Revit source projects and re-exporting. The owner has Revit and the source models, so this is available. Two reasons it loses. First, there is no programmatic enumeration of what changed: hand-editing `FireRating` on 395 walls yields no machine-readable list of mutated objects, and the oracle depends on exactly that list. Second, matching would still work (Revit GlobalIds are stable across exports, so entity renumbering is harmless), but shape fingerprints might not: a re-export can legitimately re-tessellate unchanged geometry, which the plan explicitly warns reads as "Shape representation changed". That contamination would make a property-only expectation unprovable. Byte-level churn is certain; fingerprint-level churn is a real risk, and neither is worth accepting when a surgical rewrite avoids both.
- Vary architecture and structure only. Electrical and plumbing stay byte-identical across all three deliveries, so revision reuse and "unchanged models stay contextual" are exercised rather than worked around, and the ingest cost stays near 6 minutes per delivery instead of 10.

## Implementation boundaries

- **Preserve applicability; mutate only the requirement side.** Deleting a property set or changing an entity class turns a specification *not applicable* instead of *failing*, which under the applicability rule in [the specification](../spec.md) tests the opposite of the intent. The object, its class, and its property-set membership stay; only the checked value changes.
- **Rewrite the STEP text surgically. Do not round-trip through IfcOpenShell.** Rewriting only the targeted `IFCPROPERTYSINGLEVALUE` lines leaves every other byte identical, which is what makes the expected diff exact: property component changed on precisely the enumerated objects, placement identical, shape identical, zero additions or removals. A `file.write()` round-trip renumbers entities and re-serializes geometry, perturbing placement and shape fingerprints and destroying that assertion.
- The generator must be deterministic: the same input produces a byte-identical output, and its SHA-256 is pinned alongside the base models.
- Store the oracle explicitly, in the style of `packs/demo/fixtures/oracle.json`: per grade, per specification, the expected outcome and counts, plus the exact GlobalId and expressId of every mutated object with its old and new value.
- Expect the comparison to expose `services/checker/src/jobs.rs:806`, which writes the sentinel `incomplete:waiting-for-normalized-snapshot` into all four `fp_*` columns and makes `modeldiff` report property-only changes as unchanged. That is ticket 13's defect, not this ticket's to hide. Record the observed behavior; do not adjust the oracle to match it.
- Do not commit variant `.ifc` bytes. They are derived from restricted content and inherit its terms.
- Do not use these variants for geometric change kinds. Add, remove, move, rotate, and shape edits stay with the existing synthetic A/B fixtures, which are small, fast, and already have an oracle.
- There is a better source for geometric change kinds than either option, and it is out of scope here: the owner can open the Snowdon Revit projects, make a small deliberate edit (move one wall, delete one beam, swap one type), and export a genuine second revision. That produces real exporter output for move, remove, and shape-representation changes, which no synthetic fixture reproduces, and the tessellation instability that disqualifies re-export for property grading is harmless there because geometric change is the thing under test. Raise it with the owner from ticket 13 if that ticket wants it; do not fold it into this one.

## Acceptance criteria

- [ ] A generator produces the none and all variants from the staged base models deterministically; running it twice yields identical hashes.
- [ ] Every mutated object is enumerated in the oracle with its GlobalId, expressId, old value, and new value.
- [ ] Scoring the three deliveries against one pack version yields, per specification: zero passing applicable objects in the none grade, the measured mixed counts in the partial grade, and zero failures in the all grade. No specification silently becomes not applicable in the none grade.
- [ ] A run over the all grade reports no failing objects while still reporting the same applicable-object count as the none grade, proving applicability was preserved.
- [ ] Comparing partial against all reports property changes on exactly the enumerated objects, with placement and shape components unchanged and zero additions or removals, or records the sentinel-fingerprint defect as the observed reason it cannot yet do so.
- [ ] Electrical and plumbing revisions are reused across all three deliveries by reference, with no re-ingestion.

## Verification

- The variant generator, run twice, compared by hash
- node scripts/verify-api.mjs --scenario checks
- Scoring all three deliveries against one pack version and comparing to the stored oracle
- A recorded delivery-to-delivery comparison between two grades

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Raised on 2026-09-09 by the plan-alignment review of tickets 01-11 and 18. Every claim below cites the file and line observed in that review. No implementation is claimed by ticket creation.
