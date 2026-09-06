# Start a ModelShelf ticket

Use this entry point to implement the approved prototype from a fresh agent session.

## Read first

1. Read [the map](map.md) for destination and boundaries.
2. Read [the specification](spec.md) and [starting codebase](codebase-map.md).
3. Read [the accepted reusable-module decision](../../docs/adr/0001-reusable-model-modules.md). Keep viewer/business policy separate and use opaque ObjectRefs.
4. Run `node .scratch/modelshelf-prototype/check-tickets.mjs` from the repository root.
5. Choose the first frontier ticket, or the unblocked ticket the user names. Read it and the Answer sections of its prerequisite tickets.

The work is in `/home/apollo/orca/workspaces/bim-authoring-tool/rockling`. Orca's display name is ModelShelf. If working in a relocated checkout, use its current root; do not assume this absolute path still applies.

The shared-contract ticket was added later and keeps a higher ID to preserve existing links. Follow dependencies, not filename order. The baseline ticket may already be claimed; never overwrite its owner or status.

## Claim before editing

Set a unique agent/session assignee. Before changing the ticket, atomically create `.scratch/modelshelf-prototype/claims/<ticket-id>/` using `mkdir`, without `-p` for the ticket directory. Create the parent `claims` directory separately if needed. A pre-existing claim directory means another session may own it; inspect the owner and do not delete it automatically.

Write an owner file inside the claim directory, then set `Status: claimed` and `Assignee: <your-session-name>` in the ticket. The claim directory guards the transition; the ticket assignment is the visible claim. Do not edit shared implementation files concurrently with another claimed ticket owner. Isolate test directories and ports.

## Execute one ticket

- Use poteto-mode and relevant implementation skills. The user has authorized building through this map; do not repeat the whole product interview.
- Inspect current source and uncommitted edits first. Preserve other agents' work. No destructive reset/clean, no invented stubs presented as implementation.
- Deliver the ticket's complete observable behavior with focused tests. Fix integration defects that prevent its acceptance rather than reporting a green library test alone.
- Keep source models and original uploaded bytes immutable. Keep the established worker authoritative for IFC/IDS checks. Preserve explicit failure/incomplete outcomes.
- Use the existing dark ModelShelf theme for app UI. This is a product prototype, not a screenshot mock.
- Do not implement later tickets silently, except a necessary prerequisite fix that is documented with its owner.

## Resolve and leave evidence

Append `## Answer` with behavior delivered, files changed, commands and real results, evidence paths, limits, and interface changes. Mark `Status: resolved` only after all acceptance criteria pass. Append a named link and one-line gist under the map's Decisions so far. Remove only your own claim directory after resolution. Re-run the frontier checker.

If blocked, keep the ticket open or claimed with an explicit explanation. Do not mark it resolved or manufacture a pass. A departing agent should release its own claim and restore `Status: open` / `Assignee: unassigned`, leaving a concise resume note.

## Suggested prompt for another AI

> Read `.scratch/modelshelf-prototype/HANDOFF.md` and use poteto-mode. Run the ticket checker, claim the first unblocked ticket, and implement that ticket fully. Preserve the current worktree changes. Run its acceptance checks against the real application or worker, record an Answer, and update the map. Do not claim later tickets are complete. Do not commit, push, or deploy.

For Wave 1 only, add:

> Work within Wave 1. Stop at the verified Wave 1 review-loop milestone; do not start Wave 2.

## Transfer notes

The tickets and code are currently local and include untracked files. Another AI must have this working directory or a complete authorized copy, not merely the last Git commit. Include the `.scratch` ticket set, `.omo` plan, source files, contracts, and lockfiles. Restricted samples under ignored directories require local access or the documented acquisition process; do not publish them. Transcript exports are not necessary to execute these tickets.
