"""Ordered list values and type-inherited properties."""

from __future__ import annotations

from typing import TYPE_CHECKING

import ifcopenshell

from ifc_worker.properties import extract_properties
from tests.ifc_fixtures import write_list_and_inherited_properties

if TYPE_CHECKING:
    from pathlib import Path


def test_list_values_keep_authoring_order_and_type_properties_are_inherited(tmp_path: Path) -> None:
    path = write_list_and_inherited_properties(tmp_path / "inherit.ifc")
    ifc_file = ifcopenshell.open(str(path))
    wall = ifc_file.by_type("IfcWall")[0]
    diagnostics: list[str] = []
    records = extract_properties(wall, ifc_file, diagnostics)
    by_name = {record.name: record for record in records}

    layers = by_name["Layers"]
    assert layers.ordered is True
    assert [item.value for item in layers.values] == ["outer", "inner"]
    assert layers.origin.value == "occurrence"

    rating = by_name["FireRating"]
    assert rating.values[0].value == "occ-rating"
    assert rating.origin.value == "occurrence"

    load = by_name["LoadBearing"]
    assert load.values[0].value is True
    assert load.origin.value == "type"
    assert not diagnostics
