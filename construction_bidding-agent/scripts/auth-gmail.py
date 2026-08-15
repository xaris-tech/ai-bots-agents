#!/usr/bin/env python3
"""Authorize Cortex Bid Desk to read the configured Gmail mailbox."""

from __future__ import annotations

import os
from pathlib import Path

from google_auth_oauthlib.flow import InstalledAppFlow

GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
CLIENT_FILE = Path(
    os.getenv("GMAIL_OAUTH_CLIENT_FILE", "credentials/gmail-oauth-client.json")
)
TOKEN_FILE = Path(os.getenv("GMAIL_TOKEN_FILE", "credentials/gmail-token.json"))


def main() -> None:
    if not CLIENT_FILE.exists():
        raise SystemExit(
            f"Missing {CLIENT_FILE}. Download an OAuth Desktop app client JSON "
            "from Google Cloud Console and save it at that path."
        )
    flow = InstalledAppFlow.from_client_secrets_file(
        str(CLIENT_FILE), [GMAIL_READONLY_SCOPE]
    )
    credentials = flow.run_local_server(port=0, access_type="offline", prompt="consent")
    TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    TOKEN_FILE.write_text(credentials.to_json())
    TOKEN_FILE.chmod(0o600)
    print(f"Gmail read-only authorization saved to {TOKEN_FILE}.")


if __name__ == "__main__":
    main()
