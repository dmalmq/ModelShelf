"""Object-local triangulated geometry, per docs/contracts/worker-v1.md.

Three states, never collapsed into each other: `absent` (the product genuinely
has no representation — e.g. an `IfcBuildingStorey` or `IfcVirtualElement`),
`unsupported` (a representation exists but IfcOpenShell could not triangulate
it, or the caller disabled geometry extraction for this job), and `available`.
"""

from __future__ import annotations

from functools import lru_cache
from typing import TYPE_CHECKING

import ifcopenshell.geom as ifc_geom

from ifc_worker.records import Geometry

if TYPE_CHECKING:
    import ifcopenshell

GEOMETRY_DISABLED_REASON = "geometry extraction disabled by request settings"


@lru_cache(maxsize=1)
def _settings() -> ifc_geom.settings:
    settings = ifc_geom.settings()
    settings.set("use-world-coords", False)  # noqa: FBT003 - positional bool is IfcOpenShell's own settings.set() signature
    return settings


def extract_geometry(product: ifcopenshell.entity_instance, *, geometry_enabled: bool) -> Geometry:
    if not geometry_enabled:
        return Geometry(status="unsupported", reason=GEOMETRY_DISABLED_REASON, vertices=None, triangles=None)

    if getattr(product, "Representation", None) is None:
        return Geometry(status="absent", reason="no geometric representation", vertices=None, triangles=None)

    try:
        shape = ifc_geom.create_shape(_settings(), product)
    except RuntimeError as exc:
        if "Representation is NULL" in str(exc):
            return Geometry(
                status="absent",
                reason="no geometric representation",
                vertices=None,
                triangles=None,
            )
        return Geometry(status="unsupported", reason=str(exc), vertices=None, triangles=None)
    except Exception as exc:  # noqa: BLE001 - IfcOpenShell's C++ bindings raise arbitrary types on unsupported shapes
        return Geometry(status="unsupported", reason=str(exc), vertices=None, triangles=None)

    # create_shape()'s return type is a large union (BRep | Triangulation | ...);
    # with this module's fixed settings (no "iterator-output"/serialization options
    # set) it is always a triangulated element exposing .geometry.verts/.faces, a
    # narrower guarantee than the stub expresses.
    triangulated = shape.geometry  # pyright: ignore[reportAttributeAccessIssue]
    return Geometry(
        status="available",
        reason=None,
        vertices=list(triangulated.verts),  # pyright: ignore[reportAttributeAccessIssue]
        triangles=list(triangulated.faces),  # pyright: ignore[reportAttributeAccessIssue]
    )
