# Demo check packs

Three independent pieces of demo evidence. The BLCJ pack and the synthetic
fixtures were authored in ticket 05. The Snowdon pack is ticket 31.

## The real BLCJ S1000 pack (`blcj-s1000-v1.ids` / `-v2.ids`)

11 information checks authored against the real architecture/structure/MEP
IFC exports in `samples/ifc/blcj-s1000-*.ifc` (see `samples/blcj-s1000/`),
cross-referenced against `references/bim-checking/`'s Sankai/MLIT/BLCJ source
material. Full source-to-property traceability, scope, priority, category,
and rationale for every check — plus real evaluation results against the real
models — is in [`checks.md`](checks.md). v2 differs from v1 by exactly one
explained rule change (also documented there): the MEP outer-diameter check's
applicability is narrowed to exclude 43 cable-tray segments. v1's 150 failures
were 62 ducts, 45 pipes, and 43 trays.

Each version's severity/category triage lives beside it as
`blcj-s1000-v{1,2}.metadata.json` (`services/checker/src/ids_meta.rs`'s
schema — kept out of the IDS XML itself, which stays standards-clean).

Verify independently:
```
cargo run -p ids --example evaluate_pack -- packs/demo/blcj-s1000-v1.ids samples/ifc/blcj-s1000-architecture.ifc samples/ifc/blcj-s1000-structure.ifc samples/ifc/blcj-s1000-mep.ifc
cargo run -p ids --example evaluate_pack -- packs/demo/blcj-s1000-v2.ids samples/ifc/blcj-s1000-architecture.ifc samples/ifc/blcj-s1000-structure.ifc samples/ifc/blcj-s1000-mep.ifc
```
(`node scripts/fetch-demo-models.ts` first, if `samples/ifc/blcj-s1000-*.ifc` aren't present locally yet.)

## The Snowdon Towers pack (`snowdon-towers.ids`)

10 information checks against the four IFC4 discipline exports in
`samples/ifc/snowdon-towers-*.ifc`. Vendor-neutral buildingSMART property
sets only. Source, scope, severity, and observed counts are in
[`snowdon-checks.md`](snowdon-checks.md). Electrical and plumbing are two
MEP SourceModels; architectural rules do not score them.

Stage the gitignored IFC files first (`node scripts/stage-snowdon-models.ts`).
Seeding `packs/demo` loads this file as a fourth version of `demo-pack`.

None/all grades of the same building are derived from the staged architecture
and structure files by `scripts/generate-snowdon-variants.py`. Partial is the
real export. Electrical and plumbing stay byte-identical and are reused by
revision. The oracle is [`snowdon-variants.oracle.json`](snowdon-variants.oracle.json).
Variant `.ifc` bytes stay gitignored.

## The synthetic diff/checking fixtures (`fixtures.ids` + `fixtures/`)

A small, self-authored (via `scripts/generate-demo-fixtures.py`) A/B IFC pair
purpose-built to exercise `crates/modeldiff` and the checker's
finding-grouping across every category ticket 05 asks for: 100+ repeated
failures, additions, removals, property/shape/move/rotation changes, and
ambiguous (duplicate/empty) GlobalIds — plus a machine-readable
[`fixtures/oracle.json`](fixtures/oracle.json) of the exact expected result
per object. See [`fixtures/README.md`](fixtures/README.md) for the category
table, verified real results, and two things this fixture found while it was
being built: a real, now-fixed bug in `modeldiff`'s placement-array indexing,
and the later decision that a pure rotation with no translation reports as
`moved` with a basis-change note.
