from __future__ import annotations

import os
import ssl
from datetime import UTC, date, datetime, time
from typing import Any

import aiohttp
import certifi


CLICKUP_API_BASE = "https://api.clickup.com/api/v2"
PROSPECTS_LIST_ID = "901114103788"


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
    """Archive open Prospects tasks whose due date is before today.

    Archiving removes tasks from the active ClickUp board without permanently
    deleting their history. Tasks without a due date and already closed or
    archived tasks are not changed.
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
        page = 0
        while True:
            params = {
                "archived": "false",
                "include_closed": "false",
                "due_date_lt": str(_expired_cutoff_ms()),
                "order_by": "due_date",
                "page": str(page),
            }
            async with session.get(
                f"{CLICKUP_API_BASE}/list/{PROSPECTS_LIST_ID}/task", params=params
            ) as response:
                payload = await _response_json(response, "task lookup")
            page_tasks = payload.get("tasks", [])
            if not isinstance(page_tasks, list):
                raise ClickUpCleanupError("ClickUp task lookup returned an invalid task list.")
            tasks.extend(task for task in page_tasks if isinstance(task, dict))
            if len(page_tasks) < 100:
                break
            page += 1

        archived = 0
        for task in tasks:
            task_id = str(task.get("id") or "").strip()
            if not task_id:
                continue
            async with session.put(
                f"{CLICKUP_API_BASE}/task/{task_id}", json={"archived": True}
            ) as response:
                await _response_json(response, f'task archive for "{task.get("name", task_id)}"')
            archived += 1

    return archived
