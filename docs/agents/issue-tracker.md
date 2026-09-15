# Issue tracker

GitHub Issues are the published ticket set. Local Markdown under `.scratch/modelshelf-prototype/` is a working copy that is not pushed.

Parent map: [Build the ModelShelf prototype](https://github.com/dmalmq/ModelShelf/issues/21).

Read [`VISION.md`](../../VISION.md) and [`docs/adr/0001-reusable-model-modules.md`](../adr/0001-reusable-model-modules.md) before starting work.

## Local ID to GitHub issue

Tickets 01–18 are GitHub issues 3–20 (`id + 2`). Tickets 19–34 are issues 40–55 (`id + 21`).

| Local | GitHub | Title |
| --- | --- | --- |
| 01 | [#3](https://github.com/dmalmq/ModelShelf/issues/3) | Restore and verify the local application baseline |
| 02 | [#4](https://github.com/dmalmq/ModelShelf/issues/4) | Create deliveries from immutable source-model revisions |
| 03 | [#5](https://github.com/dmalmq/ModelShelf/issues/5) | Inspect IFC through a verified worker contract |
| 04 | [#6](https://github.com/dmalmq/ModelShelf/issues/6) | Process model revisions through durable jobs |
| 05 | [#7](https://github.com/dmalmq/ModelShelf/issues/7) | Prepare reproducible Japanese and synthetic demo evidence |
| 06 | [#8](https://github.com/dmalmq/ModelShelf/issues/8) | Run scoped IDS checks against pinned delivery inputs |
| 07 | [#9](https://github.com/dmalmq/ModelShelf/issues/9) | Open a combined delivery in the browser |
| 08 | [#10](https://github.com/dmalmq/ModelShelf/issues/10) | Inspect a real finding in its model context |
| 09 | [#11](https://github.com/dmalmq/ModelShelf/issues/11) | Prove the Wave 1 review loop and viewer performance |
| 10 | [#12](https://github.com/dmalmq/ModelShelf/issues/12) | Complete the reviewer delivery shelf |
| 11 | [#13](https://github.com/dmalmq/ModelShelf/issues/13) | Complete prioritized findings and pack selection |
| 12 | [#14](https://github.com/dmalmq/ModelShelf/issues/14) | Compute versioned fingerprints from normalized object state |
| 13 | [#15](https://github.com/dmalmq/ModelShelf/issues/15) | Compare revisions with explicit match confidence |
| 14 | [#16](https://github.com/dmalmq/ModelShelf/issues/16) | Compare findings only under compatible checking settings |
| 15 | [#17](https://github.com/dmalmq/ModelShelf/issues/17) | Review model and finding changes visually |
| 16 | [#18](https://github.com/dmalmq/ModelShelf/issues/18) | Package and verify the complete local demo |
| 17 | [#19](https://github.com/dmalmq/ModelShelf/issues/19) | Independently audit prototype completion |
| 18 | [#20](https://github.com/dmalmq/ModelShelf/issues/20) | Publish shared model contracts across Rust, Python, and the browser |
| 19 | [#40](https://github.com/dmalmq/ModelShelf/issues/40) | Extract the reusable viewer package behind public exports |
| 20 | [#41](https://github.com/dmalmq/ModelShelf/issues/41) | Consume the generated model contracts in the browser and checker |
| 21 | [#42](https://github.com/dmalmq/ModelShelf/issues/42) | Remove the design mock scaffolding from the shipped application |
| 22 | [#43](https://github.com/dmalmq/ModelShelf/issues/43) | Serialize heavy worker jobs and recover interrupted runs |
| 23 | [#44](https://github.com/dmalmq/ModelShelf/issues/44) | Record measured run inputs instead of hardcoded and reconstructed ones |
| 24 | [#45](https://github.com/dmalmq/ModelShelf/issues/45) | Report distinct object counts and preserve backend order |
| 25 | [#46](https://github.com/dmalmq/ModelShelf/issues/46) | Publish the worker envelope schema and settle its version |
| 26 | [#47](https://github.com/dmalmq/ModelShelf/issues/47) | Close worker path and dependency boundary gaps |
| 27 | [#48](https://github.com/dmalmq/ModelShelf/issues/48) | Cover the untested plan edge cases with real scenarios |
| 28 | [#49](https://github.com/dmalmq/ModelShelf/issues/49) | Make the verification harness assert what it claims |
| 29 | [#50](https://github.com/dmalmq/ModelShelf/issues/50) | Re-measure Wave 1 viewer performance on a hardware GL host |
| 30 | [#51](https://github.com/dmalmq/ModelShelf/issues/51) | Reconcile stale documentation with the shipped prototype |
| 31 | [#52](https://github.com/dmalmq/ModelShelf/issues/52) | Adopt Snowdon Towers as the four-discipline demo delivery |
| 32 | [#53](https://github.com/dmalmq/ModelShelf/issues/53) | Derive graded compliance variants from the Snowdon delivery |
| 33 | [#54](https://github.com/dmalmq/ModelShelf/issues/54) | Retire the dead IFC-parsing fingerprint API |
| 34 | [#55](https://github.com/dmalmq/ModelShelf/issues/55) | Decide whether a rotation-only change reads as unchanged |

## Landed on main

`origin/main` after [PR 71](https://github.com/dmalmq/ModelShelf/pull/71). These tickets are implemented. Merged pull requests did not use closing keywords, so the GitHub issues may still show open until a later PR closes them.

| Local | GitHub | Merged PR |
| --- | --- | --- |
| 01 | [#3](https://github.com/dmalmq/ModelShelf/issues/3) | [2](https://github.com/dmalmq/ModelShelf/pull/2) |
| 02 | [#4](https://github.com/dmalmq/ModelShelf/issues/4) | Wave 1 revision model (`verify-api --scenario revisions`) |
| 03 | [#5](https://github.com/dmalmq/ModelShelf/issues/5) | Worker contract on the live IfcTester path |
| 04 | [#6](https://github.com/dmalmq/ModelShelf/issues/6) | Durable jobs (`verify-api --scenario worker-failure`) |
| 05 | [#7](https://github.com/dmalmq/ModelShelf/issues/7) | BLCJ sample fetch plus synthetic fixtures |
| 06 | [#8](https://github.com/dmalmq/ModelShelf/issues/8) | [25](https://github.com/dmalmq/ModelShelf/pull/25) |
| 07 | [#9](https://github.com/dmalmq/ModelShelf/issues/9) | [26](https://github.com/dmalmq/ModelShelf/pull/26) |
| 08 | [#10](https://github.com/dmalmq/ModelShelf/issues/10) | [27](https://github.com/dmalmq/ModelShelf/pull/27) |
| 09 | [#11](https://github.com/dmalmq/ModelShelf/issues/11) | [28](https://github.com/dmalmq/ModelShelf/pull/28) |
| 10 | [#12](https://github.com/dmalmq/ModelShelf/issues/12) | [29](https://github.com/dmalmq/ModelShelf/pull/29) |
| 11 | [#13](https://github.com/dmalmq/ModelShelf/issues/13) | [31](https://github.com/dmalmq/ModelShelf/pull/31) |
| 12 | [#14](https://github.com/dmalmq/ModelShelf/issues/14) | [33](https://github.com/dmalmq/ModelShelf/pull/33) |
| 13 | [#15](https://github.com/dmalmq/ModelShelf/issues/15) | [35](https://github.com/dmalmq/ModelShelf/pull/35) |
| 14 | [#16](https://github.com/dmalmq/ModelShelf/issues/16) | [37](https://github.com/dmalmq/ModelShelf/pull/37) |
| 15 | [#17](https://github.com/dmalmq/ModelShelf/issues/17) | [38](https://github.com/dmalmq/ModelShelf/pull/38) |
| 16 | [#18](https://github.com/dmalmq/ModelShelf/issues/18) | [39](https://github.com/dmalmq/ModelShelf/pull/39) |
| 18 | [#20](https://github.com/dmalmq/ModelShelf/issues/20) | [2](https://github.com/dmalmq/ModelShelf/pull/2) |
| 19 | [#40](https://github.com/dmalmq/ModelShelf/issues/40) | [58](https://github.com/dmalmq/ModelShelf/pull/58) |
| 20 | [#41](https://github.com/dmalmq/ModelShelf/issues/41) | [60](https://github.com/dmalmq/ModelShelf/pull/60) |
| 21 | [#42](https://github.com/dmalmq/ModelShelf/issues/42) | [61](https://github.com/dmalmq/ModelShelf/pull/61) |
| 22 | [#43](https://github.com/dmalmq/ModelShelf/issues/43) | [62](https://github.com/dmalmq/ModelShelf/pull/62) |
| 23 | [#44](https://github.com/dmalmq/ModelShelf/issues/44) | [63](https://github.com/dmalmq/ModelShelf/pull/63) |
| 24 | [#45](https://github.com/dmalmq/ModelShelf/issues/45) | [64](https://github.com/dmalmq/ModelShelf/pull/64) |
| 25 | [#46](https://github.com/dmalmq/ModelShelf/issues/46) | [65](https://github.com/dmalmq/ModelShelf/pull/65) |
| 26 | [#47](https://github.com/dmalmq/ModelShelf/issues/47) | [66](https://github.com/dmalmq/ModelShelf/pull/66) |
| 27 | [#48](https://github.com/dmalmq/ModelShelf/issues/48) | [67](https://github.com/dmalmq/ModelShelf/pull/67) |
| 28 | [#49](https://github.com/dmalmq/ModelShelf/issues/49) | [68](https://github.com/dmalmq/ModelShelf/pull/68) |
| 30 | [#51](https://github.com/dmalmq/ModelShelf/issues/51) | [69](https://github.com/dmalmq/ModelShelf/pull/69) |
| 33 | [#54](https://github.com/dmalmq/ModelShelf/issues/54) | [70](https://github.com/dmalmq/ModelShelf/pull/70) |
| 34 | [#55](https://github.com/dmalmq/ModelShelf/issues/55) | [71](https://github.com/dmalmq/ModelShelf/pull/71) |
| 31 | [#52](https://github.com/dmalmq/ModelShelf/issues/52) | [75](https://github.com/dmalmq/ModelShelf/pull/75) |

## Still open

| Local | GitHub | Why |
| --- | --- | --- |
| 17 | [#19](https://github.com/dmalmq/ModelShelf/issues/19) | Independent completion audit (plan F1–F4) |
| 29 | [#50](https://github.com/dmalmq/ModelShelf/issues/50) | Hardware-GL pass recorded in [PR 74](https://github.com/dmalmq/ModelShelf/pull/74). Close when that lands |
| 32 | [#53](https://github.com/dmalmq/ModelShelf/issues/53) | Graded Snowdon variants |
| map | [#21](https://github.com/dmalmq/ModelShelf/issues/21) | Parent prototype map |

## Wayfinding operations

- Ticket identity is the two-digit local ID in the issue title, for example `[17]`.
- `wayfinder:task` and `ready-for-agent` labels identify execution tickets.
- GitHub issue state is authoritative (`open` or `closed`). When a local working copy exists, keep its `Status:` in line with that state (`open` or `resolved`).
- GitHub issue bodies carry an HTML comment `<!-- modelshelf-local-ticket:N -->` used by `node scripts/sync-tickets.ts --check`.
- Record progress as GitHub comments. On completion, append an evidence-backed Answer, close the issue, and update the parent map.
- The frontier is open, unassigned tickets with all dependencies resolved, sorted by local ID.
- Dependencies alone do not authorize concurrent edits to shared modules. Consult each ticket's ownership area before starting.

## Evidence unit

Published proof is gitignored run directories under `.omo/evidence/modelshelf-prototype/` plus [`docs/reviews/wave-1-report.md`](../reviews/wave-1-report.md) and the leaf index in [`docs/demo-launch.md`](../demo-launch.md). The plan's `task-N.md` files are not the unit, because `.omo/` cannot be tracked. Folder names mix plan-todo numbers, ticket ids, and slugs (`task-5` is pack evaluation, viewer evidence is `07-combined-viewer`; `task-9` is first-loop; `task-11` is contracts / ticket 18).
