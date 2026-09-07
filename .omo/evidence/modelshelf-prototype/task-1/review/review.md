# Ticket 01 review

Verdict: changes required. No implementation edits made.

Normal workspace tests and QA harness exit 0. Independent QA reported 43 passing workspace tests. Current workspace includes later-ticket changes.

P1: scripts/qa-harness.mjs lines 86-92 awaits a future exit event when the child may already have exited. A copied harness with a wrapper that exits 1 on serve (delegating other CLI commands to the real binary) exits 0, leaves both temp directories, and omits serve.log. See startup-failure.json. Probe sandbox removed by reviewer.

Fix: observe child exit/error from spawn time; handle already-exited children; bounded termination; cleanup and log flushing on all failure paths. Verify startup failure produces nonzero exit and no owned process/data leftovers.

Coverage improvement: seed checks use empty packs and equal stdout; add real IDS and assert stored tenant/project/pack/version counts after both executions.

Independent QA lane passed. Four other lanes failed to complete due workspace credit errors; not recorded as approvals. Parent inspected scoped source and reproduced the blocker. See snapshot.json for reviewed file hashes.
