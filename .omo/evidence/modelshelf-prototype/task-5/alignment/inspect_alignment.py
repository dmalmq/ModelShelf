import sys
import ifcopenshell
import ifcopenshell.util.placement as placement_util

paths = {
    "architecture": "samples/ifc/blcj-s1000-architecture.ifc",
    "structure": "samples/ifc/blcj-s1000-structure.ifc",
    "mep": "samples/ifc/blcj-s1000-mep.ifc",
}

for disc, path in paths.items():
    print(f"\n=== {disc}: {path} ===")
    f = ifcopenshell.open(path)
    print("schema:", f.schema)
    project = f.by_type("IfcProject")[0]
    print("project name:", project.Name, "| description:", project.Description)
    units = f.by_type("IfcUnitAssignment")
    length_unit = None
    for ua in units:
        for u in ua.Units:
            if u.is_a("IfcSIUnit") and u.UnitType == "LENGTHUNIT":
                prefix = u.Prefix or ""
                length_unit = f"{prefix}{u.Name}"
            elif u.is_a("IfcConversionBasedUnit") and u.UnitType == "LENGTHUNIT":
                length_unit = u.Name
    print("length unit:", length_unit)

    contexts = f.by_type("IfcGeometricRepresentationContext")
    for ctx in contexts:
        if ctx.is_a("IfcGeometricRepresentationSubContext"):
            continue
        wcs = ctx.WorldCoordinateSystem
        true_north = ctx.TrueNorth
        origin = wcs.Location.Coordinates if wcs and wcs.Location else None
        tn = true_north.DirectionRatios if true_north else None
        print(f"context '{ctx.ContextType}': WCS origin={origin} trueNorth={tn}")

    sites = f.by_type("IfcSite")
    for site in sites:
        print("site name:", site.Name)
        print("  RefLatitude:", getattr(site, "RefLatitude", None))
        print("  RefLongitude:", getattr(site, "RefLongitude", None))
        print("  RefElevation:", getattr(site, "RefElevation", None))
        m = placement_util.get_local_placement(site.ObjectPlacement) if site.ObjectPlacement else None
        if m is not None:
            print("  absolute placement matrix (site):")
            print(" ", m[:3, 3], "translation")

    buildings = f.by_type("IfcBuilding")
    for b in buildings:
        print("building name:", b.Name)
        m = placement_util.get_local_placement(b.ObjectPlacement) if b.ObjectPlacement else None
        if m is not None:
            print("  absolute placement translation (building):", m[:3, 3])

    map_conversions = f.by_type("IfcMapConversion") if f.schema != "IFC2X3" else []
    for mc in map_conversions:
        print("IfcMapConversion:", mc)

    storeys = f.by_type("IfcBuildingStorey")
    print("storeys:", [(s.Name, s.Elevation) for s in storeys])

    products = f.by_type("IfcProduct")
    print("product count:", len(products))
