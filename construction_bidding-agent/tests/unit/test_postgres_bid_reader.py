from __future__ import annotations

import json

from app.bid_models import CompanyProfile
from app.postgres_bid_reader import PostgresBidReader


class FakeCursor:
    def __init__(self, rows):
        self.rows = rows
        self.query = ""
        self.parameters = ()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def execute(self, query, parameters=()):
        self.query = query
        self.parameters = parameters

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.rows[0] if self.rows else None


class FakeConnection:
    def __init__(self, cursor):
        self.fake_cursor = cursor

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def cursor(self):
        return self.fake_cursor


def test_list_bids_returns_sqlite_compatible_raw_json(monkeypatch) -> None:
    cursor = FakeCursor(
        [
            {
                "dedupe_key": "bid-1",
                "platform": "CivicEngage",
                "raw_json": {"platform": "CivicEngage", "title": "Road bid"},
            }
        ]
    )
    reader = PostgresBidReader("postgresql://example")
    monkeypatch.setattr(reader, "_connect", lambda: FakeConnection(cursor))

    rows = reader.list_bids(platform="CivicEngage")

    assert json.loads(rows[0]["raw_json"])["title"] == "Road bid"
    assert "platform = %s" in cursor.query
    assert cursor.parameters == ("CivicEngage",)


def test_get_company_profile_uses_latest_profile(monkeypatch) -> None:
    expected = CompanyProfile(version=3, service_areas=["Texas"])
    cursor = FakeCursor([{"profile_json": expected.model_dump()}])
    reader = PostgresBidReader("postgresql://example")
    monkeypatch.setattr(reader, "_connect", lambda: FakeConnection(cursor))

    assert reader.get_company_profile() == expected
