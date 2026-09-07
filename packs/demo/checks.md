# BLCJ S1000 demo pack: check traceability

Every check below was authored by first inspecting the *actual* IFC properties
in `samples/ifc/blcj-s1000-{architecture,structure,mep}.ifc` (real BLCJ S1000
exports — see `samples/blcj-s1000/README.md`), then cross-referencing that
real data against `references/bim-checking/`'s three initial sources. No
check assumes a native-software parameter name equals its IFC property name;
every property name below was confirmed present (or confirmed absent, for the
one deliberately-failing check) by direct inspection, not by reading the
mapping tables alone. Real evaluation results are from
`cargo run -p ids --example evaluate_pack -- packs/demo/blcj-s1000-v1.ids samples/ifc/blcj-s1000-*.ifc`
(`.omo/evidence/modelshelf-prototype/task-5/evaluate-v1-real-models.txt`).

| # | Check | Discipline / entity | Real IFC property | Source | Scope | Priority | Category | Why | Real result |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Room has a reference code | Architecture / `IfcSpace` | `Pset_SpaceCommon.Reference` | 03-blcj-mapping GLOOBE mapping table, row 部屋/名前/ゾーン名/名称 | Any `IfcSpace` | High | Identification | A room reference/zone code is the join key every downstream room-based check and drawing legend depends on. | Architecture: 30/60 pass, 30 fail — real gap, ~half the spaces have a blank reference. |
| 2 | Room records a net floor area | Architecture / `IfcSpace` | `BaseQuantities.NetFloorArea` | 03-blcj-mapping row 面積/測定面積/面積, checked against 容積率の対象内外 | Any `IfcSpace` | High | Regulatory (floor area) | Floor area underlies floor-area-ratio (容積率) and building-coverage calculations under the Building Standards Act. | Architecture: 60/60 pass. |
| 3 | Room records a ceiling height | Architecture / `IfcSpace` | `BaseQuantities.NominalHeight` | 03-blcj-mapping's 各部分の高さ (height of each part) column | Any `IfcSpace` | Medium | Regulatory (room height) | Room height is a standard plan-review item. | Architecture: 60/60 pass. |
| 4 | Door or window has a schedule reference | Architecture / `IfcDoor`, `IfcWindow` | `Pset_DoorCommon.Reference` / `Pset_WindowCommon.Reference` | 03-blcj-mapping row ドア窓/建具形式/開閉形式, cross-referenced to a drawing legend | Any `IfcDoor`/`IfcWindow` | Medium | Traceability | The reference code is how a reviewer cross-references this occurrence to the door/window schedule and its legend entry (which is where fire performance etc. actually appears — see check 5). | Architecture: 74/78 pass, 4 fail (4 panel windows with no reference). |
| 5 | Door or window declares a fire rating | Architecture / `IfcDoor`, `IfcWindow` | `Pset_DoorCommon.FireRating` / `Pset_WindowCommon.FireRating` | 03-blcj-mapping row ドア窓/防火性能/防火性能, tied to the 防火区画等 (fire compartition) column | Any `IfcDoor`/`IfcWindow` | High | Regulatory (fire compartition) | Fire performance of openings in a fire-rated wall is a Building Standards Act requirement (令112/114 per the mapping table's own legend). | Architecture: 0/78 pass. **Genuine, fully-confirmed gap**: no door or window in this real GLOOBE export carries a fire-rating property anywhere (occurrence or type level) — confirmed by dumping every property on every one of the 78 instances, not just a sample. Fire performance is conveyed only via the drawing legend GLOOBE's own "防火性能" native parameter references (check 4's schedule code), which this export does not carry into IFC as structured data. Kept in v1 and v2 unchanged, deliberately, as an honest demonstration of a real gap this checker surfaces rather than silently passing. |
| 6 | Structural column is load-bearing | Structure / `IfcColumn` | `Pset_ColumnCommon.LoadBearing = true` | 02-mlit-attributes structure explanation; standard structural member property | Any `IfcColumn` | High | Structural | A column not marked load-bearing is either miscategorized or a non-structural element wrongly typed `IfcColumn`. | Structure: 71/71 pass. Architecture: 81/93 pass, 12 fail (architecture's own `IfcColumn` instances — likely drawn for coordination, not authored with the same structural rigor as the structure model). |
| 7 | Structural column has a member mark | Structure / `IfcColumn` | `Pset_ColumnCommon.Reference` | 03-blcj-mapping structural terminology table; standard structural drawing practice | Any `IfcColumn` | Medium | Traceability | The member mark (e.g. "1C2") is how a structural drawing and its calculation report refer to this exact column. | Structure: 71/71 pass. Architecture: 81/93 pass, 12 fail (same 12 as check 6). |
| 8 | Structural beam records its span | Structure / `IfcBeam` | `Pset_BeamCommon.Span` | 02-mlit-attributes structure explanation | Any `IfcBeam` | Medium | Structural | Span is basic structural-adequacy information every beam schedule carries. | Structure: 158/158 pass. Architecture: 205/205 pass. |
| 9 | Structural slab is load-bearing | Structure / `IfcSlab` | `Pset_SlabCommon.LoadBearing = true` | 02-mlit-attributes structure explanation | Any `IfcSlab` | High | Structural | Same rationale as check 6, for slabs. | Structure: 76/76 pass. Architecture: 17/27 pass, 10 fail. |
| 10 | MEP flow segment records its usage | MEP / `IfcFlowSegment` | `Rebro_PartsData.用途` | 02-mlit-attributes MEP explanation; BE-Bridge (Japan's national MEP BIM exchange scheme, promoted by MLIT's 官庁営繕部) property naming | Any `IfcFlowSegment` (pipe, duct, cable tray, or conduit) | Medium | Classification | Usage (potable water / gas / drainage / supply-exhaust air / cabling) is the basic classification every downstream MEP check needs. | MEP: 1337/1337 pass — populated consistently across every flow-segment family (pipes, ducts, cable trays, conduits alike). |
| 11 | MEP flow segment records its outer diameter | MEP / `IfcFlowSegment` | `Rebro_PartsData.外径[mm]` | Same BE-Bridge/Rebro property family as check 10 | v1: any `IfcFlowSegment`. v2: excludes `Description = 電気.ケーブルラック` (cable tray) | Advisory | Data completeness | Outer diameter is needed for clash/clearance checks against structure and other MEP runs. | v1: 1187/1337 pass, 150 fail. Those 150 are 62 ducts, 45 pipes, and 43 cable trays, not cable trays alone. v2 excludes only the 43 cable trays (`applicable` 1294, 107 fail). |

`NotApplicable` outcomes (a discipline-specific check run against a model from
a different discipline, e.g. checks 1–5 against the structure file) are
omitted from the "real result" column above for brevity; every specification
carries `minOccurs="0"` precisely so that is the correct, non-failing outcome
rather than a spurious universal fail — see the full evidence file for every
`NotApplicable` line.

## The one explained rule change (v1 → v2)

Check 11 above. v1 required `Rebro_PartsData.外径[mm]` on every
`IfcFlowSegment` unconditionally and failed on 150 of 1337 real instances.

2026-09-07 correction: an earlier writeup said all 150 v1 failures were cable
trays and that v2 excluded those 150. Independent IfcTester evaluation and IFC
inspection find 62 ducts, 45 pipes, and 43 cable trays. v2 excludes only
`Description = 電気.ケーブルラック` (43 trays). Applicable count drops from
1337 to 1294. The remaining 107 failures are ducts and pipes that still lack a
single outer-diameter value.

v2 keeps the combined `<entity>` + `<attribute>` applicability. Confirmed in
`.omo/evidence/modelshelf-prototype/task-5/evaluate-v2-real-models.txt`.

## Data quality caveats, discovered by inspection

- `object_props`/property `dataType`s were determined empirically, not
  assumed: `NominalHeight` is `IFCLENGTHMEASURE` in this export, not
  `IFCPOSITIVELENGTHMEASURE`; Rebro's custom properties (`用途`, `外径[mm]`)
  are `IFCTEXT`, not `IFCLABEL`. Both were found by running the naive
  first-guess dataType against the real file and reading the actual mismatch
  IDS reported, then correcting it — not by reading buildingSMART's own
  property definitions and assuming they apply.
- Checks 6/7/9 apply to architecture's own `IfcColumn`/`IfcSlab` instances
  too (GLOOBE's export includes some, evidently for coordination), which is
  why the architecture file shows partial pass/fail on structural checks
  despite not being the structure discipline's authoritative file.
