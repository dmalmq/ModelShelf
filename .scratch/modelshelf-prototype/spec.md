# ModelShelf prototype specification

Status: approved direction; implementation outstanding.

The approved architecture and detailed behavior remain in [the prototype plan](../../.omo/plans/modelshelf-prototype.md). The [domain glossary](../../CONTEXT.md) defines shared terms. This file records how the ticket breakdown relates to that plan, rather than creating a second architecture specification.

## Destination and scope

Complete both waves of the local, single-user prototype. Wave 1 ends only when a real IFC delivery is checked by the established worker and a resulting finding selects the correct object in a combined browser viewer. Wave 2 adds the complete reviewer workflow and delivery comparisons.

Rust/Axum owns the API, local SQLite data, immutable evidence, processing jobs, grouping, fingerprints, and comparison. A locked local IfcOpenShell/IfcTester Python worker handles authoritative IFC interpretation and IDS evaluation. Next.js/React provides the frontend, initially using Three.js and web-ifc for rendering.

The ticket map authorizes implementation by a future agent. Creating these tickets did not implement or approve completion of any ticket.

## Accepted reusable-module amendment

The [module decision](../../docs/adr/0001-reusable-model-modules.md) is approved and takes precedence over earlier IFC-specific viewer references in drafts. Implement shared model contracts and one reusable viewer package. Keep native RVT/PLN integration deferred. The new shared-contract ticket is a prerequisite for source/revision payloads and the worker. The combined-viewer ticket does not own the standalone consumer; extract the reusable viewer package after Wave 1. Existing ticket IDs and claims are preserved.

## Contract clarification

The partial worker protocol document says zero applicable objects are always incomplete unless they fail. Do not preserve that policy blindly. Keep the engine's raw outcome and applicability count. Required applicability with no matching objects fails; an optional specification can legitimately have no applicable objects. Present that condition separately as not applicable when appropriate. Reserve incomplete for unsupported or unavailable evaluation. Implement and test this distinction in the scoped-check ticket.

The existing Rust IDS harness passes with accepted conformance gaps. Its success is not evidence that the custom engine is safe for unrestricted live scoring. It remains a reference/test implementation, not the authoritative prototype checker.

## Plan coverage

| Original plan item | Tickets that deliver it |
| --- | --- |
| Shared reusable model contracts | Publish shared model contracts across Rust, Python, and the browser |
| Restore service and QA harness | Restore and verify the local application baseline |
| Sources, revisions, pinned inputs | Create deliveries from immutable source-model revisions; process revisions through durable jobs; run scoped checks |
| Worker and jobs | Inspect IFC through a verified worker contract; process revisions through durable jobs; run scoped checks |
| Demo evidence and packs | Prepare reproducible Japanese and synthetic demo evidence; run scoped checks |
| Combined viewer and first loop | Open a combined delivery; inspect findings in context; prove the Wave 1 review loop |
| Project shelf | Complete the reviewer delivery shelf |
| Findings workflow | Complete prioritized findings and pack selection |
| Fingerprints and comparison | Compute normalized fingerprints; compare model revisions; compare findings under compatible settings |
| Comparison UI | Review model and finding changes visually |
| Reproducible demo and final verification | Package and verify the complete local demo; independently audit prototype completion |

## Boundaries

No Revit write-back, clash or regulatory compliance engine, production authentication/billing, arbitrary Excel conversion, or public sample redistribution. Preserve existing uncommitted work. Commits, publishing, PRs, and deployment are not authorized by this ticket-writing request.
