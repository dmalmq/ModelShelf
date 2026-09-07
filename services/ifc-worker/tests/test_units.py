"""Per-property unit/dimension resolution against real entities pulled from the
sample IFC (skipped where it is not locally available; see conftest.py) — the
sample already exercises length/area/volume measures plus a wide variety of
non-dimensioned ones (boolean, label, thermal, angle, ...), so this does not
need a hand-built synthetic file.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import ifcopenshell
import pytest

from ifc_worker.units import resolve_measure_unit

if TYPE_CHECKING:
    from pathlib import Path


@pytest.fixture
def ifc_file(real_sample_path: Path) -> ifcopenshell.file:
    return ifcopenshell.open(str(real_sample_path))


def _first_single_value(ifc_file: ifcopenshell.file, measure_type: str) -> ifcopenshell.entity_instance:
    for prop in ifc_file.by_type("IfcPropertySingleValue"):
        if prop.NominalValue is not None and prop.NominalValue.is_a() == measure_type:
            return prop
    pytest.fail(f"sample has no IfcPropertySingleValue with NominalValue of type {measure_type}")


@pytest.mark.parametrize(
    ("measure_type", "expected_dimension", "expected_unit"),
    [
        ("IfcPositiveLengthMeasure", "length", "m"),
        ("IfcAreaMeasure", "area", "m2"),
    ],
)
def test_length_and_area_measures_resolve_to_si(
    ifc_file: ifcopenshell.file,
    measure_type: str,
    expected_dimension: str,
    expected_unit: str,
) -> None:
    prop = _first_single_value(ifc_file, measure_type)
    resolved = resolve_measure_unit(measure_type, prop, ifc_file)
    assert resolved.dimension == expected_dimension
    assert resolved.original_unit == expected_unit
    assert resolved.si_multiplier == pytest.approx(1.0)  # sample project is already in metres


@pytest.mark.parametrize(
    "measure_type",
    [
        "IfcBoolean",
        "IfcLabel",
        "IfcInteger",
        "IfcReal",
        "IfcPlaneAngleMeasure",
        "IfcThermalTransmittanceMeasure",
        "IfcThermalConductivityMeasure",
        "IfcMassDensityMeasure",
        "IfcThermodynamicTemperatureMeasure",
    ],
)
def test_non_length_area_volume_measures_stay_undimensioned(
    ifc_file: ifcopenshell.file,
    measure_type: str,
) -> None:
    prop = _first_single_value(ifc_file, measure_type)
    resolved = resolve_measure_unit(measure_type, prop, ifc_file)
    assert resolved.dimension is None
    assert resolved.si_multiplier is None


def test_volume_quantity_resolves_to_si(ifc_file: ifcopenshell.file) -> None:
    quantity = ifc_file.by_type("IfcQuantityVolume")[0]
    resolved = resolve_measure_unit("IfcVolumeMeasure", quantity, ifc_file)
    assert resolved.dimension == "volume"
    assert resolved.original_unit == "m3"
    assert resolved.si_multiplier == pytest.approx(1.0)


def test_explicit_metre_property_in_millimetre_project_is_not_scaled_as_mm(tmp_path: Path) -> None:
    from tests.ifc_fixtures import write_explicit_metre_property_in_millimetre_project

    path = write_explicit_metre_property_in_millimetre_project(tmp_path / "explicit-m.ifc")
    ifc_file = ifcopenshell.open(str(path))
    prop = ifc_file.by_type("IfcPropertySingleValue")[0]
    resolved = resolve_measure_unit(prop.NominalValue.is_a(), prop, ifc_file)
    assert resolved.dimension == "length"
    assert resolved.original_unit == "m"
    assert resolved.si_multiplier == pytest.approx(1.0)
    assert prop.NominalValue.wrappedValue * resolved.si_multiplier == pytest.approx(2.0)


def test_context_dependent_unit_keeps_raw_value_without_invented_si(tmp_path: Path) -> None:
    from tests.ifc_fixtures import write_context_dependent_unit_property

    path = write_context_dependent_unit_property(tmp_path / "mystery.ifc")
    ifc_file = ifcopenshell.open(str(path))
    prop = ifc_file.by_type("IfcPropertySingleValue")[0]
    resolved = resolve_measure_unit(prop.NominalValue.is_a(), prop, ifc_file)
    assert resolved.si_multiplier is None
    assert resolved.dimension is None
    assert resolved.original_unit is not None
    assert "mystery" in resolved.original_unit.lower()


def test_milli_prefix_on_area_and_volume_is_raised_to_dimension(tmp_path: Path) -> None:
    from tests.ifc_fixtures import write_prefixed_square_and_cubic_millimetres

    path = write_prefixed_square_and_cubic_millimetres(tmp_path / "mm2-mm3.ifc")
    ifc_file = ifcopenshell.open(str(path))
    by_name = {prop.Name: prop for prop in ifc_file.by_type("IfcPropertySingleValue")}
    area = resolve_measure_unit(by_name["NetArea"].NominalValue.is_a(), by_name["NetArea"], ifc_file)
    volume = resolve_measure_unit(
        by_name["NetVolume"].NominalValue.is_a(), by_name["NetVolume"], ifc_file
    )
    assert area.dimension == "area"
    assert area.si_multiplier == pytest.approx(1e-6)
    assert by_name["NetArea"].NominalValue.wrappedValue * area.si_multiplier == pytest.approx(1.0)
    assert volume.dimension == "volume"
    assert volume.si_multiplier == pytest.approx(1e-9)
    assert by_name["NetVolume"].NominalValue.wrappedValue * volume.si_multiplier == pytest.approx(1.0)


def test_explicit_square_and_cubic_metres_in_millimetre_project(tmp_path: Path) -> None:
    from tests.ifc_fixtures import write_explicit_area_and_volume

    path = write_explicit_area_and_volume(tmp_path / "area-vol.ifc")
    ifc_file = ifcopenshell.open(str(path))
    by_name = {prop.Name: prop for prop in ifc_file.by_type("IfcPropertySingleValue")}
    area = resolve_measure_unit(by_name["NetArea"].NominalValue.is_a(), by_name["NetArea"], ifc_file)
    volume = resolve_measure_unit(by_name["NetVolume"].NominalValue.is_a(), by_name["NetVolume"], ifc_file)
    assert area.dimension == "area"
    assert area.si_multiplier == pytest.approx(1.0)
    assert by_name["NetArea"].NominalValue.wrappedValue * area.si_multiplier == pytest.approx(4.0)
    assert volume.dimension == "volume"
    assert volume.si_multiplier == pytest.approx(1.0)
    assert by_name["NetVolume"].NominalValue.wrappedValue * volume.si_multiplier == pytest.approx(8.0)
