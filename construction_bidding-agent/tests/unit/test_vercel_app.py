from fastapi.testclient import TestClient

from app.vercel_app import app


def test_healthz_is_public(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "true")

    response = TestClient(app).get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_bid_read_requires_auth(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "true")

    response = TestClient(app).get("/api/bids")

    assert response.status_code == 401
