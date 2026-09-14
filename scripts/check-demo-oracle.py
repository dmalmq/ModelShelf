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
import tempfile
from pathlib import Path

from demo_oracle import (
    IFC2X3_WALL_NAME,
    UNSUPPORTED_OBJECT_KEY,
    WALL_GROUPS,
    WALL_OUTCOMES,
    check_ids_outcome,
    execute_proof,
    fail,
    parse_oracle,
    wall_names,
)
from demo_oracle import evaluate_ids as live_ids

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DIR = REPO_ROOT / "packs" / "demo" / "fixtures"


def load_oracle(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


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
    oracle = parse_oracle(load_oracle(fixture_dir / "oracle.json"))
    objects = oracle.objects
    base_path = fixture_dir / "base.ifc"
    head_path = fixture_dir / "head.ifc"
    base_names = wall_names(base_path)
    head_names = wall_names(head_path)

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

    rotated = objects["rotated"]
    if rotated["intendedDiff"] != "moved":
        fail("rotated.intendedDiff must be moved (the physical change)")
    if "engineLimitation" in rotated:
        fail("rotated must not carry engineLimitation; in-place rotation is moved")
    if objects["ambiguous_ids"].get("intendedCorrespondence") != "uncertain":
        fail("duplicate/empty GlobalIds must be intendedCorrespondence=uncertain")

    for revision, path in (("base", base_path), ("head", head_path)):
        failed, passed = live_ids(path)
        summary = oracle.ids_summary[revision]
        if len(failed) != summary["fail"] or summary["fail"] != 135:
            fail(f"{revision} IDS fail count is {len(failed)}, expected 135")
        if len(passed) != summary["pass"] or summary["pass"] != 3:
            fail(f"{revision} IDS pass count is {len(passed)}, expected 3")
        if len(failed) + len(passed) != summary["applicable"]:
            fail(f"{revision} applicable {len(failed)+len(passed)} != {summary['applicable']}")
        expect_set(f"{revision} failKeys", failed, summary["failKeys"])
        expect_set(f"{revision} passKeys", passed, summary["passKeys"])
        names = base_names if revision == "base" else head_names
        for group_name in WALL_GROUPS:
            group = objects[group_name]
            group_keys = group["ids"][revision]["keys"]
            if group_keys:
                expect_order(f"{revision} {group_name}", names, group_keys)
            ids_side = group["ids"][revision]
            outcome = ids_side["outcome"]
            if outcome not in WALL_OUTCOMES:
                fail(f"{revision} {group_name}: unknown ids.outcome {outcome!r}")
            check_ids_outcome(
                outcome,
                ids_side["keys"],
                failed=failed,
                passed=passed,
                label=f"{revision} {group_name}",
            )

    for proof_id, row in oracle.proofs.items():
        if "oracle" in row.expected.projectors:
            execute_proof(fixture_dir, oracle, row)
        elif proof_id not in ("empty_catalog", "japanese_names"):
            fail(f"proofs.{proof_id} has no oracle projector and is not a shape-only row")

    print("ok - oracle matches IfcTester affected sets, category membership, and proofs")


def load_generator():
    import importlib.util
    import sys

    path = REPO_ROOT / "scripts" / "generate-demo-fixtures.py"
    spec = importlib.util.spec_from_file_location("generate_demo_fixtures", path)
    if spec is None or spec.loader is None:
        fail(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def prove_regen(seed: str) -> None:
    import ifcopenshell

    generator = load_generator()
    with tempfile.TemporaryDirectory() as first_dir, tempfile.TemporaryDirectory() as second_dir:
        first = Path(first_dir)
        second = Path(second_dir)
        generator.build(first, seed)
        generator.build(second, seed)
        if not filecmp.cmp(first / "oracle.json", second / "oracle.json", shallow=False):
            fail("two isolated regenerations produced different oracle.json")
        for revision in ("base.ifc", "head.ifc", "foot.ifc"):
            if wall_names(first / revision) != wall_names(second / revision):
                fail(f"two isolated regenerations produced different {revision} wall keys")
        for isolated in (first, second):
            doors = [
                door.Name
                for door in ifcopenshell.open(str(isolated / "unsupported.ifc")).by_type("IfcDoor")
            ]
            if doors != [UNSUPPORTED_OBJECT_KEY]:
                fail(f"unsupported.ifc door names {doors!r}")
            walls = wall_names(isolated / "ifc2x3-wall.ifc")
            if walls != [IFC2X3_WALL_NAME]:
                fail(f"ifc2x3-wall.ifc wall names {walls!r}")
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
