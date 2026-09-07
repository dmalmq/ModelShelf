"""IfcTester `validate` against the demo pack fixtures and tiny applicability cases.

These are real subprocess runs of `ifc-worker --request`, not in-process mocks.
"""

from __future__ import annotations

import json
from pathlib import Path

import ifcopenshell

from ifc_worker.hashing import sha256_file
from ifc_worker.records import OutcomeRecord
from tests.conftest import REPO_ROOT, run_worker, write_request

DEMO = REPO_ROOT / "packs" / "demo"
FIXTURES = DEMO / "fixtures"
FIXTURES_IDS = DEMO / "fixtures.ids"
ORACLE = FIXTURES / "oracle.json"

IDS_NS = "http://standards.buildingsmart.org/IDS"


def _ids_document(specifications: str) -> str:
    return f"""<?xml version="1.0" encoding="utf-8"?>
<ids xmlns="{IDS_NS}" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://standards.buildingsmart.org/IDS http://standards.buildingsmart.org/IDS/1.0/ids.xsd">
  <info><title>test</title></info>
  <specifications>
{specifications}
  </specifications>
</ids>
"""


def _wall_spec(*, name: str, min_occurs: int, ifc_version: str = "IFC4") -> str:
    return f"""    <specification name="{name}" ifcVersion="{ifc_version}">
      <applicability minOccurs="{min_occurs}" maxOccurs="unbounded">
        <entity><name><simpleValue>IFCWALL</simpleValue></name></entity>
      </applicability>
      <requirements>
        <attribute>
          <name><simpleValue>Name</simpleValue></name>
          <value><simpleValue>Rated</simpleValue></value>
        </attribute>
      </requirements>
    </specification>
"""


def _empty_project(path: Path, *, schema: str = "IFC4") -> Path:
    ifc_file = ifcopenshell.file(schema=schema)
    origin = ifc_file.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0))
    axis = ifc_file.create_entity("IfcAxis2Placement3D", Location=origin)
    ctx = ifc_file.create_entity(
        "IfcGeometricRepresentationContext",
        ContextType="Model",
        CoordinateSpaceDimension=3,
        Precision=1e-5,
        WorldCoordinateSystem=axis,
    )
    metre = ifc_file.create_entity("IfcSIUnit", UnitType="LENGTHUNIT", Name="METRE")
    assignment = ifc_file.create_entity("IfcUnitAssignment", Units=[metre])
    ifc_file.create_entity(
        "IfcProject",
        GlobalId=ifcopenshell.guid.new(),
        Name="Fixture",
        RepresentationContexts=[ctx],
        UnitsInContext=assignment,
    )
    ifc_file.write(str(path))
    return path


def _project_with_named_wall(path: Path, wall_name: str) -> Path:
    ifc_file = ifcopenshell.file(schema="IFC4")
    origin = ifc_file.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0))
    axis = ifc_file.create_entity("IfcAxis2Placement3D", Location=origin)
    ctx = ifc_file.create_entity(
        "IfcGeometricRepresentationContext",
        ContextType="Model",
        CoordinateSpaceDimension=3,
        Precision=1e-5,
        WorldCoordinateSystem=axis,
    )
    metre = ifc_file.create_entity("IfcSIUnit", UnitType="LENGTHUNIT", Name="METRE")
    assignment = ifc_file.create_entity("IfcUnitAssignment", Units=[metre])
    ifc_file.create_entity(
        "IfcProject",
        GlobalId=ifcopenshell.guid.new(),
        Name="Fixture",
        RepresentationContexts=[ctx],
        UnitsInContext=assignment,
    )
    point = ifc_file.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0))
    place_axis = ifc_file.create_entity("IfcAxis2Placement3D", Location=point)
    placement = ifc_file.create_entity("IfcLocalPlacement", RelativePlacement=place_axis)
    ifc_file.create_entity(
        "IfcWall",
        GlobalId=ifcopenshell.guid.new(),
        Name=wall_name,
        ObjectPlacement=placement,
    )
    ifc_file.write(str(path))
    return path


def _run_validate(  # noqa: PLR0913
    tmp_path: Path,
    *,
    model_path: Path,
    ids_path: Path,
    job_id: str,
    revision_id: str,
    specification_ids: list[str] | None = None,
) -> tuple[int, str, list[dict], dict | None]:
    out = tmp_path / job_id / "out"
    out.mkdir(parents=True)
    request_path = write_request(
        tmp_path / job_id,
        jobId=job_id,
        operation="validate",
        model={"path": str(model_path), "sha256": sha256_file(model_path), "revisionId": revision_id},
        ids={"path": str(ids_path), "sha256": sha256_file(ids_path), "specificationIds": specification_ids},
        outputDir=str(out),
        settings={"geometry": False},
    )
    run = run_worker(request_path)
    outcomes: list[dict] = []
    manifest = None
    if run.result_event is not None:
        manifest = json.loads(Path(run.result_event["manifest"]["path"]).read_text(encoding="utf-8"))
        outcomes_path = Path(manifest["artifacts"]["outcomes"]["path"])
        outcomes = [
            json.loads(line) for line in outcomes_path.read_text(encoding="utf-8").splitlines() if line
        ]
        for row in outcomes:
            OutcomeRecord.model_validate(row)
    return run.returncode, run.stderr, outcomes, manifest


def test_oracle_matches_selected_rule_on_base_and_head(tmp_path: Path) -> None:
    oracle = json.loads(ORACLE.read_text(encoding="utf-8"))
    for revision in ("base", "head"):
        code, stderr, outcomes, manifest = _run_validate(
            tmp_path,
            model_path=FIXTURES / f"{revision}.ifc",
            ids_path=FIXTURES_IDS,
            job_id=f"oracle-{revision}",
            revision_id=f"rev-{revision}",
        )
        assert code == 0, stderr
        assert manifest is not None
        assert manifest["operation"] == "validate"
        assert len(outcomes) == 1
        row = outcomes[0]
        summary = oracle["idsSummary"][revision]
        assert row["status"] == "failed"
        assert row["applicableCount"] == summary["applicable"]
        assert row["failedCount"] == summary["fail"]
        assert row["passedCount"] == summary["pass"]
        assert row["specificationName"] == oracle["idsCheck"]
        got_fail = sorted(
            ifcopenshell.open(str(FIXTURES / f"{revision}.ifc")).by_id(item["expressId"]).Name
            for item in row["failures"]
        )
        assert set(got_fail) == set(summary["failKeys"])
        assert len(got_fail) == len(summary["failKeys"])


def test_malformed_ids_fails_the_job(tmp_path: Path) -> None:
    model = _empty_project(tmp_path / "empty.ifc")
    ids_path = tmp_path / "bad.ids"
    ids_path.write_text("<not-ids/>", encoding="utf-8")
    code, stderr, outcomes, manifest = _run_validate(
        tmp_path,
        model_path=model,
        ids_path=ids_path,
        job_id="bad-ids",
        revision_id="rev-bad",
    )
    assert code != 0
    assert manifest is None
    assert outcomes == []
    assert "ids document is not valid" in stderr


def test_unknown_facet_cannot_quietly_pass(tmp_path: Path) -> None:
    model = _project_with_named_wall(tmp_path / "wall.ifc", "Rated")
    ids_path = tmp_path / "unknown.ids"
    ids_path.write_text(
        _ids_document(
            """    <specification name="Unknown facet" ifcVersion="IFC4">
      <applicability minOccurs="0" maxOccurs="unbounded">
        <entity><name><simpleValue>IFCWALL</simpleValue></name></entity>
      </applicability>
      <requirements>
        <notAFacet><name><simpleValue>X</simpleValue></name></notAFacet>
      </requirements>
    </specification>
"""
        ),
        encoding="utf-8",
    )
    code, stderr, _outcomes, manifest = _run_validate(
        tmp_path,
        model_path=model,
        ids_path=ids_path,
        job_id="unknown-facet",
        revision_id="rev-unknown",
    )
    assert code != 0
    assert manifest is None
    assert "ids document is not valid" in stderr


def test_required_no_match_fails(tmp_path: Path) -> None:
    model = _empty_project(tmp_path / "empty.ifc")
    ids_path = tmp_path / "required.ids"
    ids_path.write_text(_ids_document(_wall_spec(name="Required wall", min_occurs=1)), encoding="utf-8")
    code, stderr, outcomes, _manifest = _run_validate(
        tmp_path,
        model_path=model,
        ids_path=ids_path,
        job_id="required-none",
        revision_id="rev-required",
    )
    assert code == 0, stderr
    assert len(outcomes) == 1
    assert outcomes[0]["status"] == "failed"
    assert outcomes[0]["applicableCount"] == 0
    assert outcomes[0]["failedCount"] == 0


def test_optional_no_match_is_not_applicable(tmp_path: Path) -> None:
    model = _empty_project(tmp_path / "empty.ifc")
    ids_path = tmp_path / "optional.ids"
    ids_path.write_text(_ids_document(_wall_spec(name="Optional wall", min_occurs=0)), encoding="utf-8")
    code, stderr, outcomes, _manifest = _run_validate(
        tmp_path,
        model_path=model,
        ids_path=ids_path,
        job_id="optional-none",
        revision_id="rev-optional",
    )
    assert code == 0, stderr
    assert len(outcomes) == 1
    assert outcomes[0]["status"] == "not_applicable"
    assert outcomes[0]["applicableCount"] == 0


def test_schema_mismatch_is_incomplete(tmp_path: Path) -> None:
    model = _empty_project(tmp_path / "ifc2x3.ifc", schema="IFC2X3")
    ids_path = tmp_path / "ifc4-only.ids"
    ids_path.write_text(
        _ids_document(_wall_spec(name="IFC4 only walls", min_occurs=1, ifc_version="IFC4")),
        encoding="utf-8",
    )
    code, stderr, outcomes, manifest = _run_validate(
        tmp_path,
        model_path=model,
        ids_path=ids_path,
        job_id="schema-skip",
        revision_id="rev-schema",
    )
    assert code == 0, stderr
    assert outcomes[0]["status"] == "incomplete"
    assert outcomes[0]["applicableCount"] == 0
    assert any("unsupported" in item or "schema" in item.lower() for item in (manifest or {}).get("diagnostics", []))


def test_unknown_specification_id_fails_the_job(tmp_path: Path) -> None:
    model = _empty_project(tmp_path / "empty.ifc")
    ids_path = tmp_path / "named.ids"
    ids_path.write_text(_ids_document(_wall_spec(name="Optional wall", min_occurs=0)), encoding="utf-8")
    code, stderr, outcomes, manifest = _run_validate(
        tmp_path,
        model_path=model,
        ids_path=ids_path,
        job_id="unknown-spec",
        revision_id="rev-spec",
        specification_ids=["does-not-exist"],
    )
    assert code != 0
    assert manifest is None
    assert outcomes == []
    assert "unknown specification id" in stderr


def test_two_files_evaluate_independently(tmp_path: Path) -> None:
    first = _project_with_named_wall(tmp_path / "a.ifc", "Wall-A")
    second = _project_with_named_wall(tmp_path / "b.ifc", "Wall-B")
    ids_path = tmp_path / "name.ids"
    ids_path.write_text(_ids_document(_wall_spec(name="Wall is named Rated", min_occurs=1)), encoding="utf-8")
    results = []
    for label, model in (("a", first), ("b", second)):
        code, stderr, outcomes, _manifest = _run_validate(
            tmp_path,
            model_path=model,
            ids_path=ids_path,
            job_id=f"file-{label}",
            revision_id=f"rev-{label}",
        )
        assert code == 0, stderr
        assert outcomes[0]["status"] == "failed"
        assert outcomes[0]["failedCount"] == 1
        results.append(outcomes[0]["failures"][0]["expressId"])
    assert results[0] > 0 and results[1] > 0


def test_ids_hash_mismatch_fails_the_job(tmp_path: Path) -> None:
    model = _empty_project(tmp_path / "empty.ifc")
    ids_path = tmp_path / "ok.ids"
    ids_path.write_text(_ids_document(_wall_spec(name="Optional wall", min_occurs=0)), encoding="utf-8")
    out = tmp_path / "hash" / "out"
    out.mkdir(parents=True)
    request_path = write_request(
        tmp_path / "hash",
        jobId="hash-mismatch",
        operation="validate",
        model={"path": str(model), "sha256": sha256_file(model), "revisionId": "rev-hash"},
        ids={"path": str(ids_path), "sha256": "0" * 64, "specificationIds": None},
        outputDir=str(out),
        settings={"geometry": False},
    )
    run = run_worker(request_path)
    assert run.returncode != 0
    assert run.result_event is None
    assert "ids hash mismatch" in run.stderr
