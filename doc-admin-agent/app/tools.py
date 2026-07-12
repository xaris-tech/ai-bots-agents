"""Deterministic tools. Anything with legal or filing consequence runs as
plain code here, not LLM arithmetic — the model calls these, it doesn't
compute rule thresholds itself.
"""

import json
from pathlib import Path

RULESET_PATH = Path(__file__).parent / "rules" / "egress_rules.json"


def check_egress_rules(
    storeys: int,
    mixed_use: bool,
    corridor_width_mm: int,
    exit_count_level1: int,
    travel_distance_m: float,
    sprinkler_system: str,
) -> dict:
    """Run extracted permit fields against the versioned egress ruleset.

    Pure function: same inputs always produce the same result, independent
    of the model. This is what makes the compliance step auditable.
    """
    ruleset = json.loads(RULESET_PATH.read_text())
    checks = []

    if corridor_width_mm < ruleset["min_corridor_width_mm"]:
        checks.append({
            "rule_id": "EGR-01",
            "result": "FAIL",
            "detail": f"Corridor width {corridor_width_mm}mm < required "
                      f"{ruleset['min_corridor_width_mm']}mm minimum.",
        })
    else:
        checks.append({"rule_id": "EGR-01", "result": "PASS", "detail": "Corridor width meets minimum."})

    if travel_distance_m > ruleset["exit_count_trigger_distance_m"] and exit_count_level1 < 2:
        checks.append({
            "rule_id": "EGR-02",
            "result": "FAIL",
            "detail": f"Travel distance {travel_distance_m}m > "
                      f"{ruleset['exit_count_trigger_distance_m']}m triggers 2-exit "
                      f"requirement; only {exit_count_level1} provided.",
        })
    else:
        checks.append({"rule_id": "EGR-02", "result": "PASS", "detail": "Exit count sufficient for travel distance."})

    if travel_distance_m > ruleset["max_travel_distance_m"]:
        checks.append({
            "rule_id": "EGR-03",
            "result": "FAIL",
            "detail": f"Travel distance {travel_distance_m}m exceeds "
                      f"{ruleset['max_travel_distance_m']}m maximum to a single exit.",
        })
    else:
        checks.append({"rule_id": "EGR-03", "result": "PASS", "detail": "Travel distance within limit."})

    if storeys > ruleset["sprinkler_required_over_storeys"] and mixed_use:
        if sprinkler_system.strip().lower() in ("not specified", "not specified in drawings", ""):
            checks.append({
                "rule_id": "FIRE-01",
                "result": "NEEDS_INFO",
                "detail": f"{storeys}-storey mixed-use triggers sprinkler requirement; "
                          f"drawings do not specify sprinkler system.",
            })
        else:
            checks.append({"rule_id": "FIRE-01", "result": "PASS", "detail": "Sprinkler system specified."})

    if any(c["result"] == "FAIL" for c in checks):
        status = "FAIL"
    elif any(c["result"] == "NEEDS_INFO" for c in checks):
        status = "NEEDS_INFO"
    else:
        status = "PASS"

    return {"ruleset_version": ruleset["version"], "checks": checks, "status": status}


def file_document(application_ref: str, category_tags: list[str], filed_path: str) -> dict:
    """File a document into the document management system.

    Stub for the real integration (Procore / Aconex / SharePoint API call).
    The before_tool_callback in agent.py blocks this call entirely unless
    the compliance step returned PASS — this function never sees a
    non-compliant document.
    """
    return {
        "status": "filed",
        "application_ref": application_ref,
        "filed_path": filed_path,
        "tags": category_tags,
    }


def open_review_task(application_ref: str, queue: str, reason: str) -> dict:
    """Open a task in the human review queue (e.g. surveyor sign-off)."""
    return {
        "status": "task_opened",
        "application_ref": application_ref,
        "queue": queue,
        "reason": reason,
    }
