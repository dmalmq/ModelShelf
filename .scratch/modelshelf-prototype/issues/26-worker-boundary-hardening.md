# Close worker path and dependency boundary gaps

ID: 26
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent, plan-alignment
Status: open
Assignee: unassigned
Blocked by: 04
Wave: 1
Original plan coverage: 3, boundary portion; plan dependency pinning

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override, raised by the 2026-09-09 plan-alignment review.

## What to build

The checker trusts no path it has not canonicalized, the worker refuses relative paths on its own, and every dependency that affects validation behavior is pinned as tightly as the engines.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), [the starting codebase](../codebase-map.md), and [the plan-alignment review](../../../docs/reviews/plan-alignment-2026-09-09.md) that raised this ticket. Inspect current source before editing. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable.

## Prerequisites

- [Process model revisions through durable jobs](04-queued-ingestion.md), whose Answer records "Reject symlink-based artifact path escapes".

## Ownership

`services/checker/src/jobs.rs`, `services/ifc-worker/src/ifc_worker/protocol.py`, `services/ifc-worker/src/ifc_worker/cli.py`, `services/ifc-worker/pyproject.toml`, `packages/model-contracts-py/pyproject.toml`, `scripts/lib/fake-worker.mjs`, `scripts/verify-api.mjs`.

Other agents may be working in this checkout. Ticket 25 also edits the worker protocol and `jobs.rs`. Agree an ordering with its owner before starting.

## Implementation boundaries

- `services/checker/src/jobs.rs:512-522` checks the manifest path lexically with `is_within` and then reads it, with no `canonicalize`. `verify_artifact()` at `jobs.rs:718-735` does canonicalize before its second containment check. A manifest path that is lexically inside the job directory but is a symlink to a file outside it is read and trusted.
- `services/ifc-worker/src/ifc_worker/protocol.py:24-50` accepts `model.path`, `ids.path` and `outputDir` with no absoluteness validator, and `cli.py:34-58` never checks. `docs/contracts/worker-v1.md` promises "All paths are absolute", but only the Rust caller enforces it, so a direct CLI invocation resolves relative paths against the current directory.
- `services/ifc-worker/pyproject.toml:8` pins `ifcopenshell==0.8.5` and `ifctester==0.8.5` exactly but lets `pydantic>=2.11,<3` and `typer>=0.16,<1` float; `packages/model-contracts-py/pyproject.toml:8` does the same for pydantic. Validation behavior can change on a fresh resolve without a lockfile diff.
- Preserve the existing containment guarantees; this ticket tightens them, it does not restructure them.
- Do not grant the worker any database or network access while fixing paths.

## Acceptance criteria

- [ ] The manifest path is canonicalized and re-checked for containment before its bytes are read, hashed, or parsed.
- [ ] A manifest that is a symlink pointing outside the job directory fails the job with an explicit reason and publishes nothing. Proven by a new fake-worker mode in the `worker-failure` scenario.
- [ ] The worker rejects a relative `model.path`, `ids.path`, or `outputDir` with a nonzero exit and no result line, covered by a worker unit test.
- [ ] Pydantic and typer are pinned exactly, matching the verified lockfile, in both pyprojects, with the bump-and-relock procedure documented next to the engine pins.
- [ ] `uv run --locked` still resolves without changes after the pin tightening.

## Verification

- cargo test -p modelshelf-checker
- uv run --locked --project services/ifc-worker pytest
- node scripts/verify-api.mjs --scenario worker-failure

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Raised on 2026-09-09 by the plan-alignment review of tickets 01-11 and 18. Every claim below cites the file and line observed in that review. No implementation is claimed by ticket creation.
