from __future__ import annotations

import json
import math
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Final, Literal, Union

FOOT_TO_METRE: Final[float] = 0.3048
SCHEMA_VERSION: Final[str] = "demo-fixtures-oracle-v2"
REPEAT_SI_KEY: Final[str] = "Repeat-001"
UNSUPPORTED_OBJECT_KEY: Final[str] = "Unsupported-0"
UNSUPPORTED_IFC_CLASS: Final[str] = "IfcDoor"
SKIPPED_PROPERTY_TYPE: Final[str] = "IfcDoorLiningProperties"
JAPANESE_PSET: Final[str] = "Rebro_PartsData"
JAPANESE_PROP_NAME: Final[str] = "用途"
JAPANESE_PROP_VALUE: Final[str] = "給水"
IFC2X3_WALL_NAME: Final[str] = "Ifc2x3-Wall"
IDS_RELATIVE: Final[str] = "packs/demo/fixtures.ids"

WALL_GROUPS: Final[tuple[str, ...]] = (
    "repeated_failure",
    "removed",
    "added",
    "property_changed",
    "shape_changed",
    "moved",
    "rotated",
    "ambiguous_ids",
)

PROOF_IDS: Final[tuple[str, ...]] = (
    "mixed_units",
    "unsupported_rule",
    "empty_catalog",
    "unsupported_input",
    "japanese_names",
)

PROJECTORS: Final[tuple[str, ...]] = ("oracle", "checks", "qa_harness", "worker_pytest")
WALL_OUTCOMES: Final[tuple[str, ...]] = ("fail", "pass", "absent")

Projector = Literal["oracle", "checks", "qa_harness", "worker_pytest"]

REPO_ROOT = Path(__file__).resolve().parent.parent
IDS_PATH = REPO_ROOT / IDS_RELATIVE


class OracleShapeError(SystemExit):
    pass


def fail(message: str) -> None:
    print(f"FAIL - {message}", file=sys.stderr)
    raise OracleShapeError(1)


@dataclass(frozen=True)
class ScoreIdentity:
    kind: Literal["score_identity"]
    metric_ifc: str
    imperial_ifc: str
    metric_length_to_metre: float
    imperial_length_to_metre: float
    imperial_unit_name: str
    ids_equal_to: Literal["base", "head"]
    projectors: tuple[Projector, ...]


@dataclass(frozen=True)
class UnevaluatedSpec:
    kind: Literal["unevaluated_spec"]
    model_ifc: str
    ids_path: str
    expected_status: Literal["incomplete"]
    never: tuple[str, ...]
    diagnostic_substrings: tuple[str, ...]
    projectors: tuple[Projector, ...]


@dataclass(frozen=True)
class EmptyCatalog:
    kind: Literal["empty_catalog"]
    modes: tuple[Literal["unseeded_existing", "missing_path"], ...]
    projects: Literal[0]
    packs: Literal[0]
    projectors: tuple[Projector, ...]


@dataclass(frozen=True)
class SkippedPropertyForm:
    kind: Literal["skipped_property_form"]
    ifc: str
    object_key: str
    ifc_class: str
    skipped_types: tuple[str, ...]
    ids_outcome: Literal["incomplete"]
    reason: str
    projectors: tuple[Projector, ...]


@dataclass(frozen=True)
class VerbatimBytes:
    kind: Literal["verbatim_bytes"]
    ifc: str
    object_key: str
    pset: str
    name: str
    value: str
    projectors: tuple[Projector, ...]


Expected = Union[ScoreIdentity, UnevaluatedSpec, EmptyCatalog, SkippedPropertyForm, VerbatimBytes]


@dataclass(frozen=True)
class ProofRow:
    id: str
    expected: Expected


@dataclass(frozen=True)
class Oracle:
    schema_version: Literal["demo-fixtures-oracle-v2"]
    objects: dict
    ids_summary: dict
    fixture_summary: dict
    proofs: dict[str, ProofRow]
    data: dict


def assemble_proofs() -> dict[str, object]:
    incomplete = {
        "outcome": "incomplete",
        "reason": f"skipped {SKIPPED_PROPERTY_TYPE}",
        "keys": [UNSUPPORTED_OBJECT_KEY],
    }
    return {
        "mixed_units": {
            "kind": "score_identity",
            "metricIfc": "base.ifc",
            "imperialIfc": "foot.ifc",
            "metricLengthToMetre": 1.0,
            "imperialLengthToMetre": FOOT_TO_METRE,
            "imperialUnitName": "FOOT",
            "idsEqualTo": "base",
            "projectors": ["oracle", "checks"],
        },
        "unsupported_rule": {
            "kind": "unevaluated_spec",
            "modelIfc": "ifc2x3-wall.ifc",
            "idsPath": IDS_RELATIVE,
            "expectedStatus": "incomplete",
            "never": ["passed", "failed"],
            "diagnosticSubstrings": ["unsupported", "schema"],
            "projectors": ["oracle", "checks"],
        },
        "empty_catalog": {
            "kind": "empty_catalog",
            "modes": ["unseeded_existing", "missing_path"],
            "projects": 0,
            "packs": 0,
            "projectors": ["qa_harness"],
        },
        "unsupported_input": {
            "kind": "skipped_property_form",
            "ifc": "unsupported.ifc",
            "objectKey": UNSUPPORTED_OBJECT_KEY,
            "ifcClass": UNSUPPORTED_IFC_CLASS,
            "skippedTypes": [SKIPPED_PROPERTY_TYPE],
            "ids": {"base": incomplete, "head": incomplete},
            "projectors": ["oracle"],
        },
        "japanese_names": {
            "kind": "verbatim_bytes",
            "ifc": "unsupported.ifc",
            "objectKey": UNSUPPORTED_OBJECT_KEY,
            "pset": JAPANESE_PSET,
            "name": JAPANESE_PROP_NAME,
            "value": JAPANESE_PROP_VALUE,
            "projectors": ["worker_pytest"],
        },
    }


def parse_oracle(data: dict) -> Oracle:
    if not isinstance(data, dict):
        fail("oracle.json must be an object")
    if data.get("schemaVersion") != SCHEMA_VERSION:
        fail("oracle schemaVersion must be demo-fixtures-oracle-v2")
    objects = data.get("objects")
    if not isinstance(objects, dict):
        fail("oracle objects must be an object")
    extra_groups = sorted(set(objects) - set(WALL_GROUPS))
    missing_groups = [name for name in WALL_GROUPS if name not in objects]
    if extra_groups or missing_groups:
        fail(f"oracle objects groups extra={extra_groups} missing={missing_groups}")
    proofs_raw = data.get("proofs")
    if not isinstance(proofs_raw, dict):
        fail("oracle proofs is required")
    extra_proofs = sorted(set(proofs_raw) - set(PROOF_IDS))
    missing_proofs = [name for name in PROOF_IDS if name not in proofs_raw]
    if extra_proofs or missing_proofs:
        fail(f"oracle proofs extra={extra_proofs} missing={missing_proofs}")
    proofs = {proof_id: _parse_proof_row(proof_id, proofs_raw[proof_id]) for proof_id in PROOF_IDS}
    oracle = Oracle(
        schema_version="demo-fixtures-oracle-v2",
        objects=objects,
        ids_summary=data.get("idsSummary") if isinstance(data.get("idsSummary"), dict) else {},
        fixture_summary=data.get("fixtureSummary") if isinstance(data.get("fixtureSummary"), dict) else {},
        proofs=proofs,
        data=data,
    )
    assert_frozen_wall_counts(oracle)
    return oracle


def assert_frozen_wall_counts(oracle: Oracle) -> None:
    objects = oracle.objects
    tracked = oracle.fixture_summary.get("totalDistinctTrackedObjects")
    expected_tracked = sum(len(objects[group]["keys"]) for group in WALL_GROUPS)
    if tracked != 141 or tracked != expected_tracked:
        fail(f"totalDistinctTrackedObjects is {tracked}, expected 141")
    if objects["repeated_failure"]["count"] != 120:
        fail("repeated_failure.count must stay 120; the extra 15 IDS failures live in other groups")
    for revision in ("base", "head"):
        summary = oracle.ids_summary.get(revision)
        if not isinstance(summary, dict):
            fail(f"idsSummary.{revision} is required")
        if summary.get("fail") != 135:
            fail(f"{revision} IDS fail count is {summary.get('fail')}, expected 135")
        if summary.get("pass") != 3:
            fail(f"{revision} IDS pass count is {summary.get('pass')}, expected 3")


def check_ids_outcome(
    outcome: str,
    keys: list[str],
    *,
    failed: list[str],
    passed: list[str],
    label: str,
) -> None:
    if outcome == "fail":
        for key in keys:
            if key not in failed:
                fail(f"{label}: {key!r} should fail IDS")
        return
    if outcome == "pass":
        for key in keys:
            if key not in passed:
                fail(f"{label}: {key!r} should pass IDS")
        return
    if outcome == "absent":
        if keys:
            fail(f"{label}: absent group must have empty keys, found {keys!r}")
        return
    fail(f"{label}: unknown ids.outcome {outcome!r}")


def execute_proof(fixture_dir: Path, oracle: Oracle, row: ProofRow) -> None:
    expected = row.expected
    kind = expected.kind
    if kind == "score_identity":
        check_score_identity(fixture_dir, oracle, expected)
        return
    if kind == "unevaluated_spec":
        check_unevaluated_spec(fixture_dir, expected)
        return
    if kind == "skipped_property_form":
        check_skipped_property_form(fixture_dir, oracle, expected)
        return
    if kind == "empty_catalog":
        return
    if kind == "verbatim_bytes":
        return
    fail(f"unknown expected.kind {kind!r}")


def check_score_identity(fixture_dir: Path, oracle: Oracle, expected: ScoreIdentity) -> None:
    import ifcopenshell

    from ifc_worker.units import length_scale_to_metre

    metric_path = fixture_dir / expected.metric_ifc
    imperial_path = fixture_dir / expected.imperial_ifc
    imperial = ifcopenshell.open(str(imperial_path))
    length_units = [
        unit
        for unit in imperial.by_type("IfcProject")[0].UnitsInContext.Units or ()
        if getattr(unit, "UnitType", None) == "LENGTHUNIT"
    ]
    if not length_units:
        fail(f"{expected.imperial_ifc}: no LENGTHUNIT")
    first = length_units[0]
    if first.is_a() != "IfcConversionBasedUnit" or first.Name != expected.imperial_unit_name:
        fail(f"{expected.imperial_ifc}: first LENGTHUNIT must be IfcConversionBasedUnit named {expected.imperial_unit_name}")
    factor = float(first.ConversionFactor.ValueComponent.wrappedValue)
    if not math.isclose(factor, expected.imperial_length_to_metre, abs_tol=1e-9, rel_tol=0.0):
        fail(f"{expected.imperial_ifc}: ConversionFactor {factor} != {expected.imperial_length_to_metre}")
    scale = length_scale_to_metre(imperial)
    if scale is None or not math.isclose(scale, expected.imperial_length_to_metre, abs_tol=1e-9, rel_tol=0.0):
        fail(f"length_scale_to_metre({expected.imperial_ifc}) is {scale}, expected {expected.imperial_length_to_metre}")
    metric_names = wall_names(metric_path)
    imperial_names = wall_names(imperial_path)
    if metric_names != imperial_names:
        fail(f"{expected.imperial_ifc} wall names {imperial_names!r} != {expected.metric_ifc} {metric_names!r}")
    failed, passed = evaluate_ids(imperial_path)
    summary = oracle.ids_summary[expected.ids_equal_to]
    if set(failed) != set(summary["failKeys"]) or set(passed) != set(summary["passKeys"]):
        fail(
            f"{expected.imperial_ifc} IfcTester keys != idsSummary.{expected.ids_equal_to}: "
            f"fail extra={sorted(set(failed) - set(summary['failKeys']))} "
            f"missing={sorted(set(summary['failKeys']) - set(failed))}"
        )
    metric = ifcopenshell.open(str(metric_path))
    _assert_repeat_si(metric, imperial, scale)


def check_unevaluated_spec(fixture_dir: Path, expected: UnevaluatedSpec) -> None:
    import ifcopenshell
    import ifctester

    ids_path = REPO_ROOT / expected.ids_path
    spec_file = ifctester.open(str(ids_path))
    ifc_file = ifcopenshell.open(str(fixture_dir / expected.model_ifc))
    spec_file.validate(ifc_file, should_filter_version=True)
    spec = spec_file.specifications[0]
    is_ifc_version = getattr(spec, "is_ifc_version", True)
    status = getattr(spec, "status", None)
    if is_ifc_version is not False and status is not None:
        fail(f"{expected.model_ifc}: spec evaluated as status={status!r} is_ifc_version={is_ifc_version!r}")
    if status in expected.never:
        fail(f"{expected.model_ifc}: spec status {status!r} is in never={expected.never!r}")
    walls = [wall.Name for wall in ifc_file.by_type("IfcWall")]
    if IFC2X3_WALL_NAME not in walls:
        fail(f"{expected.model_ifc}: missing wall {IFC2X3_WALL_NAME!r}, found {walls!r}")


def check_skipped_property_form(fixture_dir: Path, oracle: Oracle, expected: SkippedPropertyForm) -> None:
    import ifcopenshell

    from ifc_worker.properties import extract_properties

    ifc_path = fixture_dir / expected.ifc
    ifc_file = ifcopenshell.open(str(ifc_path))
    products = [product for product in ifc_file.by_type(expected.ifc_class) if product.Name == expected.object_key]
    if len(products) != 1:
        fail(f"{expected.ifc}: expected one {expected.ifc_class} named {expected.object_key!r}")
    door = products[0]
    diagnostics: list[str] = []
    records = extract_properties(door, ifc_file, diagnostics)
    skipped = {skipped_type for skipped_type in expected.skipped_types}
    joined = " ".join(diagnostics)
    if not skipped.issubset(_diagnostic_types(diagnostics)) or any(name not in joined for name in skipped):
        fail(f"{expected.ifc}: extract_properties diagnostics {diagnostics!r} missing {sorted(skipped)}")
    japanese = next((record for record in records if record.pset == JAPANESE_PSET and record.name == JAPANESE_PROP_NAME), None)
    if japanese is None:
        fail(f"{expected.ifc}: Japanese pset {JAPANESE_PSET!r} was skipped with the lining form")
    for revision in ("base", "head"):
        summary = oracle.ids_summary[revision]
        if expected.object_key in summary["failKeys"] or expected.object_key in summary["passKeys"]:
            fail(f"{expected.object_key!r} must not appear in idsSummary.{revision} fail/pass keys")
    _spawn_inspect_skip(ifc_path, expected)


def wall_names(ifc_path: Path) -> list[str]:
    import ifcopenshell

    ifc_file = ifcopenshell.open(str(ifc_path))
    names = [wall.Name for wall in ifc_file.by_type("IfcWall")]
    if len(names) != len(set(names)):
        fail(f"{ifc_path.name}: wall names are not unique, so they cannot be oracle keys")
    return names


def evaluate_ids(ifc_path: Path) -> tuple[list[str], list[str]]:
    import ifcopenshell
    import ifctester

    spec_file = ifctester.open(str(IDS_PATH))
    ifc_file = ifcopenshell.open(str(ifc_path))
    spec_file.validate(ifc_file)
    requirement = spec_file.specifications[0].requirements[0]
    failed = [entry["element"].Name for entry in requirement.failures]
    passed = [entity.Name for entity in (requirement.passed_entities or [])]
    return failed, passed


def _parse_proof_row(proof_id: str, raw: object) -> ProofRow:
    if not isinstance(raw, dict):
        fail(f"proofs.{proof_id} must be an object")
    kind = raw.get("kind")
    projectors = _parse_projectors(proof_id, raw.get("projectors"))
    if kind == "score_identity":
        ids_equal_to = raw.get("idsEqualTo")
        if ids_equal_to not in ("base", "head"):
            fail(f"proofs.{proof_id}.idsEqualTo must be base or head")
        expected: Expected = ScoreIdentity(
            kind="score_identity",
            metric_ifc=_require_str(proof_id, raw, "metricIfc"),
            imperial_ifc=_require_str(proof_id, raw, "imperialIfc"),
            metric_length_to_metre=_require_float(proof_id, raw, "metricLengthToMetre"),
            imperial_length_to_metre=_require_float(proof_id, raw, "imperialLengthToMetre"),
            imperial_unit_name=_require_str(proof_id, raw, "imperialUnitName"),
            ids_equal_to=ids_equal_to,
            projectors=projectors,
        )
        if not math.isclose(expected.imperial_length_to_metre, FOOT_TO_METRE, abs_tol=1e-9, rel_tol=0.0):
            fail(f"proofs.{proof_id}.imperialLengthToMetre must be {FOOT_TO_METRE}")
        return ProofRow(id=proof_id, expected=expected)
    if kind == "unevaluated_spec":
        never = raw.get("never")
        if never != ["passed", "failed"]:
            fail(f"proofs.{proof_id}.never must be [passed, failed]")
        if raw.get("expectedStatus") != "incomplete":
            fail(f"proofs.{proof_id}.expectedStatus must be incomplete")
        substrings = raw.get("diagnosticSubstrings")
        if not isinstance(substrings, list) or not all(isinstance(item, str) and item for item in substrings):
            fail(f"proofs.{proof_id}.diagnosticSubstrings must be nonempty strings")
        expected = UnevaluatedSpec(
            kind="unevaluated_spec",
            model_ifc=_require_str(proof_id, raw, "modelIfc"),
            ids_path=_require_str(proof_id, raw, "idsPath"),
            expected_status="incomplete",
            never=("passed", "failed"),
            diagnostic_substrings=tuple(substrings),
            projectors=projectors,
        )
        return ProofRow(id=proof_id, expected=expected)
    if kind == "empty_catalog":
        modes = raw.get("modes")
        if modes != ["unseeded_existing", "missing_path"]:
            fail(f"proofs.{proof_id}.modes must be [unseeded_existing, missing_path]")
        if raw.get("projects") != 0 or raw.get("packs") != 0:
            fail(f"proofs.{proof_id} projects and packs must be 0")
        expected = EmptyCatalog(
            kind="empty_catalog",
            modes=("unseeded_existing", "missing_path"),
            projects=0,
            packs=0,
            projectors=projectors,
        )
        return ProofRow(id=proof_id, expected=expected)
    if kind == "skipped_property_form":
        skipped_types = raw.get("skippedTypes")
        if not isinstance(skipped_types, list) or skipped_types != [SKIPPED_PROPERTY_TYPE]:
            fail(f"proofs.{proof_id}.skippedTypes must be [{SKIPPED_PROPERTY_TYPE}]")
        ids = raw.get("ids")
        if not isinstance(ids, dict):
            fail(f"proofs.{proof_id}.ids is required")
        reason = None
        for side in ("base", "head"):
            side_ids = ids.get(side)
            if not isinstance(side_ids, dict) or side_ids.get("outcome") != "incomplete":
                fail(f"proofs.{proof_id}.ids.{side}.outcome must be incomplete")
            if side_ids.get("keys") != [UNSUPPORTED_OBJECT_KEY]:
                fail(f"proofs.{proof_id}.ids.{side}.keys must be [{UNSUPPORTED_OBJECT_KEY}]")
            reason = side_ids.get("reason")
            if not isinstance(reason, str) or not reason:
                fail(f"proofs.{proof_id}.ids.{side}.reason is required")
        expected = SkippedPropertyForm(
            kind="skipped_property_form",
            ifc=_require_str(proof_id, raw, "ifc"),
            object_key=_require_str(proof_id, raw, "objectKey"),
            ifc_class=_require_str(proof_id, raw, "ifcClass"),
            skipped_types=(SKIPPED_PROPERTY_TYPE,),
            ids_outcome="incomplete",
            reason=str(reason),
            projectors=projectors,
        )
        return ProofRow(id=proof_id, expected=expected)
    if kind == "verbatim_bytes":
        expected = VerbatimBytes(
            kind="verbatim_bytes",
            ifc=_require_str(proof_id, raw, "ifc"),
            object_key=_require_str(proof_id, raw, "objectKey"),
            pset=_require_str(proof_id, raw, "pset"),
            name=_require_str(proof_id, raw, "name"),
            value=_require_str(proof_id, raw, "value"),
            projectors=projectors,
        )
        if expected.pset != JAPANESE_PSET or expected.name != JAPANESE_PROP_NAME or expected.value != JAPANESE_PROP_VALUE:
            fail(f"proofs.{proof_id} Japanese pset/name/value must match the sidecar literals")
        return ProofRow(id=proof_id, expected=expected)
    fail(f"proofs.{proof_id}: unknown kind {kind!r}")


def _parse_projectors(proof_id: str, raw: object) -> tuple[Projector, ...]:
    if not isinstance(raw, list) or not raw:
        fail(f"proofs.{proof_id}.projectors must be a nonempty list")
    projectors: list[Projector] = []
    for item in raw:
        if item not in PROJECTORS:
            fail(f"proofs.{proof_id}: unknown projector {item!r}")
        projectors.append(item)
    return tuple(projectors)


def _require_str(proof_id: str, raw: dict, key: str) -> str:
    value = raw.get(key)
    if not isinstance(value, str) or not value:
        fail(f"proofs.{proof_id}.{key} must be a nonempty string")
    return value


def _require_float(proof_id: str, raw: dict, key: str) -> float:
    value = raw.get(key)
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        fail(f"proofs.{proof_id}.{key} must be a number")
    return float(value)


def _assert_repeat_si(metric, imperial, scale: float) -> None:
    from ifc_worker.placement import object_placement

    metric_wall = next((wall for wall in metric.by_type("IfcWall") if wall.Name == REPEAT_SI_KEY), None)
    imperial_wall = next((wall for wall in imperial.by_type("IfcWall") if wall.Name == REPEAT_SI_KEY), None)
    if metric_wall is None or imperial_wall is None:
        fail(f"{REPEAT_SI_KEY} missing from metric or imperial file")
    metric_placement = object_placement(metric_wall, metric)
    imperial_placement = object_placement(imperial_wall, imperial)
    if metric_placement is None or imperial_placement is None:
        fail(f"{REPEAT_SI_KEY} placement could not be interpreted")
    for index in (3, 7, 11):
        if not math.isclose(metric_placement[index], imperial_placement[index], abs_tol=1e-9, rel_tol=0.0):
            fail(
                f"{REPEAT_SI_KEY} SI translation metric={metric_placement[index]!r} "
                f"imperial={imperial_placement[index]!r}"
            )
    raw_imperial = _raw_translation(imperial_wall)
    if raw_imperial is None:
        fail(f"{REPEAT_SI_KEY} imperial raw translation is missing")
    metres = (metric_placement[3], metric_placement[7], metric_placement[11])
    scaled_axes = [
        (axis, metre)
        for axis, metre in zip(raw_imperial, metres)
        if not math.isclose(metre, 0.0, abs_tol=1e-9, rel_tol=0.0)
    ]
    if not scaled_axes:
        fail(f"{REPEAT_SI_KEY} is at the origin, so the SI pin cannot catch a double unit conversion")
    for axis, metre in scaled_axes:
        if math.isclose(axis, metre, abs_tol=1e-9, rel_tol=0.0):
            fail(f"{REPEAT_SI_KEY} imperial raw translation {axis} was stored in metres")
        if not math.isclose(axis * scale, metre, abs_tol=1e-9, rel_tol=0.0):
            fail(f"{REPEAT_SI_KEY} raw translation {axis} × {scale} != SI {metre}")


def _raw_translation(wall) -> tuple[float, float, float] | None:
    placement = getattr(wall, "ObjectPlacement", None)
    if placement is None:
        return None
    relative = getattr(placement, "RelativePlacement", None)
    location = getattr(relative, "Location", None)
    coords = getattr(location, "Coordinates", None)
    if coords is None or len(coords) < 3:
        return None
    return (float(coords[0]), float(coords[1]), float(coords[2]))


def _diagnostic_types(diagnostics: list[str]) -> set[str]:
    found: set[str] = set()
    for line in diagnostics:
        if "skipped unsupported property definitions of type " in line:
            tail = line.split("skipped unsupported property definitions of type ", 1)[1]
            found.update(part.strip() for part in tail.split(",") if part.strip())
    return found


def _spawn_inspect_skip(ifc_path: Path, expected: SkippedPropertyForm) -> None:
    from ifc_worker.hashing import sha256_file

    worker = shutil.which("ifc-worker")
    if worker is None:
        fail("ifc-worker is not on PATH; cannot spawn inspect for unsupported_input")
    with tempfile.TemporaryDirectory(prefix="oracle-inspect-") as tmp:
        out = Path(tmp) / "out"
        out.mkdir()
        request_path = Path(tmp) / "request.json"
        payload = {
            "protocolVersion": 2,
            "jobId": "oracle-unsupported-input",
            "operation": "inspect",
            "model": {
                "path": str(ifc_path.resolve()),
                "sha256": sha256_file(ifc_path),
                "revisionId": "sidecar",
            },
            "ids": None,
            "outputDir": str(out.resolve()),
            "settings": {"geometry": False},
        }
        request_path.write_text(json.dumps(payload), encoding="utf-8")
        proc = subprocess.run(  # noqa: S603
            [worker, "--request", str(request_path)],
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0:
            fail(f"inspect {expected.ifc} exited {proc.returncode}: {proc.stderr}")
        manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
        diagnostics = manifest.get("diagnostics") or []
        joined = " ".join(diagnostics)
        if any(name not in joined for name in expected.skipped_types):
            fail(f"inspect {expected.ifc} diagnostics {diagnostics!r} missing {list(expected.skipped_types)}")
