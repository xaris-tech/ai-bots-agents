from __future__ import annotations

import subprocess
import sys
from datetime import date

from app.bid_models import BidInput, PortalRunInput
from app.repository import BidRepository


def test_migration_dry_run_reports_counts_without_database_connection(tmp_path) -> None:
    source = tmp_path / "source.db"
    repository = BidRepository(source)
    repository.record_portal_run(
        PortalRunInput.success(
            "CivicEngage",
            [
                BidInput(
                    platform="CivicEngage",
                    title="Migration test bid",
                    due_date=date(2099, 12, 31),
                )
            ],
        )
    )

    result = subprocess.run(
        [
            sys.executable,
            "scripts/migrate_sqlite_to_supabase.py",
            "--source",
            str(source),
            "--dry-run",
        ],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0
    assert "bids=1 profiles=1" in result.stdout
    assert "no Supabase changes" in result.stdout
