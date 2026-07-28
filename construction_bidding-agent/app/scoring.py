from __future__ import annotations

from datetime import date

from app.bid_models import BidInput, BidScore, CompanyProfile, ScoreComponent


def score_bid(
    bid: BidInput, profile: CompanyProfile, *, today: date | None = None
) -> BidScore:
    today = today or date.today()
    text = " ".join(
        [bid.title, bid.description, bid.agency, bid.location]
    ).casefold()

    if _contains_any(text, profile.excluded_terms):
        return BidScore(
            total=0,
            label="irrelevant",
            profile_version=profile.version,
            excluded=True,
            breakdown=[],
        )

    breakdown: list[ScoreComponent] = []
    _add_match(breakdown, text, profile.project_terms, "Project type match", 30)
    _add_match(breakdown, text, profile.material_terms, "Material match", 20)
    _add_match(breakdown, text, profile.service_areas, "Service area match", 15)
    _add_match(
        breakdown,
        bid.agency.casefold(),
        profile.preferred_agencies,
        "Preferred agency",
        10,
    )
    if bid.due_date and (bid.due_date - today).days >= profile.minimum_lead_days:
        breakdown.append(ScoreComponent(reason="Submission lead time", points=15))
    if bid.bid_url:
        breakdown.append(ScoreComponent(reason="Source link available", points=10))

    total = min(100, sum(item.points for item in breakdown))
    label = "high" if total >= 75 else "medium" if total >= 50 else "low"
    return BidScore(
        total=total,
        label=label,
        profile_version=profile.version,
        breakdown=breakdown,
    )


def _add_match(
    breakdown: list[ScoreComponent],
    text: str,
    terms: list[str],
    reason: str,
    points: int,
) -> None:
    if _contains_any(text, terms):
        breakdown.append(ScoreComponent(reason=reason, points=points))


def _contains_any(text: str, terms: list[str]) -> bool:
    return any(term.casefold() in text for term in terms if term.strip())

