from __future__ import annotations

import asyncio
import json
import os
import tempfile
from pathlib import Path
from typing import Any

from app.bid_models import BidInput, PortalName, PortalRunInput


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def bid_from_raw(raw: dict[str, Any]) -> BidInput:
    return BidInput(
        platform=raw.get("platform", ""),
        bid_id=raw.get("bidId", ""),
        title=raw.get("title") or "Untitled Bid",
        agency=raw.get("agency", ""),
        location=raw.get("location", ""),
        due_date=raw.get("dueDate") or None,
        bid_url=raw.get("bidUrl", ""),
        documents_url=raw.get("documentsUrl", ""),
        estimated_value=raw.get("estimatedValue", ""),
        description=raw.get("description", ""),
        scraped_at=raw.get("scrapedAt", ""),
    )


def portal_result_from_payload(
    platform: PortalName,
    raw_bids: list[dict[str, Any]],
    report: dict[str, Any],
) -> PortalRunInput:
    warning = str(report.get("warning") or "")
    if warning:
        return PortalRunInput.failure(platform, warning)
    return PortalRunInput.success(platform, [bid_from_raw(item) for item in raw_bids])


async def scrape_portal(platform: PortalName) -> PortalRunInput:
    with tempfile.TemporaryDirectory(prefix=f"bid-{platform.casefold()}-") as temp_dir:
        output_path = Path(temp_dir) / "bids.json"
        report_path = Path(temp_dir) / "report.json"
        environment = {
            **os.environ,
            "ONLY_PLATFORM": platform,
            "SCRAPE_REPORT_PATH": str(report_path),
        }
        process = await asyncio.create_subprocess_exec(
            "node",
            "--env-file=.env",
            "scripts/scrape-bids.mjs",
            str(output_path),
            cwd=PROJECT_ROOT,
            env=environment,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()
        if process.returncode != 0:
            message = stderr.decode().strip() or stdout.decode().strip()
            return PortalRunInput.failure(
                platform, message[-1000:] or "Portal scraper failed"
            )

        try:
            raw_bids = json.loads(output_path.read_text())
            reports = json.loads(report_path.read_text())
            report = reports[0] if reports else {"platform": platform}
            return portal_result_from_payload(platform, raw_bids, report)
        except (OSError, ValueError, TypeError) as error:
            return PortalRunInput.failure(
                platform, f"Invalid scraper output: {error}"
            )


async def fetch_live_bid_page(url: str) -> dict[str, Any]:
    """Fetch a bid's live page via Playwright for accuracy cross-checking.

    Reuses the same persistent portal session Playwright uses for scraping,
    so authenticated portal pages (IonWave, DemandStar, Bonfire) resolve the
    same way a scrape would. Cloudflare-walled sites still won't load
    headlessly here (see docs/portal-ingestion-runbook.md) and come back as
    an error entry.
    """
    with tempfile.TemporaryDirectory(prefix="bid-verify-") as temp_dir:
        output_path = Path(temp_dir) / "verify.json"
        process = await asyncio.create_subprocess_exec(
            "node",
            "--env-file=.env",
            "scripts/verify-bid-page.mjs",
            url,
            str(output_path),
            cwd=PROJECT_ROOT,
            env=os.environ.copy(),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()
        if process.returncode != 0:
            message = stderr.decode().strip() or stdout.decode().strip()
            return {"url": url, "error": message[-1000:] or "Fetch failed"}
        try:
            return json.loads(output_path.read_text())
        except (OSError, ValueError) as error:
            return {"url": url, "error": f"Invalid verify output: {error}"}

