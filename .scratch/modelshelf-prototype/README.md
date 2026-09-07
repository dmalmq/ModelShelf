# ModelShelf prototype tickets

Start with [the handoff](HANDOFF.md). [The Wayfinder map](map.md) records the destination and completed resolutions. Read [the accepted module decision](../../docs/adr/0001-reusable-model-modules.md) before implementation. There are 18 tickets: 10 in Wave 1 and 8 in Wave 2. Existing IDs and claims are preserved; rows below follow dependency order.

## Wave 1

| Ticket | Prerequisites |
| --- | --- |
| [Restore and verify the local application baseline](issues/01-local-baseline.md) | None |
| [Publish shared model contracts across Rust, Python, and the browser](issues/18-shared-model-contracts.md) | None |
| [Create deliveries from immutable source-model revisions](issues/02-immutable-deliveries.md) | [Restore and verify the local application baseline](issues/01-local-baseline.md); [Publish shared model contracts across Rust, Python, and the browser](issues/18-shared-model-contracts.md) |
| [Inspect IFC through a verified worker contract](issues/03-ifc-worker-contract.md) | [Publish shared model contracts across Rust, Python, and the browser](issues/18-shared-model-contracts.md) |
| [Process model revisions through durable jobs](issues/04-queued-ingestion.md) | [Create deliveries from immutable source-model revisions](issues/02-immutable-deliveries.md); [Inspect IFC through a verified worker contract](issues/03-ifc-worker-contract.md) |
| [Prepare reproducible Japanese and synthetic demo evidence](issues/05-demo-evidence.md) | None |
| [Run scoped IDS checks against pinned delivery inputs](issues/06-scoped-ids-runs.md) | [Process model revisions through durable jobs](issues/04-queued-ingestion.md); [Prepare reproducible Japanese and synthetic demo evidence](issues/05-demo-evidence.md) |
| [Open a combined delivery in the browser](issues/07-combined-viewer.md) | [Process model revisions through durable jobs](issues/04-queued-ingestion.md); [Prepare reproducible Japanese and synthetic demo evidence](issues/05-demo-evidence.md); [Publish shared model contracts across Rust, Python, and the browser](issues/18-shared-model-contracts.md). Viewer package extraction is out of this ticket. |
| [Inspect a real finding in its model context](issues/08-finding-inspection.md) | [Run scoped IDS checks against pinned delivery inputs](issues/06-scoped-ids-runs.md); [Open a combined delivery in the browser](issues/07-combined-viewer.md) |
| [Prove the Wave 1 review loop and viewer performance](issues/09-wave-one-gate.md) | [Inspect a real finding in its model context](issues/08-finding-inspection.md) |

## Wave 2

| Ticket | Prerequisites |
| --- | --- |
| [Complete the reviewer delivery shelf](issues/10-delivery-shelf.md) | [Prove the Wave 1 review loop and viewer performance](issues/09-wave-one-gate.md) |
| [Complete prioritized findings and pack selection](issues/11-priority-review.md) | [Complete the reviewer delivery shelf](issues/10-delivery-shelf.md) |
| [Compute versioned fingerprints from normalized object state](issues/12-normalized-fingerprints.md) | [Prove the Wave 1 review loop and viewer performance](issues/09-wave-one-gate.md) |
| [Compare revisions with explicit match confidence](issues/13-model-diff.md) | [Compute versioned fingerprints from normalized object state](issues/12-normalized-fingerprints.md) |
| [Compare findings only under compatible checking settings](issues/14-finding-diff.md) | [Complete prioritized findings and pack selection](issues/11-priority-review.md); [Compare revisions with explicit match confidence](issues/13-model-diff.md) |
| [Review model and finding changes visually](issues/15-comparison-screen.md) | [Compare findings only under compatible checking settings](issues/14-finding-diff.md) |
| [Package and verify the complete local demo](issues/16-reproducible-demo.md) | [Review model and finding changes visually](issues/15-comparison-screen.md) |
| [Independently audit prototype completion](issues/17-completion-audit.md) | [Package and verify the complete local demo](issues/16-reproducible-demo.md) |

Run `node .scratch/modelshelf-prototype/check-tickets.mjs` from the repository root for current unclaimed work. No ticket is resolved by this architecture amendment.
