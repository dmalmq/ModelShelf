"""Ticket 32: surgical Snowdon grade rewrites keep applicability and flip requirement outcomes."""

from __future__ import annotations

import hashlib
import importlib.util
import sys
from pathlib import Path

import pytest

from ifc_worker.hashing import sha256_file
from ifc_worker.records import OutcomeRecord
from tests.conftest import REPO_ROOT
from tests.test_demo_packs import SNOWDON_IDS, SNOWDON_IFC, _run_validate

GENERATOR = REPO_ROOT / "scripts" / "generate-snowdon-variants.py"


def _load_generator() -> object:
    spec = importlib.util.spec_from_file_location("generate_snowdon_variants", GENERATOR)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_step_null_rewrites_nominal_value_only() -> None:
    gen = _load_generator()
    line = "#11=IFCPROPERTYSINGLEVALUE('FireRating',$,IFCLABEL('2 HR'),$);"
    parsed = gen.parse_entity_line(line)
    assert parsed is not None
    express_id, ifc_type, args = parsed
    rewritten = gen.format_entity(express_id, ifc_type, gen.apply_null(args, ifc_type, "$"))
    assert rewritten == "#11=IFCPROPERTYSINGLEVALUE('FireRating',$,$,$);"


def test_step_quantity_null_and_pset_tuple_append() -> None:
    gen = _load_generator()
    line = "#13191=IFCQUANTITYLENGTH('Length',$,$,18.652476024748058,$);"
    parsed = gen.parse_entity_line(line)
    assert parsed is not None
    express_id, ifc_type, args = parsed
    rewritten = gen.format_entity(express_id, ifc_type, gen.apply_null(args, ifc_type, "$"))
    assert rewritten == "#13191=IFCQUANTITYLENGTH('Length',$,$,$,$);"
    assert gen.tuple_append("(#13199,#13203)", 900001) == "(#13199,#13203,#900001)"
    assert gen.tuple_append("$", 7) == "(#7)"
    assert gen.tuple_remove("(#13191,#13274,#13595)", 13274) == "(#13191,#13595)"


def _structure() -> Path:
    path = SNOWDON_IFC["structure"]
    if not path.is_file():
        pytest.skip(f"Snowdon IFC not staged: {path}")
    return path


def test_structure_none_fails_mutable_specs_and_all_matches_source(tmp_path: Path) -> None:
    model = _structure()
    gen = _load_generator()
    out = tmp_path / "out"
    oracle = gen.generate(model.parent, out, ["structure"], write_oracle=False)
    none_path = out / "snowdon-towers-none-structure.ifc"
    all_path = out / "snowdon-towers-all-structure.ifc"
    source_bytes = model.read_bytes()
    none_bytes = none_path.read_bytes()
    all_bytes = all_path.read_bytes()
    assert hashlib.sha256(all_bytes).hexdigest() == hashlib.sha256(source_bytes).hexdigest()
    assert hashlib.sha256(none_bytes).hexdigest() != hashlib.sha256(source_bytes).hexdigest()
    again = gen.generate(model.parent, tmp_path / "out2", ["structure"], write_oracle=False)
    assert again["grades"]["none"]["structure"]["sha256"] == oracle["grades"]["none"]["structure"]["sha256"]
    assert again["grades"]["all"]["structure"]["sha256"] == oracle["grades"]["all"]["structure"]["sha256"]

    specs = ["Beam records its span", "Beam declares load-bearing", "Member declares whether it is external"]
    code, stderr, outcomes, _manifest = _run_validate(
        tmp_path,
        model_path=none_path,
        ids_path=SNOWDON_IDS,
        job_id="snowdon-struct-none",
        revision_id="rev-snowdon-struct-none",
        specification_ids=specs,
    )
    assert code == 0, stderr
    by_name = {row["specificationName"]: row for row in outcomes}
    span = by_name["Beam records its span"]
    bearing = by_name["Beam declares load-bearing"]
    member = by_name["Member declares whether it is external"]
    assert span["status"] == "failed"
    assert span["applicableCount"] == 917
    assert span["passedCount"] == 0
    assert span["failedCount"] == 917
    assert bearing["status"] == "failed"
    assert bearing["applicableCount"] == 917
    assert bearing["passedCount"] == 0
    assert member["status"] == "failed"
    assert member["applicableCount"] == 25
    assert member["passedCount"] == 0

    code, stderr, outcomes, _manifest = _run_validate(
        tmp_path,
        model_path=all_path,
        ids_path=SNOWDON_IDS,
        job_id="snowdon-struct-all",
        revision_id="rev-snowdon-struct-all",
        specification_ids=specs,
    )
    assert code == 0, stderr
    by_name = {row["specificationName"]: row for row in outcomes}
    assert by_name["Beam records its span"]["status"] == "passed"
    assert by_name["Beam records its span"]["applicableCount"] == 917
    assert by_name["Beam declares load-bearing"]["failedCount"] == 0
    assert by_name["Member declares whether it is external"]["applicableCount"] == 25
    assert by_name["Member declares whether it is external"]["failedCount"] == 0
    for row in outcomes:
        OutcomeRecord.model_validate(row)
    assert sha256_file(all_path) == sha256_file(model)
