"""Project-frame placement, per docs/contracts/worker-v1.md: 12 numbers, the
first three rows of the 4x4 homogeneous transform, flattened row-major.
Translations are metres after converting the resolved placement chain; rotation
entries are left untouched. A unit or placement that cannot be interpreted
yields None rather than a number that looks like metres.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import ifcopenshell.util.placement as util_placement

from ifc_worker.units import length_scale_to_metre

if TYPE_CHECKING:
    import ifcopenshell


def object_placement(
    product: ifcopenshell.entity_instance,
    ifc_file: ifcopenshell.file,
) -> list[float] | None:
    placement = getattr(product, "ObjectPlacement", None)
    if placement is None:
        return None
    scale = length_scale_to_metre(ifc_file)
    if scale is None:
        return None
    try:
        matrix = util_placement.get_local_placement(placement)
    except Exception:  # noqa: BLE001 - IfcOpenShell raises mixed types on unreadable placements
        return None
    values: list[float] = []
    translation_column = 3
    for row in range(3):
        for column in range(4):
            value = float(matrix[row, column])
            if column == translation_column:
                value *= scale
            values.append(value)
    return values
