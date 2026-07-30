from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

from app.bid_models import ActionProposalInput, BidInput, CompanyProfile, PortalRunInput


class BidRepository:
    def __init__(self, database_path: str | Path) -> None:
        self.database_path = Path(database_path)
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS portal_runs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    platform TEXT NOT NULL,
                    status TEXT NOT NULL,
                    warning TEXT NOT NULL DEFAULT '',
                    record_count INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS bids (
                    dedupe_key TEXT PRIMARY KEY,
                    platform TEXT NOT NULL,
                    bid_id TEXT NOT NULL DEFAULT '',
                    title TEXT NOT NULL,
                    agency TEXT NOT NULL DEFAULT '',
                    location TEXT NOT NULL DEFAULT '',
                    due_date TEXT,
                    bid_url TEXT NOT NULL DEFAULT '',
                    documents_url TEXT NOT NULL DEFAULT '',
                    estimated_value TEXT NOT NULL DEFAULT '',
                    description TEXT NOT NULL DEFAULT '',
                    scraped_at TEXT NOT NULL DEFAULT '',
                    raw_json TEXT NOT NULL,
                    is_current INTEGER NOT NULL DEFAULT 1,
                    last_seen_run_id INTEGER NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(last_seen_run_id) REFERENCES portal_runs(id)
                );

                CREATE TABLE IF NOT EXISTS company_profiles (
                    version INTEGER PRIMARY KEY,
                    profile_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS action_proposals (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    destination TEXT NOT NULL,
                    action TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    payload_hash TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    approved_at TEXT
                );
                """
            )
            count = connection.execute(
                "SELECT COUNT(*) FROM company_profiles"
            ).fetchone()[0]
            if count == 0:
                profile = CompanyProfile()
                connection.execute(
                    """
                    INSERT INTO company_profiles(version, profile_json, created_at)
                    VALUES (?, ?, ?)
                    """,
                    (1, profile.model_dump_json(), datetime.now(UTC).isoformat()),
                )

    def record_portal_run(self, run: PortalRunInput) -> dict[str, Any]:
        effective_status = run.status
        warning = run.warning
        if run.status == "success" and not run.bids:
            effective_status = "suspicious"
            warning = warning or "Portal returned zero records; current data preserved."

        now = datetime.now(UTC).isoformat()
        with self._connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO portal_runs(platform, status, warning, record_count, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (run.platform, effective_status, warning, len(run.bids), now),
            )
            run_id = int(cursor.lastrowid)

            if effective_status == "success":
                connection.execute(
                    "UPDATE bids SET is_current = 0 WHERE platform = ?",
                    (run.platform,),
                )
                for bid in run.bids:
                    self._upsert_bid(connection, bid, run_id, now)

        return self.latest_portal_run(run.platform)

    def begin_portal_run(self, platform: str) -> int:
        """Start a run that will be fed bids incrementally via upsert_bids
        (one call per scraped unit) instead of all at once like
        record_portal_run. Wipes is_current for the platform ONCE, up front,
        so later upsert_bids calls for the same run don't re-wipe sites that
        already reported in this run."""
        now = datetime.now(UTC).isoformat()
        with self._connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO portal_runs(platform, status, warning, record_count, created_at)
                VALUES (?, 'running', '', 0, ?)
                """,
                (platform, now),
            )
            connection.execute(
                "UPDATE bids SET is_current = 0 WHERE platform = ?", (platform,)
            )
            return int(cursor.lastrowid)

    def upsert_bids(self, bids: list[BidInput], run_id: int) -> None:
        if not bids:
            return
        now = datetime.now(UTC).isoformat()
        with self._connect() as connection:
            for bid in bids:
                self._upsert_bid(connection, bid, run_id, now)
            connection.execute(
                "UPDATE portal_runs SET record_count = record_count + ? WHERE id = ?",
                (len(bids), run_id),
            )

    def finish_portal_run(self, run_id: int, status: str, warning: str) -> dict[str, Any]:
        with self._connect() as connection:
            connection.execute(
                "UPDATE portal_runs SET status = ?, warning = ? WHERE id = ?",
                (status, warning, run_id),
            )
            row = connection.execute(
                "SELECT * FROM portal_runs WHERE id = ?", (run_id,)
            ).fetchone()
        return dict(row)

    def _upsert_bid(
        self,
        connection: sqlite3.Connection,
        bid: BidInput,
        run_id: int,
        now: str,
    ) -> None:
        values = (
            dedupe_key(bid),
            bid.platform,
            bid.bid_id,
            bid.title,
            bid.agency,
            bid.location,
            bid.due_date.isoformat() if bid.due_date else None,
            bid.bid_url,
            bid.documents_url,
            bid.estimated_value,
            bid.description,
            bid.scraped_at,
            bid.model_dump_json(),
            run_id,
            now,
        )
        connection.execute(
            """
            INSERT INTO bids (
                dedupe_key, platform, bid_id, title, agency, location, due_date,
                bid_url, documents_url, estimated_value, description, scraped_at,
                raw_json, last_seen_run_id, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(dedupe_key) DO UPDATE SET
                title = excluded.title,
                agency = excluded.agency,
                location = excluded.location,
                due_date = excluded.due_date,
                bid_url = excluded.bid_url,
                documents_url = excluded.documents_url,
                estimated_value = excluded.estimated_value,
                description = excluded.description,
                scraped_at = excluded.scraped_at,
                raw_json = excluded.raw_json,
                is_current = 1,
                last_seen_run_id = excluded.last_seen_run_id,
                updated_at = excluded.updated_at
            """,
            values,
        )

    def list_bids(self, *, platform: str | None = None) -> list[dict[str, Any]]:
        query = """
            SELECT * FROM bids
            WHERE is_current = 1 AND (due_date IS NULL OR due_date >= ?)
        """
        parameters: tuple[Any, ...] = (date.today().isoformat(),)
        if platform:
            query += " AND platform = ?"
            parameters += (platform,)
        query += " ORDER BY due_date IS NULL, due_date, title"
        with self._connect() as connection:
            return [dict(row) for row in connection.execute(query, parameters)]

    def delete_expired_bids(self) -> int:
        """Permanently remove bids whose due_date has passed.

        list_bids() already excludes these from what the dashboard shows, so
        this is storage hygiene (the bids table otherwise grows forever) —
        it never changes what's currently visible in the Opportunities tab.
        """
        with self._connect() as connection:
            cursor = connection.execute(
                "DELETE FROM bids WHERE due_date IS NOT NULL AND due_date < ?",
                (date.today().isoformat(),),
            )
            return cursor.rowcount

    def latest_portal_run(self, platform: str) -> dict[str, Any]:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT * FROM portal_runs
                WHERE platform = ? ORDER BY id DESC LIMIT 1
                """,
                (platform,),
            ).fetchone()
        if row is None:
            raise LookupError(f"No portal run found for {platform}")
        return dict(row)

    def get_company_profile(self) -> CompanyProfile:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT profile_json FROM company_profiles
                ORDER BY version DESC LIMIT 1
                """
            ).fetchone()
        if row is None:
            return CompanyProfile()
        return CompanyProfile.model_validate_json(row["profile_json"])

    def save_company_profile(self, profile: CompanyProfile) -> CompanyProfile:
        current = self.get_company_profile()
        updated = profile.model_copy(update={"version": current.version + 1})
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO company_profiles(version, profile_json, created_at)
                VALUES (?, ?, ?)
                """,
                (
                    updated.version,
                    updated.model_dump_json(),
                    datetime.now(UTC).isoformat(),
                ),
            )
        return updated

    def create_action_proposal(
        self, proposal: ActionProposalInput
    ) -> dict[str, Any]:
        allowed_actions = {
            "google_sheets": {"upsert_bids"},
            "clickup": {"create_tasks", "update_tasks"},
        }
        if proposal.action not in allowed_actions[proposal.destination]:
            raise ValueError(
                f"Action {proposal.action!r} is not allowed for {proposal.destination}"
            )
        payload = self._materialize_action_payload(proposal)
        payload_json = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        payload_hash = hashlib.sha256(payload_json.encode()).hexdigest()
        now = datetime.now(UTC).isoformat()
        with self._connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO action_proposals(
                    destination, action, payload_json, payload_hash, status, created_at
                ) VALUES (?, ?, ?, ?, 'pending', ?)
                """,
                (
                    proposal.destination,
                    proposal.action,
                    payload_json,
                    payload_hash,
                    now,
                ),
            )
            proposal_id = int(cursor.lastrowid)
        return self.get_action_proposal(proposal_id)

    def _materialize_action_payload(
        self, proposal: ActionProposalInput
    ) -> dict[str, Any]:
        requested_keys = proposal.payload.get("bid_keys")
        if not isinstance(requested_keys, list) or not requested_keys:
            raise ValueError("Select at least one current bid")

        current_rows = {row["dedupe_key"]: row for row in self.list_bids()}
        selected_rows = [
            current_rows[key]
            for key in requested_keys
            if isinstance(key, str) and key in current_rows
        ]
        if len(selected_rows) != len(requested_keys):
            raise ValueError("One or more selected records are not current bids")

        records: list[dict[str, Any]] = []
        for row in selected_rows:
            bid = BidInput.model_validate_json(row["raw_json"])
            records.append(
                {
                    "dedupe_key": row["dedupe_key"],
                    "platform": bid.platform,
                    "bid_id": bid.bid_id,
                    "title": bid.title,
                    "agency": bid.agency,
                    "location": bid.location,
                    "due_date": bid.due_date.isoformat() if bid.due_date else None,
                    "estimated_value": bid.estimated_value,
                    "bid_url": bid.bid_url,
                    "documents_url": bid.documents_url,
                }
            )

        if proposal.destination == "google_sheets":
            return {
                "mode": "upsert_only",
                "spreadsheet_id": os.getenv(
                    "GOOGLE_SHEETS_SPREADSHEET_ID",
                    "1mtPEx2C_bHFGYoEFcc0gIsqr_KyW8fStxxhp3JQ5584",
                ),
                "tab": os.getenv("GOOGLE_SHEETS_BIDS_TAB", "Bids"),
                "key_column": "Cortex Key",
                "rows": records,
            }

        tasks = []
        for record in records:
            platform = str(record["platform"])
            tasks.append(
                {
                    **record,
                    "target_list_id": os.getenv(
                        f"CLICKUP_{platform.upper()}_LIST_ID", ""
                    ),
                    "operation": "create_or_update",
                }
            )
        return {
            "mode": "create_or_update_only",
            "workspace_id": os.getenv("CLICKUP_WORKSPACE_ID", "9011646920"),
            "tasks": tasks,
        }

    def get_action_proposal(self, proposal_id: int) -> dict[str, Any]:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM action_proposals WHERE id = ?", (proposal_id,)
            ).fetchone()
        if row is None:
            raise LookupError(f"Action proposal {proposal_id} was not found")
        result = dict(row)
        result["payload"] = json.loads(result.pop("payload_json"))
        return result

    def list_action_proposals(self) -> list[dict[str, Any]]:
        with self._connect() as connection:
            ids = [
                row["id"]
                for row in connection.execute(
                    "SELECT id FROM action_proposals ORDER BY id DESC"
                )
            ]
        return [self.get_action_proposal(proposal_id) for proposal_id in ids]

    def approve_action_proposal(
        self, proposal_id: int, payload_hash: str
    ) -> dict[str, Any]:
        proposal = self.get_action_proposal(proposal_id)
        if proposal["status"] != "pending":
            raise ValueError("Only pending action proposals can be approved")
        if proposal["payload_hash"] != payload_hash:
            raise ValueError("Proposal payload changed; approval hash does not match")
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE action_proposals
                SET status = 'approved', approved_at = ?
                WHERE id = ?
                """,
                (datetime.now(UTC).isoformat(), proposal_id),
            )
        return self.get_action_proposal(proposal_id)


def dedupe_key(bid: BidInput) -> str:
    identity = bid.bid_id or bid.title
    parts = [
        bid.platform,
        _normalize(identity),
        _normalize(bid.agency),
        bid.due_date.isoformat() if bid.due_date else "",
    ]
    return "|".join(parts)


def _normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.casefold()).strip()
