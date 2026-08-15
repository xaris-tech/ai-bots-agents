import ssl

import certifi

from app.clickup_cleanup import CLEANUP_LIST_IDS, PROSPECTS_LIST_ID, _clickup_ssl_context, _duplicate_task_ids


def test_clickup_ssl_context_uses_packaged_ca_bundle(monkeypatch) -> None:
    captured: dict[str, str] = {}
    expected = ssl.create_default_context()

    def fake_create_default_context(*, cafile: str) -> ssl.SSLContext:
        captured["cafile"] = cafile
        return expected

    monkeypatch.setattr(ssl, "create_default_context", fake_create_default_context)

    result = _clickup_ssl_context()

    assert result is expected
    assert captured["cafile"] == certifi.where()


def test_cleanup_is_scoped_to_bid_opportunities_prospects() -> None:
    assert CLEANUP_LIST_IDS == (PROSPECTS_LIST_ID,)


def test_duplicate_cleanup_keeps_oldest_prospects_copy() -> None:
    tasks = [
        {
            "id": "older-copy",
            "name": "  Road Base Supply - Tarrant County ",
            "list": {"id": PROSPECTS_LIST_ID},
            "tags": [],
            "date_created": "100",
        },
        {
            "id": "newer-copy",
            "name": "Road Base Supply – Tarrant County",
            "list": {"id": PROSPECTS_LIST_ID},
            "tags": [{"name": "dedupe-abc123"}],
            "date_created": "200",
        },
    ]

    assert _duplicate_task_ids(tasks) == {"newer-copy"}


def test_duplicate_cleanup_uses_dedupe_tag_when_agency_format_differs() -> None:
    tasks = [
        {
            "id": "older-prospect",
            "name": "Concrete Work - City of Irving, TX",
            "list": {"id": PROSPECTS_LIST_ID},
            "tags": [{"name": "dedupe-shared"}],
            "date_created": "100",
        },
        {
            "id": "newer-prospect",
            "name": "Concrete Work - City of Irving",
            "list": {"id": PROSPECTS_LIST_ID},
            "tags": [{"name": "dedupe-shared"}],
            "date_created": "200",
        },
    ]

    assert _duplicate_task_ids(tasks) == {"newer-prospect"}


def test_duplicate_cleanup_does_not_merge_distinct_tasks_with_same_title() -> None:
    tasks = [
        {
            "id": "one",
            "name": "Concrete Work - City of Irving",
            "list": {"id": PROSPECTS_LIST_ID},
            "tags": [{"name": "dedupe-one"}],
        },
        {
            "id": "two",
            "name": "Concrete Work - City of Dallas",
            "list": {"id": PROSPECTS_LIST_ID},
            "tags": [{"name": "dedupe-two"}],
        },
    ]

    assert _duplicate_task_ids(tasks) == set()


def test_duplicate_cleanup_consolidates_tag_and_name_chains() -> None:
    tasks = [
        {
            "id": "tagged-original",
            "name": "Road Base - Tarrant County, TX",
            "tags": [{"name": "dedupe-shared"}],
            "date_created": "100",
        },
        {
            "id": "bridge-copy",
            "name": "Road Base - Tarrant County",
            "tags": [{"name": "dedupe-shared"}],
            "date_created": "200",
        },
        {
            "id": "oldest-legacy-copy",
            "name": "Road Base - Tarrant County",
            "tags": [],
            "date_created": "50",
        },
    ]

    assert _duplicate_task_ids(tasks) == {"tagged-original", "bridge-copy"}
