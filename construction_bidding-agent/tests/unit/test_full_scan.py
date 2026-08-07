import pytest

from app.bid_models import BidInput, PortalRunInput
from app.full_scan import _scan_gmail_unit
from app.repository import BidRepository


@pytest.mark.asyncio
async def test_gmail_full_scan_unit_persists_independent_success(
    tmp_path, monkeypatch
) -> None:
    repository = BidRepository(tmp_path / "bids.db")

    async def fake_scan() -> PortalRunInput:
        return PortalRunInput.success(
            "Gmail",
            [BidInput(platform="Gmail", bid_id="message-1", title="Road bid")],
        )

    monkeypatch.setattr("app.full_scan.scan_gmail_bids", fake_scan)

    outcome = await _scan_gmail_unit(repository)

    assert outcome.platform == "Gmail"
    assert outcome.status == "success"
    assert outcome.record_count == 1
    assert len(repository.list_bids(platform="Gmail")) == 1


@pytest.mark.asyncio
async def test_gmail_full_scan_unit_returns_warning_without_raising(
    tmp_path, monkeypatch
) -> None:
    repository = BidRepository(tmp_path / "bids.db")

    async def fake_scan() -> PortalRunInput:
        return PortalRunInput.failure("Gmail", "Authorization required")

    monkeypatch.setattr("app.full_scan.scan_gmail_bids", fake_scan)

    outcome = await _scan_gmail_unit(repository)

    assert outcome.status == "failed"
    assert outcome.warning == "Authorization required"
