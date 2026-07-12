"""Structured contracts passed between agents via session state.

Kept as pydantic models (not free text) so the compliance and filing
agents consume fixed fields, never re-interpret prose from upstream.
"""

from typing import Literal
from pydantic import BaseModel, Field


class ExtractedPermit(BaseModel):
    is_document: bool = Field(
        description="True if the input is an actual permit application or "
        "floor-plan document. False for greetings, small talk, or anything "
        "else that isn't a document to process."
    )
    application_ref: str
    project_name: str
    site_address: str
    storeys: int
    occupancy_classes: list[str]
    mixed_use: bool
    corridor_width_mm: int = Field(description="Main exit corridor width, Level 1 commercial")
    exit_count_level1: int
    travel_distance_m: float
    sprinkler_system: str = Field(description="As stated in drawings, verbatim")
    extraction_confidence: float = Field(ge=0, le=1)


class RuleResult(BaseModel):
    rule_id: str
    result: Literal["PASS", "FAIL", "NEEDS_INFO"]
    detail: str


class ComplianceResult(BaseModel):
    application_ref: str
    ruleset_version: str
    checks: list[RuleResult]
    status: Literal["PASS", "FAIL", "NEEDS_INFO"] = Field(
        description="Worst-case status across all checks: any FAIL -> FAIL, "
        "else any NEEDS_INFO -> NEEDS_INFO, else PASS."
    )
