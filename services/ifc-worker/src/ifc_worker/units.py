"""Per-property unit resolution and SI normalization, per docs/contracts/worker-v1.md:
dimension is length/area/volume or null, and an unsupported unit retains the raw
value with null SI/dimension rather than a fabricated conversion.

Conversion uses the property's own unit when one is set, and the project unit
only as a fallback. IfcOpenShell's unit-resolution helpers (`get_property_unit`,
`get_unit_symbol`) are only reliable for the small set of measure types that
carry a real SI or conversion-based unit; calling them on the many
non-dimensioned measure types IFC defines (boolean, label, thermal, mass
density, ...) is both unnecessary (the contract does not ask for an SI value
there) and, for some derived-unit types, crashes inside IfcOpenShell itself.
So unit resolution below only runs for the three dimensions the contract
actually normalizes.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, NamedTuple

import ifcopenshell.util.unit as util_unit

if TYPE_CHECKING:
    import ifcopenshell

    from ifc_worker.records import Dimension

_DIMENSION_BY_UNIT_TYPE: dict[str, Dimension] = {
    "LENGTHUNIT": "length",
    "AREAUNIT": "area",
    "VOLUMEUNIT": "volume",
}


class ResolvedUnit(NamedTuple):
    original_unit: str | None
    si_multiplier: float | None
    dimension: Dimension


def length_scale_to_metre(ifc_file: ifcopenshell.file) -> float | None:
    """Multiplier that converts a length in project units into metres.

    None when the project has no interpretable length unit, so callers can
    refuse to emit a metre placement rather than guess.
    """
    projects = ifc_file.by_type("IfcProject")
    if not projects:
        return None
    assignment = projects[0].UnitsInContext
    if assignment is None:
        return None
    for unit in assignment.Units or ():
        if getattr(unit, "UnitType", None) == "LENGTHUNIT":
            return si_multiplier_for_unit(unit)
    return None


def _si_prefix_exponent(unit: ifcopenshell.entity_instance) -> int:
    """Milli on a square unit is 1e-3 squared, not 1e-3 once."""
    unit_type = getattr(unit, "UnitType", None)
    if unit_type == "AREAUNIT":
        return 2
    if unit_type == "VOLUMEUNIT":
        return 3
    return 1


def si_multiplier_for_unit(unit: ifcopenshell.entity_instance | None) -> float | None:
    """Scale that converts a value in `unit` into SI (m, m2, or m3).

    Conversion-based units are unfolded; SI prefixes are applied; context-
    dependent and other uninterpretable units return None.
    """
    if unit is None:
        return None
    scale = 1.0
    current = unit
    if current.is_a("IfcContextDependentUnit") or current.is_a("IfcDerivedUnit"):
        return None
    try:
        while current.is_a("IfcConversionBasedUnit"):
            conversion_factor = current.ConversionFactor
            if conversion_factor is None:
                return None
            scale *= float(conversion_factor.ValueComponent.wrappedValue)
            current = conversion_factor.UnitComponent
        if current.is_a("IfcSIUnit"):
            prefix = float(util_unit.get_prefix_multiplier(current.Prefix))
            return scale * (prefix ** _si_prefix_exponent(current))
    except Exception:  # noqa: BLE001 - fall back to unsupported rather than invent a scale
        return None
    return None


def _unit_label(unit: ifcopenshell.entity_instance) -> str | None:
    try:
        symbol = util_unit.get_unit_symbol(unit)
    except Exception:  # noqa: BLE001 - symbol helpers crash on some unit forms
        symbol = None
    if symbol and symbol != "?":
        return str(symbol)
    name = getattr(unit, "Name", None)
    return str(name) if name else None


def resolve_measure_unit(
    measure_type: str,
    entity: ifcopenshell.entity_instance,
    ifc_file: ifcopenshell.file,
) -> ResolvedUnit:
    """`entity` is the IfcPropertySingleValue or IfcPhysicalSimpleQuantity that
    carries this value; `measure_type` is its declared measure type name
    (e.g. "IfcPositiveLengthMeasure") for a property, or the fixed unit type a
    quantity class implies (see `QUANTITY_UNIT_TYPES` in properties.py).
    """
    # get_measure_unit_type's stub declares only a handful of Literal measure-class
    # names, but it accepts (and correctly maps) any real IFC measure type name at
    # runtime — confirmed against IfcBoolean/IfcLabel/etc., not just the 5 the stub
    # lists — so a plain `str` here is a stub gap, not a real type error.
    unit_type = util_unit.get_measure_unit_type(measure_type)  # pyright: ignore[reportArgumentType]
    dimension = _DIMENSION_BY_UNIT_TYPE.get(unit_type)
    if dimension is None:
        return ResolvedUnit(original_unit=None, si_multiplier=None, dimension=None)

    try:
        unit = util_unit.get_property_unit(entity, ifc_file)
    except Exception:  # noqa: BLE001 - fall back to the contract's documented "unsupported unit" behavior
        return ResolvedUnit(original_unit=None, si_multiplier=None, dimension=None)

    if unit is None:
        return ResolvedUnit(original_unit=None, si_multiplier=None, dimension=None)

    original_unit = _unit_label(unit)
    si_multiplier = si_multiplier_for_unit(unit)
    if si_multiplier is None:
        return ResolvedUnit(original_unit=original_unit, si_multiplier=None, dimension=None)
    return ResolvedUnit(original_unit=original_unit, si_multiplier=si_multiplier, dimension=dimension)
