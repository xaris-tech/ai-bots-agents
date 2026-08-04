"""Read-only dashboard summary for the latest scraper operations run."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
OPERATIONS_REPORT = PROJECT_ROOT / "data" / "out" / "scraper-operations-report.json"
RECONCILIATION_REPORT = PROJECT_ROOT / "data" / "out" / "target-entity-reconciliation.json"
BIDS_FILE = PROJECT_ROOT / "data" / "raw" / "bids.json"
REGISTRY_URL = (
    "https://docs.google.com/spreadsheets/d/"
    "12bRxCgN764J9fc0wmvINDkgXtO3Ow_tcMix9KgF6o5I/edit?gid=77846233#gid=77846233"
)


def _load_json(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return fallback


def build_operations_status(
    operations_path: Path = OPERATIONS_REPORT,
    reconciliation_path: Path = RECONCILIATION_REPORT,
    bids_path: Path = BIDS_FILE,
) -> dict[str, Any]:
    operations = _load_json(operations_path, {})
    reconciliation = _load_json(reconciliation_path, {})
    bids = _load_json(bids_path, [])
    if not isinstance(bids, list):
        bids = []

    without_links = 0
    with_multiple_links = 0
    for bid in bids:
        links = bid.get("sourceLinks") if isinstance(bid, dict) else []
        links = links if isinstance(links, list) else []
        if not links:
            without_links += 1
        if len(links) > 1:
            with_multiple_links += 1

    coverage = operations.get("readyEntityProfileCoverage") or reconciliation.get("coverage") or {}
    coverage_by_tab = operations.get("readyEntityProfileCoverageByTab") or reconciliation.get("tabs") or []

    return {
        "has_data": bool(operations),
        "generated_at": operations.get("generatedAt"),
        "status": operations.get("status", "No operations report"),
        "coverage": coverage,
        "coverage_by_tab": coverage_by_tab,
        "dispositions": reconciliation.get("dispositionCounts", {}),
        "onboarding_gap_count": operations.get("onboardingGapCount", 0),
        "runtime": {
            "total": operations.get("totalEntities", 0),
            "passed": operations.get("passedEntities", 0),
            "failed": operations.get("failedEntities", 0),
            "verified_empty": operations.get("verifiedEmptyEntities", 0),
            "audit_pass_rate": operations.get("entityAuditPassRate", 0),
        },
        "listings": {
            "captured": operations.get("listingsCaptured", len(bids)),
            "categories": operations.get("categoryCounts", {}),
        },
        "consolidation": {
            "records": len(bids),
            "records_without_source_links": without_links,
            "records_with_multiple_source_links": with_multiple_links,
        },
        "pipeline_errors": operations.get("pipelineErrors", []),
        "failure_count": len(operations.get("failures", [])),
        "registry_url": REGISTRY_URL,
    }
