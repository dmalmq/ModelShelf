"""One deterministic, revision-scoped mapping from an IFC express ID to an opaque
ObjectRef.objectId. See ../../../../schemas/model/v1/README.md for the full contract
this must agree with (the TypeScript/browser loader implements the same function).
"""

from __future__ import annotations

import hashlib


def express_id_to_object_id(revision_id: str, express_id: int) -> str:
    digest = hashlib.sha256(f"{revision_id}:{express_id}".encode("utf-8")).hexdigest()
    return f"occ_{digest[:16]}"
