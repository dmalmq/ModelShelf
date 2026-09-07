"""Walks occurrence and type property/quantity sets into shared ``Property`` records.

Supports ``IfcPropertySingleValue``, ordered ``IfcPropertyListValue``, and
``IfcPhysicalSimpleQuantity``. Occurrence properties override type properties of
the same (pset, name). Unsupported forms are skipped with a diagnostic.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from model_contracts import Dimension as SiDimension
from model_contracts import Origin, Property, PropertyValue

from ifc_worker.units import resolve_measure_unit

if TYPE_CHECKING:
    import ifcopenshell

_QUANTITY_MEASURE_TYPES: dict[str, str] = {
    "IfcQuantityLength": "IfcLengthMeasure",
    "IfcQuantityArea": "IfcAreaMeasure",
    "IfcQuantityVolume": "IfcVolumeMeasure",
}

def extract_properties(
    product: ifcopenshell.entity_instance,
    ifc_file: ifcopenshell.file,
    diagnostics: list[str],
) -> list[Property]:
    skipped_types: set[str] = set()
    by_key: dict[tuple[str, str], Property] = {}
    for origin, definition in _property_definitions(product):
        for record in _records_from_definition(definition, origin, ifc_file, skipped_types):
            by_key[record.pset, record.name] = record
    if skipped_types:
        diagnostics.append(
            f"object #{product.id()}: skipped unsupported property definitions of type "
            f"{', '.join(sorted(skipped_types))}",
        )
    return list(by_key.values())


def _property_definitions(
    product: ifcopenshell.entity_instance,
) -> list[tuple[Origin, ifcopenshell.entity_instance]]:
    definitions: list[tuple[Origin, ifcopenshell.entity_instance]] = []
    for rel in getattr(product, "IsTypedBy", None) or ():
        if not rel.is_a("IfcRelDefinesByType"):
            continue
        relating_type = rel.RelatingType
        definitions.extend(
            (Origin.type, pset) for pset in getattr(relating_type, "HasPropertySets", None) or ()
        )
    definitions.extend(
        (Origin.occurrence, rel.RelatingPropertyDefinition)
        for rel in getattr(product, "IsDefinedBy", None) or ()
        if rel.is_a("IfcRelDefinesByProperties")
    )
    return definitions


def _records_from_definition(
    definition: ifcopenshell.entity_instance,
    origin: Origin,
    ifc_file: ifcopenshell.file,
    skipped_types: set[str],
) -> list[Property]:
    if definition.is_a("IfcPropertySet"):
        set_name = definition.Name or "UnnamedPropertySet"
        records: list[Property] = []
        for prop in definition.HasProperties or ():
            record = _property_record(prop, set_name, origin, ifc_file, skipped_types)
            if record is not None:
                records.append(record)
        return records
    if definition.is_a("IfcElementQuantity"):
        set_name = definition.Name or "UnnamedQuantitySet"
        records = []
        for quantity in definition.Quantities or ():
            if not quantity.is_a("IfcPhysicalSimpleQuantity"):
                skipped_types.add(quantity.is_a())
                continue
            records.append(_quantity_record(quantity, set_name, origin, ifc_file))
        return records
    skipped_types.add(definition.is_a())
    return []


def _property_record(
    prop: ifcopenshell.entity_instance,
    set_name: str,
    origin: Origin,
    ifc_file: ifcopenshell.file,
    skipped_types: set[str],
) -> Property | None:
    if prop.is_a("IfcPropertySingleValue"):
        singles: list[ifcopenshell.entity_instance] = (
            [] if prop.NominalValue is None else [prop.NominalValue]
        )
        measure_type = None if prop.NominalValue is None else prop.NominalValue.is_a()
        return _typed_values_record(
            set_name,
            prop.Name,
            singles,
            measure_type,
            prop,
            ifc_file,
            origin=origin,
            ordered=True,
        )
    if prop.is_a("IfcPropertyListValue"):
        listed: list[ifcopenshell.entity_instance] = list(prop.ListValues or ())
        measure_type = listed[0].is_a() if listed else None
        return _typed_values_record(
            set_name,
            prop.Name,
            listed,
            measure_type,
            prop,
            ifc_file,
            origin=origin,
            ordered=True,
        )
    if prop.is_a("IfcPropertyEnumeratedValue"):
        enumerated: list[ifcopenshell.entity_instance] = list(prop.EnumerationValues or ())
        measure_type = enumerated[0].is_a() if enumerated else None
        return _typed_values_record(
            set_name,
            prop.Name,
            enumerated,
            measure_type,
            prop,
            ifc_file,
            origin=origin,
            ordered=False,
        )
    skipped_types.add(prop.is_a())
    return None


def _typed_values_record(  # noqa: PLR0913, PLR0917
    set_name: str,
    name: str,
    raw_values: list[ifcopenshell.entity_instance],
    measure_type: str | None,
    entity: ifcopenshell.entity_instance,
    ifc_file: ifcopenshell.file,
    *,
    origin: Origin,
    ordered: bool,
) -> Property:
    resolved = (
        resolve_measure_unit(measure_type, entity, ifc_file)
        if measure_type is not None
        else None
    )
    values: list[PropertyValue] = []
    for raw in raw_values:
        value = raw.wrappedValue
        si_value = None
        dimension = None
        original_unit = None
        if resolved is not None:
            original_unit = resolved.original_unit
            dimension = SiDimension(resolved.dimension) if resolved.dimension else None
            if resolved.si_multiplier is not None and isinstance(value, (int, float)):
                si_value = value * resolved.si_multiplier
        values.append(
            PropertyValue(
                value=value,
                originalUnit=original_unit,
                siValue=si_value,
                dimension=dimension,
            )
        )
    return Property(pset=set_name, name=name, values=values, ordered=ordered, origin=origin)


def _quantity_record(
    quantity: ifcopenshell.entity_instance,
    set_name: str,
    origin: Origin,
    ifc_file: ifcopenshell.file,
) -> Property:
    value = quantity[3]
    measure_type = _QUANTITY_MEASURE_TYPES.get(quantity.is_a())
    if measure_type is None:
        return Property(
            pset=set_name,
            name=quantity.Name,
            values=[PropertyValue(value=value)],
            ordered=True,
            origin=origin,
        )
    resolved = resolve_measure_unit(measure_type, quantity, ifc_file)
    si_value = value * resolved.si_multiplier if resolved.si_multiplier is not None else None
    return Property(
        pset=set_name,
        name=quantity.Name,
        values=[
            PropertyValue(
                value=value,
                originalUnit=resolved.original_unit,
                siValue=si_value,
                dimension=SiDimension(resolved.dimension) if resolved.dimension else None,
            )
        ],
        ordered=True,
        origin=origin,
    )
