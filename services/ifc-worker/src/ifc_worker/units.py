"""Per-property unit resolution and SI normalization, per docs/contracts/worker-v1.md:
dimension is length/area/volume or null, and an unsupported unit retains the raw
value with null SI/dimension rather than a fabricated conversion.

IfcOpenShell's unit-resolution helpers (`get_property_unit`, `get_unit_symbol`) are
only reliable for the small set of measure types that carry a real SI or
conversion-based project unit; calling them on the many non-dimensioned measure
types IFC defines (boolean, label, thermal, mass density, ...) is both unnecessary
(the contract does not ask for an SI value there) and, for some derived-unit
types, crashes inside IfcOpenShell itself. So unit resolution below only runs for
the three dimensions the contract actually normalizes; everything else keeps its
raw value with `originalUnit`/`siValue`/`dimension` all null.
"""

from __future__ import annotations

from functools import lru_cache
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


@lru_cache(maxsize=8)
def _scale_to_si(ifc_file: ifcopenshell.file, unit_type: str) -> float:
    return util_unit.calculate_unit_scale(ifc_file, unit_type)


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
        original_unit = util_unit.get_unit_symbol(unit) if unit is not None else None
        si_multiplier = _scale_to_si(ifc_file, unit_type)
    except Exception:  # noqa: BLE001 - fall back to the contract's documented "unsupported unit" behavior
        return ResolvedUnit(original_unit=None, si_multiplier=None, dimension=None)

    return ResolvedUnit(original_unit=original_unit, si_multiplier=si_multiplier, dimension=dimension)
