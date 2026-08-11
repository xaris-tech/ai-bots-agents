import json

from app.bid_models import BidInput
from app.clickup_online import dedupe_tag, matches_clickup_keywords, sync_clickup_from_supabase


class FakeReader:
    def __init__(self, bids):
        self.bids = bids

    def list_bids(self):
        return [{"raw_json": json.dumps(bid.model_dump(mode="json"))} for bid in self.bids]


class FakeClient:
    def __init__(self, tasks=None):
        self.tasks = tasks or []
        self.created = []
        self.updated = []

    def list_tasks(self, **_kwargs):
        return self.tasks

    def create_task(self, payload):
        self.created.append(payload)

    def update_task_description(self, task_id, description):
        self.updated.append((task_id, description))


def bid(**overrides):
    values = {
        "platform": "IonWave",
        "bid_id": "BID-1",
        "title": "Road reconstruction",
        "agency": "City of Test",
        "location": "Fort Worth, TX",
        "due_date": "2026-09-01",
    }
    values.update(overrides)
    return BidInput.model_validate(values)


def test_keyword_filter_excludes_professional_services():
    assert matches_clickup_keywords(bid(title="Concrete paving improvements"))
    assert not matches_clickup_keywords(
        bid(title="Construction management consulting services")
    )


def test_keyword_filter_drops_civil_infrastructure_terms():
    removed_terms = [
        "stormwater", "landscaping", "culvert", "resurfacing", "paving",
        "sewer", "main line", "pump station", "wastewater", "lift station",
        "transmission main", "levee", "flood control", "traffic signal",
        "widening", "bridge",
    ]

    for term in removed_terms:
        assert not matches_clickup_keywords(bid(title=term)), term


def test_keyword_filter_keeps_commercial_remodel_trades():
    remodel_terms = [
        "carpentry", "structural steel", "framing", "roofing", "windows",
        "glazing", "stucco", "EIFS", "metal panel", "waterproofing",
        "sealants", "electrical", "plumbing", "HVAC", "fire protection",
        "sprinklers", "low-voltage", "data-comm", "drywall", "painting",
        "flooring", "tile", "carpet", "VCT", "epoxy", "ceilings", "ACT grid",
        "millwork", "cabinetry", "doors", "frames", "hardware", "fire alarm",
        "elevator", "signage", "insulation", "storefront systems",
        "concrete flatwork", "final cleaning", "permitting",
        "inspections coordination",
    ]

    for term in remodel_terms:
        assert matches_clickup_keywords(bid(title=term)), term


def test_sync_dedupes_and_drops_bare_non_texas_states():
    existing = bid(title="Existing concrete project", bid_id="EX-1")
    new = bid(title="New roofing project", bid_id="NEW-1")
    client = FakeClient(
        tasks=[{"id": "task-existing", "name": "different legacy name", "tags": [{"name": dedupe_tag(existing)}]}]
    )

    result = sync_clickup_from_supabase(
        FakeReader([existing, new, bid(location="Colorado")]), client
    )

    assert result["total_bids"] == 2
    assert result["matched"] == 2
    assert result["created"] == 1
    assert result["updated"] == 1
    assert result["skipped"] == 0
    assert client.created[0]["name"] == "New roofing project - City of Test"
    assert client.updated[0][0] == "task-existing"
    assert "**What the Bid Is About:** Existing concrete project" in client.updated[0][1]


def test_dry_run_reports_creation_without_mutating_clickup():
    client = FakeClient()

    result = sync_clickup_from_supabase(FakeReader([bid()]), client, dry_run=True)

    assert result["created"] == 1
    assert client.created == []
    assert client.updated == []


def test_task_description_explains_what_the_bid_is_for_and_its_scope():
    client = FakeClient()
    source_bid = bid(
        title="Commercial roofing replacement",
        due_date=None,
        bid_url="https://example.test/bids/roofing",
        documents_url="https://drive.example.test/folder",
        description=(
            "NOTICE OF BID | The Commissioners' Court will be accepting sealed bids "
            "for the purchase of the following: | Road Materials: | Not less than "
            "50,000 tons of flex base road material for county road maintenance."
        ),
    )

    sync_clickup_from_supabase(FakeReader([source_bid]), client)

    description = client.created[0]["markdown_description"]
    assert "**Due Date:** N/A" in description
    assert "**Bid URL:** https://example.test/bids/roofing" in description
    assert "**What the Bid Is About:** Road Materials" in description
    assert "**Purpose / Scope:** Not less than 50,000 tons of flex base road material for county road maintenance." in description
    assert "Commissioners' Court will be accepting" not in description
    assert "CEO Decision" not in description
    assert "Documents URL" not in description
    assert "https://drive.example.test/folder" not in description
