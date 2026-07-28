from datetime import date
from typing import Any

from google.adk.agents import Agent
from google.adk.apps import App
from google.adk.models import Gemini
from google.genai import types

from app.bid_models import ActionProposalInput, BidInput, ScanRequest
from app.intake_workflow import execute_intake
from app.runtime import get_repository
from app.scoring import score_bid


def search_bids(query: str = "", platform: str = "") -> dict[str, Any]:
    """Search current bid listings by title, agency, location, or description."""
    repository = get_repository()
    profile = repository.get_company_profile()
    query_text = query.casefold().strip()
    results = []
    for row in repository.list_bids(platform=platform or None):
        bid = BidInput.model_validate_json(row["raw_json"])
        searchable = " ".join(
            [bid.title, bid.agency, bid.location, bid.description]
        ).casefold()
        if query_text and query_text not in searchable:
            continue
        results.append(
            {
                "dedupe_key": row["dedupe_key"],
                **bid.model_dump(mode="json"),
                "score": score_bid(bid, profile, today=date.today()).model_dump(),
            }
        )
    results.sort(key=lambda item: -item["score"]["total"])
    return {"count": len(results), "bids": results[:25]}


def explain_bid_score(dedupe_key: str) -> dict[str, Any]:
    """Return the deterministic score and evidence for one current bid."""
    repository = get_repository()
    for row in repository.list_bids():
        if row["dedupe_key"] == dedupe_key:
            bid = BidInput.model_validate_json(row["raw_json"])
            score = score_bid(
                bid, repository.get_company_profile(), today=date.today()
            )
            return {
                "bid": bid.model_dump(mode="json"),
                "score": score.model_dump(),
            }
    return {"error": "Bid not found", "dedupe_key": dedupe_key}


async def scan_bid_portals(platforms: list[str]) -> dict[str, Any]:
    """Run the ADK intake workflow for selected supported bid portals."""
    request = ScanRequest.model_validate({"platforms": platforms})
    return (await execute_intake(request)).model_dump()


def prepare_external_action(
    destination: str, action: str, bid_keys: list[str]
) -> dict[str, Any]:
    """Prepare, but never approve, an external Google Sheets or ClickUp action."""
    proposal = ActionProposalInput.model_validate(
        {
            "destination": destination,
            "action": action,
            "payload": {"bid_keys": bid_keys},
        }
    )
    return get_repository().create_action_proposal(proposal)


root_agent = Agent(
    name="bid_copilot",
    model=Gemini(
        model="gemini-3.1-flash-lite",
        retry_options=types.HttpRetryOptions(attempts=3),
    ),
    instruction="""
You are the bid copilot for the CEO of a construction firm. Help the operator
find, compare, and understand current procurement opportunities. Use tools for
all claims about stored bids or scores. Deterministic scores are authoritative;
explain their evidence plainly and identify missing data. You may run scans when
asked. For Google Sheets or ClickUp, you may only prepare a preview proposal.
Never claim an external write happened, never approve your own proposal, and
never suggest deletion. Keep responses concise and operational.
""".strip(),
    tools=[
        search_bids,
        explain_bid_score,
        scan_bid_portals,
        prepare_external_action,
    ],
)

app = App(root_agent=root_agent, name="construction_bid_copilot")
