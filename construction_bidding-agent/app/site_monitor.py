"""Read-only site scraping monitor.

Joins the site catalog (`config/sites.json`, the source of truth for what
*should* be scraped) with the last-run outcome (`data/out/site-scrape-report.json`)
and the actual scraped bids (`data/raw/site-bids.json`) so the dashboard can show,
per configured site, whether the scraper ran correctly (no warning, count > 0) and
accurately (the actual bid titles it returned).

Pure reader: never triggers a scrape. Both report and bids files are regenerated
by the existing "Scrape + sync sheet" pipeline (`app/sheet_sync.py`).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SITES_CONFIG = PROJECT_ROOT / "config" / "sites.json"
SITE_REPORT = PROJECT_ROOT / "data" / "out" / "site-scrape-report.json"
SITE_BIDS = PROJECT_ROOT / "data" / "raw" / "site-bids.json"

# Cap the bids returned per site — enough to eyeball accuracy without shipping
# the whole 100KB feed to the browser on every poll.
MAX_BIDS_PER_SITE = 25


def _load_json(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return fallback


def _file_mtime_iso(path: Path) -> str | None:
    try:
        stamp = path.stat().st_mtime
    except OSError:
        return None
    return datetime.fromtimestamp(stamp, tz=timezone.utc).isoformat()


def _block_kind(warning: str) -> str:
    """Classify WHY a site failed from its warning text, so the UI can separate
    infrastructure blocks (nothing the scraper can fix) from genuine no-rows
    results (a possible parser problem worth investigating).

    cloudflare  - Cloudflare managed challenge; needs the real-Chrome CDP pass
    bot-block   - HTTP 403 / WAF / "bot protection"; not reachable headless
    origin-down - origin server unreachable (5xx / 522); site's fault, not ours
    network     - connection timeout / reset / geo-block (e.g. Public Purchase)
    ""          - no infra signal: the page loaded but no rows were recognized
    """
    text = warning.lower()
    if "cloudflare" in text:
        return "cloudflare"
    if "bot-block" in text or "bot protection" in text or "403" in text or "access denied" in text:
        return "bot-block"
    if "origin server unreachable" in text or "522" in text:
        return "origin-down"
    if (
        "err_connection" in text
        or "err_http2" in text
        or "err_name" in text
        or "net::" in text
        or "timeout" in text
        or "publicpurchase" in text
    ):
        return "network"
    return ""


def _classify(enabled: bool, entry: dict[str, Any] | None) -> str:
    """Derive a single health status for one configured site.

    disabled  - turned off in config, never expected to run
    never-run - enabled but absent from the last report
    healthy   - returned at least one fresh bid
    empty     - ran cleanly but found no open bids (a legitimate outcome)
    stale     - failed this run, fell back to previously scraped bids
    blocked   - failed to an infra wall (Cloudflare/403/geo/origin); not a scraper bug
    warning   - failed with no infra signal: page loaded, no rows recognized (parser suspect)
    """
    if not enabled:
        return "disabled"
    if entry is None:
        return "never-run"
    warning = str(entry.get("warning") or "").strip()
    count = int(entry.get("count") or 0)
    retained = int(entry.get("retainedCount") or 0)
    if count > 0:
        return "healthy"
    if warning and retained > 0:
        return "stale"
    if warning:
        return "blocked" if _block_kind(warning) else "warning"
    return "empty"


def build_site_monitor() -> dict[str, Any]:
    sites: list[dict[str, Any]] = _load_json(SITES_CONFIG, {}).get("sites", [])
    report_rows: list[dict[str, Any]] = _load_json(SITE_REPORT, [])
    bid_rows: list[dict[str, Any]] = _load_json(SITE_BIDS, [])

    report_by_id = {row.get("sourceId"): row for row in report_rows if row.get("sourceId")}

    bids_by_id: dict[str, list[dict[str, Any]]] = {}
    for bid in bid_rows:
        bids_by_id.setdefault(bid.get("sourceId", ""), []).append(bid)

    site_views: list[dict[str, Any]] = []
    status_totals: dict[str, int] = {}
    platform_totals: dict[str, dict[str, int]] = {}

    for site in sites:
        site_id = site.get("id", "")
        enabled = site.get("enabled", True)
        entry = report_by_id.get(site_id)
        status = _classify(enabled, entry)
        status_totals[status] = status_totals.get(status, 0) + 1

        platform = site.get("platform", "Unknown")
        bucket = platform_totals.setdefault(
            platform,
            {"total": 0, "healthy": 0, "warning": 0, "blocked": 0, "stale": 0, "empty": 0, "never-run": 0, "disabled": 0},
        )
        bucket["total"] += 1
        bucket[status] = bucket.get(status, 0) + 1

        raw_bids = bids_by_id.get(site_id, [])
        sample = [
            {
                "title": bid.get("title") or "Untitled",
                "bid_id": bid.get("bidId", ""),
                "due_date": bid.get("dueDate") or "",
                "bid_url": bid.get("bidUrl", ""),
            }
            for bid in raw_bids[:MAX_BIDS_PER_SITE]
        ]

        site_views.append(
            {
                "id": site_id,
                "agency": site.get("agency", ""),
                "location": site.get("location", ""),
                "county": site.get("county", ""),
                "platform": platform,
                "priority": site.get("priority"),
                "url": site.get("url", ""),
                "enabled": enabled,
                "status": status,
                "block_kind": _block_kind(str(entry.get("warning") or "")) if entry else "",
                "via": str(entry.get("via") or "") if entry else "",
                "count": int(entry.get("count") or 0) if entry else 0,
                "retained_count": int(entry.get("retainedCount") or 0) if entry else 0,
                "warning": str(entry.get("warning") or "") if entry else "",
                "bid_total": len(raw_bids),
                "bids": sample,
            }
        )

    # Surface broken sites first, then stale, then the rest, so the table opens
    # on whatever needs attention.
    status_order = {"warning": 0, "blocked": 1, "never-run": 2, "stale": 3, "empty": 4, "healthy": 5, "disabled": 6}
    site_views.sort(key=lambda item: (status_order.get(item["status"], 9), item["priority"] or 99, item["agency"]))

    platforms = [
        {"platform": name, **counts}
        for name, counts in sorted(platform_totals.items())
    ]

    return {
        "generated_at": _file_mtime_iso(SITE_REPORT),
        "bids_generated_at": _file_mtime_iso(SITE_BIDS),
        "has_report": SITE_REPORT.exists() and bool(report_rows),
        "summary": {
            "configured": len(sites),
            "enabled": sum(1 for site in sites if site.get("enabled", True)),
            "reported": len(report_rows),
            "healthy": status_totals.get("healthy", 0),
            "empty": status_totals.get("empty", 0),
            "stale": status_totals.get("stale", 0),
            "warning": status_totals.get("warning", 0),
            "blocked": status_totals.get("blocked", 0),
            "never_run": status_totals.get("never-run", 0),
            "disabled": status_totals.get("disabled", 0),
            "total_bids": len(bid_rows),
        },
        "platforms": platforms,
        "sites": site_views,
    }
