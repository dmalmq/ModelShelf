"""Self-authored IFC4 files for unit and placement tests. Kept tiny on purpose:
one project, one wall, the unit/property/placement combination under test.
"""

from __future__ import annotations

from pathlib import Path

import ifcopenshell


def _project_with_units(units: list[ifcopenshell.entity_instance]) -> ifcopenshell.file:
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
    assignment = ifc_file.create_entity("IfcUnitAssignment", Units=units)
    ifc_file.create_entity(
        "IfcProject",
        GlobalId=ifcopenshell.guid.new(),
        Name="Fixture",
        RepresentationContexts=[ctx],
        UnitsInContext=assignment,
    )
    return ifc_file


def _si_length(ifc_file: ifcopenshell.file, *, prefix: str | None = None) -> ifcopenshell.entity_instance:
    return ifc_file.create_entity("IfcSIUnit", UnitType="LENGTHUNIT", Prefix=prefix, Name="METRE")


def _placement(
    ifc_file: ifcopenshell.file,
    translation: tuple[float, float, float],
    *,
    relative_to: ifcopenshell.entity_instance | None = None,
    direction_ratios: tuple[float, float, float] | None = None,
) -> ifcopenshell.entity_instance:
    point = ifc_file.create_entity("IfcCartesianPoint", Coordinates=translation)
    axis = None
    if direction_ratios is not None:
        axis = ifc_file.create_entity("IfcDirection", DirectionRatios=direction_ratios)
    ref = ifc_file.create_entity("IfcAxis2Placement3D", Location=point, Axis=axis)
    return ifc_file.create_entity("IfcLocalPlacement", PlacementRelTo=relative_to, RelativePlacement=ref)


def _wall(ifc_file: ifcopenshell.file, placement: ifcopenshell.entity_instance) -> ifcopenshell.entity_instance:
    return ifc_file.create_entity(
        "IfcWall",
        GlobalId=ifcopenshell.guid.new(),
        Name="Wall",
        ObjectPlacement=placement,
    )


def write_metre_translation(path: Path) -> Path:
    ifc_file = _project_with_units([])
    metre = _si_length(ifc_file)
    ifc_file.by_type("IfcUnitAssignment")[0].Units = [metre]
    wall_place = _placement(ifc_file, (1.0, 0.0, 0.0))
    _wall(ifc_file, wall_place)
    ifc_file.write(str(path))
    return path


def write_millimetre_translation(path: Path) -> Path:
    ifc_file = _project_with_units([])
    mm = _si_length(ifc_file, prefix="MILLI")
    ifc_file.by_type("IfcUnitAssignment")[0].Units = [mm]
    wall_place = _placement(ifc_file, (1000.0, 0.0, 0.0))
    _wall(ifc_file, wall_place)
    ifc_file.write(str(path))
    return path


def write_nested_millimetre_translation(path: Path) -> Path:
    ifc_file = _project_with_units([])
    mm = _si_length(ifc_file, prefix="MILLI")
    ifc_file.by_type("IfcUnitAssignment")[0].Units = [mm]
    parent = _placement(ifc_file, (1000.0, 0.0, 0.0))
    child = _placement(ifc_file, (1000.0, 0.0, 0.0), relative_to=parent)
    _wall(ifc_file, child)
    ifc_file.write(str(path))
    return path


def write_rotated_millimetre_translation(path: Path) -> Path:
    ifc_file = _project_with_units([])
    mm = _si_length(ifc_file, prefix="MILLI")
    ifc_file.by_type("IfcUnitAssignment")[0].Units = [mm]
    # Axis (0,0,1) is the default Z; set RefDirection along Y so the X axis
    # of the placement is rotated 90 degrees about Z.
    point = ifc_file.create_entity("IfcCartesianPoint", Coordinates=(1000.0, 0.0, 0.0))
    z_dir = ifc_file.create_entity("IfcDirection", DirectionRatios=(0.0, 0.0, 1.0))
    y_dir = ifc_file.create_entity("IfcDirection", DirectionRatios=(0.0, 1.0, 0.0))
    ref = ifc_file.create_entity("IfcAxis2Placement3D", Location=point, Axis=z_dir, RefDirection=y_dir)
    placement = ifc_file.create_entity("IfcLocalPlacement", RelativePlacement=ref)
    _wall(ifc_file, placement)
    ifc_file.write(str(path))
    return path


def write_inch_conversion_translation(path: Path) -> Path:
    ifc_file = _project_with_units([])
    metre = _si_length(ifc_file)
    exponents = ifc_file.create_entity(
        "IfcDimensionalExponents",
        LengthExponent=1,
        MassExponent=0,
        TimeExponent=0,
        ElectricCurrentExponent=0,
        ThermodynamicTemperatureExponent=0,
        AmountOfSubstanceExponent=0,
        LuminousIntensityExponent=0,
    )
    conversion = ifc_file.create_entity(
        "IfcMeasureWithUnit",
        ValueComponent=ifc_file.create_entity("IfcLengthMeasure", 0.0254),
        UnitComponent=metre,
    )
    inch = ifc_file.create_entity(
        "IfcConversionBasedUnit",
        Dimensions=exponents,
        UnitType="LENGTHUNIT",
        Name="inch",
        ConversionFactor=conversion,
    )
    ifc_file.by_type("IfcUnitAssignment")[0].Units = [inch]
    wall_place = _placement(ifc_file, (12.0, 0.0, 0.0))
    _wall(ifc_file, wall_place)
    ifc_file.write(str(path))
    return path


def write_explicit_metre_property_in_millimetre_project(path: Path) -> Path:
    ifc_file = _project_with_units([])
    mm = _si_length(ifc_file, prefix="MILLI")
    metre = _si_length(ifc_file)
    ifc_file.by_type("IfcUnitAssignment")[0].Units = [mm]
    wall = _wall(ifc_file, _placement(ifc_file, (0.0, 0.0, 0.0)))
    prop = ifc_file.create_entity(
        "IfcPropertySingleValue",
        Name="Height",
        NominalValue=ifc_file.create_entity("IfcLengthMeasure", 2.0),
        Unit=metre,
    )
    pset = ifc_file.create_entity(
        "IfcPropertySet",
        GlobalId=ifcopenshell.guid.new(),
        Name="Pset_Test",
        HasProperties=[prop],
    )
    ifc_file.create_entity(
        "IfcRelDefinesByProperties",
        GlobalId=ifcopenshell.guid.new(),
        RelatedObjects=[wall],
        RelatingPropertyDefinition=pset,
    )
    ifc_file.write(str(path))
    return path


def write_context_dependent_unit_property(path: Path) -> Path:
    ifc_file = _project_with_units([])
    mm = _si_length(ifc_file, prefix="MILLI")
    ifc_file.by_type("IfcUnitAssignment")[0].Units = [mm]
    wall = _wall(ifc_file, _placement(ifc_file, (0.0, 0.0, 0.0)))
    exponents = ifc_file.create_entity(
        "IfcDimensionalExponents",
        LengthExponent=1,
        MassExponent=0,
        TimeExponent=0,
        ElectricCurrentExponent=0,
        ThermodynamicTemperatureExponent=0,
        AmountOfSubstanceExponent=0,
        LuminousIntensityExponent=0,
    )
    mystery = ifc_file.create_entity(
        "IfcContextDependentUnit",
        Dimensions=exponents,
        UnitType="LENGTHUNIT",
        Name="mystery",
    )
    prop = ifc_file.create_entity(
        "IfcPropertySingleValue",
        Name="Weird",
        NominalValue=ifc_file.create_entity("IfcLengthMeasure", 5.0),
        Unit=mystery,
    )
    pset = ifc_file.create_entity(
        "IfcPropertySet",
        GlobalId=ifcopenshell.guid.new(),
        Name="Pset_Test",
        HasProperties=[prop],
    )
    ifc_file.create_entity(
        "IfcRelDefinesByProperties",
        GlobalId=ifcopenshell.guid.new(),
        RelatedObjects=[wall],
        RelatingPropertyDefinition=pset,
    )
    ifc_file.write(str(path))
    return path


def write_explicit_area_and_volume(path: Path) -> Path:
    ifc_file = _project_with_units([])
    mm = _si_length(ifc_file, prefix="MILLI")
    area = ifc_file.create_entity("IfcSIUnit", UnitType="AREAUNIT", Name="SQUARE_METRE")
    volume = ifc_file.create_entity("IfcSIUnit", UnitType="VOLUMEUNIT", Name="CUBIC_METRE")
    ifc_file.by_type("IfcUnitAssignment")[0].Units = [mm]
    wall = _wall(ifc_file, _placement(ifc_file, (0.0, 0.0, 0.0)))
    area_prop = ifc_file.create_entity(
        "IfcPropertySingleValue",
        Name="NetArea",
        NominalValue=ifc_file.create_entity("IfcAreaMeasure", 4.0),
        Unit=area,
    )
    volume_prop = ifc_file.create_entity(
        "IfcPropertySingleValue",
        Name="NetVolume",
        NominalValue=ifc_file.create_entity("IfcVolumeMeasure", 8.0),
        Unit=volume,
    )
    pset = ifc_file.create_entity(
        "IfcPropertySet",
        GlobalId=ifcopenshell.guid.new(),
        Name="Pset_Test",
        HasProperties=[area_prop, volume_prop],
    )
    ifc_file.create_entity(
        "IfcRelDefinesByProperties",
        GlobalId=ifcopenshell.guid.new(),
        RelatedObjects=[wall],
        RelatingPropertyDefinition=pset,
    )
    ifc_file.write(str(path))
    return path


def write_list_and_inherited_properties(path: Path) -> Path:
    ifc_file = _project_with_units([])
    metre = _si_length(ifc_file)
    ifc_file.by_type("IfcUnitAssignment")[0].Units = [metre]
    wall = _wall(ifc_file, _placement(ifc_file, (0.0, 0.0, 0.0)))
    type_rating = ifc_file.create_entity(
        "IfcPropertySingleValue",
        Name="FireRating",
        NominalValue=ifc_file.create_entity("IfcLabel", "type-rating"),
    )
    type_load = ifc_file.create_entity(
        "IfcPropertySingleValue",
        Name="LoadBearing",
        NominalValue=ifc_file.create_entity("IfcBoolean", True),
    )
    type_pset = ifc_file.create_entity(
        "IfcPropertySet",
        GlobalId=ifcopenshell.guid.new(),
        Name="Pset_WallCommon",
        HasProperties=[type_rating, type_load],
    )
    wall_type = ifc_file.create_entity(
        "IfcWallType",
        GlobalId=ifcopenshell.guid.new(),
        Name="BasicWall",
        HasPropertySets=[type_pset],
    )
    ifc_file.create_entity(
        "IfcRelDefinesByType",
        GlobalId=ifcopenshell.guid.new(),
        RelatedObjects=[wall],
        RelatingType=wall_type,
    )
    occ_rating = ifc_file.create_entity(
        "IfcPropertySingleValue",
        Name="FireRating",
        NominalValue=ifc_file.create_entity("IfcLabel", "occ-rating"),
    )
    layers = ifc_file.create_entity(
        "IfcPropertyListValue",
        Name="Layers",
        ListValues=[
            ifc_file.create_entity("IfcLabel", "outer"),
            ifc_file.create_entity("IfcLabel", "inner"),
        ],
    )
    occ_pset = ifc_file.create_entity(
        "IfcPropertySet",
        GlobalId=ifcopenshell.guid.new(),
        Name="Pset_WallCommon",
        HasProperties=[occ_rating, layers],
    )
    ifc_file.create_entity(
        "IfcRelDefinesByProperties",
        GlobalId=ifcopenshell.guid.new(),
        RelatedObjects=[wall],
        RelatingPropertyDefinition=occ_pset,
    )
    ifc_file.write(str(path))
    return path
