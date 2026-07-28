from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]

# Order matters: each step reads files the previous step wrote, using the
# repo's existing default paths (data/raw/*.json, data/out/*.json).
PIPELINE_STEPS: list[list[str]] = [
    ["node", "--env-file=.env", "scripts/scrape-sites.mjs"],
    ["node", "--env-file=.env", "scripts/scrape-bids.mjs"],
    ["node", "scripts/combine-bids.mjs"],
    ["node", "scripts/normalize-bids.mjs"],
    ["node", "scripts/build-site-tab-requests.mjs"],
    ["node", "scripts/build-sheets-update-requests.mjs"],
    ["node", "--env-file=.env", "scripts/push-to-google-sheet.mjs"],
]


class SheetSyncError(RuntimeError):
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
        raise SheetSyncError(" ".join(command), message[-1500:], logs=logs)
    return stdout_text


def _read_json(relative_path: str, fallback: Any) -> Any:
    path = PROJECT_ROOT / relative_path
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return fallback


async def sync_bids_to_sheet() -> dict[str, Any]:
    """Scrape every configured site/portal, then push the combined result to
    the Google Sheet. Runs the same steps as the CLI pipeline
    (scrape:sites -> scrape:bids -> combine:bids -> normalize:bids ->
    sheet:requests -> sheet:push) so the sheet always reflects a fresh scrape.
    """
    logs: list[str] = []
    for command in PIPELINE_STEPS:
        await _run_step(command, logs)

    bids = _read_json("data/raw/bids.json", [])
    report = _read_json("data/out/scrape-report.json", [])
    sheet_config = _read_json("config/google-sheet.json", {})

    warnings = [
        {"platform": item.get("platform") or item.get("sourceId", ""), "warning": item.get("warning", "")}
        for item in report
        if item.get("warning")
    ]

    return {
        "status": "completed_with_warnings" if warnings else "completed",
        "total_bids": len(bids),
        "warnings": warnings,
        "sheet_url": sheet_config.get("spreadsheetUrl", ""),
        "logs": logs,
    }
