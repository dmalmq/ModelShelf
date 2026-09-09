# Coordinate frame, units, and identity across the four Snowdon Towers models

Measured on 2026-09-09 by running the real `services/ifc-worker` `inspect`
operation (IfcOpenShell 0.8.5, `settings.geometry = true`) over all four files
and reading the resulting `descriptor.json` and `render-manifest.json`
artifacts. Placements below are the worker's own normalized metre placements,
not raw STEP coordinates.

## Finding: no transform is required, but a large origin offset is

All four files already share one world coordinate frame. Whole-model extents
from every render instance's placement translation, in metres:

| Discipline | X | Y | Z | instances |
| --- | --- | --- | --- | --- |
| Architecture | 417,585.8 .. 417,645.4 | 78,685.4 .. 78,733.4 | 230.9 .. 265.6 | 7,455 |
| Electrical | 417,587.1 .. 417,644.4 | 78,691.3 .. 78,740.2 | 231.5 .. 258.7 | 5,882 |
| Plumbing | 417,589.5 .. 417,646.3 | 78,691.3 .. 78,733.3 | 230.9 .. 260.3 | 19,820 |
| Structure | 417,586.0 .. 417,645.1 | 78,665.9 .. 78,733.6 | 230.9 .. 259.5 | 1,487 |

Combined: X 417,585.8 .. 417,646.3, Y 78,665.9 .. 78,740.2, Z 230.9 .. 265.6.
A 60.5 m by 74.3 m footprint, 34.7 m tall. The four overlap to within the
building's own extents, with no scaling and no rotation between them.

Every file declares `IfcMapConversion` with eastings 0, northings 0,
orthogonal height 0, and scale 1, so the survey position is carried in the
element placements themselves rather than in a georeferencing offset.

**The building centre sits about 425 km from the world origin.** This is the
only sample data in the repository that puts real distance between the origin
and the geometry. At that distance a 32-bit float resolves roughly 5 cm, so a
viewer that uploads world coordinates to the GPU without a shared origin offset
will visibly jitter and z-fight. The plan's requirement to "use one shared
origin offset for precision, never center disciplines independently" is
testable here for the first time; the BLCJ models sit within 20 m of the
origin and cannot exercise it.

Each discipline must receive the *same* offset. Centring each model on its own
bounding box would pull the four apart by up to 75 m.

## Units: imperial throughout

Every file assigns `IFCCONVERSIONBASEDUNIT` `FOOT` (0.3048 m), `SQUARE FOOT`,
and `CUBIC FOOT` over SI bases. The worker reports `lengthToMetre` 0.3048 in
all four descriptors and normalizes measures to SI.

This is the repository's only non-metric sample. It is the natural fixture for
the plan's "mixed model units" verification case, both on its own and mixed
into a delivery beside the metric BLCJ revisions.

## Identity: real cross-model GlobalId collisions

GlobalId intersections between the four files:

| Pair | Shared GlobalIds |
| --- | --- |
| Electrical ∩ Plumbing | 17 |
| Architecture ∩ Electrical | 1 |
| Architecture ∩ Plumbing | 1 |
| Architecture ∩ Structure | 0 |
| Electrical ∩ Structure | 0 |
| Plumbing ∩ Structure | 0 |
| shared by all four | 0 |

The 17 electrical/plumbing collisions are naturally occurring, not authored.
They matter for two rules the plan states: a public viewer reference must stay
revision-qualified rather than collapsing on GlobalId, and a persistent object
match is "only considered exact when the GlobalId is unique on both sides".
Until now that behavior was proven only against synthetic duplicates.

The four models are separate Revit projects, each with its own `IfcProject`
GlobalId, so they federate as four SourceModels rather than four exports of one
project tree.

## Two export quirks worth keeping

**Electrical's site geolocation disagrees with the other three.** Architecture,
plumbing, and structure all record `RefLatitude (40, 1, 20, 538978)` and
`RefLongitude (-79, -53, -11, -994970)`. Electrical records
`(40, 1, 19, 809250)` and `(-79, -53, -13, -64794)` — roughly 22 m north-south
and 25 m east-west away. The element geometry still co-registers exactly, so
this is metadata drift, not a misplacement. It is a good honest-reporting case:
a reviewer should see the discrepancy without the models being pulled apart.

**Architecture's `IfcSite` is named `Parking Symbol - ADA:Parking Symbol -
ADA:791516`.** A Revit export artifact where a family instance became the site
entity. Left as-is; real exports contain this kind of noise and the prototype
should not depend on site naming.

## Worker diagnostics on ingestion

| Discipline | Diagnostics | Kinds |
| --- | --- | --- |
| Architecture | 1,197 | 997 `IfcPhysicalComplexQuantity`, 132 `IfcDoorLiningProperties`, 68 `IfcWindowLiningProperties` |
| Structure | 12 | `IfcPhysicalComplexQuantity` |
| Electrical | 0 | — |
| Plumbing | 0 | — |

All are "skipped unsupported property definitions of type ...". They are real
unsupported-input cases produced by real data rather than by a crafted fixture,
and they are reported rather than silently dropped.

## Ingestion cost on the recording host

Measured wall time for `ifc-worker inspect` with geometry, Linux x64, 32 CPU:
structure 37.5 s, electrical 76.7 s, plumbing 171.7 s, architecture 331.8 s.
About 10 minutes for a full four-model delivery. Plan accordingly when a
scenario ingests this set; reuse unchanged revisions rather than re-ingesting.

## What downstream tickets can assume

- The four revisions are already co-registered. No `ModelDescriptor.transform`
  translation or rotation is needed to overlay them.
- One shared origin offset of roughly (417,616, 78,703, 248) metres, applied
  identically to all four, brings the delivery to the origin.
- `lengthToMetre` is 0.3048 for every model.
- GlobalId is not unique across the delivery. Selection, highlighting, and
  matching must stay revision-qualified.
