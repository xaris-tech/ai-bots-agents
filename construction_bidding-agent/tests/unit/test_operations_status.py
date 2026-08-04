import json

from app.operations_status import build_operations_status


def test_build_operations_status_combines_run_reconciliation_and_bids(tmp_path) -> None:
    operations = tmp_path / "operations.json"
    reconciliation = tmp_path / "reconciliation.json"
    bids = tmp_path / "bids.json"
    operations.write_text(json.dumps({
        "generatedAt": "2026-08-04T08:43:02.211Z",
        "status": "Completed with blockers/warnings",
        "totalEntities": 108,
        "passedEntities": 88,
        "failedEntities": 20,
        "verifiedEmptyEntities": 43,
        "entityAuditPassRate": 81.48,
        "readyEntityProfileCoverage": {"ready": 112, "total": 139, "percent": 80.58},
        "onboardingGapCount": 27,
        "listingsCaptured": 2,
        "categoryCounts": {"aggregate": 1, "construction": 1, "both": 0, "neither": 0},
        "pipelineErrors": [],
        "failures": [{"sourceId": "blocked-site"}],
    }))
    reconciliation.write_text(json.dumps({
        "dispositionCounts": {"direct-profile": 102, "batch-owned": 10, "manual": 16, "blocked": 11, "unresolved": 0}
    }))
    bids.write_text(json.dumps([
        {"title": "One", "sourceLinks": ["https://one.test", "https://mirror.test"]},
        {"title": "Two", "sourceLinks": []},
    ]))

    result = build_operations_status(operations, reconciliation, bids)

    assert result["coverage"]["ready"] == 112
    assert result["dispositions"]["direct-profile"] == 102
    assert result["runtime"] == {
        "total": 108, "passed": 88, "failed": 20, "verified_empty": 43, "audit_pass_rate": 81.48
    }
    assert result["consolidation"] == {
        "records": 2, "records_without_source_links": 1, "records_with_multiple_source_links": 1
    }
    assert result["failure_count"] == 1


def test_build_operations_status_handles_missing_reports(tmp_path) -> None:
    result = build_operations_status(
        tmp_path / "missing-operations.json",
        tmp_path / "missing-reconciliation.json",
        tmp_path / "missing-bids.json",
    )

    assert result["has_data"] is False
    assert result["coverage"] == {}
    assert result["consolidation"]["records"] == 0
