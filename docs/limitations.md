# ModelShelf prototype: limitations and support profile

This document is the prototype's support profile. It records what the local demo
is and is not, and where a capability is unproven it names the ticket that owns
proving it. Facts here trace to [the GitHub ticket set](agents/issue-tracker.md),
the contract documents (`docs/contracts/`), and the sample documentation
(`samples/`).

## Supported IFC inputs

- The supported input class is IFC as exported by IFC-capable BIM authoring
  tools; the boundary names Revit and Archicad explicitly (ticket 16,
  implementation boundaries).
- Native Revit (RVT) and Archicad (PLN) project files remain deferred. The
  approved architecture adds no native-format adapters
  (`docs/adr/0001-reusable-model-modules.md`; plan scope).
- The demo samples exercise both IFC2X3 and IFC4:
  - The BLCJ S1000 set is three IFC2X3 files (architecture by GLOOBE, structure
    by Revit/SS7, MEP by Rebro). The combined-viewer evidence records
    `schemaLabel: "IFC2X3"` for all three;
    `samples/blcj-s1000/alignment.md` confirms all three are IFC2X3 and metric.
  - The Snowdon Towers set is four IFC4 files exported from Revit 2026 with the
    `ReferenceView_V1.2` MVD; `samples/snowdon-towers/manifest.json` records
    `schema: "IFC4"` for each.
- Authoring-tool coverage is not exhaustive. BLCJ publishes further tool
  variants per discipline (including Archicad and Vectorworks) that the demo
  does not acquire (ticket 05, limits).
- The BLCJ check pack declares `ifcVersion=IFC2X3`. On an IFC4 file IfcTester
  skips those specifications as incomplete, so the BLCJ pack is not a useful
  scorer for IFC4 samples (ticket 06, limits).

## IDS support

- IDS support is scoped to what IfcTester 0.8.5 evaluates. The worker pins
  `ifctester==0.8.5`, `ifcopenshell==0.8.5`, `pydantic==2.13.5`, and
  `typer==0.27.2` in `services/ifc-worker/pyproject.toml` and `uv.lock`.
  pydantic is also `==2.13.5` in `packages/model-contracts-py`. Bump by editing
  those `==` lines, then `uv lock` both projects.
- Unsupported evaluation produces `incomplete` outcomes, never a pass
  (`docs/contracts/worker-v2.md`). Invalid IDS XML or schema fails the job.
- `crates/ids` is a reference/test engine and is never used for live scoring;
  IfcTester is the only scorer (map notes 2026-09-07; plan-alignment review
  2026-09-09; README). Its conformance baseline is 288/307 with 19 known gaps
  (ticket 01).
- No universal IDS support is implied. A requirement that IfcTester 0.8.5
  cannot evaluate is incomplete, not silently passed, and no document claims
  support beyond that engine (ticket 16, acceptance criteria).

## Regulatory approval

- Nothing here implies regulatory approval. The demo pack is a prototype
  information check, not an approved national architectural validation pack
  (`references/bim-checking/README.md`; plan TL;DR; map "Out of scope").
- No clash detection or fire-code geometry checking is performed (plan
  guardrails; map "Out of scope").

## Geometry extraction

- Unsupported representations stay `unsupported`. The worker reports geometry
  per object as `available`, `absent`, or `unsupported` and never collapses
  them (`docs/contracts/worker-v2.md`).
- The synthetic fixture walls are `IfcBlock` CSG primitives that the browser
  IFC engine cannot tessellate, so fixture members are listed as without
  geometry in the browser (tickets 11 and 15, limits). Drawable geometry is
  proven by hand-authored extruded walls and the real samples.
- Shape is a representation hash, not geometric equivalence. A different
  tessellation or exporter can change the shape fingerprint, and the change
  reads as "Shape representation changed", not proof of physical geometry
  change (plan fingerprint policy; tickets 12, 13, and 15).

## Fingerprints (`fp-v1`)

- Every object is fingerprinted at ingestion under the `fp-v1` profile: full
  BLAKE3 digests for properties, placement, and shape separately
  (tickets 12 and 13; `docs/contracts/http-api.md` rule 11).
- Comparison uses seven `ChangeKind` values and has no `Rotated` kind. An
  in-place rotation reports as `moved` with distance 0 m and a placement-basis
  note. A sub-threshold origin shift stays `unchanged` only when the basis is
  identical. Ticket 34 / PR 71 shipped that contract.
  `node scripts/verify-api.ts --scenario comparisons` asserts it.
- Mixed units are normalized for length, area, and volume measures only
  (ticket 12; plan). Unsupported units keep the raw value with a null
  `siValue`/`dimension` (`docs/contracts/worker-v2.md`). The Snowdon set
  exercises `FOOT` units (`samples/snowdon-towers/README.md`).
- Quantization (lengths to 0.1 mm, directions to 1e-6) is not a guarantee that
  any two values within tolerance share a hash (plan fingerprint policy).

## Viewer

- The exact camera matrix is not restored when switching sides in the
  comparison screen; coherence is delivered by re-framing the selected change
  on the new side (ticket 15, limits).
- Japanese (CJK) glyph rendering depends on host fonts. This host has no CJK
  font, so screenshots show tofu; the Japanese copy is asserted in the DOM
  instead (tickets 07, 11, and 15).
- Wave 1 inspection on a GPU-less SwiftShader host missed median orbit (2.5
  FPS against 30) and could not trust longtask telemetry. The 2026-09-15
  hardware-GL rerun on NVIDIA RTX 4500 Ada (D3D11) passed every gate: cold
  3661 ms, median orbit 60.1 FPS, p95 selection 2.3 ms, filter 11 ms, UI
  longtask 0.0 ms max. Thresholds were not lowered. The SwiftShader misses
  stay documented as host-side. See `docs/reviews/wave-1-report.md`.

## Worker protocol

- The live worker job envelope is protocol 2. Canonical JSON Schema lives in
  `schemas/worker/v2/` and the human contract is `docs/contracts/worker-v2.md`.
  Drift is checked by `node scripts/verify-worker-envelope.ts --check`.
  Unpublished v1 combined `objects.jsonl` never shipped; there is no
  published combined v1 envelope schema file. The model payload schemas under
  `schemas/model/v1/` are not affected.

## Sample redistribution

- The BLCJ S1000 files are public downloads from the official BLCJ sample-model
  page, fetched by `scripts/fetch-demo-models.ts` with pinned SHA-256 hashes.
  BLCJ prohibits unauthorized redistribution, so the archives and extracted
  IFC files are gitignored and never committed (`samples/blcj-s1000/README.md`).
- The Snowdon Towers files come only from an operator-owned copy via
  `scripts/stage-snowdon-models.ts --from <dir>`. There is no confirmed public
  URL and no redistribution grant, so no download step exists and the files are
  gitignored (`samples/snowdon-towers/README.md`).

## Scope boundaries

- The prototype performs no Revit write-back and no arbitrary spreadsheet
  conversion (plan guardrails; map "Out of scope").
- There is no production authentication or billing (plan scope; map "Out of
  scope").
- The viewer package extraction is delivered in `packages/model-viewer` with a
  framework-independent core, a thin React wrapper, and a standalone example.
  `node scripts/verify-viewer.ts --scenario standalone` proves the example
  with ModelShelf services stopped; the package remains a prototype seam, not a
  plugin framework.