import json
import uuid
from datetime import date
from typing import Any

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    TextBlock,
    create_sdk_mcp_server,
    query,
    tool,
)

from app.bid_models import ActionProposalInput, BidInput, ScanRequest
from app.intake_workflow import execute_intake
from app.runtime import get_repository
from app.scraper_adapter import fetch_live_bid_page
from app.scoring import score_bid

SYSTEM_PROMPT = """
You are the bid copilot for the CEO of a construction firm. Help the operator
find, compare, and understand current procurement opportunities. Use tools for
all claims about stored bids or scores. Deterministic scores are authoritative;
explain their evidence plainly and identify missing data. You may run scans when
asked. When asked to check a bid's accuracy, use verify_bid_accuracy and
compare the stored fields against the live page's title/text yourself —
call out any mismatched title, agency, due date, or estimated value, and
say plainly if the live page couldn't be fetched (e.g. Cloudflare-walled
portals) rather than guessing. For Google Sheets or ClickUp, you may only
prepare a preview proposal. Never claim an external write happened, never
approve your own proposal, and never suggest deletion. Keep responses
concise and operational.
""".strip()


def _search_bids(query_text: str = "", platform: str = "") -> dict[str, Any]:
    """Search current bid listings by title, agency, location, or description."""
    repository = get_repository()
    profile = repository.get_company_profile()
    needle = query_text.casefold().strip()
    results = []
    for row in repository.list_bids(platform=platform or None):
        bid = BidInput.model_validate_json(row["raw_json"])
        searchable = " ".join(
            [bid.title, bid.agency, bid.location, bid.description]
        ).casefold()
        if needle and needle not in searchable:
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


def _explain_bid_score(dedupe_key: str) -> dict[str, Any]:
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


async def _verify_bid_accuracy(dedupe_key: str) -> dict[str, Any]:
    """Fetch a bid's live source page and return it alongside the stored
    record so the model can judge whether the scrape is accurate.

    Returns the stored fields plus the fetched page's title and visible text
    (or a fetch error, e.g. a Cloudflare-walled portal that can't load
    headlessly) — the model compares them and reports discrepancies rather
    than this tool computing a verdict itself.
    """
    repository = get_repository()
    for row in repository.list_bids():
        if row["dedupe_key"] == dedupe_key:
            bid = BidInput.model_validate_json(row["raw_json"])
            if not bid.bid_url:
                return {
                    "dedupe_key": dedupe_key,
                    "stored": bid.model_dump(mode="json"),
                    "error": "Bid has no bid_url to verify against",
                }
            live_page = await fetch_live_bid_page(bid.bid_url)
            return {
                "dedupe_key": dedupe_key,
                "stored": bid.model_dump(mode="json"),
                "live_page": live_page,
            }
    return {"error": "Bid not found", "dedupe_key": dedupe_key}


async def _scan_bid_portals(platforms: list[str]) -> dict[str, Any]:
    """Run the ADK intake workflow for selected supported bid portals."""
    request = ScanRequest.model_validate({"platforms": platforms})
    return (await execute_intake(request)).model_dump()


def _prepare_external_action(
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


def _text_result(payload: dict[str, Any]) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": json.dumps(payload)}]}


@tool(
    "search_bids",
    "Search current bid listings by title, agency, location, or description.",
    {"query": str, "platform": str},
)
async def search_bids_tool(args: dict[str, Any]) -> dict[str, Any]:
    return _text_result(_search_bids(args.get("query", ""), args.get("platform", "")))


@tool(
    "explain_bid_score",
    "Return the deterministic score and evidence for one current bid.",
    {"dedupe_key": str},
)
async def explain_bid_score_tool(args: dict[str, Any]) -> dict[str, Any]:
    return _text_result(_explain_bid_score(args["dedupe_key"]))


@tool(
    "verify_bid_accuracy",
    "Fetch a bid's live source page to check the stored record for accuracy.",
    {"dedupe_key": str},
)
async def verify_bid_accuracy_tool(args: dict[str, Any]) -> dict[str, Any]:
    return _text_result(await _verify_bid_accuracy(args["dedupe_key"]))


@tool(
    "scan_bid_portals",
    "Run the intake workflow for selected supported bid portals.",
    {"platforms": list},
)
async def scan_bid_portals_tool(args: dict[str, Any]) -> dict[str, Any]:
    return _text_result(await _scan_bid_portals(args["platforms"]))


@tool(
    "prepare_external_action",
    "Prepare, but never approve, an external Google Sheets or ClickUp action.",
    {"destination": str, "action": str, "bid_keys": list},
)
async def prepare_external_action_tool(args: dict[str, Any]) -> dict[str, Any]:
    return _text_result(
        _prepare_external_action(args["destination"], args["action"], args["bid_keys"])
    )


bid_tools = create_sdk_mcp_server(
    name="bid_tools",
    version="1.0.0",
    tools=[
        search_bids_tool,
        explain_bid_score_tool,
        verify_bid_accuracy_tool,
        scan_bid_portals_tool,
        prepare_external_action_tool,
    ],
)

ALLOWED_TOOLS = [
    "mcp__bid_tools__search_bids",
    "mcp__bid_tools__explain_bid_score",
    "mcp__bid_tools__verify_bid_accuracy",
    "mcp__bid_tools__scan_bid_portals",
    "mcp__bid_tools__prepare_external_action",
]


def _build_options(resume: str | None) -> ClaudeAgentOptions:
    return ClaudeAgentOptions(
        mcp_servers={"bid_tools": bid_tools},
        allowed_tools=ALLOWED_TOOLS,
        system_prompt=SYSTEM_PROMPT,
        resume=resume,
        permission_mode="bypassPermissions",
    )


async def run_bid_copilot(message: str, session_id: str | None) -> tuple[str, str]:
    """Send one chat turn to the bid copilot, resuming session_id if given.

    Returns (response_text, session_id) — the session_id is echoed back
    (or newly minted) so the caller can round-trip it on the next turn.
    """
    options = _build_options(resume=session_id)
    text_parts: list[str] = []
    resolved_session_id = session_id
    async for msg in query(prompt=message, options=options):
        if isinstance(msg, AssistantMessage):
            resolved_session_id = msg.session_id or resolved_session_id
            text_parts.extend(
                block.text for block in msg.content if isinstance(block, TextBlock)
            )
    return "".join(text_parts), resolved_session_id or str(uuid.uuid4())
