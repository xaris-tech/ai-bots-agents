from __future__ import annotations

import asyncio
import base64
import html
import imaplib
import os
import re
from datetime import UTC, date, datetime, timedelta
from email import policy
from email.message import Message
from email.parser import BytesParser
from email.utils import parseaddr, parsedate_to_datetime
from pathlib import Path
from typing import Any

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

from app.bid_models import BidInput, PortalRunInput

GMAIL_PLATFORM = "Gmail"
GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
DEFAULT_ACCOUNT = "info.cortexconstruction@gmail.com"
DEFAULT_LABEL = "Cortex Bids"
DEFAULT_TOKEN_FILE = Path("credentials/gmail-token.json")

_BID_TERMS = re.compile(
    r"\b(invitation to bid|notice to bidders?|bid opportunity|request for "
    r"(?:proposal|qualification)|solicitation|rfp|rfq|ifb|itb|sealed bids?)\b",
    re.IGNORECASE,
)
_DUE_DATE = re.compile(
    r"\b(?:due|deadline|closing|close[sd]?)\s*(?:date)?\s*[:\-]?\s*"
    r"([A-Z][a-z]+\s+\d{1,2},\s+\d{4}|\d{1,2}/\d{1,2}/\d{4}|\d{4}-\d{2}-\d{2})",
    re.IGNORECASE,
)
_URL = re.compile(r"https?://[^\s<>\"]+", re.IGNORECASE)
_SUBJECT_PREFIX = re.compile(
    r"^(?:re|fwd?)\s*:\s*|^(?:invitation to bid|bid opportunity|solicitation|"
    r"request for (?:proposal|qualifications)|rfp|rfq|ifb|itb)\s*[:\-]\s*",
    re.IGNORECASE,
)


class GmailSourceError(RuntimeError):
    pass


def _decode(data: str) -> str:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode(
        "utf-8", errors="replace"
    )


def _message_text(part: dict[str, Any]) -> str:
    chunks: list[str] = []
    mime_type = str(part.get("mimeType") or "")
    data = (part.get("body") or {}).get("data")
    if data and mime_type in {"text/plain", "text/html"}:
        value = _decode(str(data))
        if mime_type == "text/html":
            value = re.sub(r"<[^>]+>", " ", html.unescape(value))
        chunks.append(value)
    for child in part.get("parts") or []:
        if isinstance(child, dict):
            chunks.append(_message_text(child))
    return "\n".join(chunk for chunk in chunks if chunk)


def _attachments(part: dict[str, Any]) -> list[str]:
    names = [str(part["filename"])] if part.get("filename") else []
    for child in part.get("parts") or []:
        if isinstance(child, dict):
            names.extend(_attachments(child))
    return names


def _headers(payload: dict[str, Any]) -> dict[str, str]:
    return {
        str(item.get("name") or "").lower(): str(item.get("value") or "")
        for item in payload.get("headers") or []
        if isinstance(item, dict)
    }


def is_bid_message(subject: str, body: str) -> bool:
    return bool(_BID_TERMS.search(f"{subject}\n{body}"))


def _parse_due_date(text: str) -> date | None:
    match = _DUE_DATE.search(text)
    if not match:
        return None
    value = match.group(1)
    for pattern in ("%B %d, %Y", "%b %d, %Y", "%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(value, pattern).date()
        except ValueError:
            continue
    return None


def gmail_message_to_bid(message: dict[str, Any]) -> BidInput | None:
    payload = message.get("payload") or {}
    headers = _headers(payload)
    subject = headers.get("subject", "").strip()
    body = re.sub(r"\s+", " ", _message_text(payload)).strip()
    if not subject or not is_bid_message(subject, body):
        return None

    title = subject
    while True:
        cleaned = _SUBJECT_PREFIX.sub("", title, count=1).strip()
        if cleaned == title:
            break
        title = cleaned
    sender_name, sender_email = parseaddr(headers.get("from", ""))
    urls = [item.rstrip(".,);]") for item in _URL.findall(body)]
    attachments = _attachments(payload)
    received_ms = str(message.get("internalDate") or "0")
    received_at = datetime.fromtimestamp(int(received_ms) / 1000, tz=UTC)
    description_parts = [body[:4000], f"Email sender: {sender_email}"]
    if attachments:
        description_parts.append(f"Attachments: {', '.join(attachments)}")
    return BidInput(
        platform=GMAIL_PLATFORM,
        bid_id=str(message.get("id") or ""),
        title=title or subject,
        agency=sender_name or sender_email,
        due_date=_parse_due_date(f"{subject} {body}"),
        bid_url=urls[0] if urls else "",
        documents_url=urls[0] if urls else "",
        description="\n".join(description_parts),
        scraped_at=received_at.isoformat(),
    )


def email_message_to_bid(message: Message, uid: str) -> BidInput | None:
    subject = str(message.get("Subject") or "").strip()
    body_chunks: list[str] = []
    attachments: list[str] = []
    parts = message.walk() if message.is_multipart() else [message]
    for part in parts:
        filename = part.get_filename()
        if filename:
            attachments.append(filename)
            continue
        if part.get_content_type() not in {"text/plain", "text/html"}:
            continue
        try:
            value = part.get_content()
        except (KeyError, LookupError, UnicodeError):
            payload = part.get_payload(decode=True) or b""
            value = payload.decode(part.get_content_charset() or "utf-8", errors="replace")
        if part.get_content_type() == "text/html":
            value = re.sub(r"<[^>]+>", " ", html.unescape(str(value)))
        body_chunks.append(str(value))
    body = re.sub(r"\s+", " ", "\n".join(body_chunks)).strip()
    if not subject or not is_bid_message(subject, body):
        return None

    title = subject
    while True:
        cleaned = _SUBJECT_PREFIX.sub("", title, count=1).strip()
        if cleaned == title:
            break
        title = cleaned
    sender_name, sender_email = parseaddr(str(message.get("From") or ""))
    urls = [item.rstrip(".,);]") for item in _URL.findall(body)]
    message_id = str(message.get("Message-ID") or "").strip().strip("<>") or uid
    try:
        received_at = parsedate_to_datetime(str(message.get("Date") or ""))
        if received_at.tzinfo is None:
            received_at = received_at.replace(tzinfo=UTC)
    except (TypeError, ValueError):
        received_at = datetime.now(UTC)
    description_parts = [body[:4000], f"Email sender: {sender_email}"]
    if attachments:
        description_parts.append(f"Attachments: {', '.join(attachments)}")
    return BidInput(
        platform=GMAIL_PLATFORM,
        bid_id=message_id,
        title=title or subject,
        agency=sender_name or sender_email,
        due_date=_parse_due_date(f"{subject} {body}"),
        bid_url=urls[0] if urls else "",
        documents_url=urls[0] if urls else "",
        description="\n".join(description_parts),
        scraped_at=received_at.astimezone(UTC).isoformat(),
    )


def _token_path() -> Path:
    return Path(os.getenv("GMAIL_TOKEN_FILE", str(DEFAULT_TOKEN_FILE)))


def _credentials() -> Credentials:
    token_path = _token_path()
    if not token_path.exists():
        raise GmailSourceError(
            "Gmail is not authorized. Run: .venv/bin/python scripts/auth-gmail.py"
        )
    credentials = Credentials.from_authorized_user_file(
        str(token_path), [GMAIL_READONLY_SCOPE]
    )
    if credentials.expired and credentials.refresh_token:
        credentials.refresh(Request())
        token_path.write_text(credentials.to_json())
        token_path.chmod(0o600)
    if not credentials.valid:
        raise GmailSourceError(
            "Gmail authorization expired. Run: .venv/bin/python scripts/auth-gmail.py"
        )
    return credentials


def fetch_recent_messages() -> list[dict[str, Any]]:
    service = build("gmail", "v1", credentials=_credentials(), cache_discovery=False)
    expected = os.getenv("GMAIL_ACCOUNT", DEFAULT_ACCOUNT).strip().lower()
    actual = service.users().getProfile(userId="me").execute()["emailAddress"].lower()
    if actual != expected:
        raise GmailSourceError(
            f"Gmail authorized {actual}, expected {expected}. Re-run Gmail authorization."
        )
    lookback = max(1, int(os.getenv("GMAIL_LOOKBACK_DAYS", "30")))
    label = os.getenv("GMAIL_LABEL", DEFAULT_LABEL).strip() or DEFAULT_LABEL
    escaped_label = label.replace('"', r'\"')
    query = (
        f'newer_than:{lookback}d label:"{escaped_label}" '
        "{\"invitation to bid\" \"notice to bidders\" \"bid opportunity\" "
        "\"request for proposal\" solicitation RFP RFQ IFB ITB}"
    )
    response = service.users().messages().list(userId="me", q=query).execute()
    messages: list[dict[str, Any]] = []
    while True:
        for item in response.get("messages", []):
            messages.append(
                service.users().messages().get(
                    userId="me", id=item["id"], format="full"
                ).execute()
            )
        token = response.get("nextPageToken")
        if not token:
            break
        response = service.users().messages().list(
            userId="me", q=query, pageToken=token
        ).execute()
    return messages


def fetch_recent_imap_bids() -> list[BidInput]:
    account = os.getenv("GMAIL_ACCOUNT", DEFAULT_ACCOUNT).strip()
    app_password = os.getenv("GMAIL_APP_PASSWORD", "").replace(" ", "").strip()
    if not app_password:
        raise GmailSourceError("GMAIL_APP_PASSWORD is not configured.")
    lookback = max(1, int(os.getenv("GMAIL_LOOKBACK_DAYS", "30")))
    label = os.getenv("GMAIL_LABEL", DEFAULT_LABEL).strip() or DEFAULT_LABEL
    imap_label = '"' + label.replace("\\", "\\\\").replace('"', '\\"') + '"'
    since = (date.today() - timedelta(days=lookback)).strftime("%d-%b-%Y")
    client = imaplib.IMAP4_SSL("imap.gmail.com", 993)
    try:
        client.login(account, app_password)
        status, _ = client.select(imap_label, readonly=True)
        if status != "OK":
            raise GmailSourceError(
                f'Gmail label "{label}" was not found or could not be opened read-only.'
            )
        status, data = client.uid("search", None, "SINCE", since)
        if status != "OK":
            raise GmailSourceError("Gmail message search failed.")
        bids: list[BidInput] = []
        for raw_uid in (data[0] or b"").split()[-500:]:
            status, fetched = client.uid("fetch", raw_uid, "(BODY.PEEK[])")
            if status != "OK":
                continue
            raw_message = next(
                (item[1] for item in fetched if isinstance(item, tuple)), None
            )
            if not raw_message:
                continue
            message = BytesParser(policy=policy.default).parsebytes(raw_message)
            bid = email_message_to_bid(message, raw_uid.decode())
            if bid:
                bids.append(bid)
        return bids
    except imaplib.IMAP4.error as error:
        raise GmailSourceError(
            "Gmail IMAP login failed. Check GMAIL_ACCOUNT and GMAIL_APP_PASSWORD."
        ) from error
    finally:
        try:
            client.logout()
        except imaplib.IMAP4.error:
            pass


async def scan_gmail_bids() -> PortalRunInput:
    try:
        if os.getenv("GMAIL_APP_PASSWORD", "").strip():
            bids = await asyncio.to_thread(fetch_recent_imap_bids)
        else:
            messages = await asyncio.to_thread(fetch_recent_messages)
            bids = [bid for message in messages if (bid := gmail_message_to_bid(message))]
        return PortalRunInput.success(GMAIL_PLATFORM, bids)
    except Exception as error:
        if isinstance(error, GmailSourceError):
            warning = str(error)
        else:
            warning = f"Gmail scan failed: {error}"
        return PortalRunInput.failure(GMAIL_PLATFORM, warning[:1000])
