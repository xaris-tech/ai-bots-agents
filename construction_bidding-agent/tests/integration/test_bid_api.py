from datetime import date

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import create_bid_router
from app.bid_models import BidInput, PortalRunInput, ScanSummary
from app.clickup_cleanup import ClickUpCleanupError
from app.repository import BidRepository


def test_bid_api_lists_scored_current_bids(tmp_path) -> None:
    repository = BidRepository(tmp_path / "bids.db")
    repository.record_portal_run(
        PortalRunInput.success(
            "IonWave",
            [
                BidInput(
                    platform="IonWave",
                    bid_id="ITB-42",
                    title="Drainage construction",
                    agency="Tarrant County",
                    location="Texas",
                    due_date=date(2026, 8, 1),
                    bid_url="https://example.test/bids/42",
                )
            ],
        )
    )
    app = FastAPI()
    app.include_router(create_bid_router(lambda: repository))

    response = TestClient(app).get("/api/bids")

    assert response.status_code == 200
    payload = response.json()
    assert payload[0]["bid_id"] == "ITB-42"
    assert payload[0]["score"]["profile_version"] == 1
    assert payload[0]["score"]["total"] > 0


def test_bid_api_filters_by_platform(tmp_path) -> None:
    repository = BidRepository(tmp_path / "bids.db")
    for platform in ("IonWave", "DemandStar"):
        repository.record_portal_run(
            PortalRunInput.success(
                platform,
                [BidInput(platform=platform, title=f"{platform} opportunity")],
            )
        )
    app = FastAPI()
    app.include_router(create_bid_router(lambda: repository))

    response = TestClient(app).get("/api/bids?platform=DemandStar")

    assert [item["platform"] for item in response.json()] == ["DemandStar"]


def test_cleanup_expired_archives_clickup_before_deleting_local_rows(
    tmp_path, monkeypatch
) -> None:
    repository = BidRepository(tmp_path / "bids.db")
    repository.record_portal_run(
        PortalRunInput.success(
            "IonWave",
            [
                BidInput(
                    platform="IonWave",
                    title="Expired opportunity",
                    due_date=date(2020, 1, 1),
                )
            ],
        )
    )

    async def fake_cleanup() -> int:
        return 3

    monkeypatch.setattr("app.api.cleanup_expired_clickup_tasks", fake_cleanup)
    app = FastAPI()
    app.include_router(create_bid_router(lambda: repository))

    response = TestClient(app).post("/api/bids/cleanup-expired")

    assert response.status_code == 200
    assert response.json() == {"deleted": 1, "clickup_archived": 3}


def test_cleanup_expired_preserves_local_rows_when_clickup_fails(
    tmp_path, monkeypatch
) -> None:
    repository = BidRepository(tmp_path / "bids.db")
    repository.record_portal_run(
        PortalRunInput.success(
            "IonWave",
            [
                BidInput(
                    platform="IonWave",
                    title="Expired opportunity",
                    due_date=date(2020, 1, 1),
                )
            ],
        )
    )

    async def fake_cleanup() -> int:
        raise ClickUpCleanupError("ClickUp unavailable")

    monkeypatch.setattr("app.api.cleanup_expired_clickup_tasks", fake_cleanup)
    app = FastAPI()
    app.include_router(create_bid_router(lambda: repository))

    response = TestClient(app).post("/api/bids/cleanup-expired")

    assert response.status_code == 502
    with repository._connect() as connection:
        remaining = connection.execute("SELECT COUNT(*) FROM bids").fetchone()[0]
    assert remaining == 1


def test_profile_and_action_proposal_endpoints(tmp_path) -> None:
    repository = BidRepository(tmp_path / "bids.db")
    bid = BidInput(platform="IonWave", bid_id="ITB-42", title="Road repair")
    repository.record_portal_run(PortalRunInput.success("IonWave", [bid]))
    app = FastAPI()
    app.include_router(create_bid_router(lambda: repository))
    client = TestClient(app)

    profile = client.put(
        "/api/profile",
        json={"service_areas": ["Texas"], "minimum_lead_days": 10},
    )
    proposal = client.post(
        "/api/actions/preview",
        json={
            "destination": "google_sheets",
            "action": "upsert_bids",
            "payload": {"bid_keys": ["IonWave|itb 42||"]},
        },
    )
    approval = client.post(
        f"/api/actions/{proposal.json()['id']}/approve",
        json={"payload_hash": proposal.json()["payload_hash"]},
    )

    assert profile.status_code == 200
    assert profile.json()["version"] == 2
    assert proposal.json()["status"] == "pending"
    assert approval.json()["status"] == "approved"


def test_scan_endpoint_runs_workflow(tmp_path, monkeypatch) -> None:
    repository = BidRepository(tmp_path / "bids.db")

    async def fake_execute(_request):
        return ScanSummary(status="completed", total_records=3, outcomes=[])

    monkeypatch.setattr("app.api.execute_intake", fake_execute)
    app = FastAPI()
    app.include_router(create_bid_router(lambda: repository))

    response = TestClient(app).post(
        "/api/scans", json={"platforms": ["IonWave"]}
    )

    assert response.status_code == 200
    assert response.json()["total_records"] == 3
