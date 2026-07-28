from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

from app.bid_models import BidInput, ScanOutcome, ScanProgress
from app.runtime import get_repository
from app.sheet_sync import PROJECT_ROOT

TMP_DIR = PROJECT_ROOT / "data" / "raw" / "scan-tmp"

# One node subprocess per site (own --output file, so parallel/partial runs
# never race on a shared file), run sequentially: scrape-sites.mjs launches a
# persistent Playwright profile at a fixed path, so two of these processes
# running at once would collide trying to lock the same profile directory.
BATCH_PORTALS = ("IonWave", "DemandStar", "Bonfire")


@dataclass
class _ScanUnit:
    label: str
    command: list[str]
    output_path: Path
    extra_env: dict[str, str] = field(default_factory=dict)
    # Set for batch-portal units, which can legitimately return zero bids
    # (still worth a finished portal_runs row) even when no site row exists.
    platform_hint: str | None = None


def _load_enabled_sites() -> list[dict[str, Any]]:
    config = json.loads((PROJECT_ROOT / "config" / "sites.json").read_text())
    return [site for site in config["sites"] if site.get("enabled", True)]


def _build_units() -> list[_ScanUnit]:
    sites = _load_enabled_sites()
    cloudflare_sites = [site for site in sites if site.get("cloudflare")]
    regular_sites = [site for site in sites if not site.get("cloudflare")]

    units: list[_ScanUnit] = []
    if cloudflare_sites:
        output = TMP_DIR / "cloudflare-batch.json"
        units.append(
            _ScanUnit(
                label=f"Cloudflare sites ({len(cloudflare_sites)})",
                command=[
                    "node", "--env-file=.env", "scripts/scrape-cloudflare-sites.mjs",
                    "--output", str(output),
                ],
                output_path=output,
            )
        )
    for site in regular_sites:
        output = TMP_DIR / f"{site['id']}.json"
        units.append(
            _ScanUnit(
                label=f"{site['agency']} ({site['platform']})",
                command=[
                    "node", "--env-file=.env", "scripts/scrape-sites.mjs",
                    "--site", site["id"], "--output", str(output),
                ],
                output_path=output,
            )
        )
    for platform in BATCH_PORTALS:
        output = TMP_DIR / f"portal-{platform.lower()}.json"
        units.append(
            _ScanUnit(
                label=f"{platform} (batch portal)",
                command=["node", "--env-file=.env", "scripts/scrape-bids.mjs", str(output)],
                output_path=output,
                extra_env={"ONLY_PLATFORM": platform},
                platform_hint=platform,
            )
        )
    return units


def _to_bid_input(record: dict[str, Any]) -> BidInput:
    due_date = None
    raw_due_date = record.get("dueDate")
    if raw_due_date:
        try:
            due_date = date.fromisoformat(raw_due_date[:10])
        except ValueError:
            due_date = None
    return BidInput(
        platform=record.get("platform", "Unknown"),
        bid_id=record.get("bidId", ""),
        title=record.get("title", ""),
        agency=record.get("agency", ""),
        location=record.get("location", ""),
        due_date=due_date,
        bid_url=record.get("bidUrl", ""),
        documents_url=record.get("documentsUrl", ""),
        estimated_value=record.get("estimatedValue", ""),
        description=record.get("description", ""),
        scraped_at=record.get("scrapedAt", ""),
    )


async def _run_unit(unit: _ScanUnit) -> tuple[list[dict[str, Any]], str]:
    env = {**os.environ, "HEADLESS": os.environ.get("HEADLESS", "1"), **unit.extra_env}
    process = await asyncio.create_subprocess_exec(
        *unit.command,
        cwd=PROJECT_ROOT,
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await process.communicate()
    if process.returncode != 0:
        message = (stderr.decode().strip() or stdout.decode().strip())[-500:]
        return [], message
    if not unit.output_path.exists():
        return [], "No output file produced"
    try:
        records = json.loads(unit.output_path.read_text())
    except (OSError, ValueError):
        return [], "Could not parse scan output"
    if not isinstance(records, list):
        return [], "Unexpected scan output shape"
    warning = "; ".join(
        dict.fromkeys(record.get("warning", "") for record in records if record.get("warning"))
    )[:500]
    return records, warning


_progress = ScanProgress(running=False)
_scan_task: asyncio.Task[None] | None = None


def get_full_scan_progress() -> ScanProgress:
    return _progress


async def _run_full_scan() -> None:
    global _progress
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    units = _build_units()
    _progress = ScanProgress(
        running=True,
        total_units=len(units),
        logs=[f"Starting full scan across {len(units)} sites/portals"],
    )
    repository = get_repository()
    platform_runs: dict[str, int] = {}
    platform_counts: dict[str, int] = {}
    platform_warnings: dict[str, list[str]] = {}

    def ensure_run(platform: str) -> int:
        if platform not in platform_runs:
            platform_runs[platform] = repository.begin_portal_run(platform)
            platform_counts[platform] = 0
            platform_warnings[platform] = []
        return platform_runs[platform]

    try:
        for unit in units:
            records, warning = await _run_unit(unit)
            bids_by_platform: dict[str, list[BidInput]] = {}
            for record in records:
                platform = record.get("platform", "Unknown")
                bids_by_platform.setdefault(platform, []).append(_to_bid_input(record))

            touched = set(bids_by_platform) | ({unit.platform_hint} if unit.platform_hint else set())
            for platform in touched:
                run_id = ensure_run(platform)
                bids = bids_by_platform.get(platform, [])
                if bids:
                    repository.upsert_bids(bids, run_id)
                    platform_counts[platform] += len(bids)
                    _progress.total_ingested += len(bids)
                if warning:
                    platform_warnings[platform].append(warning)

            _progress.completed_units += 1
            unit_count = sum(len(bids) for bids in bids_by_platform.values())
            _progress.logs.append(
                f"[{_progress.completed_units}/{_progress.total_units}] {unit.label}: {unit_count} records"
                + (f" - {warning}" if warning else "")
            )

        for platform, run_id in platform_runs.items():
            record_count = platform_counts.get(platform, 0)
            warning = "; ".join(dict.fromkeys(platform_warnings.get(platform, [])))[:1000]
            status = "success" if record_count > 0 else "failed"
            repository.finish_portal_run(run_id, status, warning)
            _progress.outcomes.append(
                ScanOutcome(platform=platform, status=status, record_count=record_count, warning=warning)
            )
    except Exception as error:  # background task: must not vanish silently, must always clear `running`
        _progress.error = str(error)
        _progress.logs.append(f"Full scan aborted: {error}")
    finally:
        _progress.running = False


def start_full_scan() -> ScanProgress:
    """Kick off the full scan in the background if one isn't already running,
    and return the current progress snapshot immediately."""
    global _scan_task
    if not _progress.running:
        _scan_task = asyncio.create_task(_run_full_scan())
    return _progress
