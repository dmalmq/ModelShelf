"""Placement translations must be metres, regardless of the project's length unit."""

from __future__ import annotations

from typing import TYPE_CHECKING

import ifcopenshell
import pytest

from ifc_worker.placement import object_placement
from tests.ifc_fixtures import (
    write_inch_conversion_translation,
    write_metre_translation,
    write_millimetre_translation,
    write_nested_millimetre_translation,
    write_rotated_millimetre_translation,
)

if TYPE_CHECKING:
    from pathlib import Path

TRANSLATION = (3, 7, 11)  # column 4 of the flattened 3x4


def _wall_placement(path: Path) -> list[float]:
    ifc_file = ifcopenshell.open(str(path))
    wall = ifc_file.by_type("IfcWall")[0]
    result = object_placement(wall, ifc_file)
    assert result is not None
    assert len(result) == 12
    return result


def test_metre_project_keeps_metre_translation(tmp_path: Path) -> None:
    matrix = _wall_placement(write_metre_translation(tmp_path / "m.ifc"))
    assert matrix[3] == pytest.approx(1.0)
    assert matrix[7] == pytest.approx(0.0)
    assert matrix[11] == pytest.approx(0.0)


def test_millimetre_translation_of_1000_is_one_metre(tmp_path: Path) -> None:
    matrix = _wall_placement(write_millimetre_translation(tmp_path / "mm.ifc"))
    assert matrix[3] == pytest.approx(1.0)


def test_nested_millimetre_translations_add_in_metres(tmp_path: Path) -> None:
    matrix = _wall_placement(write_nested_millimetre_translation(tmp_path / "nested.ifc"))
    assert matrix[3] == pytest.approx(2.0)


def test_inch_conversion_based_unit_translation(tmp_path: Path) -> None:
    matrix = _wall_placement(write_inch_conversion_translation(tmp_path / "inch.ifc"))
    assert matrix[3] == pytest.approx(0.3048)


def test_rotation_entries_are_not_scaled(tmp_path: Path) -> None:
    matrix = _wall_placement(write_rotated_millimetre_translation(tmp_path / "rot.ifc"))
    assert matrix[3] == pytest.approx(1.0)
    rotation = [matrix[i] for i in range(12) if i not in TRANSLATION]
    assert all(value in {0.0, 1.0, -1.0} or abs(value) < 1e-9 or abs(abs(value) - 1.0) < 1e-9 for value in rotation)
    assert max(abs(value) for value in rotation) == pytest.approx(1.0)
