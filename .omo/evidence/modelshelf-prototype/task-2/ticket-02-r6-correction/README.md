# Ticket 02 review correction R6: run input provenance defaults to incomplete

Every command below ran in an isolated `git worktree` checked out at the fix commit,
not in the shared development checkout, because two other sessions were editing
`schemas/model/v1/`, the generated contract bindings, and `services/ifc-worker/`
at the same time. Their in-flight state made `cargo test --workspace` and both
`verify-api` scenarios red for reasons unrelated to this change.

- `cargo-test-workspace.log` — every crate, including the four new migration tests.
- `verify-api-revisions.log` — the ticket's named scenario, real server and real
  IFC worker, ending in the new provenance check.
- `verify-api-worker-failure.log` — the other scenario, unaffected and still green.
- `web-typecheck.log`
- `schema-v5-on-disk.txt` — the migrated schema read back out of a real database
  written by the shipped binary.
- `r6-reproduced-without-fix.txt` — the same tests against a copy with only the
  production fix reverted, reproducing R6 verbatim off a real server.
