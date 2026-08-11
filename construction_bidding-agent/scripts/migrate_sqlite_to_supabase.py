from __future__ import annotations

import argparse
import json
import os
import sqlite3
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

import psycopg
from dotenv import load_dotenv
from psycopg.types.json import Jsonb

from app.bid_models import BidInput
from app.publisher import consolidation_key


MIGRATION_RUN_ID = uuid5(NAMESPACE_URL, "cortex-bid-desk:sqlite-migration:v1")
MIGRATION_PUBLISHER = "migration-local"


def read_source(path: Path) -> tuple[list[dict], list[dict]]:
    with sqlite3.connect(path) as connection:
        connection.row_factory = sqlite3.Row
        bids = [dict(row) for row in connection.execute("select * from bids where is_current = 1")]
        profiles = [dict(row) for row in connection.execute("select * from company_profiles")]
    return bids, profiles


def migrate(database_url: str, bids: list[dict], profiles: list[dict]) -> None:
    with psycopg.connect(database_url, prepare_threshold=None) as connection:
        connection.execute(
            """
            insert into public.publisher_devices (id, display_name, key_salt, key_hash)
            values (%s, 'One-time SQLite migration', %s, %s)
            on conflict (id) do nothing
            """,
            (MIGRATION_PUBLISHER, b"0" * 16, b"0" * 32),
        )
        connection.execute(
            """
            insert into public.publication_runs
              (run_id, publisher_id, schema_version, status, started_at,
               finished_at, bid_count, content_checksum, result_json)
            values (%s, %s, 1, 'completed', now(), now(), %s, %s, %s)
            on conflict (run_id) do update set bid_count = excluded.bid_count
            """,
            (
                MIGRATION_RUN_ID,
                MIGRATION_PUBLISHER,
                len(bids),
                "0" * 64,
                Jsonb({"migration": True, "bid_count": len(bids)}),
            ),
        )
        for row in bids:
            raw = json.loads(row["raw_json"])
            bid = BidInput.model_validate(raw)
            key = consolidation_key(bid)
            source_id = str(raw.get("sourceId") or raw.get("source_id") or bid.platform)
            source_links = raw.get("sourceLinks") or raw.get("source_links") or [bid.bid_url or ""]
            connection.execute(
                """
                insert into public.bids
                  (dedupe_key, platform, bid_id, title, agency, location,
                   due_date, bid_url, documents_url, estimated_value,
                   description, scraped_at, raw_json, is_current, updated_at)
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                        nullif(%s,'')::timestamptz,%s,true,now())
                on conflict (dedupe_key) do update set raw_json=excluded.raw_json,
                  title=excluded.title, is_current=true, updated_at=now()
                """,
                (
                    key, bid.platform, bid.bid_id, bid.title, bid.agency,
                    bid.location, bid.due_date, bid.bid_url, bid.documents_url,
                    bid.estimated_value, bid.description, bid.scraped_at, Jsonb(raw),
                ),
            )
            for link in dict.fromkeys(map(str, source_links)):
                connection.execute(
                    """
                    insert into public.opportunity_sources
                      (dedupe_key, source_id, source_url, first_seen_run_id, last_seen_run_id)
                    values (%s,%s,%s,%s,%s)
                    on conflict (dedupe_key, source_id, source_url) do update set
                      is_current=true, last_seen_run_id=excluded.last_seen_run_id,
                      updated_at=now()
                    """,
                    (key, source_id, link, MIGRATION_RUN_ID, MIGRATION_RUN_ID),
                )
        for row in profiles:
            connection.execute(
                """
                insert into public.company_profiles(version, profile_json, created_at)
                values (%s,%s,%s::timestamptz)
                on conflict (version) do update set profile_json=excluded.profile_json
                """,
                (row["version"], Jsonb(json.loads(row["profile_json"])), row["created_at"]),
            )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default=os.getenv("BID_DATABASE_PATH", "data/bid-copilot.db"))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--yes", action="store_true")
    args = parser.parse_args()
    source = Path(args.source)
    if not source.is_file():
        raise SystemExit("SQLite source database not found")
    bids, profiles = read_source(source)
    print(f"Migration plan: bids={len(bids)} profiles={len(profiles)}")
    if args.dry_run:
        print("Dry run: no Supabase changes")
        return
    if not args.yes:
        raise SystemExit("Production migration requires --yes")
    load_dotenv(dotenv_path=".env")
    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        raise SystemExit("DATABASE_URL is required")
    migrate(database_url, bids, profiles)
    print(f"Migration complete: bids={len(bids)} profiles={len(profiles)}")


if __name__ == "__main__":
    main()
