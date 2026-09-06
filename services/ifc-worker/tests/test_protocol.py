"""Pydantic model validation for the request envelope (docs/contracts/worker-v1.md)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from ifc_worker.protocol import Request

VALID_INSPECT_REQUEST = {
    "protocolVersion": 2,
    "jobId": "job-1",
    "operation": "inspect",
    "model": {"path": "/data/a.ifc", "sha256": "0" * 64, "revisionId": "revision-1"},
    "ids": None,
    "outputDir": "/data/jobs/job-1",
    "settings": {"geometry": True},
}


def test_valid_inspect_request_parses() -> None:
    request = Request.model_validate(VALID_INSPECT_REQUEST)
    assert request.operation == "inspect"
    assert request.model.revisionId == "revision-1"


def test_valid_validate_request_with_ids_parses() -> None:
    payload = {
        **VALID_INSPECT_REQUEST,
        "operation": "validate",
        "ids": {"path": "/data/a.ids", "sha256": "1" * 64, "specificationIds": None},
    }
    request = Request.model_validate(payload)
    assert request.ids is not None
    assert request.ids.specificationIds is None


def test_validate_operation_without_ids_is_rejected() -> None:
    payload = {**VALID_INSPECT_REQUEST, "operation": "validate", "ids": None}
    with pytest.raises(ValidationError, match="requires 'ids'"):
        Request.model_validate(payload)


def test_unknown_operation_is_rejected() -> None:
    payload = {**VALID_INSPECT_REQUEST, "operation": "delete"}
    with pytest.raises(ValidationError):
        Request.model_validate(payload)


def test_extra_field_is_rejected() -> None:
    payload = {**VALID_INSPECT_REQUEST, "unexpectedField": "nope"}
    with pytest.raises(ValidationError):
        Request.model_validate(payload)


def test_missing_required_field_is_rejected() -> None:
    payload = {k: v for k, v in VALID_INSPECT_REQUEST.items() if k != "outputDir"}
    with pytest.raises(ValidationError):
        Request.model_validate(payload)


def test_settings_geometry_defaults_true() -> None:
    payload = {**VALID_INSPECT_REQUEST, "settings": {}}
    request = Request.model_validate(payload)
    assert request.settings.geometry is True
