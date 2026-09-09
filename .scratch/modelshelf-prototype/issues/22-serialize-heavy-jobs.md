# Serialize heavy worker jobs and recover interrupted runs

ID: 22
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent, plan-alignment
Status: open
Assignee: unassigned
Blocked by: 04, 06
Wave: 1
Original plan coverage: 3, job-scheduling portion; plan 'one active heavy processing job at a time'

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override, raised by the 2026-09-09 plan-alignment review.

## What to build

At most one heavyweight IFC worker subprocess runs at a time across ingestion and checking, and a restart during a run leaves a visible recoverable failure rather than a permanently running row.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), [the starting codebase](../codebase-map.md), and [the plan-alignment review](../../../docs/reviews/plan-alignment-2026-09-09.md) that raised this ticket. Inspect current source before editing. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable.

## Prerequisites

- [Process model revisions through durable jobs](04-queued-ingestion.md) established the exclusive ingestion lock.
- [Run scoped IDS checks against pinned delivery inputs](06-scoped-ids-runs.md) added run evaluation on a separate path.

## Ownership

`services/checker/src/jobs.rs`, `services/checker/src/run.rs`, `services/checker/src/db.rs`, `services/checker/src/state.rs`, `scripts/verify-api.mjs`.

Other agents may be working in this checkout. Ticket 23 edits `run.rs` in the same region. Agree an ordering with its owner before starting.

## Implementation boundaries

- `services/checker/src/jobs.rs:126-128` documents "One task per process, processing claimed jobs strictly one after another", but `services/checker/src/run.rs` `create_run` awaits `execute(...)` inline in the HTTP handler and calls `invoke_worker` per model with no shared gate. Two concurrent `POST /api/runs`, or a run racing an ingestion job, spawn concurrent workers.
- `services/checker/src/db.rs:111-122` `recover_interrupted_jobs` fails interrupted `ingestion_jobs` at startup. There is no equivalent for `runs`; `run.rs` inserts `status = 'running'` and evaluates synchronously, so a SIGKILL strands the row with no error and no retry path.
- Do not solve this by removing the synchronous run path if that changes the HTTP contract. Either share one gate across both paths or route run evaluation through the durable queue; state which you chose and why.
- A failed or interrupted run must never present as a clean scorecard.

## Acceptance criteria

- [ ] Two concurrent run requests, and a run concurrent with an ingestion job, never produce two live worker subprocesses. Prove it by observation, not by reading the code.
- [ ] Startup recovery marks interrupted runs failed with an explicit reason, mirroring `recover_interrupted_jobs`, and the run is retryable afterwards.
- [ ] A restart mid-run leaves no row in `running` and no completed scorecard.
- [ ] The single-job guarantee is asserted in `scripts/verify-api.mjs` against real processes.

## Verification

- cargo test -p modelshelf-checker
- node scripts/verify-api.mjs --scenario worker-failure
- node scripts/verify-api.mjs --scenario checks
- A new or extended scenario step that starts two runs concurrently and observes at most one worker process

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Raised on 2026-09-09 by the plan-alignment review of tickets 01-11 and 18. Every claim below cites the file and line observed in that review. No implementation is claimed by ticket creation.
