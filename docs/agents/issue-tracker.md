# Issue tracker

Use local Markdown for this effort. No external issues have been created.

ModelShelf prototype tickets live in `.scratch/modelshelf-prototype/issues/`, with one file per issue. The canonical Wayfinder index is `.scratch/modelshelf-prototype/map.md`. Read `HANDOFF.md` in that directory before starting work.

## Wayfinding operations

- Ticket identity is its two-digit filename prefix. Refer to tickets by linked title in prose.
- `Type: task` and `Labels: wayfinder:task, ready-for-agent` identify execution tickets. The map's Notes explicitly permit implementation.
- `Status: open`, `Status: claimed`, and `Status: resolved` describe the lifecycle. `Assignee: unassigned` means unclaimed.
- `Blocked by: 01, 02` lists prerequisites. `Blocked by: none` means no dependencies. All blockers must be resolved before claiming.
- Before any implementation, claim one ticket and set its assignee to a unique agent/session name. Use exclusive creation of a ticket-specific claim directory as described in HANDOFF.md. Do not race writes to the same issue.
- Record progress under `## Comments`. On completion, append an evidence-backed resolution under `## Answer`, set status resolved, release the claim, and append a linked gist to the map's Decisions so far.
- The frontier is open, unassigned tickets with all dependencies resolved, sorted numerically. `node .scratch/modelshelf-prototype/check-tickets.mjs` validates and prints it.
- Dependencies alone do not authorize concurrent edits to shared modules. Consult each ticket's ownership area and coordinate file conflicts before starting.

This uses Wayfinder's documented local-tracker fallback. Run `/setup-matt-pocock-skills` later if you want to switch to a hosted tracker; it is not required to use these local tickets.
