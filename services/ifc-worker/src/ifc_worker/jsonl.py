"""Atomic JSONL writing. A crash mid-write must never leave a partially-written
file at the path a caller will later hash and trust; write to a sibling temp file
in the same directory (so the final rename is same-filesystem) and rename into
place only once every record is flushed.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, NamedTuple

from ifc_worker.hashing import sha256_file

if TYPE_CHECKING:
    from collections.abc import Iterable
    from pathlib import Path

    from pydantic import BaseModel


class ArtifactInfo(NamedTuple):
    path: str
    sha256: str
    size: int
    record_count: int


def write_jsonl_atomic(path: Path, records: Iterable[BaseModel]) -> ArtifactInfo:
    tmp_path = path.with_name(f".{path.name}.tmp")
    record_count = 0
    with tmp_path.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(record.model_dump_json())
            handle.write("\n")
            record_count += 1
    tmp_path.replace(path)
    return ArtifactInfo(
        path=str(path),
        sha256=sha256_file(path),
        size=path.stat().st_size,
        record_count=record_count,
    )
