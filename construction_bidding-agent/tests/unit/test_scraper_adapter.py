from datetime import date

from app.scraper_adapter import bid_from_raw, portal_result_from_payload


def test_bid_from_raw_maps_existing_javascript_shape() -> None:
    bid = bid_from_raw(
        {
            "platform": "IonWave",
            "bidId": "ITB-42",
            "title": "Drainage construction",
            "agency": "Tarrant County",
            "location": "Texas",
            "dueDate": "2026-08-01",
            "bidUrl": "https://example.test/bids/42",
            "documentsUrl": "https://example.test/bids/42/docs",
            "estimatedValue": "$1,000,000",
            "description": "Road and drainage work",
            "scrapedAt": "2026-07-13T10:00:00Z",
        }
    )

    assert bid.bid_id == "ITB-42"
    assert bid.due_date == date(2026, 8, 1)
    assert bid.documents_url.endswith("/docs")


def test_warning_report_becomes_failed_portal_result() -> None:
    result = portal_result_from_payload(
        "Bonfire",
        [],
        {"platform": "Bonfire", "count": 0, "warning": "Login required"},
    )

    assert result.status == "failed"
    assert result.warning == "Login required"

