# Coordinate alignment across the three BLCJ S1000 discipline models

Inspected directly with `ifcopenshell` (`ifcopenshell.util.placement.get_local_placement`,
the same placement-chain-resolution algorithm `crates/ifc-model`/the checker use)
against the real files in `samples/ifc/blcj-s1000-{architecture,structure,mep}.ifc`.
Full inspection scripts and raw output are in
`.omo/evidence/modelshelf-prototype/task-5/alignment/`.

## Finding: no transform is required

All three files already share one world coordinate frame, in millimetres
(`IfcSIUnit` LENGTHUNIT = MILLIMETRE in all three). Evidence:

**Whole-model bounding boxes** (every `IfcProduct`'s absolute placement translation, mm):

| Discipline | X | Y | Z |
| --- | --- | --- | --- |
| Architecture | -2000 .. 15050 | -1700 .. 20573 | -2060 .. 16760 |
| Structure | -1000 .. 13200 | -1000 .. 19400 | -2060 .. 16500 |
| MEP | -2560 .. 14544 | -5988 .. 18607 | -3500 .. 17000 |

The three overlap almost exactly, with no scaling or rotation, in a footprint
consistent with the S1000 building's stated ~1,000 m² total floor area over
several storeys.

**Storey elevations** (mm, matched across the two files that declare storeys —
MEP does not model storeys as `IfcBuildingStorey`):

| Architecture | Structure |
| --- | --- |
| PIT -2060 | GL -100 |
| 1F 0 | 1FL 0 |
| 2F 4500 | 2FL 4500 |
| 3F 8500 | 3FL 8500 |
| PHF 12500 | RFL 12500 |
| PHR 15950 | PHRFL 15950 |

Every shared level (1F/2F/3F/roof) lands on the identical Z value in both
files — the two firms modeled the same real floor-to-floor heights on the
same vertical datum (Z = 0 at the first floor slab).

**Structural grid vs. architectural columns** (mm, X positions; both resolved
through the real `IfcLocalPlacement` chain, not the raw `IfcSite`):
architecture's columns sit at X = 4200 and X = 13000; structure's columns sit
at X = 0, 4200, and 13000. 4200 and 13000 coincide exactly between the two
independently-produced files.

## A red herring: `IfcSite`'s own offset

The structure file's `IfcSite` (and `IfcBuilding`) report an absolute
placement of `(-1000, -1000, 0)` mm via `get_local_placement`, and its
`IfcGeometricRepresentationContext.WorldCoordinateSystem` origin is also
`(-1000, -1000, 0)` — a plausible "shared site"/"project base point" artifact
of the Revit → IFC export. It does **not** propagate to the building's actual
elements: columns and every other `IfcProduct` resolve to the same coordinates
as the architecture and MEP files regardless of it (see the bounding-box and
grid comparisons above, which walk each element's own placement chain, not
the site's). A naive implementation that aligned models by translating on
`IfcSite`'s reported placement alone would have introduced a spurious 1 m
offset; this was caught precisely by checking real element placements instead
of trusting the site entity.

## `TrueNorth`, noted but not applied

Architecture's model context declares `TrueNorth ≈ (-0.491, 0.871)`
(≈ 60.6° from the project Y axis); structure declares `TrueNorth ≈ (0, 1)`
(0°) and MEP the same. Since the three files' raw coordinates already
coincide (above), this is informational metadata about compass orientation
for that one file, not a transform between the disciplines — applying it
would rotate architecture away from the other two, not into alignment with
them. No rotation is applied anywhere in this demo.

## What downstream tickets can assume

The three revisions can be treated as already co-registered in one shared
(x, y, z) frame in millimetres. No `ModelDescriptor.transform` translation or
rotation is needed to overlay them; `length_to_metre` (1/1000) is the only
per-model factor that matters.
