from datetime import date

from app.bid_models import ActionProposalInput, BidInput, CompanyProfile, PortalRunInput
from app.repository import BidRepository


def test_successful_run_upserts_without_duplicates(tmp_path) -> None:
    repository = BidRepository(tmp_path / "bids.db")
    bid = BidInput(
        platform="IonWave",
        bid_id="ITB-42",
        title="Drainage construction",
        agency="Tarrant County",
        due_date=date(2026, 8, 1),
    )

    repository.record_portal_run(PortalRunInput.success("IonWave", [bid]))
    repository.record_portal_run(PortalRunInput.success("IonWave", [bid]))

    rows = repository.list_bids()
    assert len(rows) == 1
    assert rows[0]["bid_id"] == "ITB-42"


def test_failed_run_preserves_last_known_good_records(tmp_path) -> None:
    repository = BidRepository(tmp_path / "bids.db")
    bid = BidInput(
        platform="Bonfire",
        title="Road reconstruction",
        agency="City of Example",
        due_date=date(2026, 8, 1),
    )
    repository.record_portal_run(PortalRunInput.success("Bonfire", [bid]))

    repository.record_portal_run(
        PortalRunInput.failure("Bonfire", "Authentication required")
    )

    rows = repository.list_bids(platform="Bonfire")
    assert len(rows) == 1
    assert rows[0]["title"] == "Road reconstruction"
    latest = repository.latest_portal_run("Bonfire")
    assert latest["status"] == "failed"
    assert latest["record_count"] == 0


def test_zero_result_run_is_suspicious_and_preserves_records(tmp_path) -> None:
    repository = BidRepository(tmp_path / "bids.db")
    bid = BidInput(
        platform="DemandStar",
        title="Bridge repair",
        agency="Example County",
        due_date=date(2026, 8, 1),
    )
    repository.record_portal_run(PortalRunInput.success("DemandStar", [bid]))

    repository.record_portal_run(PortalRunInput.success("DemandStar", []))

    assert len(repository.list_bids(platform="DemandStar")) == 1
    assert repository.latest_portal_run("DemandStar")["status"] == "suspicious"


def test_expired_bids_are_not_listed_as_current(tmp_path) -> None:
    repository = BidRepository(tmp_path / "bids.db")
    repository.record_portal_run(
        PortalRunInput.success(
            "Bonfire",
            [
                BidInput(
                    platform="Bonfire",
                    title="Expired invitation",
                    due_date=date(2025, 1, 1),
                )
            ],
        )
    )

    assert repository.list_bids(platform="Bonfire") == []


def test_company_profile_updates_are_versioned(tmp_path) -> None:
    repository = BidRepository(tmp_path / "bids.db")

    initial = repository.get_company_profile()
    updated = repository.save_company_profile(
        CompanyProfile(service_areas=["Texas"], minimum_lead_days=14)
    )

    assert initial.version == 1
    assert updated.version == 2
    assert updated.service_areas == ["Texas"]


def test_action_proposal_requires_matching_hash_for_approval(tmp_path) -> None:
    repository = BidRepository(tmp_path / "bids.db")
    bid = BidInput(
        platform="IonWave",
        bid_id="ITB-42",
        title="Drainage construction",
        bid_url="https://example.test/bids/42",
    )
    repository.record_portal_run(PortalRunInput.success("IonWave", [bid]))
    proposal = repository.create_action_proposal(
        ActionProposalInput(
            destination="clickup",
            action="create_tasks",
            payload={"bid_keys": ["IonWave|itb 42||"]},
        )
    )

    assert proposal["status"] == "pending"
    assert proposal["payload"]["tasks"][0]["title"] == "Drainage construction"
    assert repository.approve_action_proposal(
        proposal["id"], proposal["payload_hash"]
    )["status"] == "approved"


def test_action_proposal_rejects_destructive_actions(tmp_path) -> None:
    repository = BidRepository(tmp_path / "bids.db")

    try:
        repository.create_action_proposal(
            ActionProposalInput(
                destination="clickup", action="delete_tasks", payload={}
            )
        )
    except ValueError as error:
        assert "delete_tasks" in str(error)
    else:
        raise AssertionError("Destructive proposal was accepted")


def test_action_proposal_rejects_empty_or_stale_selection(tmp_path) -> None:
    repository = BidRepository(tmp_path / "bids.db")

    try:
        repository.create_action_proposal(
            ActionProposalInput(
                destination="google_sheets",
                action="upsert_bids",
                payload={"bid_keys": ["missing"]},
            )
        )
    except ValueError as error:
        assert "current bids" in str(error)
    else:
        raise AssertionError("Stale selection was accepted")
