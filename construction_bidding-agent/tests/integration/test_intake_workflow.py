import pytest

from app.bid_models import BidInput, PortalRunInput, ScanRequest
from app.intake_workflow import execute_intake
from app.repository import BidRepository
from app.runtime import reset_repository


@pytest.mark.asyncio
async def test_adk_workflow_runs_portals_and_persists_independent_outcomes(
    tmp_path, monkeypatch
) -> None:
    database_path = tmp_path / "workflow.db"
    monkeypatch.setenv("BID_DATABASE_PATH", str(database_path))
    reset_repository()

    async def fake_scrape(platform):
        if platform == "Bonfire":
            return PortalRunInput.failure(platform, "Login required")
        return PortalRunInput.success(
            platform,
            [BidInput(platform=platform, title=f"{platform} road construction")],
        )

    monkeypatch.setattr("app.intake_workflow.scrape_portal", fake_scrape)

    summary = await execute_intake(ScanRequest())

    assert summary.status == "completed_with_warnings"
    assert summary.total_records == 2
    assert {item["platform"]: item["status"] for item in summary.outcomes} == {
        "IonWave": "success",
        "DemandStar": "success",
        "Bonfire": "failed",
    }
    repository = BidRepository(database_path)
    assert len(repository.list_bids()) == 2
    assert repository.latest_portal_run("Bonfire")["status"] == "failed"


@pytest.mark.asyncio
async def test_adk_workflow_skips_unselected_portals(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("BID_DATABASE_PATH", str(tmp_path / "workflow.db"))
    reset_repository()
    called = []

    async def fake_scrape(platform):
        called.append(platform)
        return PortalRunInput.success(
            platform, [BidInput(platform=platform, title="Selected bid")]
        )

    monkeypatch.setattr("app.intake_workflow.scrape_portal", fake_scrape)

    summary = await execute_intake(ScanRequest(platforms=["IonWave"]))

    assert called == ["IonWave"]
    assert summary.total_records == 1
