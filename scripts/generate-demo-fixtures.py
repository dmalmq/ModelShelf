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
from dataclasses import dataclass
from pathlib import Path

import ifcopenshell
import ifcopenshell.api.aggregate
import ifcopenshell.api.context
import ifcopenshell.api.geometry
import ifcopenshell.api.pset
import ifcopenshell.api.root
import ifcopenshell.api.spatial
import ifcopenshell.api.unit
from ifcopenshell.util.shape_builder import ShapeBuilder

from demo_oracle import (
    FOOT_TO_METRE,
    IFC2X3_WALL_NAME,
    JAPANESE_PSET,
    JAPANESE_PROP_NAME,
    JAPANESE_PROP_VALUE,
    PROOF_IDS,
    SKIPPED_PROPERTY_TYPE,
    UNSUPPORTED_OBJECT_KEY,
    assemble_proofs,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT_DIR = REPO_ROOT / "packs" / "demo" / "fixtures"
IDS_PATH = REPO_ROOT / "packs" / "demo" / "fixtures.ids"
DEFAULT_SEED = "modelshelf-demo-fixtures-v1"
FIXED_TIMESTAMP = "2024-01-01T00:00:00"
FIXED_CREATED = 1_704_067_200
REPEATED_FAILURE_COUNT = 120
IDS_CHECK = "Wall declares a fire rating"


@dataclass
class ProjectCtx:
    file: object
    body: object
    storey: object
    length_to_metre: float


@dataclass(frozen=True)
class WallOccurrence:
    key: str
    global_id: str | None
    position_m: tuple[float, float, float]
    size_m: tuple[float, float, float]
    rotation_degrees: float = 0.0
    fire_rating: str | None = None


def stable_guid(seed: str, key: str) -> str:
    return ifcopenshell.guid.compress(uuid.uuid5(uuid.NAMESPACE_URL, f"{seed}:{key}").hex)


def make_project(seed: str, *, length_to_metre: float = 1.0) -> ProjectCtx:
    f = ifcopenshell.file(schema="IFC4")
    project = ifcopenshell.api.root.create_entity(f, ifc_class="IfcProject", name="Demo Fixtures")
    project.GlobalId = stable_guid(seed, "project")
    if length_to_metre == FOOT_TO_METRE:
        # Worker stops at the first LENGTHUNIT; FOOT must be that unit, not a twin of METRE.
        ifcopenshell.api.unit.assign_unit(f, units=[_foot_length_unit(f)])
    elif length_to_metre == 1.0:
        ifcopenshell.api.unit.assign_unit(f, length={"is_metric": True, "raw": "METERS"})
    else:
        raise ValueError(f"unsupported length_to_metre {length_to_metre}")
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
    return ProjectCtx(file=f, body=body, storey=storey, length_to_metre=length_to_metre)


def _foot_length_unit(ifc_file: object) -> object:
    metre = ifc_file.create_entity("IfcSIUnit", UnitType="LENGTHUNIT", Name="METRE")
    exponents = ifc_file.create_entity(
        "IfcDimensionalExponents",
        LengthExponent=1,
        MassExponent=0,
        TimeExponent=0,
        ElectricCurrentExponent=0,
        ThermodynamicTemperatureExponent=0,
        AmountOfSubstanceExponent=0,
        LuminousIntensityExponent=0,
    )
    conversion = ifc_file.create_entity(
        "IfcMeasureWithUnit",
        ValueComponent=ifc_file.create_entity("IfcLengthMeasure", FOOT_TO_METRE),
        UnitComponent=metre,
    )
    return ifc_file.create_entity(
        "IfcConversionBasedUnit",
        Dimensions=exponents,
        UnitType="LENGTHUNIT",
        Name="FOOT",
        ConversionFactor=conversion,
    )


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
    ctx: ProjectCtx,
    *,
    global_id: str | None,
    name: str,
    position_m: tuple[float, float, float],
    size_m: tuple[float, float, float],
    rotation_degrees: float = 0.0,
    fire_rating: str | None = None,
) -> object:
    scale = ctx.length_to_metre
    size = (size_m[0] / scale, size_m[1] / scale, size_m[2] / scale)
    builder = ShapeBuilder(ctx.file)
    wall = ifcopenshell.api.root.create_entity(ctx.file, ifc_class="IfcWall", name=name)
    if global_id is not None:
        wall.GlobalId = global_id
    ifcopenshell.api.spatial.assign_container(ctx.file, relating_structure=ctx.storey, products=[wall])
    block = builder.block(position=(0.0, 0.0, 0.0), x_length=size[0], y_length=size[1], z_length=size[2])
    rep = builder.get_representation(ctx.body, block)
    ifcopenshell.api.geometry.assign_representation(ctx.file, product=wall, representation=rep)
    ifcopenshell.api.geometry.edit_object_placement(
        ctx.file, product=wall, matrix=_placement_matrix(position_m, rotation_degrees), is_si=True
    )
    if fire_rating is not None:
        pset = ifcopenshell.api.pset.add_pset(ctx.file, product=wall, name="Pset_WallCommon")
        ifcopenshell.api.pset.edit_pset(ctx.file, pset=pset, properties={"FireRating": fire_rating})
    freeze_file(ctx.file)
    return wall


def apply_plan(ctx: ProjectCtx, plan: list[WallOccurrence]) -> None:
    for occ in plan:
        wall = add_wall(
            ctx,
            global_id=occ.global_id,
            name=occ.key,
            position_m=occ.position_m,
            size_m=occ.size_m,
            rotation_degrees=occ.rotation_degrees,
            fire_rating=occ.fire_rating,
        )
        if occ.global_id is None:
            wall.GlobalId = ""


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


def wall_plans(seed: str) -> tuple[list[WallOccurrence], list[WallOccurrence], dict[str, object]]:
    base: list[WallOccurrence] = []
    head: list[WallOccurrence] = []
    repeat_keys = [f"Repeat-{i:03d}" for i in range(REPEATED_FAILURE_COUNT)]
    for i, key in enumerate(repeat_keys):
        occ = WallOccurrence(key, stable_guid(seed, key), (float(i) * 1.0, 0.0, 0.0), (0.2, 4.0, 3.0))
        base.append(occ)
        head.append(occ)

    removed_keys = [f"Removed-{i}" for i in range(3)]
    for i, key in enumerate(removed_keys):
        base.append(WallOccurrence(key, stable_guid(seed, key), (200.0 + i, 0.0, 0.0), (0.15, 1.1, 2.2)))

    added_keys = [f"Added-{i}" for i in range(3)]
    for i, key in enumerate(added_keys):
        head.append(WallOccurrence(key, stable_guid(seed, key), (210.0 + i, 0.0, 0.0), (0.45, 3.3, 4.4)))

    prop_keys = [f"PropChange-{i}" for i in range(3)]
    for i, key in enumerate(prop_keys):
        gid = stable_guid(seed, key)
        position = (220.0 + i, 0.0, 0.0)
        size = (0.2, 2.0, 3.0)
        base.append(WallOccurrence(key, gid, position, size, fire_rating="REI30"))
        head.append(WallOccurrence(key, gid, position, size, fire_rating="REI60"))

    shape_keys = [f"ShapeChange-{i}" for i in range(3)]
    for i, key in enumerate(shape_keys):
        gid = stable_guid(seed, key)
        position = (230.0 + i, 0.0, 0.0)
        base.append(WallOccurrence(key, gid, position, (0.2, 2.0, 3.0)))
        head.append(WallOccurrence(key, gid, position, (0.4, 2.0, 3.0)))

    moved_keys = [f"Moved-{i}" for i in range(3)]
    for i, key in enumerate(moved_keys):
        gid = stable_guid(seed, key)
        size = (0.2, 2.0, 3.0)
        base.append(WallOccurrence(key, gid, (240.0 + i, 0.0, 0.0), size))
        head.append(WallOccurrence(key, gid, (240.0 + i, 0.5, 0.0), size))

    rotated_keys = [f"Rotated-{i}" for i in range(3)]
    for i, key in enumerate(rotated_keys):
        gid = stable_guid(seed, key)
        position = (250.0 + i, 0.0, 0.0)
        size = (0.2, 2.0, 3.0)
        base.append(WallOccurrence(key, gid, position, size, rotation_degrees=0.0))
        head.append(WallOccurrence(key, gid, position, size, rotation_degrees=30.0))

    dup_gid = stable_guid(seed, "duplicate-global-id")
    dup_keys = ["Duplicate-A", "Duplicate-B"]
    for i, key in enumerate(dup_keys):
        occ = WallOccurrence(key, dup_gid, (260.0 + i, 0.0, 0.0), (0.2, 2.0, 3.0))
        base.append(occ)
        head.append(occ)

    empty_key = "EmptyGlobalId"
    empty = WallOccurrence(empty_key, None, (270.0, 0.0, 0.0), (0.2, 2.0, 3.0))
    base.append(empty)
    head.append(empty)

    groups = {
        "repeat": repeat_keys,
        "removed": removed_keys,
        "added": added_keys,
        "prop": prop_keys,
        "shape": shape_keys,
        "moved": moved_keys,
        "rotated": rotated_keys,
        "dup": dup_keys,
        "empty": [empty_key],
        "dup_gid": dup_gid,
    }
    return base, head, groups


def add_unsupported_door(ctx: ProjectCtx, *, seed: str) -> object:
    door = ifcopenshell.api.root.create_entity(ctx.file, ifc_class="IfcDoor", name=UNSUPPORTED_OBJECT_KEY)
    door.GlobalId = stable_guid(seed, "unsupported-door")
    ifcopenshell.api.spatial.assign_container(ctx.file, relating_structure=ctx.storey, products=[door])
    lining = ctx.file.create_entity(
        SKIPPED_PROPERTY_TYPE,
        GlobalId=stable_guid(seed, "unsupported-lining"),
        LiningThickness=0.05,
    )
    ifcopenshell.api.pset.assign_pset(ctx.file, [door], lining)
    pset = ifcopenshell.api.pset.add_pset(ctx.file, product=door, name=JAPANESE_PSET)
    ifcopenshell.api.pset.edit_pset(ctx.file, pset=pset, properties={JAPANESE_PROP_NAME: JAPANESE_PROP_VALUE})
    freeze_file(ctx.file)
    return door


def write_ifc2x3_wall(path: Path, *, name: str, seed: str) -> None:
    f = ifcopenshell.file(schema="IFC2X3")
    origin = f.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0))
    axis = f.create_entity("IfcAxis2Placement3D", Location=origin)
    ctx = f.create_entity(
        "IfcGeometricRepresentationContext",
        ContextType="Model",
        CoordinateSpaceDimension=3,
        Precision=1e-5,
        WorldCoordinateSystem=axis,
    )
    metre = f.create_entity("IfcSIUnit", UnitType="LENGTHUNIT", Name="METRE")
    assignment = f.create_entity("IfcUnitAssignment", Units=[metre])
    project = f.create_entity(
        "IfcProject",
        GlobalId=stable_guid(seed, "ifc2x3-project"),
        Name="IFC2X3 wall",
        RepresentationContexts=[ctx],
        UnitsInContext=assignment,
    )
    site = f.create_entity("IfcSite", GlobalId=stable_guid(seed, "ifc2x3-site"), Name="Demo Site")
    building = f.create_entity("IfcBuilding", GlobalId=stable_guid(seed, "ifc2x3-building"), Name="Demo Building")
    storey = f.create_entity("IfcBuildingStorey", GlobalId=stable_guid(seed, "ifc2x3-storey"), Name="1F")
    f.create_entity(
        "IfcRelAggregates",
        GlobalId=stable_guid(seed, "ifc2x3-agg-site"),
        RelatingObject=project,
        RelatedObjects=[site],
    )
    f.create_entity(
        "IfcRelAggregates",
        GlobalId=stable_guid(seed, "ifc2x3-agg-building"),
        RelatingObject=site,
        RelatedObjects=[building],
    )
    f.create_entity(
        "IfcRelAggregates",
        GlobalId=stable_guid(seed, "ifc2x3-agg-storey"),
        RelatingObject=building,
        RelatedObjects=[storey],
    )
    point = f.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0))
    place_axis = f.create_entity("IfcAxis2Placement3D", Location=point)
    placement = f.create_entity("IfcLocalPlacement", RelativePlacement=place_axis)
    wall = f.create_entity(
        "IfcWall",
        GlobalId=stable_guid(seed, "ifc2x3-wall"),
        Name=name,
        ObjectPlacement=placement,
    )
    f.create_entity(
        "IfcRelContainedInSpatialStructure",
        GlobalId=stable_guid(seed, "ifc2x3-contain"),
        RelatedElements=[wall],
        RelatingStructure=storey,
    )
    freeze_file(f)
    f.write(str(path))


def build(output_dir: Path, seed: str) -> dict[str, object]:
    output_dir.mkdir(parents=True, exist_ok=True)
    base_plan, head_plan, groups = wall_plans(seed)
    base = make_project(f"{seed}:base")
    head = make_project(f"{seed}:head")
    apply_plan(base, base_plan)
    apply_plan(head, head_plan)
    foot = make_project(f"{seed}:foot", length_to_metre=FOOT_TO_METRE)
    apply_plan(foot, base_plan)
    unsupported = make_project(f"{seed}:unsupported")
    add_unsupported_door(unsupported, seed=seed)

    repeat_keys = groups["repeat"]
    removed_keys = groups["removed"]
    added_keys = groups["added"]
    prop_keys = groups["prop"]
    shape_keys = groups["shape"]
    moved_keys = groups["moved"]
    rotated_keys = groups["rotated"]
    dup_keys = groups["dup"]
    empty_key = groups["empty"][0]
    dup_gid = groups["dup_gid"]

    base_fail = repeat_keys + removed_keys + shape_keys + moved_keys + rotated_keys + dup_keys + [empty_key]
    head_fail = repeat_keys + added_keys + shape_keys + moved_keys + rotated_keys + dup_keys + [empty_key]
    tracked = repeat_keys + removed_keys + added_keys + prop_keys + shape_keys + moved_keys + rotated_keys + dup_keys + [empty_key]

    proofs = assemble_proofs()
    if set(proofs) != set(PROOF_IDS):
        raise RuntimeError(f"assemble_proofs ids {sorted(proofs)} != {list(PROOF_IDS)}")

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
            "footPath": "foot.ifc",
            "unsupportedPath": "unsupported.ifc",
            "ifc2x3WallPath": "ifc2x3-wall.ifc",
            "totalDistinctTrackedObjects": len(tracked),
            "generatedBy": "scripts/generate-demo-fixtures.py",
        },
        "proofs": proofs,
        "notes": [
            "Intended diffs describe physical/check outcomes. engineLimitation records current matcher behavior that must not be treated as the intended result.",
            "IfcTester is the authority for IDS affected-set membership. The custom ids crate is not.",
        ],
    }

    freeze_file(base.file)
    freeze_file(head.file)
    freeze_file(foot.file)
    freeze_file(unsupported.file)
    base_path = output_dir / "base.ifc"
    head_path = output_dir / "head.ifc"
    foot_path = output_dir / "foot.ifc"
    unsupported_path = output_dir / "unsupported.ifc"
    ifc2x3_path = output_dir / "ifc2x3-wall.ifc"
    base.file.write(str(base_path))
    head.file.write(str(head_path))
    foot.file.write(str(foot_path))
    unsupported.file.write(str(unsupported_path))
    write_ifc2x3_wall(ifc2x3_path, name=IFC2X3_WALL_NAME, seed=seed)
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
    import ifctester

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
    print(
        f"wrote {args.output_dir / 'base.ifc'}, {args.output_dir / 'head.ifc'}, "
        f"{args.output_dir / 'foot.ifc'}, {args.output_dir / 'unsupported.ifc'}, "
        f"{args.output_dir / 'ifc2x3-wall.ifc'}, and oracle.json ({tracked} tracked objects)"
    )


if __name__ == "__main__":
    main()
