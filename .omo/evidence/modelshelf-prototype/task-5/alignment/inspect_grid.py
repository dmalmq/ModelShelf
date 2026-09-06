import ifcopenshell
import ifcopenshell.util.placement as placement_util
import numpy as np

paths = {
    "architecture": "samples/ifc/blcj-s1000-architecture.ifc",
    "structure": "samples/ifc/blcj-s1000-structure.ifc",
    "mep": "samples/ifc/blcj-s1000-mep.ifc",
}

for disc, path in paths.items():
    print(f"\n=== {disc} ===")
    f = ifcopenshell.open(path)
    grids = f.by_type("IfcGrid")
    print("grid count:", len(grids))
    for g in grids:
        try:
            m = placement_util.get_local_placement(g.ObjectPlacement) if g.ObjectPlacement else np.eye(4)
            print("grid placement translation:", m[:3, 3])
        except Exception as exc:
            print("grid placement: <error>", exc)
        for axis_group_name, axes in (("U", g.UAxes), ("V", g.VAxes)):
            labels = [ax.AxisTag for ax in axes[:8]]
            print(f"  {axis_group_name} axes (first 8 tags):", labels)

    # Try to find columns and print a few absolute placements for cross-check.
    columns = f.by_type("IfcColumn")
    print("column count:", len(columns))
    for c in columns[:8]:
        try:
            m = placement_util.get_local_placement(c.ObjectPlacement) if c.ObjectPlacement else None
        except Exception as exc:
            print("  column", c.Name, "<placement error>", exc)
            continue
        if m is not None:
            print("  column", c.Name, "abs translation:", m[:3, 3])
