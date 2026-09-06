"""Walks a product's property sets and quantity sets into `PropertyRecord`s.

Scoped to `IfcPropertySingleValue` (in property sets) and `IfcPhysicalSimpleQuantity`
subtypes (in quantity sets) — the two shapes IFC files actually use for scalar
data in practice (confirmed against the sample fixture: zero instances of
`IfcPropertyEnumeratedValue`/`ListValue`/`BoundedValue`/`TableValue`/`ComplexProperty`
in this project's real IFC sample). Anything else is skipped with a diagnostic
rather than guessed at.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from ifc_worker.records import PropertyRecord
from ifc_worker.units import resolve_measure_unit

if TYPE_CHECKING:
    import ifcopenshell

# The measure type IfcOpenShell would report for each simple-quantity class's own
# value attribute, used only to decide whether it is length/area/volume-dimensioned;
# anything not listed here (count, weight, time, ...) keeps its raw value with no
# SI/dimension, the same as any other non-length/area/volume property.
_QUANTITY_MEASURE_TYPES: dict[str, str] = {
    "IfcQuantityLength": "IfcLengthMeasure",
    "IfcQuantityArea": "IfcAreaMeasure",
    "IfcQuantityVolume": "IfcVolumeMeasure",
}


def _property_set_definitions(product: ifcopenshell.entity_instance) -> list[ifcopenshell.entity_instance]:
    return [
        rel.RelatingPropertyDefinition
        for rel in getattr(product, "IsDefinedBy", None) or ()
        if rel.is_a("IfcRelDefinesByProperties")
    ]


def extract_properties(
    product: ifcopenshell.entity_instance,
    ifc_file: ifcopenshell.file,
    diagnostics: list[str],
) -> list[PropertyRecord]:
    records: list[PropertyRecord] = []
    skipped_types: set[str] = set()

    for definition in _property_set_definitions(product):
        if definition.is_a("IfcPropertySet"):
            set_name = definition.Name or "UnnamedPropertySet"
            for index, prop in enumerate(definition.HasProperties or ()):
                if not prop.is_a("IfcPropertySingleValue"):
                    skipped_types.add(prop.is_a())
                    continue
                records.append(_single_value_record(prop, set_name, index, ifc_file))
        elif definition.is_a("IfcElementQuantity"):
            set_name = definition.Name or "UnnamedQuantitySet"
            for index, quantity in enumerate(definition.Quantities or ()):
                if not quantity.is_a("IfcPhysicalSimpleQuantity"):
                    skipped_types.add(quantity.is_a())
                    continue
                records.append(_quantity_record(quantity, set_name, index, ifc_file))
        else:
            skipped_types.add(definition.is_a())

    if skipped_types:
        diagnostics.append(
            f"object #{product.id()}: skipped unsupported property definitions of type "
            f"{', '.join(sorted(skipped_types))}",
        )
    return records


def _single_value_record(
    prop: ifcopenshell.entity_instance,
    set_name: str,
    index: int,
    ifc_file: ifcopenshell.file,
) -> PropertyRecord:
    path = f"{set_name}.{prop.Name}"
    if prop.NominalValue is None:
        return PropertyRecord(
            path=path,
            value=None,
            originalUnit=None,
            siValue=None,
            dimension=None,
            collectionOrder=index,
        )
    value = prop.NominalValue.wrappedValue
    resolved = resolve_measure_unit(prop.NominalValue.is_a(), prop, ifc_file)
    si_value = value * resolved.si_multiplier if resolved.si_multiplier is not None else None
    return PropertyRecord(
        path=path,
        value=value,
        originalUnit=resolved.original_unit,
        siValue=si_value,
        dimension=resolved.dimension,
        collectionOrder=index,
    )


def _quantity_record(
    quantity: ifcopenshell.entity_instance,
    set_name: str,
    index: int,
    ifc_file: ifcopenshell.file,
) -> PropertyRecord:
    path = f"{set_name}.{quantity.Name}"
    value = quantity[3]
    measure_type = _QUANTITY_MEASURE_TYPES.get(quantity.is_a())
    if measure_type is None:
        return PropertyRecord(
            path=path,
            value=value,
            originalUnit=None,
            siValue=None,
            dimension=None,
            collectionOrder=index,
        )
    resolved = resolve_measure_unit(measure_type, quantity, ifc_file)
    si_value = value * resolved.si_multiplier if resolved.si_multiplier is not None else None
    return PropertyRecord(
        path=path,
        value=value,
        originalUnit=resolved.original_unit,
        siValue=si_value,
        dimension=resolved.dimension,
        collectionOrder=index,
    )
