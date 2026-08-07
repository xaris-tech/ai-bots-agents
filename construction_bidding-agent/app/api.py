import json
from collections.abc import Callable
from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import require_auth
from app.bid_models import (
    ActionApproval,
    ActionProposalInput,
    BidInput,
    CleanupSummary,
    ClickUpSyncSummary,
    CompanyProfile,
    ScanProgress,
    ScanRequest,
    ScanSummary,
    SheetSyncSummary,
)
from app.clickup_cleanup import ClickUpCleanupError, cleanup_expired_clickup_tasks
from app.clickup_sync import ClickUpSyncError, sync_bids_to_clickup
from app.full_scan import get_full_scan_progress, start_full_scan
from app.gmail_source import scan_gmail_bids
from app.intake_workflow import execute_intake
from app.operations_status import build_operations_status
from app.repository import BidRepository
from app.scoring import score_bid
from app.sheet_sync import SheetSyncError, sync_bids_to_sheet
from app.site_monitor import build_site_monitor


RepositoryProvider = Callable[[], BidRepository]


def create_bid_router(repository_provider: RepositoryProvider) -> APIRouter:
    # Every /api route requires a verified, allowlisted Firebase user.
    router = APIRouter(prefix="/api", tags=["bid-copilot"], dependencies=[Depends(require_auth)])

    def get_repository() -> BidRepository:
        return repository_provider()

    @router.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @router.get("/bids")
    def list_bids(
        repository: Annotated[BidRepository, Depends(get_repository)],
        platform: str | None = Query(default=None),
    ) -> list[dict[str, Any]]:
        profile = repository.get_company_profile()
        today = date.today()
        results = []
        for row in repository.list_bids(platform=platform):
            bid = BidInput.model_validate(json.loads(row["raw_json"]))
            results.append(
                {
                    **bid.model_dump(mode="json"),
                    "dedupe_key": row["dedupe_key"],
                    "score": score_bid(bid, profile, today=today).model_dump(),
                }
            )
        return sorted(
            results,
            key=lambda item: (-item["score"]["total"], item["due_date"] or "9999"),
        )

    @router.post("/bids/cleanup-expired")
    async def cleanup_expired_bids(
        repository: Annotated[BidRepository, Depends(get_repository)],
    ) -> CleanupSummary:
        """Archive expired ClickUp prospects, then remove their local rows."""
        try:
            clickup_archived = await cleanup_expired_clickup_tasks()
        except ClickUpCleanupError as error:
            raise HTTPException(status_code=502, detail=str(error)) from error
        return CleanupSummary(
            deleted=repository.delete_expired_bids(),
            clickup_archived=clickup_archived,
        )

    @router.get("/profile")
    def get_profile(
        repository: Annotated[BidRepository, Depends(get_repository)],
    ) -> CompanyProfile:
        return repository.get_company_profile()

    @router.put("/profile")
    def update_profile(
        profile: CompanyProfile,
        repository: Annotated[BidRepository, Depends(get_repository)],
    ) -> CompanyProfile:
        return repository.save_company_profile(profile)

    @router.post("/scans")
    async def run_scan(request: ScanRequest) -> ScanSummary:
        return await execute_intake(request)

    @router.post("/scans/gmail")
    async def run_gmail_scan(
        repository: Annotated[BidRepository, Depends(get_repository)],
    ) -> ScanSummary:
        result = await scan_gmail_bids()
        stored = repository.record_portal_run(result)
        warning = str(stored["warning"] or "")
        succeeded = stored["status"] == "success"
        return ScanSummary(
            status="completed" if succeeded else "completed_with_warnings",
            total_records=int(stored["record_count"]),
            outcomes=[
                {
                    "platform": "Gmail",
                    "status": str(stored["status"]),
                    "record_count": int(stored["record_count"]),
                    "warning": warning,
                }
            ],
            logs=[
                f"Gmail: {stored['status']} ({stored['record_count']} records)"
                + (f" - {warning}" if warning else "")
            ],
        )

    @router.post("/scans/full")
    async def run_full_scan() -> ScanProgress:
        return start_full_scan()

    @router.get("/scans/full/status")
    def full_scan_status() -> ScanProgress:
        return get_full_scan_progress()

    @router.get("/site-monitor")
    def site_monitor() -> dict[str, Any]:
        return build_site_monitor()

    @router.get("/operations-status")
    def operations_status() -> dict[str, Any]:
        return build_operations_status()

    @router.post("/sync-sheet")
    async def sync_sheet() -> SheetSyncSummary:
        try:
            result = await sync_bids_to_sheet()
        except SheetSyncError as error:
            return SheetSyncSummary(status="failed", error=str(error), logs=error.logs)
        return SheetSyncSummary.model_validate(result)

    @router.post("/sync-clickup")
    async def sync_clickup() -> ClickUpSyncSummary:
        try:
            result = await sync_bids_to_clickup()
        except ClickUpSyncError as error:
            return ClickUpSyncSummary(status="failed", error=str(error), logs=error.logs)
        return ClickUpSyncSummary.model_validate(result)

    @router.get("/actions")
    def list_actions(
        repository: Annotated[BidRepository, Depends(get_repository)],
    ) -> list[dict[str, Any]]:
        return repository.list_action_proposals()

    @router.post("/actions/preview")
    def preview_action(
        proposal: ActionProposalInput,
        repository: Annotated[BidRepository, Depends(get_repository)],
    ) -> dict[str, Any]:
        try:
            return repository.create_action_proposal(proposal)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

    @router.post("/actions/{proposal_id}/approve")
    def approve_action(
        proposal_id: int,
        approval: ActionApproval,
        repository: Annotated[BidRepository, Depends(get_repository)],
    ) -> dict[str, Any]:
        try:
            return repository.approve_action_proposal(
                proposal_id, approval.payload_hash
            )
        except LookupError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error

    return router
