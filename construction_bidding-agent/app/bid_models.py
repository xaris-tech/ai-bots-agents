from __future__ import annotations

from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, Field


# Widened from a 3-value Literal so full-pipeline platforms (BidNet,
# CivicEngage, StaticList, Public Purchase, BeaconBid, ...) can be persisted
# through the same BidInput/PortalRunInput shapes as the 3 batch portals.
PortalName = str


class BidInput(BaseModel):
    platform: PortalName
    bid_id: str = ""
    title: str
    agency: str = ""
    location: str = ""
    due_date: date | None = None
    bid_url: str = ""
    documents_url: str = ""
    estimated_value: str = ""
    description: str = ""
    scraped_at: str = ""


class CompanyProfile(BaseModel):
    version: int = 1
    service_areas: list[str] = Field(default_factory=list)
    project_terms: list[str] = Field(
        default_factory=lambda: [
            "construction",
            "road",
            "bridge",
            "drainage",
            "concrete",
            "earthwork",
        ]
    )
    material_terms: list[str] = Field(
        default_factory=lambda: [
            "aggregate",
            "gravel",
            "sand",
            "stone",
            "asphalt",
            "riprap",
        ]
    )
    preferred_agencies: list[str] = Field(default_factory=list)
    excluded_terms: list[str] = Field(default_factory=list)
    minimum_lead_days: int = 7


class ScoreComponent(BaseModel):
    reason: str
    points: int


class BidScore(BaseModel):
    total: int
    label: Literal["high", "medium", "low", "irrelevant"]
    profile_version: int
    excluded: bool = False
    breakdown: list[ScoreComponent]


class PortalRunInput(BaseModel):
    platform: PortalName
    status: Literal["success", "failed", "skipped"]
    bids: list[BidInput] = Field(default_factory=list)
    warning: str = ""

    @classmethod
    def success(
        cls, platform: PortalName, bids: list[BidInput]
    ) -> PortalRunInput:
        return cls(platform=platform, status="success", bids=bids)

    @classmethod
    def failure(cls, platform: PortalName, warning: str) -> PortalRunInput:
        return cls(platform=platform, status="failed", warning=warning)

    @classmethod
    def skipped(cls, platform: PortalName) -> PortalRunInput:
        return cls(platform=platform, status="skipped")


class ScanRequest(BaseModel):
    platforms: list[PortalName] = Field(
        default_factory=lambda: ["IonWave", "DemandStar", "Bonfire"]
    )


class ScanSummary(BaseModel):
    status: Literal["completed", "completed_with_warnings"]
    total_records: int
    outcomes: list[dict[str, str | int]]
    logs: list[str] = Field(default_factory=list)


class ScanOutcome(BaseModel):
    platform: str
    status: str
    record_count: int
    warning: str = ""


class ScanProgress(BaseModel):
    running: bool
    completed_units: int = 0
    total_units: int = 0
    total_ingested: int = 0
    outcomes: list[ScanOutcome] = Field(default_factory=list)
    logs: list[str] = Field(default_factory=list)
    error: str = ""


class ActionProposalInput(BaseModel):
    destination: Literal["google_sheets", "clickup"]
    action: Literal["upsert_bids", "create_tasks", "update_tasks"]
    payload: dict[str, Any]


class ActionApproval(BaseModel):
    payload_hash: str


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    session_id: str | None = None


class SheetSyncWarning(BaseModel):
    platform: str
    warning: str


class SheetSyncSummary(BaseModel):
    status: Literal["completed", "completed_with_warnings", "failed"]
    total_bids: int = 0
    warnings: list[SheetSyncWarning] = Field(default_factory=list)
    sheet_url: str = ""
    error: str = ""
    logs: list[str] = Field(default_factory=list)


class ClickUpSyncSummary(BaseModel):
    status: Literal["completed", "failed"]
    total_bids: int = 0
    matched: int = 0
    created: int = 0
    skipped: int = 0
    list_url: str = ""
    error: str = ""
    logs: list[str] = Field(default_factory=list)


class CleanupSummary(BaseModel):
    deleted: int
    clickup_archived: int = 0
