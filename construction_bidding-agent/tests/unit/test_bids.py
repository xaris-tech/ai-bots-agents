from datetime import date

from app.bid_models import BidInput, CompanyProfile
from app.scoring import score_bid


def test_score_bid_returns_reproducible_breakdown() -> None:
    profile = CompanyProfile(
        version=3,
        service_areas=["Texas", "Tarrant County"],
        project_terms=["construction", "drainage"],
        material_terms=["aggregate", "gravel"],
        preferred_agencies=["Tarrant County"],
        excluded_terms=["janitorial"],
        minimum_lead_days=7,
    )
    bid = BidInput(
        platform="IonWave",
        bid_id="ITB-42",
        title="Tarrant County drainage construction",
        agency="Tarrant County",
        location="Texas",
        due_date=date(2026, 8, 1),
        bid_url="https://example.test/bids/42",
        description="Aggregate and gravel site work",
    )

    result = score_bid(bid, profile, today=date(2026, 7, 13))

    assert result.profile_version == 3
    assert result.total == sum(item.points for item in result.breakdown)
    assert result.total == 100
    assert [item.reason for item in result.breakdown] == [
        "Project type match",
        "Material match",
        "Service area match",
        "Preferred agency",
        "Submission lead time",
        "Source link available",
    ]


def test_score_bid_applies_exclusion_without_discarding_record() -> None:
    profile = CompanyProfile(
        version=1,
        excluded_terms=["janitorial"],
    )
    bid = BidInput(
        platform="DemandStar",
        title="Annual janitorial services",
        due_date=date(2026, 8, 1),
    )

    result = score_bid(bid, profile, today=date(2026, 7, 13))

    assert result.total == 0
    assert result.label == "irrelevant"
    assert result.excluded is True

