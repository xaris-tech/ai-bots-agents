from __future__ import annotations

import json
from typing import Any

import psycopg
from psycopg.rows import dict_row

from app.bid_models import CompanyProfile


class PostgresBidReader:
    """Read-only production bid path backed by Supabase PostgreSQL."""

    def __init__(self, database_url: str) -> None:
        if not database_url.strip():
            raise ValueError("DATABASE_URL must not be empty")
        self.database_url = database_url

    def _connect(self) -> psycopg.Connection[dict[str, Any]]:
        return psycopg.connect(
            self.database_url, row_factory=dict_row, prepare_threshold=None
        )

    def list_bids(self, platform: str | None = None) -> list[dict[str, Any]]:
        query = "SELECT * FROM public.bids WHERE is_current = true"
        parameters: tuple[str, ...] = ()
        if platform:
            query += " AND platform = %s"
            parameters = (platform,)
        query += " ORDER BY due_date NULLS LAST, title"
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(query, parameters)
            rows = cursor.fetchall()
        return [self._normalize_bid_row(row) for row in rows]

    def get_company_profile(self) -> CompanyProfile:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT profile_json FROM public.company_profiles "
                "ORDER BY version DESC LIMIT 1"
            )
            row = cursor.fetchone()
        if row is None:
            return CompanyProfile()
        return CompanyProfile.model_validate(row["profile_json"])

    def latest_publication_run(self) -> dict[str, Any] | None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                select r.run_id, r.status, r.started_at, r.finished_at,
                       r.bid_count, r.created_at, d.id as publisher_id,
                       d.display_name as publisher_name
                from public.publication_runs r
                join public.publisher_devices d on d.id = r.publisher_id
                order by r.created_at desc limit 1
                """
            )
            run = cursor.fetchone()
            if run is None:
                return None
            cursor.execute(
                """
                select source_id, status, warning, record_count, retained_count,
                       checked_at
                from public.entity_check_results
                where run_id = %s order by source_id
                """,
                (run["run_id"],),
            )
            checks = cursor.fetchall()
        result = dict(run)
        result["entity_checks"] = [dict(check) for check in checks]
        return result

    @staticmethod
    def _normalize_bid_row(row: dict[str, Any]) -> dict[str, Any]:
        normalized = dict(row)
        raw = normalized.get("raw_json", {})
        normalized["raw_json"] = raw if isinstance(raw, str) else json.dumps(raw)
        return normalized
