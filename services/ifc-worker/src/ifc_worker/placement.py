"""Project-frame placement, per docs/contracts/worker-v1.md: 12 numbers, the
first three rows of the 4x4 homogeneous transform, flattened row-major
(translation in metres, already resolved through the product's placement chain
by IfcOpenShell).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import ifcopenshell.util.placement as util_placement

if TYPE_CHECKING:
    import ifcopenshell


def object_placement(product: ifcopenshell.entity_instance) -> list[float] | None:
    placement = getattr(product, "ObjectPlacement", None)
    if placement is None:
        return None
    matrix = util_placement.get_local_placement(placement)
    return [float(value) for row in matrix[:3] for value in row]
