from fastapi.testclient import TestClient

import app.auth as auth_module
from app.vercel_app import app


def test_valid_allowlisted_token_is_accepted(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "true")
    monkeypatch.setenv("AUTH_ALLOWED_EMAILS", "operator@example.com")
    monkeypatch.setattr(
        auth_module,
        "_verify_firebase_id_token",
        lambda _token: {"email": "operator@example.com", "uid": "user-1"},
    )

    response = TestClient(app).get(
        "/api/actions", headers={"Authorization": "Bearer valid-token"}
    )

    assert response.status_code == 200


def test_invalid_token_is_rejected(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "true")

    def reject(_token):
        raise ValueError("bad token")

    monkeypatch.setattr(auth_module, "_verify_firebase_id_token", reject)

    response = TestClient(app).get(
        "/api/actions", headers={"Authorization": "Bearer invalid-token"}
    )

    assert response.status_code == 401
