# Review through ticket 05

Reviewed 2026-09-07. This report records corrective work for another agent; no product code was changed. The earlier [follow-up findings](tickets-01-03-follow-up.md) remain open in the current implementation.

## Ticket disposition

| Ticket | Result | Remaining work |
| --- | --- | --- |
| 01 | Retain resolved | Original cleanup and tracked seed fixture corrections are present. |
| 02 | Reopen | New unpinned runs still default to complete input provenance. |
| 03 | Reopen | Area/volume prefix conversion, independent rendering placement, IFC2X3 inheritance. |
| 04 | Reopen | Artifact validation and property round-trip from the earlier review, plus lifecycle and containment findings below. |
| 05 | Reopen | Correct and independently verify the synthetic oracle and the pack-change explanation. |

Historical Answers remain useful implementation history. They are not current approval where this review reopens a ticket.

## Ticket 04 corrections

### Recover jobs only under exclusive service ownership

`AppState::open` calls `recover_interrupted_jobs` for every caller, including `seed`. A real-process probe uploaded a job, waited until it was running, then ran seed against the same directory. Seed exited 0 and the live job changed to failed with `interrupted: the service restarted while this job was running`. No restart occurred.

Move recovery out of general database opening. Acquire exclusive ownership of the service's data directory before recovering jobs or starting a queue. A second server or seed invocation must not invalidate another process's live work. Verify seed during a slow job, a duplicate server start, a genuine restart, and exclusive heavy-work execution.

### Own worker lifetime and separate retry artifacts

`jobs.rs` waits for `sh -c ...` through `Command::output()` without supervising the descendant process tree. The same probe killed the checker and confirmed its worker remained alive. Restart can then mark the job failed and launch a retry while the old worker continues. Retries also reuse `jobs/<job-id>/`, permitting old and new attempts to overwrite evidence.

Supervise the full worker process tree, including abrupt checker death, and give each attempt an immutable output directory. Fence publication by attempt identity. Add a bounded execution timeout so a stuck worker does not block the queue forever. Verify the old worker is gone before retry, stale attempts cannot publish, and prior failure logs survive retries. An exit check on the checker alone is insufficient.

### Enforce filesystem containment, not only lexical containment

`is_within` normalizes path components but artifact reads follow filesystem links. A path lexically inside the job directory can resolve through a symlink to bytes outside it. Reject such escapes before reading or publishing. Test symlinked files and directories in addition to `../` and absolute outside paths. This is an inspection finding; the current path-escape test covers only a lexical escape.

### Remove the custom-parser prerequisite from ready publication

`publish_revision` still requires `ifc_model::IfcModel::parse` to succeed after the authoritative worker succeeds, and takes header/schema/unit information from that parse. Its failure aborts ingestion. This contradicts ticket 04's requirement to replace live custom-parser ingestion, even if fingerprints are its stated purpose.

Publish authoritative worker data without requiring a second parser's success. Coordinate the minimum worker metadata needed by the service. Keep optional comparison preparation explicitly incomplete when unsupported, and move normalized fingerprint work into its assigned ticket. Verify a successful worker artifact can publish independently of the custom parser.

Also complete earlier follow-up R3 and R5: validate render schemas and cross-artifact identity, and preserve the full structured property evidence at the persistence/API boundary.

## Ticket 05 corrections

### Make the oracle describe intended changes and exact check results

`packs/demo/fixtures/oracle.json` describes the repeated group as 120 affected objects, but the fixture IDS actually fails 135 walls in each revision. The other wall groups' exact IDS outcomes and affected membership are not fully enumerated. Equal totals do not prove equal finding membership when objects were added and removed.

The oracle also records pure rotations as `unchanged` because that is current engine behavior. Keep intended physical changes separate from known engine limitations. Duplicate GlobalIds must carry explicit uncertain correspondence, not an expectation of trusted express-ID pairing. Use revision-local occurrence references or stable fixture keys so ambiguous IDs are representable.

Add an executable oracle checker that fails on wrong counts, omitted objects, wrong category membership, and reversed ordered changes. Evaluate IDS with IfcTester and compare exact affected sets. Record unsupported engine expectations separately rather than changing the fixture to make a flawed matcher pass. Engine redesign remains in the comparison tickets; the oracle must expose the gap now.

### Correct the pack-change rationale

`packs/demo/checks.md` says all 150 v1 diameter failures are cable trays, while v2 excludes only 43. Independent IfcTester evaluation and IFC inspection find 62 ducts, 45 pipes, and 43 cable trays. Correct this explanation and the historical ticket Answer with a dated correction. The v2 counts themselves are correct: 1294 applicable, 107 failures.

### Make regeneration reviewable

The generator uses fresh UUIDs and changes the generated oracle each run. Add a stable fixture seed or deterministic IDs and header values, with an explicit output-directory option. Verify two isolated runs produce equivalent fixtures and the same oracle without overwriting the checked-in baseline during tests. Fix the documented root invocation, which currently includes an incorrect `../../scripts` path.

## Verification

- `cargo test --workspace` passed.
- `node scripts/verify-api.ts --scenario revisions` passed.
- `node scripts/verify-api.ts --scenario worker-failure` passed despite the uncovered descendant-lifetime gap.
- Worker test results and lifecycle probe evidence are retained under `.omo/evidence/modelshelf-prototype/tickets-1-5-review/`.
- The demo reviewer validated all three IDS files with IfcTester, confirmed the documented numeric check counts, and verified all six pinned archive/IFC hashes. The failures concern oracle completeness and explanation, not those checksums or IDS syntax.

The ticket 04 independent reviewer did not deliver a final verdict after a tool-policy interruption. Its observations were checked against source; the parent independently reproduced live-seed invalidation and the surviving worker. This report does not claim a complete security audit.
