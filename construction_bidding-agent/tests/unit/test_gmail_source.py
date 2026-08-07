import base64
from datetime import date
from email.message import EmailMessage

from app.gmail_source import (
    email_message_to_bid,
    fetch_recent_imap_bids,
    gmail_message_to_bid,
    is_bid_message,
)


def _encoded(value: str) -> str:
    return base64.urlsafe_b64encode(value.encode()).decode().rstrip("=")


def test_bid_message_normalizes_subject_sender_due_date_url_and_attachments() -> None:
    message = {
        "id": "gmail-message-123",
        "internalDate": "1786060800000",
        "payload": {
            "headers": [
                {"name": "Subject", "value": "Invitation to Bid: Main Street Improvements"},
                {"name": "From", "value": "City Purchasing <bids@example.gov>"},
                {"name": "Date", "value": "Fri, 07 Aug 2026 09:00:00 -0500"},
            ],
            "mimeType": "multipart/mixed",
            "parts": [
                {
                    "mimeType": "text/plain",
                    "body": {
                        "data": _encoded(
                            "Sealed bids are due August 28, 2026. "
                            "Documents: https://example.gov/bids/42"
                        )
                    },
                },
                {
                    "mimeType": "application/pdf",
                    "filename": "ITB-42.pdf",
                    "body": {"attachmentId": "attachment-1"},
                },
            ],
        },
    }

    bid = gmail_message_to_bid(message)

    assert bid is not None
    assert bid.platform == "Gmail"
    assert bid.bid_id == "gmail-message-123"
    assert bid.title == "Main Street Improvements"
    assert bid.agency == "City Purchasing"
    assert bid.due_date == date(2026, 8, 28)
    assert bid.bid_url == "https://example.gov/bids/42"
    assert bid.documents_url == "https://example.gov/bids/42"
    assert "ITB-42.pdf" in bid.description


def test_irrelevant_email_is_not_a_bid() -> None:
    assert not is_bid_message("Your monthly account statement", "Balance summary")


def test_bid_relevance_can_come_from_body() -> None:
    assert is_bid_message(
        "New procurement notice",
        "The county issued an IFB for aggregate base and roadway materials.",
    )


def test_imap_email_normalizes_without_marking_message_state() -> None:
    message = EmailMessage()
    message["Message-ID"] = "<notice-42@example.gov>"
    message["Subject"] = "IFB: County Road Materials"
    message["From"] = "County Purchasing <purchasing@example.gov>"
    message["Date"] = "Fri, 07 Aug 2026 09:00:00 -0500"
    message.set_content(
        "Responses are due 2026-08-31. See https://example.gov/ifb/42"
    )
    message.add_attachment(
        b"sample", maintype="application", subtype="pdf", filename="specs.pdf"
    )

    bid = email_message_to_bid(message, uid="501")

    assert bid is not None
    assert bid.bid_id == "notice-42@example.gov"
    assert bid.title == "County Road Materials"
    assert bid.agency == "County Purchasing"
    assert bid.due_date == date(2026, 8, 31)
    assert bid.bid_url == "https://example.gov/ifb/42"
    assert "specs.pdf" in bid.description


def test_imap_scan_selects_only_configured_bid_label_readonly(monkeypatch) -> None:
    calls: list[tuple[object, ...]] = []

    class FakeImap:
        def __init__(self, *args, **kwargs):
            pass

        def login(self, account, password):
            return "OK", []

        def select(self, mailbox, readonly=False):
            calls.append(("select", mailbox, readonly))
            return "OK", [b"0"]

        def uid(self, command, *args):
            calls.append(("uid", command, *args))
            return "OK", [b""]

        def logout(self):
            return "BYE", []

    monkeypatch.setenv("GMAIL_ACCOUNT", "info.cortexconstruction@gmail.com")
    monkeypatch.setenv("GMAIL_APP_PASSWORD", "app-password")
    monkeypatch.setenv("GMAIL_LABEL", "Cortex Bids")
    monkeypatch.setattr("app.gmail_source.imaplib.IMAP4_SSL", FakeImap)

    assert fetch_recent_imap_bids() == []
    assert ("select", '"Cortex Bids"', True) in calls
