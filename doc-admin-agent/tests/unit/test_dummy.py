"""Unit test for the deterministic compliance tool — runs with no GCP
credentials, no model call. Proves the guardrail logic itself is correct
independent of whatever the LLM does around it.
"""

from app.tools import check_egress_rules


def test_riverside_block_b_fails_three_rules() -> None:
    result = check_egress_rules(
        storeys=4,
        mixed_use=True,
        corridor_width_mm=900,
        exit_count_level1=1,
        travel_distance_m=38,
        sprinkler_system="Not specified in drawings",
    )

    assert result["status"] == "FAIL"
    by_id = {c["rule_id"]: c["result"] for c in result["checks"]}
    assert by_id["EGR-01"] == "FAIL"  # corridor width
    assert by_id["EGR-02"] == "FAIL"  # exit count vs travel distance
    assert by_id["EGR-03"] == "FAIL"  # max travel distance
    assert by_id["FIRE-01"] == "NEEDS_INFO"  # sprinkler unspecified


def test_compliant_building_passes() -> None:
    result = check_egress_rules(
        storeys=2,
        mixed_use=False,
        corridor_width_mm=1200,
        exit_count_level1=1,
        travel_distance_m=15,
        sprinkler_system="Wet pipe, per NCC Spec",
    )

    assert result["status"] == "PASS"
    assert all(c["result"] == "PASS" for c in result["checks"])
