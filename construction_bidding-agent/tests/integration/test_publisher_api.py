from __future__ import annotations

from datetime import UTC, datetime

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.publisher import (
    PublicationConflict,
    PublisherImportResult,
    compute_payload_checksum,
    create_publisher_router,
)


class FakePublisherStore:
    def __init__(self) -> None:
        self.imports = []
        self.devices = {"office-pc": {"key": "valid-secret", "revoked": False}}

    def authenticate(self, publisher_id: str, key: str) -> bool:
        device = self.devices.get(publisher_id)
        return bool(device and not device["revoked"] and device["key"] == key)

    def import_run(self, publisher_id, payload):
        prior = next(
            (item for item in self.imports if item[1].run_id == payload.run_id), None
        )
        if prior:
            if prior[1].content_checksum != payload.content_checksum:
                raise PublicationConflict
            return prior[2]
        result = PublisherImportResult(
            run_id=payload.run_id,
            created=1,
            updated=0,
            unchanged=0,
            retained=0,
            rejected=0,
        )
        self.imports.append((publisher_id, payload, result))
        return result


def valid_payload() -> dict:
    now = datetime.now(UTC).isoformat()
    payload = {
        "schema_version": 1,
        "run_id": "94cc8e1a-6e93-4bf6-bdd8-26da43360739",
        "started_at": now,
        "finished_at": now,
        "status": "completed",
        "bids": [
            {
                "platform": "CivicEngage",
                "source_id": "example-city",
                "source_links": ["https://example.test/bids/ITB-1"],
                "bid_id": "ITB-1",
                "title": "Road construction",
                "agency": "Example City",
                "due_date": "2099-12-31",
            }
        ],
        "entity_checks": [
            {
                "source_id": "example-city",
                "status": "success",
                "record_count": 1,
                "checked_at": now,
            }
        ],
    }
    payload["content_checksum"] = compute_payload_checksum(payload)
    return payload


def build_client(store: FakePublisherStore) -> TestClient:
    app = FastAPI()
    app.include_router(create_publisher_router(lambda: store))
    return TestClient(app)


def test_valid_device_imports_one_run() -> None:
    store = FakePublisherStore()
    response = build_client(store).post(
        "/api/publisher/runs",
        headers={
            "X-Publisher-ID": "office-pc",
            "Authorization": "Bearer valid-secret",
        },
        json=valid_payload(),
    )

    assert response.status_code == 201
    assert response.json()["created"] == 1
    assert len(store.imports) == 1


def test_missing_invalid_or_revoked_credentials_do_not_import() -> None:
    store = FakePublisherStore()
    client = build_client(store)

    assert client.post("/api/publisher/runs", json=valid_payload()).status_code == 401
    assert client.post(
        "/api/publisher/runs",
        headers={"X-Publisher-ID": "office-pc", "Authorization": "Bearer wrong"},
        json=valid_payload(),
    ).status_code == 401
    store.devices["office-pc"]["revoked"] = True
    assert client.post(
        "/api/publisher/runs",
        headers={"X-Publisher-ID": "office-pc", "Authorization": "Bearer valid-secret"},
        json=valid_payload(),
    ).status_code == 401
    assert store.imports == []


def test_malformed_payload_does_not_import() -> None:
    store = FakePublisherStore()
    response = build_client(store).post(
        "/api/publisher/runs",
        headers={
            "X-Publisher-ID": "office-pc",
            "Authorization": "Bearer valid-secret",
        },
        json={"schema_version": 1, "bids": []},
    )

    assert response.status_code == 422
    assert store.imports == []


def test_oversized_payload_is_rejected_without_import() -> None:
    store = FakePublisherStore()
    response = build_client(store).post(
        "/api/publisher/runs",
        headers={
            "X-Publisher-ID": "office-pc",
            "Authorization": "Bearer valid-secret",
            "Content-Length": str(6 * 1024 * 1024),
        },
        json=valid_payload(),
    )

    assert response.status_code == 413
    assert store.imports == []


def test_identical_retry_returns_original_result_without_duplicate() -> None:
    store = FakePublisherStore()
    client = build_client(store)
    headers = {
        "X-Publisher-ID": "office-pc",
        "Authorization": "Bearer valid-secret",
    }
    payload = valid_payload()

    first = client.post("/api/publisher/runs", headers=headers, json=payload)
    retry = client.post("/api/publisher/runs", headers=headers, json=payload)

    assert first.status_code == retry.status_code == 201
    assert retry.json() == first.json()
    assert len(store.imports) == 1


def test_run_uuid_with_different_content_returns_conflict() -> None:
    store = FakePublisherStore()
    client = build_client(store)
    headers = {
        "X-Publisher-ID": "office-pc",
        "Authorization": "Bearer valid-secret",
    }
    first = valid_payload()
    changed = valid_payload()
    changed["bids"][0]["title"] = "Different bid"
    changed["content_checksum"] = compute_payload_checksum(changed)

    assert client.post("/api/publisher/runs", headers=headers, json=first).status_code == 201
    response = client.post("/api/publisher/runs", headers=headers, json=changed)

    assert response.status_code == 409
    assert len(store.imports) == 1


def test_unsupported_schema_version_is_actionable() -> None:
    store = FakePublisherStore()
    payload = valid_payload()
    payload["schema_version"] = 2
    payload["content_checksum"] = compute_payload_checksum(payload)
    response = build_client(store).post(
        "/api/publisher/runs",
        headers={
            "X-Publisher-ID": "office-pc",
            "Authorization": "Bearer valid-secret",
        },
        json=payload,
    )

    assert response.status_code == 422
    assert "schema version" in response.json()["detail"].lower()
    assert store.imports == []
