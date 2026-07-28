"""Firebase ID-token auth + email allowlist — the server-side security boundary.

The dashboard signs users in with Firebase (passwordless email link) and sends
the resulting ID token as `Authorization: Bearer <token>` on every API call.
This module verifies that token and checks the caller's email against a strict
allowlist. Because this runs on the server, a user cannot bypass it by editing
the frontend — an unlisted email is rejected even with a valid Firebase token.

Config (env):
  AUTH_ENABLED          "false" disables all checks (LOCAL DEV ONLY; default on)
  AUTH_ALLOWED_EMAILS   comma list; defaults to the two authorized operators
  FIREBASE_CREDENTIALS  path to a Firebase service-account JSON (preferred), or
  FIREBASE_PROJECT_ID   project id to verify token audience via ADC
"""

from __future__ import annotations

import logging
import os

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

logger = logging.getLogger(__name__)

DEFAULT_ALLOWED = "ranjovidad@gmail.com,info@cortexconstruction.com"
_bearer = HTTPBearer(auto_error=False)
_firebase_ready = False


def auth_enabled() -> bool:
    return os.getenv("AUTH_ENABLED", "true").strip().lower() != "false"


def allowed_emails() -> set[str]:
    raw = os.getenv("AUTH_ALLOWED_EMAILS", DEFAULT_ALLOWED)
    return {email.strip().lower() for email in raw.split(",") if email.strip()}


def _ensure_firebase() -> None:
    """Initialise the firebase-admin app once, for ID-token verification."""
    global _firebase_ready
    if _firebase_ready:
        return
    import firebase_admin
    from firebase_admin import credentials

    if not firebase_admin._apps:
        cred_path = os.getenv("FIREBASE_CREDENTIALS") or os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
        project_id = os.getenv("FIREBASE_PROJECT_ID") or os.getenv("GOOGLE_CLOUD_PROJECT")
        if cred_path and os.path.exists(cred_path):
            firebase_admin.initialize_app(credentials.Certificate(cred_path))
        elif project_id:
            firebase_admin.initialize_app(options={"projectId": project_id})
        else:
            # Application Default Credentials (e.g. on Cloud Run).
            firebase_admin.initialize_app()
    _firebase_ready = True


async def require_auth(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict[str, str]:
    """FastAPI dependency: verify the Firebase token and enforce the allowlist."""
    if not auth_enabled():
        return {"email": "dev@local", "auth": "disabled"}

    if creds is None or not creds.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    _ensure_firebase()
    from firebase_admin import auth as firebase_auth

    try:
        decoded = firebase_auth.verify_id_token(creds.credentials)
    except Exception as exc:  # invalid signature, expired, wrong audience, ...
        logger.warning("Rejected token: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    email = str(decoded.get("email") or "").strip().lower()
    if email not in allowed_emails():
        logger.warning("Denied non-allowlisted email: %s", email or "<none>")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account is not authorized to use this application.",
        )

    return {"email": email, "uid": str(decoded.get("uid", ""))}
