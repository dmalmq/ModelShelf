#!/usr/bin/env python3
"""Self-authored synthetic IFC A/B pair plus a machine-readable oracle.

The oracle records intended physical/check outcomes separately from known
engine limitations. Fixture keys are wall names, stable across regenerations.
GUIDs and IFC header timestamps are derived from a seed so two isolated runs
produce equivalent files.

Usage (from the repo root):

    uv run --project services/ifc-worker python scripts/generate-demo-fixtures.py
    uv run --project services/ifc-worker python scripts/generate-demo-fixtures.py --output-dir /tmp/fixtures
"""

from __future__ import annotations

import argparse
import json
import uuid
from pathlib import Path

import ifcopenshell
import ifctester
import ifcopenshell.api.aggregate
import ifcopenshell.api.context
import ifcopenshell.api.geometry
import ifcopenshell.api.pset
import ifcopenshell.api.root
import ifcopenshell.api.spatial
import ifcopenshell.api.unit
from ifcopenshell.util.shape_builder import ShapeBuilder

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT_DIR = REPO_ROOT / "packs" / "demo" / "fixtures"
IDS_PATH = REPO_ROOT / "packs" / "demo" / "fixtures.ids"
DEFAULT_SEED = "modelshelf-demo-fixtures-v1"
FIXED_TIMESTAMP = "2024-01-01T00:00:00"
FIXED_CREATED = 1_704_067_200
REPEATED_FAILURE_COUNT = 120
IDS_CHECK = "Wall declares a fire rating"


def stable_guid(seed: str, key: str) -> str:
    return ifcopenshell.guid.compress(uuid.uuid5(uuid.NAMESPACE_URL, f"{seed}:{key}").hex)


def make_project(seed: str) -> tuple[ifcopenshell.file, object, object]:
    f = ifcopenshell.file(schema="IFC4")
    project = ifcopenshell.api.root.create_entity(f, ifc_class="IfcProject", name="Demo Fixtures")
    project.GlobalId = stable_guid(seed, "project")
    ifcopenshell.api.unit.assign_unit(f, length={"is_metric": True, "raw": "METERS"})
    context = ifcopenshell.api.context.add_context(f, context_type="Model")
    body = ifcopenshell.api.context.add_context(
        f, context_type="Model", context_identifier="Body", target_view="MODEL_VIEW", parent=context
    )
    site = ifcopenshell.api.root.create_entity(f, ifc_class="IfcSite", name="Demo Site")
    site.GlobalId = stable_guid(seed, "site")
    building = ifcopenshell.api.root.create_entity(f, ifc_class="IfcBuilding", name="Demo Building")
    building.GlobalId = stable_guid(seed, "building")
    storey = ifcopenshell.api.root.create_entity(f, ifc_class="IfcBuildingStorey", name="1F")
    storey.GlobalId = stable_guid(seed, "storey")
    ifcopenshell.api.aggregate.assign_object(f, relating_object=project, products=[site])
    ifcopenshell.api.aggregate.assign_object(f, relating_object=site, products=[building])
    ifcopenshell.api.aggregate.assign_object(f, relating_object=building, products=[storey])
    freeze_file(f)
    return f, body, storey


def freeze_file(f: ifcopenshell.file) -> None:
    for history in f.by_type("IfcOwnerHistory"):
        history.CreationDate = FIXED_CREATED
        if history.LastModifiedDate is not None:
            history.LastModifiedDate = FIXED_CREATED
    f.header.file_name.time_stamp = FIXED_TIMESTAMP
    f.header.file_name.author = ("ModelShelf",)
    f.header.file_name.organization = ("ModelShelf",)
    f.header.file_name.preprocessor_version = "ifcopenshell"
    f.header.file_name.originating_system = "ModelShelf demo fixtures"
    f.header.file_name.authorization = "ModelShelf"


def add_wall(
    f: ifcopenshell.file,
    body_context: object,
    storey: object,
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
    ifcopenshell.api.geometry.edit_object_placement(
        f, product=wall, matrix=_placement_matrix(position, rotation_degrees)
    )
    if fire_rating is not None:
        pset = ifcopenshell.api.pset.add_pset(f, product=wall, name="Pset_WallCommon")
        ifcopenshell.api.pset.edit_pset(f, pset=pset, properties={"FireRating": fire_rating})
    freeze_file(f)
    return wall


def _placement_matrix(position: tuple[float, float, float], rotation_degrees: float):
    import numpy as np

    theta = np.radians(rotation_degrees)
    rot = np.array(
        [
            [round(float(np.cos(theta)), 12), round(float(-np.sin(theta)), 12), 0.0, 0.0],
            [round(float(np.sin(theta)), 12), round(float(np.cos(theta)), 12), 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ]
    )
    rot[:3, 3] = position
    return rot


def ids_fail(keys: list[str]) -> dict[str, object]:
    return {"outcome": "fail", "reason": "FireRating not set", "keys": keys}


def ids_pass(keys: list[str]) -> dict[str, object]:
    return {"outcome": "pass", "keys": keys}


def ids_absent() -> dict[str, object]:
    return {"outcome": "absent", "keys": []}


def build(output_dir: Path, seed: str) -> dict[str, object]:
    output_dir.mkdir(parents=True, exist_ok=True)
    base, base_body, base_storey = make_project(f"{seed}:base")
    head, head_body, head_storey = make_project(f"{seed}:head")

    repeat_keys = [f"Repeat-{i:03d}" for i in range(REPEATED_FAILURE_COUNT)]
    for i, key in enumerate(repeat_keys):
        gid = stable_guid(seed, key)
        for file, body, storey in ((base, base_body, base_storey), (head, head_body, head_storey)):
            add_wall(
                file,
                body,
                storey,
                global_id=gid,
                name=key,
                position=(float(i) * 1.0, 0.0, 0.0),
                size=(0.2, 4.0, 3.0),
            )

    removed_keys = [f"Removed-{i}" for i in range(3)]
    for i, key in enumerate(removed_keys):
        add_wall(
            base,
            base_body,
            base_storey,
            global_id=stable_guid(seed, key),
            name=key,
            position=(200.0 + i, 0.0, 0.0),
            size=(0.15, 1.1, 2.2),
        )

    added_keys = [f"Added-{i}" for i in range(3)]
    for i, key in enumerate(added_keys):
        add_wall(
            head,
            head_body,
            head_storey,
            global_id=stable_guid(seed, key),
            name=key,
            position=(210.0 + i, 0.0, 0.0),
            size=(0.45, 3.3, 4.4),
        )

    prop_keys = [f"PropChange-{i}" for i in range(3)]
    for i, key in enumerate(prop_keys):
        gid = stable_guid(seed, key)
        add_wall(
            base,
            base_body,
            base_storey,
            global_id=gid,
            name=key,
            position=(220.0 + i, 0.0, 0.0),
            size=(0.2, 2.0, 3.0),
            fire_rating="REI30",
        )
        add_wall(
            head,
            head_body,
            head_storey,
            global_id=gid,
            name=key,
            position=(220.0 + i, 0.0, 0.0),
            size=(0.2, 2.0, 3.0),
            fire_rating="REI60",
        )

    shape_keys = [f"ShapeChange-{i}" for i in range(3)]
    for i, key in enumerate(shape_keys):
        gid = stable_guid(seed, key)
        add_wall(
            base,
            base_body,
            base_storey,
            global_id=gid,
            name=key,
            position=(230.0 + i, 0.0, 0.0),
            size=(0.2, 2.0, 3.0),
        )
        add_wall(
            head,
            head_body,
            head_storey,
            global_id=gid,
            name=key,
            position=(230.0 + i, 0.0, 0.0),
            size=(0.4, 2.0, 3.0),
        )

    moved_keys = [f"Moved-{i}" for i in range(3)]
    for i, key in enumerate(moved_keys):
        gid = stable_guid(seed, key)
        add_wall(
            base,
            base_body,
            base_storey,
            global_id=gid,
            name=key,
            position=(240.0 + i, 0.0, 0.0),
            size=(0.2, 2.0, 3.0),
        )
        add_wall(
            head,
            head_body,
            head_storey,
            global_id=gid,
            name=key,
            position=(240.0 + i, 0.5, 0.0),
            size=(0.2, 2.0, 3.0),
        )

    rotated_keys = [f"Rotated-{i}" for i in range(3)]
    for i, key in enumerate(rotated_keys):
        gid = stable_guid(seed, key)
        add_wall(
            base,
            base_body,
            base_storey,
            global_id=gid,
            name=key,
            position=(250.0 + i, 0.0, 0.0),
            size=(0.2, 2.0, 3.0),
            rotation_degrees=0.0,
        )
        add_wall(
            head,
            head_body,
            head_storey,
            global_id=gid,
            name=key,
            position=(250.0 + i, 0.0, 0.0),
            size=(0.2, 2.0, 3.0),
            rotation_degrees=30.0,
        )

    dup_gid = stable_guid(seed, "duplicate-global-id")
    dup_keys = ["Duplicate-A", "Duplicate-B"]
    for i, key in enumerate(dup_keys):
        add_wall(
            base,
            base_body,
            base_storey,
            global_id=dup_gid,
            name=key,
            position=(260.0 + i, 0.0, 0.0),
            size=(0.2, 2.0, 3.0),
        )
        add_wall(
            head,
            head_body,
            head_storey,
            global_id=dup_gid,
            name=key,
            position=(260.0 + i, 0.0, 0.0),
            size=(0.2, 2.0, 3.0),
        )

    empty_key = "EmptyGlobalId"
    for file, body, storey in ((base, base_body, base_storey), (head, head_body, head_storey)):
        wall = add_wall(
            file,
            body,
            storey,
            global_id=None,
            name=empty_key,
            position=(270.0, 0.0, 0.0),
            size=(0.2, 2.0, 3.0),
        )
        wall.GlobalId = ""

    base_fail = repeat_keys + removed_keys + shape_keys + moved_keys + rotated_keys + dup_keys + [empty_key]
    head_fail = repeat_keys + added_keys + shape_keys + moved_keys + rotated_keys + dup_keys + [empty_key]
    tracked = repeat_keys + removed_keys + added_keys + prop_keys + shape_keys + moved_keys + rotated_keys + dup_keys + [empty_key]

    oracle = {
        "schemaVersion": "demo-fixtures-oracle-v2",
        "idsCheck": IDS_CHECK,
        "seed": seed,
        "objects": {
            "repeated_failure": {
                "keys": repeat_keys,
                "count": REPEATED_FAILURE_COUNT,
                "intendedDiff": "unchanged",
                "ids": {"base": ids_fail(repeat_keys), "head": ids_fail(repeat_keys)},
                "findingDelta": "persisting",
            },
            "removed": {
                "keys": removed_keys,
                "intendedDiff": "removed",
                "ids": {"base": ids_fail(removed_keys), "head": ids_absent()},
            },
            "added": {
                "keys": added_keys,
                "intendedDiff": "added",
                "ids": {"base": ids_absent(), "head": ids_fail(added_keys)},
            },
            "property_changed": {
                "keys": prop_keys,
                "intendedDiff": "properties_changed",
                "detail": "Pset_WallCommon.FireRating REI30 -> REI60",
                "ids": {"base": ids_pass(prop_keys), "head": ids_pass(prop_keys)},
            },
            "shape_changed": {
                "keys": shape_keys,
                "intendedDiff": "shape_changed",
                "detail": "wall thickness 0.2m -> 0.4m, placement unchanged",
                "ids": {"base": ids_fail(shape_keys), "head": ids_fail(shape_keys)},
            },
            "moved": {
                "keys": moved_keys,
                "intendedDiff": "moved",
                "detail": "translated +0.5m in Y",
                "ids": {"base": ids_fail(moved_keys), "head": ids_fail(moved_keys)},
            },
            "rotated": {
                "keys": rotated_keys,
                "intendedDiff": "moved",
                "detail": "rotated 30 degrees about own origin, zero translation",
                "ids": {"base": ids_fail(rotated_keys), "head": ids_fail(rotated_keys)},
                "engineLimitation": {
                    "modeldiff": "unchanged",
                    "reason": "classify_pair measures origin-to-origin distance only; a pure rotation has zero displacement.",
                },
            },
            "ambiguous_ids": {
                "keys": dup_keys + [empty_key],
                "duplicateKeys": dup_keys,
                "duplicateGlobalId": dup_gid,
                "emptyGlobalIdKey": empty_key,
                "intendedCorrespondence": "uncertain",
                "ids": {
                    "base": ids_fail(dup_keys + [empty_key]),
                    "head": ids_fail(dup_keys + [empty_key]),
                },
                "engineLimitation": {
                    "modeldiff": "uncertain_or_express_id_pair",
                    "reason": "Duplicate GlobalIds and empty GlobalIds must not be treated as trusted identity.",
                },
            },
        },
        "idsSummary": {
            "base": {"applicable": 138, "fail": 135, "pass": 3, "failKeys": base_fail, "passKeys": prop_keys},
            "head": {"applicable": 138, "fail": 135, "pass": 3, "failKeys": head_fail, "passKeys": prop_keys},
        },
        "fixtureSummary": {
            "basePath": "base.ifc",
            "headPath": "head.ifc",
            "totalDistinctTrackedObjects": len(tracked),
            "generatedBy": "scripts/generate-demo-fixtures.py",
        },
        "notes": [
            "Intended diffs describe physical/check outcomes. engineLimitation records current matcher behavior that must not be treated as the intended result.",
            "IfcTester is the authority for IDS affected-set membership. The custom ids crate is not.",
        ],
    }

    freeze_file(base)
    freeze_file(head)
    base_path = output_dir / "base.ifc"
    head_path = output_dir / "head.ifc"
    base.write(str(base_path))
    head.write(str(head_path))
    for revision, path in (("base", base_path), ("head", head_path)):
        failed, passed = _ids_keys(path)
        oracle["idsSummary"][revision] = {
            "applicable": len(failed) + len(passed),
            "fail": len(failed),
            "pass": len(passed),
            "failKeys": sorted(failed),
            "passKeys": sorted(passed),
        }
    (output_dir / "oracle.json").write_text(json.dumps(oracle, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return oracle


def _ids_keys(ifc_path: Path) -> tuple[list[str], list[str]]:
    spec_file = ifctester.open(str(IDS_PATH))
    ifc_file = ifcopenshell.open(str(ifc_path))
    spec_file.validate(ifc_file)
    requirement = spec_file.specifications[0].requirements[0]
    failed = [entry["element"].Name for entry in requirement.failures]
    passed = [entity.Name for entity in (requirement.passed_entities or [])]
    return failed, passed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--seed", default=DEFAULT_SEED)
    args = parser.parse_args()
    oracle = build(args.output_dir, args.seed)
    tracked = oracle["fixtureSummary"]["totalDistinctTrackedObjects"]
    print(f"wrote {args.output_dir / 'base.ifc'}, {args.output_dir / 'head.ifc'}, and oracle.json ({tracked} tracked objects)")


if __name__ == "__main__":
    main()
