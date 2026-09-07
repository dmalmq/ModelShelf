#!/usr/bin/env python3
"""Self-authored (not downloaded) synthetic IFC fixture pair for exercising the
modeldiff/fingerprint comparison engine and the checker's finding-grouping
end to end, against real parsed IFC files rather than in-memory Rust structs.

Produces packs/demo/fixtures/base.ifc and packs/demo/fixtures/head.ifc (an A/B
delivery pair) plus packs/demo/fixtures/oracle.json, a machine-readable list of
every object's expected diff classification and every IDS finding's expected
pass/fail/delta — independently checkable by any consumer, not just this
script's own run of it.

Categories covered (ticket 05's acceptance criteria):
  - 120 "repeated failure" walls, identical and unchanged between base/head,
    each missing the required fire rating property. Exercises the checker's
    finding-grouping (one finding, 120 affected objects) and, across the
    base->head revision, a *persisting* finding (docs/contracts/http-api.md's
    diff.rs FindingDelta).
  - additions: objects present only in head. Given a distinct, otherwise-unused
    shape (see below), so they cannot heuristically match anything on the
    other side.
  - removals: objects present only in base. Same shape-uniqueness requirement.
  - property changes: same GlobalId, a property value differs.
  - shape changes: same GlobalId/placement, the extruded block's dimensions differ.
  - moved: same GlobalId/shape, translated 500 mm (above modeldiff's 1 mm threshold).
  - rotated: same GlobalId/shape, rotated 30 degrees about its own origin with
    *no* translation. Included specifically to demonstrate a real, verified
    modeldiff characteristic — not a bug, a design limitation: `classify_pair`
    measures displacement only as origin-to-origin distance
    (`heuristic::origin_distance`), so a pure rotation about the origin (zero
    origin displacement) is reported `unchanged` with a sub-threshold-
    displacement note, even though its placement fingerprint did change.
    (Building this fixture also found and fixed a real, separate bug in that
    same distance function — see packs/demo/fixtures/README.md — this
    remaining rotation behavior is what's left once that bug is fixed.)
  - ambiguous IDs: two objects in the same file sharing one GlobalId (forces
    heuristic, non-GlobalId matching), and one object whose GlobalId is empty.

Every category except "repeated failure" uses block dimensions unique across
the entire fixture (no two categories, and no two objects within a category,
share a shape) so heuristic matching (crates/modeldiff/src/heuristic.rs,
weighted 40% shape + 30% placement + 20% properties + 10% name) cannot
accidentally pair two semantically-unrelated objects just because they happen
to look alike — a real failure mode this generator hit and fixed during
authoring (see packs/demo/fixtures/README.md).

Usage: uv run --project services/ifc-worker python ../../scripts/generate-demo-fixtures.py
   (run from the repo root; uses the ifc-worker venv only for its ifcopenshell
   install — this script does not import ifc_worker or model_contracts, so it
   is unaffected by the worker's own protocol version.)
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path

import ifcopenshell
import ifcopenshell.api.aggregate
import ifcopenshell.api.context
import ifcopenshell.api.geometry
import ifcopenshell.api.pset
import ifcopenshell.api.project
import ifcopenshell.api.root
import ifcopenshell.api.spatial
import ifcopenshell.api.unit
from ifcopenshell.util.shape_builder import ShapeBuilder

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = REPO_ROOT / "packs" / "demo" / "fixtures"

REPEATED_FAILURE_COUNT = 120


def new_guid() -> str:
    return ifcopenshell.guid.compress(uuid.uuid4().hex)


def make_project() -> tuple[ifcopenshell.file, object, object]:
    f = ifcopenshell.file(schema="IFC4")
    project = ifcopenshell.api.root.create_entity(f, ifc_class="IfcProject", name="Demo Fixtures")
    ifcopenshell.api.unit.assign_unit(f, length={"is_metric": True, "raw": "METERS"})
    context = ifcopenshell.api.context.add_context(f, context_type="Model")
    body = ifcopenshell.api.context.add_context(
        f, context_type="Model", context_identifier="Body", target_view="MODEL_VIEW", parent=context
    )
    site = ifcopenshell.api.root.create_entity(f, ifc_class="IfcSite", name="Demo Site")
    building = ifcopenshell.api.root.create_entity(f, ifc_class="IfcBuilding", name="Demo Building")
    storey = ifcopenshell.api.root.create_entity(f, ifc_class="IfcBuildingStorey", name="1F")
    ifcopenshell.api.aggregate.assign_object(f, relating_object=project, products=[site])
    ifcopenshell.api.aggregate.assign_object(f, relating_object=site, products=[building])
    ifcopenshell.api.aggregate.assign_object(f, relating_object=building, products=[storey])
    return f, body, storey


def add_wall(
    f: ifcopenshell.file,
    body_context,
    storey,
    *,
    global_id: str | None,
    name: str,
    position: tuple[float, float, float],
    size: tuple[float, float, float],
    rotation_degrees: float = 0.0,
    fire_rating: str | None = None,
) -> object:
    builder = ShapeBuilder(f)
    wall = ifcopenshell.api.root.create_entity(f, ifc_class="IfcWall", name=name)
    if global_id is not None:
        wall.GlobalId = global_id
    ifcopenshell.api.spatial.assign_container(f, relating_structure=storey, products=[wall])

    block = builder.block(position=(0.0, 0.0, 0.0), x_length=size[0], y_length=size[1], z_length=size[2])
    rep = builder.get_representation(body_context, block)
    ifcopenshell.api.geometry.assign_representation(f, product=wall, representation=rep)
    ifcopenshell.api.geometry.edit_object_placement(f, product=wall, matrix=_placement_matrix(position, rotation_degrees))

    if fire_rating is not None:
        pset = ifcopenshell.api.pset.add_pset(f, product=wall, name="Pset_WallCommon")
        ifcopenshell.api.pset.edit_pset(f, pset=pset, properties={"FireRating": fire_rating})
    return wall


def _placement_matrix(position: tuple[float, float, float], rotation_degrees: float):
    import numpy as np

    theta = np.radians(rotation_degrees)
    rot = np.array(
        [
            [np.cos(theta), -np.sin(theta), 0.0, 0.0],
            [np.sin(theta), np.cos(theta), 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ]
    )
    rot[:3, 3] = position
    return rot


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    oracle: dict[str, object] = {
        "objects": {},
        "notes": [
            "Building this fixture found and fixed a real bug in "
            "crates/modeldiff/src/heuristic.rs::origin() (see packs/demo/fixtures/README.md): "
            "it read placement array indices [3,7,11] as if the layout were an "
            "interleaved row-major 3x4 with a translation column per row, but "
            "ifc_model::Transform::to_array12()'s actual, documented layout is "
            "three axis vectors then the origin (indices [9,10,11]). This caused "
            "real translations to sometimes go undetected and pure rotations to "
            "be misreported as moves. Fixed as a prerequisite; crates/modeldiff/tests/diff.rs's "
            "placement_at() helper was updated to match the corrected layout, and "
            "all 14 pre-existing modeldiff tests still pass.",
            "Additions/removals must use a shape (block dimensions) unused anywhere "
            "else in the fixture, or modeldiff's heuristic matcher (40% shape + 30% "
            "placement + 20% properties + 10% name) can score a coincidental match "
            "high enough to pair two semantically-unrelated objects as 'the same "
            "object, unchanged' instead of reporting a clean add + remove. This "
            "generator hit that exact failure during authoring and fixed it by "
            "giving Removed-* and Added-* distinct, otherwise-unused dimensions.",
        ],
    }

    base, base_body, base_storey = make_project()
    head, head_body, head_storey = make_project()

    # --- 120 repeated failures: identical, unchanged, each missing FireRating ---
    repeat_ids = []
    for i in range(REPEATED_FAILURE_COUNT):
        gid = new_guid()
        repeat_ids.append(gid)
        for f, body, storey in ((base, base_body, base_storey), (head, head_body, head_storey)):
            add_wall(
                f, body, storey,
                global_id=gid, name=f"Repeat-{i:03d}",
                position=(float(i) * 1.0, 0.0, 0.0), size=(0.2, 4.0, 3.0),
            )
    oracle["objects"]["repeated_failure"] = {
        "count": REPEATED_FAILURE_COUNT,
        "globalIds": repeat_ids,
        "diffKind": "unchanged",
        "idsCheck": "Wall declares a fire rating",
        "idsOutcome": "fail (FireRating not set)",
        "findingDelta": "persisting",
        "note": "Same 120 objects, same missing property, in both revisions -> one grouped, persisting finding with 120 affected objects, not 120 separate findings.",
    }

    # --- removed: base only ---
    removed_ids = [new_guid() for _ in range(3)]
    for i, gid in enumerate(removed_ids):
        add_wall(base, base_body, base_storey, global_id=gid, name=f"Removed-{i}", position=(200.0 + i, 0.0, 0.0), size=(0.15, 1.1, 2.2))
    oracle["objects"]["removed"] = {"globalIds": removed_ids, "diffKind": "removed"}

    # --- added: head only ---
    added_ids = [new_guid() for _ in range(3)]
    for i, gid in enumerate(added_ids):
        add_wall(head, head_body, head_storey, global_id=gid, name=f"Added-{i}", position=(210.0 + i, 0.0, 0.0), size=(0.45, 3.3, 4.4))
    oracle["objects"]["added"] = {"globalIds": added_ids, "diffKind": "added"}

    # --- property changed: same GlobalId, FireRating differs ---
    prop_ids = [new_guid() for _ in range(3)]
    for i, gid in enumerate(prop_ids):
        add_wall(base, base_body, base_storey, global_id=gid, name=f"PropChange-{i}", position=(220.0 + i, 0.0, 0.0), size=(0.2, 2.0, 3.0), fire_rating="REI30")
        add_wall(head, head_body, head_storey, global_id=gid, name=f"PropChange-{i}", position=(220.0 + i, 0.0, 0.0), size=(0.2, 2.0, 3.0), fire_rating="REI60")
    oracle["objects"]["property_changed"] = {"globalIds": prop_ids, "diffKind": "properties_changed", "detail": "Pset_WallCommon.FireRating REI30 -> REI60"}

    # --- shape changed: same GlobalId/placement, block dimensions differ ---
    shape_ids = [new_guid() for _ in range(3)]
    for i, gid in enumerate(shape_ids):
        add_wall(base, base_body, base_storey, global_id=gid, name=f"ShapeChange-{i}", position=(230.0 + i, 0.0, 0.0), size=(0.2, 2.0, 3.0))
        add_wall(head, head_body, head_storey, global_id=gid, name=f"ShapeChange-{i}", position=(230.0 + i, 0.0, 0.0), size=(0.4, 2.0, 3.0))
    oracle["objects"]["shape_changed"] = {"globalIds": shape_ids, "diffKind": "shape_changed", "detail": "wall thickness 0.2m -> 0.4m, placement unchanged"}

    # --- moved: translated 0.5 m (>> 1mm threshold) ---
    moved_ids = [new_guid() for _ in range(3)]
    for i, gid in enumerate(moved_ids):
        add_wall(base, base_body, base_storey, global_id=gid, name=f"Moved-{i}", position=(240.0 + i, 0.0, 0.0), size=(0.2, 2.0, 3.0))
        add_wall(head, head_body, head_storey, global_id=gid, name=f"Moved-{i}", position=(240.0 + i, 0.5, 0.0), size=(0.2, 2.0, 3.0))
    oracle["objects"]["moved"] = {"globalIds": moved_ids, "diffKind": "moved", "detail": "translated +0.5m in Y (500mm >> 1mm move_threshold_m)"}

    # --- rotated: 30 degrees about its own origin, zero translation ---
    rotated_ids = [new_guid() for _ in range(3)]
    for i, gid in enumerate(rotated_ids):
        add_wall(base, base_body, base_storey, global_id=gid, name=f"Rotated-{i}", position=(250.0 + i, 0.0, 0.0), size=(0.2, 2.0, 3.0), rotation_degrees=0.0)
        add_wall(head, head_body, head_storey, global_id=gid, name=f"Rotated-{i}", position=(250.0 + i, 0.0, 0.0), size=(0.2, 2.0, 3.0), rotation_degrees=30.0)
    oracle["objects"]["rotated"] = {
        "globalIds": rotated_ids,
        "diffKind": "unchanged",
        "note": (
            "DISCOVERED BEHAVIOR (see packs/demo/fixtures/README.md): a pure "
            "rotation about the object's own origin has zero origin-to-origin "
            "displacement, so modeldiff::classify_pair (crates/modeldiff/src/lib.rs) "
            "treats it as a sub-threshold move and reports 'unchanged' with a "
            "sub-threshold-displacement note, even though the placement "
            "fingerprint did change. Not a bug introduced by this ticket; "
            "recorded as a real, verified characteristic of the current engine."
        ),
    }

    # --- ambiguous IDs: duplicate GlobalId within one file; one empty GlobalId ---
    dup_gid = new_guid()
    add_wall(base, base_body, base_storey, global_id=dup_gid, name="Duplicate-A", position=(260.0, 0.0, 0.0), size=(0.2, 2.0, 3.0))
    add_wall(base, base_body, base_storey, global_id=dup_gid, name="Duplicate-B", position=(261.0, 0.0, 0.0), size=(0.2, 2.0, 3.0))
    add_wall(head, head_body, head_storey, global_id=dup_gid, name="Duplicate-A", position=(260.0, 0.0, 0.0), size=(0.2, 2.0, 3.0))
    add_wall(head, head_body, head_storey, global_id=dup_gid, name="Duplicate-B", position=(261.0, 0.0, 0.0), size=(0.2, 2.0, 3.0))

    empty_gid_name = "EmptyGlobalId"
    for f, body, storey in ((base, base_body, base_storey), (head, head_body, head_storey)):
        wall = add_wall(f, body, storey, global_id=None, name=empty_gid_name, position=(270.0, 0.0, 0.0), size=(0.2, 2.0, 3.0))
        wall.GlobalId = ""

    oracle["objects"]["ambiguous_ids"] = {
        "duplicateGlobalId": dup_gid,
        "duplicateNames": ["Duplicate-A", "Duplicate-B"],
        "diffKind": "unchanged (paired by express id, not GlobalId, per modeldiff::duplicate_global_ids_pair_by_express_id)",
        "emptyGlobalIdName": empty_gid_name,
        "emptyGlobalIdDiffKind": "unchanged (paired by heuristic matching, per modeldiff::heuristic_matches_object_without_global_id)",
    }

    base_path = OUT_DIR / "base.ifc"
    head_path = OUT_DIR / "head.ifc"
    base.write(str(base_path))
    head.write(str(head_path))

    total_objects = REPEATED_FAILURE_COUNT + 3 * 6 + 2 + 2
    oracle["fixtureSummary"] = {
        "basePath": "base.ifc",
        "headPath": "head.ifc",
        "totalDistinctTrackedObjects": total_objects,
        "generatedBy": "scripts/generate-demo-fixtures.py",
    }
    (OUT_DIR / "oracle.json").write_text(json.dumps(oracle, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {base_path}, {head_path}, and oracle.json ({total_objects} tracked objects)")


if __name__ == "__main__":
    main()
