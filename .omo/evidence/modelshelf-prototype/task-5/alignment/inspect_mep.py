import ifcopenshell
import ifcopenshell.util.placement as placement_util
import numpy as np

f = ifcopenshell.open("samples/ifc/blcj-s1000-mep.ifc")
mins = np.array([np.inf, np.inf, np.inf])
maxs = np.array([-np.inf, -np.inf, -np.inf])
count = 0
for p in f.by_type("IfcProduct"):
    if not p.ObjectPlacement:
        continue
    try:
        m = placement_util.get_local_placement(p.ObjectPlacement)
    except Exception:
        continue
    t = m[:3, 3]
    mins = np.minimum(mins, t)
    maxs = np.maximum(maxs, t)
    count += 1
print("mep products with placement:", count)
print("mep bbox min:", mins)
print("mep bbox max:", maxs)

f2 = ifcopenshell.open("samples/ifc/blcj-s1000-architecture.ifc")
mins2 = np.array([np.inf, np.inf, np.inf])
maxs2 = np.array([-np.inf, -np.inf, -np.inf])
count2 = 0
for p in f2.by_type("IfcProduct"):
    if not p.ObjectPlacement:
        continue
    try:
        m = placement_util.get_local_placement(p.ObjectPlacement)
    except Exception:
        continue
    t = m[:3, 3]
    mins2 = np.minimum(mins2, t)
    maxs2 = np.maximum(maxs2, t)
    count2 += 1
print("arch products with placement:", count2)
print("arch bbox min:", mins2)
print("arch bbox max:", maxs2)

f3 = ifcopenshell.open("samples/ifc/blcj-s1000-structure.ifc")
mins3 = np.array([np.inf, np.inf, np.inf])
maxs3 = np.array([-np.inf, -np.inf, -np.inf])
count3 = 0
for p in f3.by_type("IfcProduct"):
    if not p.ObjectPlacement:
        continue
    try:
        m = placement_util.get_local_placement(p.ObjectPlacement)
    except Exception:
        continue
    t = m[:3, 3]
    mins3 = np.minimum(mins3, t)
    maxs3 = np.maximum(maxs3, t)
    count3 += 1
print("structure products with placement:", count3)
print("structure bbox min:", mins3)
print("structure bbox max:", maxs3)
