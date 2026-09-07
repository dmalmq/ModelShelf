"""Render instances carry metre placement so geometry can be positioned without semantics."""

from __future__ import annotations

import json
from pathlib import Path

import ifcopenshell
import ifcopenshell.geom as ifc_geom
import pytest

from ifc_worker.hashing import sha256_file
from ifc_worker.units import length_scale_to_metre
from tests.conftest import run_worker, write_request
from tests.ifc_fixtures import write_translated_rotated_millimetre_box


def _apply_placement(matrix: list[float], x: float, y: float, z: float) -> tuple[float, float, float]:
    return (
        matrix[0] * x + matrix[1] * y + matrix[2] * z + matrix[3],
        matrix[4] * x + matrix[5] * y + matrix[6] * z + matrix[7],
        matrix[8] * x + matrix[9] * y + matrix[10] * z + matrix[11],
    )


def test_translated_rotated_box_positions_from_render_artifacts_alone(tmp_path: Path) -> None:
    path = write_translated_rotated_millimetre_box(tmp_path / "box.ifc")
    request_path = write_request(
        tmp_path,
        jobId="render-placement",
        model={"path": str(path), "sha256": sha256_file(path), "revisionId": "rev-box"},
        outputDir=str(tmp_path / "out"),
    )
    run = run_worker(request_path)
    assert run.returncode == 0, run.stderr
    result = run.result_event
    assert result is not None
    manifest = json.loads(Path(result["manifest"]["path"]).read_text(encoding="utf-8"))

    render_path = Path(manifest["artifacts"]["renderManifest"]["path"])
    geometry_path = Path(manifest["artifacts"]["geometry"]["path"])
    semantic_path = Path(manifest["artifacts"]["semantic"]["path"])
    assert semantic_path.is_file()

    render = json.loads(render_path.read_text(encoding="utf-8"))
    chunks = [json.loads(line) for line in geometry_path.read_text(encoding="utf-8").splitlines() if line]
    wall_chunk = next(chunk for chunk in chunks if chunk["status"] == "available")
    instance = next(item for item in render["instances"] if item["instanceId"] == wall_chunk["instanceId"])
    placement = instance["placement"]
    assert len(placement) == 12
    assert placement[3] == pytest.approx(1.0)

    verts = wall_chunk["vertices"]
    assert verts and len(verts) >= 3
    local = (verts[0], verts[1], verts[2])
    positioned = _apply_placement(placement, *local)

    ifc_file = ifcopenshell.open(str(path))
    wall = ifc_file.by_type("IfcWall")[0]
    settings = ifc_geom.settings()
    settings.set("use-world-coords", True)  # noqa: FBT003
    shape = ifc_geom.create_shape(settings, wall)
    world = list(shape.geometry.verts)
    scale = length_scale_to_metre(ifc_file)
    assert scale is not None
    world_m = (world[0] * scale, world[1] * scale, world[2] * scale)
    world_as_is = (world[0], world[1], world[2])
    metres = (
        world_as_is
        if abs(world_as_is[0] - positioned[0]) < abs(world_m[0] - positioned[0])
        else world_m
    )
    assert metres[0] == pytest.approx(positioned[0], abs=1e-6)
    assert metres[1] == pytest.approx(positioned[1], abs=1e-6)
    assert metres[2] == pytest.approx(positioned[2], abs=1e-6)
