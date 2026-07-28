from __future__ import annotations

import uuid
from typing import Any

from google.adk.runners import InMemoryRunner
from google.adk.workflow import JoinNode, Workflow
from google.genai import types

from app.bid_models import PortalRunInput, ScanRequest, ScanSummary
from app.runtime import get_repository
from app.scraper_adapter import scrape_portal


def validate_scan_request(node_input: ScanRequest) -> ScanRequest:
    if not node_input.platforms:
        raise ValueError("Select at least one portal")
    return node_input


async def scrape_ionwave(node_input: ScanRequest) -> PortalRunInput:
    if "IonWave" not in node_input.platforms:
        return PortalRunInput.skipped("IonWave")
    return await scrape_portal("IonWave")


async def scrape_demandstar(node_input: ScanRequest) -> PortalRunInput:
    if "DemandStar" not in node_input.platforms:
        return PortalRunInput.skipped("DemandStar")
    return await scrape_portal("DemandStar")


async def scrape_bonfire(node_input: ScanRequest) -> PortalRunInput:
    if "Bonfire" not in node_input.platforms:
        return PortalRunInput.skipped("Bonfire")
    return await scrape_portal("Bonfire")


def persist_scan(node_input: dict[str, Any]) -> ScanSummary:
    repository = get_repository()
    outcomes: list[dict[str, str | int]] = []
    logs: list[str] = []
    total_records = 0
    has_warnings = False

    for key in ("scrape_ionwave", "scrape_demandstar", "scrape_bonfire"):
        result = PortalRunInput.model_validate(node_input[key])
        if result.status == "skipped":
            logs.append(f"{key.removeprefix('scrape_')}: skipped")
            continue
        stored = repository.record_portal_run(result)
        total_records += stored["record_count"]
        has_warnings = has_warnings or stored["status"] != "success"
        outcomes.append(
            {
                "platform": stored["platform"],
                "status": stored["status"],
                "record_count": stored["record_count"],
                "warning": stored["warning"],
            }
        )
        logs.append(
            f"{stored['platform']}: {stored['status']} ({stored['record_count']} records)"
            + (f" - {stored['warning']}" if stored["warning"] else "")
        )

    return ScanSummary(
        status="completed_with_warnings" if has_warnings else "completed",
        total_records=total_records,
        outcomes=outcomes,
        logs=logs,
    )


portal_join = JoinNode(name="join_portal_results")

bid_intake_workflow = Workflow(
    name="bid_intake_workflow",
    description="Scan configured bid portals and safely persist validated results.",
    input_schema=ScanRequest,
    output_schema=ScanSummary,
    max_concurrency=3,
    edges=[
        ("START", validate_scan_request),
        (
            validate_scan_request,
            (scrape_ionwave, scrape_demandstar, scrape_bonfire),
        ),
        (
            (scrape_ionwave, scrape_demandstar, scrape_bonfire),
            portal_join,
        ),
        (portal_join, persist_scan),
    ],
)


async def execute_intake(request: ScanRequest) -> ScanSummary:
    runner = InMemoryRunner(node=bid_intake_workflow, app_name="bid_intake")
    session_id = str(uuid.uuid4())
    await runner.session_service.create_session(
        app_name="bid_intake",
        user_id="local-ceo",
        session_id=session_id,
    )
    final_output: Any = None
    message = types.Content(
        role="user",
        parts=[types.Part.from_text(text=request.model_dump_json())],
    )
    async for event in runner.run_async(
        user_id="local-ceo",
        session_id=session_id,
        new_message=message,
    ):
        if event.output is not None:
            final_output = event.output
    if final_output is None:
        raise RuntimeError("Bid intake workflow completed without an output")
    return ScanSummary.model_validate(final_output)
