from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

from ifc_worker.protocol import Manifest, ProgressEvent, Request, ResultEvent

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURES = REPO_ROOT / "schemas" / "worker" / "v2" / "fixtures"

VALID_TYPES: dict[str, type[BaseModel]] = {
    "request-inspect.json": Request,
    "request-validate.json": Request,
    "progress-event.json": ProgressEvent,
    "result-event.json": ResultEvent,
    "manifest-inspect.json": Manifest,
    "manifest-validate.json": Manifest,
}

INVALID_TYPES: dict[str, type[BaseModel]] = {
    "request-job-id-renamed.json": Request,
    "request-wrong-version.json": Request,
    "request-extra-field.json": Request,
    "request-validate-without-ids.json": Request,
    "request-bad-hash.json": Request,
    "progress-event-unknown-field.json": ProgressEvent,
    "progress-with-manifest.json": ProgressEvent,
    "result-event-missing-manifest.json": ResultEvent,
    "result-with-stage.json": ResultEvent,
    "event-unknown-kind.json": ProgressEvent,
    "stdout-event-unknown-kind.json": ResultEvent,
    "manifest-missing-operation.json": Manifest,
    "manifest-empty-version.json": Manifest,
    "manifest-operation-renamed.json": Manifest,
}


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.mark.parametrize("name, model", sorted(VALID_TYPES.items()))
def test_valid_golden_round_trips(name: str, model: type[BaseModel]) -> None:
    payload = _load(FIXTURES / "valid" / name)
    parsed = model.model_validate(payload)
    assert parsed.model_dump(mode="json") == payload


@pytest.mark.parametrize("name, model", sorted(INVALID_TYPES.items()))
def test_invalid_schema_golden_is_rejected(name: str, model: type[BaseModel]) -> None:
    payload = _load(FIXTURES / "invalid" / "schema" / name)
    with pytest.raises(ValidationError):
        model.model_validate(payload)
