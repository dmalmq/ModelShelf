#!/usr/bin/env python3
"""Check packs/demo/fixtures/oracle.json against IfcTester and the fixture IFC.

Fails on wrong IDS counts, omitted objects, wrong category membership, and
reversed key order. Intended diffs stay separate from engineLimitation.

Usage (from the repo root):

    uv run --project services/ifc-worker python scripts/check-demo-oracle.py
    uv run --project services/ifc-worker python scripts/check-demo-oracle.py --prove-regen
"""

from __future__ import annotations

import argparse
import filecmp
import json
import sys
import tempfile
from pathlib import Path

import ifcopenshell
import ifctester

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DIR = REPO_ROOT / "packs" / "demo" / "fixtures"
IDS_PATH = REPO_ROOT / "packs" / "demo" / "fixtures.ids"


def fail(message: str) -> None:
    print(f"FAIL - {message}", file=sys.stderr)
    raise SystemExit(1)


def load_oracle(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def wall_names(ifc_path: Path) -> list[str]:
    ifc_file = ifcopenshell.open(str(ifc_path))
    names = [wall.Name for wall in ifc_file.by_type("IfcWall")]
    if len(names) != len(set(names)):
        fail(f"{ifc_path.name}: wall names are not unique, so they cannot be oracle keys")
    return names


def evaluate_ids(ifc_path: Path) -> tuple[list[str], list[str]]:
    spec_file = ifctester.open(str(IDS_PATH))
    ifc_file = ifcopenshell.open(str(ifc_path))
    spec_file.validate(ifc_file)
    requirement = spec_file.specifications[0].requirements[0]
    failed = [entry["element"].Name for entry in requirement.failures]
    passed = [entity.Name for entity in (requirement.passed_entities or [])]
    return failed, passed


def expect_set(label: str, actual: list[str], expected: list[str]) -> None:
    if set(actual) != set(expected) or len(actual) != len(expected):
        missing = [key for key in expected if key not in actual]
        extra = [key for key in actual if key not in expected]
        fail(f"{label}: expected {expected!r}, got {actual!r} (missing={missing} extra={extra})")


def expect_order(label: str, haystack: list[str], keys: list[str]) -> None:
    positions = []
    for key in keys:
        if key not in haystack:
            fail(f"{label}: {key!r} is omitted")
        positions.append(haystack.index(key))
    if positions != sorted(positions):
        fail(f"{label}: keys are reversed or shuffled in the IFC: {keys!r}")


def check_oracle(fixture_dir: Path) -> None:
    oracle = load_oracle(fixture_dir / "oracle.json")
    if oracle.get("schemaVersion") != "demo-fixtures-oracle-v2":
        fail("oracle schemaVersion must be demo-fixtures-oracle-v2")
    base_path = fixture_dir / "base.ifc"
    head_path = fixture_dir / "head.ifc"
    base_names = wall_names(base_path)
    head_names = wall_names(head_path)
    objects = oracle["objects"]

    def present(revision_names: list[str], keys: list[str], label: str) -> None:
        for key in keys:
            if key not in revision_names:
                fail(f"{label}: object {key!r} is omitted from the IFC")

    present(base_names, objects["repeated_failure"]["keys"], "base repeated_failure")
    present(head_names, objects["repeated_failure"]["keys"], "head repeated_failure")
    present(base_names, objects["removed"]["keys"], "base removed")
    if any(key in head_names for key in objects["removed"]["keys"]):
        fail("removed keys must not appear in head")
    present(head_names, objects["added"]["keys"], "head added")
    if any(key in base_names for key in objects["added"]["keys"]):
        fail("added keys must not appear in base")

    tracked = oracle["fixtureSummary"]["totalDistinctTrackedObjects"]
    expected_tracked = (
        len(objects["repeated_failure"]["keys"])
        + len(objects["removed"]["keys"])
        + len(objects["added"]["keys"])
        + len(objects["property_changed"]["keys"])
        + len(objects["shape_changed"]["keys"])
        + len(objects["moved"]["keys"])
        + len(objects["rotated"]["keys"])
        + len(objects["ambiguous_ids"]["keys"])
    )
    if tracked != 141 or tracked != expected_tracked:
        fail(f"totalDistinctTrackedObjects is {tracked}, expected 141")
    if objects["repeated_failure"]["count"] != 120:
        fail("repeated_failure.count must stay 120; the extra 15 IDS failures live in other groups")

    rotated = objects["rotated"]
    if rotated["intendedDiff"] != "moved":
        fail("rotated.intendedDiff must be moved (the physical change), not the engine's unchanged report")
    if rotated.get("engineLimitation", {}).get("modeldiff") != "unchanged":
        fail("rotated.engineLimitation.modeldiff must record the current origin-distance limitation")
    if objects["ambiguous_ids"].get("intendedCorrespondence") != "uncertain":
        fail("duplicate/empty GlobalIds must be intendedCorrespondence=uncertain")

    for revision, path in (("base", base_path), ("head", head_path)):
        failed, passed = evaluate_ids(path)
        summary = oracle["idsSummary"][revision]
        if len(failed) != summary["fail"] or summary["fail"] != 135:
            fail(f"{revision} IDS fail count is {len(failed)}, expected 135")
        if len(passed) != summary["pass"] or summary["pass"] != 3:
            fail(f"{revision} IDS pass count is {len(passed)}, expected 3")
        if len(failed) + len(passed) != summary["applicable"]:
            fail(f"{revision} applicable {len(failed)+len(passed)} != {summary['applicable']}")
        expect_set(f"{revision} failKeys", failed, summary["failKeys"])
        expect_set(f"{revision} passKeys", passed, summary["passKeys"])
        names = base_names if revision == "base" else head_names
        for group_name, group in objects.items():
            group_keys = group["ids"][revision]["keys"]
            if group_keys:
                expect_order(f"{revision} {group_name}", names, group_keys)
        for group_name, group in objects.items():
            ids_side = group["ids"][revision]
            if ids_side["outcome"] == "fail":
                for key in ids_side["keys"]:
                    if key not in failed:
                        fail(f"{revision} {group_name}: {key!r} should fail IDS")
            elif ids_side["outcome"] == "pass":
                for key in ids_side["keys"]:
                    if key not in passed:
                        fail(f"{revision} {group_name}: {key!r} should pass IDS")
            elif ids_side["outcome"] == "absent":
                for key in ids_side["keys"]:
                    fail(f"{revision} {group_name}: absent group must have empty keys, found {key!r}")

    print("ok - oracle matches IfcTester affected sets and category membership")


def load_generator():
    import importlib.util

    path = REPO_ROOT / "scripts" / "generate-demo-fixtures.py"
    spec = importlib.util.spec_from_file_location("generate_demo_fixtures", path)
    if spec is None or spec.loader is None:
        fail(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def prove_regen(seed: str) -> None:
    generator = load_generator()
    with tempfile.TemporaryDirectory() as first_dir, tempfile.TemporaryDirectory() as second_dir:
        first = Path(first_dir)
        second = Path(second_dir)
        generator.build(first, seed)
        generator.build(second, seed)
        if not filecmp.cmp(first / "oracle.json", second / "oracle.json", shallow=False):
            fail("two isolated regenerations produced different oracle.json")
        for revision in ("base.ifc", "head.ifc"):
            if wall_names(first / revision) != wall_names(second / revision):
                fail(f"two isolated regenerations produced different {revision} wall keys")
        baseline = DEFAULT_DIR / "oracle.json"
        if baseline.is_file() and not filecmp.cmp(first / "oracle.json", baseline, shallow=False):
            fail("isolated regeneration does not match the checked-in oracle.json")
    print("ok - two isolated regenerations match each other and the checked-in oracle")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixtures-dir", type=Path, default=DEFAULT_DIR)
    parser.add_argument("--prove-regen", action="store_true")
    parser.add_argument("--seed", default="modelshelf-demo-fixtures-v1")
    args = parser.parse_args()
    check_oracle(args.fixtures_dir)
    if args.prove_regen:
        prove_regen(args.seed)


if __name__ == "__main__":
    main()
