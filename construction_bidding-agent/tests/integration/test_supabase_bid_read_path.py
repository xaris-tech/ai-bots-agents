from __future__ import annotations

import json
from datetime import date

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import create_bid_router
from app.bid_models import BidInput, CompanyProfile


class FakeSupabaseReader:
    def get_company_profile(self) -> CompanyProfile:
        return CompanyProfile()

    def list_bids(self, platform: str | None = None):
        bid = BidInput(
            platform="CivicEngage",
            bid_id="SUPABASE-1",
            title="Supabase road construction",
            agency="Example City",
            due_date=date(2099, 8, 31),
        )
        return [{"dedupe_key": "supabase-1", "raw_json": bid.model_dump_json()}]

    def latest_publication_run(self):
        return {
            "run_id": "94cc8e1a-6e93-4bf6-bdd8-26da43360739",
            "status": "completed_with_blockers",
            "publisher_id": "office-pc",
            "publisher_name": "Office PC",
            "bid_count": 1,
            "finished_at": "2026-08-09T00:00:00Z",
            "entity_checks": [
                {"source_id": "blocked", "status": "blocked", "retained_count": 1}
            ],
        }


def test_bids_endpoint_reads_from_supabase_provider(monkeypatch) -> None:
    monkeypatch.setenv("AUTH_ENABLED", "false")
    app = FastAPI()
    app.include_router(
        create_bid_router(
            lambda: None,  # Other repository paths are outside this tracer.
            lambda: FakeSupabaseReader(),
        )
    )

    response = TestClient(app).get("/api/bids")

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["dedupe_key"] == "supabase-1"
    assert json.loads(FakeSupabaseReader().list_bids()[0]["raw_json"])["title"] == body[0]["title"]


def test_latest_publication_run_comes_from_supabase_provider(monkeypatch) -> None:
    monkeypatch.setenv("AUTH_ENABLED", "false")
    app = FastAPI()
    app.include_router(create_bid_router(lambda: None, lambda: FakeSupabaseReader()))

    response = TestClient(app).get("/api/publication-runs/latest")

    assert response.status_code == 200
    assert response.json()["publisher_id"] == "office-pc"
    assert response.json()["entity_checks"][0]["retained_count"] == 1
