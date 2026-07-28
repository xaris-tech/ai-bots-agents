from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]

# No scraping here. Reuses data/raw/bids.json, the combined feed the sheet
# sync already wrote, then filters it by the client's keyword lists and
# pushes to the two ClickUp lists (Aggregates Supply, General Construction).
# Assignment to the default assignee and dedupe-by-name both happen inside
# push-clickup-tasks.mjs.
PIPELINE_STEPS: list[list[str]] = [
    ["node", "--env-file=.env", "scripts/push-clickup-tasks.mjs"],
]

BIDS_FEED_PATH = PROJECT_ROOT / "data" / "raw" / "bids.json"


class ClickUpSyncError(RuntimeError):
    def __init__(self, step: str, message: str, logs: list[str] | None = None) -> None:
        super().__init__(f"{step} failed: {message}")
        self.step = step
        self.message = message
        self.logs = logs or []


async def _run_step(command: list[str], logs: list[str]) -> str:
    logs.append(f"$ {' '.join(command)}")
    process = await asyncio.create_subprocess_exec(
        *command,
        cwd=PROJECT_ROOT,
        env={**os.environ, "HEADLESS": os.environ.get("HEADLESS", "1")},
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await process.communicate()
    stdout_text = stdout.decode().strip()
    stderr_text = stderr.decode().strip()
    if stdout_text:
        logs.append(stdout_text)
    if stderr_text:
        logs.append(stderr_text)
    if process.returncode != 0:
        message = stderr_text or stdout_text
        raise ClickUpSyncError(" ".join(command), message[-1500:], logs=logs)
    return stdout_text


def _read_json(relative_path: str, fallback: Any) -> Any:
    path = PROJECT_ROOT / relative_path
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return fallback


async def sync_bids_to_clickup() -> dict[str, Any]:
    """Filter the already-scraped bid feed (data/raw/bids.json, written by the
    sheet sync) against the Aggregates/General Construction keyword lists and
    push matches into their ClickUp lists. Does not scrape anything itself —
    run a sheet sync first so the feed is current.
    """
    if not BIDS_FEED_PATH.exists():
        raise ClickUpSyncError(
            "sync_bids_to_clickup",
            "No scraped bid data found (data/raw/bids.json missing). Run 'Scrape + sync sheet' first.",
        )

    logs: list[str] = []
    for command in PIPELINE_STEPS:
        await _run_step(command, logs)

    report = _read_json("data/out/clickup-push-report.json", {})

    return {
        "status": "completed",
        "total_bids": report.get("totalBids", 0),
        "matched_aggregates": report.get("matched", {}).get("aggregates", 0),
        "matched_general_construction": report.get("matched", {}).get("generalConstruction", 0),
        "created": report.get("created", 0),
        "skipped": report.get("skipped", 0),
        "aggregates_list_url": report.get("lists", {}).get("aggregates", {}).get("url", ""),
        "general_construction_list_url": report.get("lists", {}).get("generalConstruction", {}).get("url", ""),
        "logs": logs,
    }
