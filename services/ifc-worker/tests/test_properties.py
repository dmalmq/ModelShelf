"""Ordered list values and type-inherited properties."""

from __future__ import annotations

from typing import TYPE_CHECKING

import ifcopenshell

from model_contracts import Property

from ifc_worker.properties import extract_properties
from tests.conftest import REPO_ROOT
from tests.ifc_fixtures import write_list_and_inherited_properties

if TYPE_CHECKING:
    from pathlib import Path


def test_ifc2x3_type_properties_are_inherited(tmp_path: Path) -> None:
    from tests.ifc_fixtures import write_ifc2x3_type_properties

    path = write_ifc2x3_type_properties(tmp_path / "ifc2x3-type.ifc")
    ifc_file = ifcopenshell.open(str(path))
    wall = ifc_file.by_type("IfcWall")[0]
    diagnostics: list[str] = []
    records = extract_properties(wall, ifc_file, diagnostics)
    by_name = {record.name: record for record in records}
    load = by_name["LoadBearing"]
    assert load.values[0].value is True
    assert load.origin.value == "type"
    assert not diagnostics


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


def test_null_quantity_length_extracts_empty_values(tmp_path: Path) -> None:
    from tests.ifc_fixtures import write_metre_translation

    path = write_metre_translation(tmp_path / "qty.ifc")
    ifc_probe = ifcopenshell.open(str(path))
    wall_id = ifc_probe.by_type("IfcWall")[0].id()
    text = path.read_text(encoding="utf-8")
    insert = (
        f"#900=IFCQUANTITYLENGTH('Length',$,$,$,$);\n"
        f"#901=IFCELEMENTQUANTITY('2xh2pnQLTRmxBmJEcDoABB',$,'Qto_WallBaseQuantities',$,$,(#900));\n"
        f"#902=IFCRELDEFINESBYPROPERTIES('3vLzsfeBzQEP4SO4CnB2Zu',$,$,$,(#{wall_id}),#901);\n"
    )
    idx = text.rfind("ENDSEC;")
    path.write_text(text[:idx] + insert + text[idx:], encoding="utf-8")
    ifc_file = ifcopenshell.open(str(path))
    wall = ifc_file.by_type("IfcWall")[0]
    diagnostics: list[str] = []
    records = extract_properties(wall, ifc_file, diagnostics)
    length = next(record for record in records if record.name == "Length")
    assert length.values == []
    assert not diagnostics


def test_japanese_pset_and_property_names_round_trip_utf8() -> None:
    import json

    fixtures = REPO_ROOT / "packs" / "demo" / "fixtures"
    row = json.loads((fixtures / "oracle.json").read_text(encoding="utf-8"))["proofs"]["japanese_names"]
    ifc_file = ifcopenshell.open(str(fixtures / row["ifc"]))
    door = next(product for product in ifc_file.by_type("IfcDoor") if product.Name == row["objectKey"])
    diagnostics: list[str] = []
    records = extract_properties(door, ifc_file, diagnostics)
    prop = next(record for record in records if record.name == row["name"])
    raw = prop.model_dump_json().encode("utf-8")
    parsed = Property.model_validate_json(raw)
    assert parsed.pset == row["pset"] == "Rebro_PartsData"
    assert parsed.name == row["name"] == "用途"
    assert parsed.pset.encode("utf-8") == row["pset"].encode("utf-8")
    assert parsed.name.encode("utf-8") == row["name"].encode("utf-8")
    assert row["name"].encode("utf-8") in raw
    assert parsed.values[0].value == row["value"] == "給水"
