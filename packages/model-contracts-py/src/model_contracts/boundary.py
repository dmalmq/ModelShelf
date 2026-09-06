"""The one contract rule pydantic's generated validation cannot express: JSON Schema
has no "unique by sub-key" keyword, so two occurrences sharing an ``objectId`` within
one ``SemanticModel`` deserializes fine and needs an explicit check. Duplicated
``globalId``s are unrelated and always allowed.
"""

from __future__ import annotations

from .generated import SemanticModel


class DuplicateObjectIdError(ValueError):
    def __init__(self, object_id: str, first_index: int, duplicate_index: int) -> None:
        self.object_id = object_id
        self.first_index = first_index
        self.duplicate_index = duplicate_index
        super().__init__(
            f"objects[{duplicate_index}].ref.objectId {object_id!r} "
            f"duplicates objects[{first_index}].ref.objectId"
        )


def check_distinct_object_ids(model: SemanticModel) -> None:
    """Raises DuplicateObjectIdError if two objects share an objectId."""
    seen: dict[str, int] = {}
    for index, obj in enumerate(model.objects):
        object_id = obj.ref.objectId
        first_index = seen.get(object_id)
        if first_index is not None:
            raise DuplicateObjectIdError(object_id, first_index, index)
        seen[object_id] = index
