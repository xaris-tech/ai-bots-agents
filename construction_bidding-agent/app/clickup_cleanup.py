from __future__ import annotations

import os
import ssl
from datetime import UTC, date, datetime, time
from typing import Any

import aiohttp
import certifi

from app.clickup_dedupe import CLEANUP_LIST_IDS, PROSPECTS_LIST_ID, duplicate_task_ids


CLICKUP_API_BASE = "https://api.clickup.com/api/v2"
_duplicate_task_ids = duplicate_task_ids


class ClickUpCleanupError(RuntimeError):
    pass


def _clickup_ssl_context() -> ssl.SSLContext:
    """Use a portable CA bundle instead of the host Python certificate store."""
    return ssl.create_default_context(cafile=certifi.where())


def _expired_cutoff_ms(today: date | None = None) -> int:
    cutoff = datetime.combine(today or date.today(), time.min, tzinfo=UTC)
    return int(cutoff.timestamp() * 1000)


async def _response_json(response: aiohttp.ClientResponse, operation: str) -> dict[str, Any]:
    if response.status >= 400:
        detail = (await response.text())[-1000:]
        raise ClickUpCleanupError(f"ClickUp {operation} failed ({response.status}): {detail}")
    payload = await response.json()
    if not isinstance(payload, dict):
        raise ClickUpCleanupError(f"ClickUp {operation} returned an invalid response.")
    return payload


async def cleanup_expired_clickup_tasks() -> int:
    """Archive expired and duplicate tasks in Bid Opportunities Prospects.

    Archiving removes tasks from the active ClickUp board without permanently
    deleting their history. Duplicate tasks do not need a due date; already
    closed or archived tasks are not changed.
    """
    token = os.getenv("CLICKUP_API_TOKEN", "").strip()
    if not token:
        raise ClickUpCleanupError("CLICKUP_API_TOKEN is not configured.")

    headers = {"Authorization": token, "Content-Type": "application/json"}
    timeout = aiohttp.ClientTimeout(total=60)
    tasks: list[dict[str, Any]] = []

    connector = aiohttp.TCPConnector(ssl=_clickup_ssl_context())
    async with aiohttp.ClientSession(
        headers=headers,
        timeout=timeout,
        connector=connector,
    ) as session:
        for list_id in CLEANUP_LIST_IDS:
            page = 0
            while True:
                params = {
                    "archived": "false",
                    "include_closed": "false",
                    "page": str(page),
                }
                async with session.get(
                    f"{CLICKUP_API_BASE}/list/{list_id}/task", params=params
                ) as response:
                    payload = await _response_json(response, "task lookup")
                page_tasks = payload.get("tasks", [])
                if not isinstance(page_tasks, list):
                    raise ClickUpCleanupError("ClickUp task lookup returned an invalid task list.")
                tasks.extend(task for task in page_tasks if isinstance(task, dict))
                if len(page_tasks) < 100:
                    break
                page += 1

        cutoff = _expired_cutoff_ms()
        task_ids = _duplicate_task_ids(tasks)
        task_ids.update(
            str(task["id"])
            for task in tasks
            if task.get("id")
            and str(task.get("due_date") or "").isdigit()
            and int(task["due_date"]) < cutoff
        )

        archived = 0
        for task in tasks:
            task_id = str(task.get("id") or "").strip()
            if not task_id or task_id not in task_ids:
                continue
            async with session.put(
                f"{CLICKUP_API_BASE}/task/{task_id}", json={"archived": True}
            ) as response:
                await _response_json(response, f'task archive for "{task.get("name", task_id)}"')
            archived += 1

    return archived
