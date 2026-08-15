from __future__ import annotations

import re
from typing import Any


PROSPECTS_LIST_ID = "901114103788"
CLEANUP_LIST_IDS = (PROSPECTS_LIST_ID,)


def normalized_task_name(task: dict[str, Any]) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(task.get("name") or "").lower()).strip()


def duplicate_task_ids(tasks: list[dict[str, Any]]) -> set[str]:
    """Return duplicate IDs, keeping the oldest copy in Prospects."""
    candidates = [task for task in tasks if task.get("id")]
    parents = list(range(len(candidates)))
    first_by_key: dict[str, int] = {}

    def find(index: int) -> int:
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    def union(left: int, right: int) -> None:
        left_root = find(left)
        right_root = find(right)
        if left_root != right_root:
            parents[right_root] = left_root

    for index, task in enumerate(candidates):
        keys: list[str] = []
        name = normalized_task_name(task)
        if name:
            keys.append(f"name:{name}")
        for tag in task.get("tags", []):
            tag_name = str(tag.get("name") or "") if isinstance(tag, dict) else ""
            if tag_name.startswith("dedupe-"):
                keys.append(f"tag:{tag_name}")
        for key in keys:
            if key in first_by_key:
                union(index, first_by_key[key])
            else:
                first_by_key[key] = index

    def rank(task: dict[str, Any]) -> tuple[int, str]:
        created = str(task.get("date_created") or "")
        return (
            int(created) if created.isdigit() else 2**63 - 1,
            str(task.get("id") or ""),
        )

    groups: dict[int, list[dict[str, Any]]] = {}
    for index, task in enumerate(candidates):
        groups.setdefault(find(index), []).append(task)

    duplicates: set[str] = set()
    for group in groups.values():
        if len(group) < 2:
            continue
        ordered = sorted(group, key=rank)
        duplicates.update(str(task["id"]) for task in ordered[1:])
    return duplicates
