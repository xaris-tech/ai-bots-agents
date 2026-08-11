from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import UTC, date, datetime, time
from typing import Any

import psycopg
import requests

from app.bid_models import BidInput

CLICKUP_API_BASE = "https://api.clickup.com/api/v2"
PROSPECTS_LIST_ID = "901114103788"
DEFAULT_WORKSPACE_ID = "9011646920"

GENERAL_KEYWORDS = [
    "concrete", "sitework", "excavation", "grading", "drainage",
    "renovation", "remodeling", "construction", "building improvements",
    "general contractor", "general contracting", "joc", "job order contracting",
    "foundation", "structural concrete", "structural steel", "masonry",
    "steel erection", "framing", "carpentry", "parking lot", "fencing",
    "accessibility", "ada improvements", "ada", "reconstruction",
    "rehabilitation", "sidewalk", "roadway", "improvements", "demolition",
    "abatement", "roofing", "window", "glazing", "exterior finishes", "stucco",
    "eifs", "metal panel", "waterproofing", "sealant", "electrical", "plumbing",
    "hvac", "fire protection", "sprinkler", "low voltage", "low-voltage",
    "data comm", "data-comm", "drywall", "painting", "flooring", "tile",
    "carpet", "vct", "epoxy", "ceiling", "act grid", "millwork", "cabinetry",
    "door", "frame", "hardware", "fire alarm", "elevator", "signage",
    "insulation", "glass", "storefront system", "concrete flatwork",
    "final cleaning", "permitting", "inspections coordination",
]
AGGREGATE_KEYWORDS = [
    "aggregate", "aggregates", "construction aggregate", "crushed stone",
    "crushed rock", "limestone", "road base", "base material", "flexbase",
    "flex base", "gravel", "pea gravel", "washed gravel", "sand",
    "concrete sand", "masonry sand", "fill sand", "select fill", "screened fill",
    "common fill", "backfill", "crushed concrete", "recycled concrete",
    "recycled aggregate", "crushing", "riprap", "rip rap", "gabion stone",
    "topsoil", "stabilized soil", "aggregate supply", "material supply",
    "bulk material", "asphalt", "caliche",
]
EXCLUDED_KEYWORDS = [
    "construction management", "construction manager", "manager at risk", "cmar",
    "inspection services", "engineering services", "architectural services",
    "design services", "consulting services",
]
SCOPE_EXCLUDED_KEYWORDS = [
    "stormwater", "landscaping", "culvert", "resurfacing", "paving",
    "sewer", "main line", "pump station", "wastewater", "wastwater", "lift",
    "transmission main", "levee", "flood control", "traffic signal",
    "widening", "bridge",
]
CONSTRUCTION_CONTEXT_KEYWORDS = [
    "repair", "repairs", "replacement", "rehabilitation", "placement", "demolition", "dredging",
]
AGGREGATE_CATEGORY_TERMS = [
    "aggregate", "aggregates", "stone", "gravel", "sand", "asphalt",
    "base material", "riprap",
]
CONSTRUCTION_CATEGORY_TERMS = [
    "construction", "road", "bridge", "site work", "concrete", "drainage",
    "utility", "earthwork",
]
NON_TEXAS_STATES = {
    "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
    "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho",
    "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine",
    "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi",
    "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
    "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
    "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina",
    "South Dakota", "Tennessee", "Utah", "Vermont", "Virginia", "Washington",
    "West Virginia", "Wisconsin", "Wyoming",
}


class OnlineClickUpError(RuntimeError):
    pass


def _keyword_pattern(keywords: list[str]) -> re.Pattern[str]:
    parts = [
        re.escape(value) if " " in value else rf"\b{re.escape(value)}s?\b"
        for value in keywords
    ]
    return re.compile("|".join(parts), re.IGNORECASE)


GENERAL_PATTERN = _keyword_pattern(GENERAL_KEYWORDS)
AGGREGATE_PATTERN = _keyword_pattern(AGGREGATE_KEYWORDS)
EXCLUDED_PATTERN = _keyword_pattern(EXCLUDED_KEYWORDS)
SCOPE_EXCLUDED_PATTERN = _keyword_pattern(SCOPE_EXCLUDED_KEYWORDS)
CONSTRUCTION_CONTEXT_PATTERN = _keyword_pattern(CONSTRUCTION_CONTEXT_KEYWORDS)


def matches_clickup_keywords(bid: BidInput) -> bool:
    text = f"{bid.title} {bid.description}"
    if SCOPE_EXCLUDED_PATTERN.search(text):
        return False
    return bool(
        AGGREGATE_PATTERN.search(text)
        or (GENERAL_PATTERN.search(text) and not EXCLUDED_PATTERN.search(text))
    )


def _normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def dedupe_tag(bid: BidInput) -> str:
    key = "|".join(
        [
            bid.platform,
            _normalize(bid.bid_id),
            _normalize(bid.title),
            bid.due_date.isoformat() if bid.due_date else "",
        ]
    )
    digest = hashlib.sha1(key.encode(), usedforsecurity=False).hexdigest()[:12]
    return f"dedupe-{digest}"


def _category(bid: BidInput) -> str:
    return "Aggregates" if _clickup_status(bid) == "aggregates" else "Construction"


def _clickup_status(bid: BidInput) -> str:
    text = f"{bid.title} {bid.description}"
    is_aggregate = bool(AGGREGATE_PATTERN.search(text))
    is_construction_context = is_aggregate and bool(CONSTRUCTION_CONTEXT_PATTERN.search(text))
    return "aggregates" if is_aggregate and not is_construction_context else "construction"


def _fit_score(bid: BidInput, today: date | None = None) -> int:
    score = 35 if _category(bid) == "Aggregates" else 30 if _category(bid) == "Construction" else 0
    score += 10 if bid.location else 0
    score += 20 if bid.documents_url else 0
    score += 10 if bid.agency else 0
    if bid.due_date:
        days = (bid.due_date - (today or date.today())).days
        score += 25 if 0 <= days <= 7 else 20 if days <= 14 else 15 if days <= 30 else 8 if days >= 0 else 0
    return max(0, min(100, score))


def _task_name(bid: BidInput) -> str:
    return f"{bid.title} - {bid.agency}"


def _summarize_bid_details(title: str, description: str) -> tuple[str, str]:
    segments = [
        " ".join(segment.split()).strip()
        for segment in re.split(r"\s*\|\s*|[\r\n]+", description)
    ]
    meaningful = [
        segment
        for segment in segments
        if segment
        and not re.fullmatch(r"notice (?:of|to) bid(?:ders)?", segment, re.IGNORECASE)
        and not re.search(
            r"\baccepting sealed bids\b.*\b(?:the )?following\b", segment, re.IGNORECASE
        )
    ]
    heading = next(
        (segment[:-1].strip() for segment in meaningful if segment.endswith(":") and len(segment) <= 120),
        "",
    )
    what = heading or " ".join(title.split()).strip() or "N/A"
    scope_parts = [segment for segment in meaningful if segment.rstrip(":").strip() != heading]
    scope = " ".join(scope_parts).strip() or "N/A"
    if len(scope) > 2000:
        scope = f"{scope[:1999].rstrip()}…"
    return what[:200], scope


def _format_clickup_description(bid: BidInput) -> str:
    usable_description = (
        bid.description
        if bid.description_quality in {"unknown", "summary", "detailed"}
        else ""
    )
    what, scope = _summarize_bid_details(bid.title, usable_description)
    title = " ".join(bid.title.split()).strip()
    heading = f"{what}: " if what != "N/A" and what != title else ""
    brief = f"{heading}{scope}" if scope != "N/A" else ""
    return "\n".join(
        [
            f"**Source:** {bid.platform or 'N/A'}",
            f"**Category:** {_category(bid)}",
            "",
            f"## {bid.title or 'Untitled project'}",
            "",
            brief or "No project description was provided by the source.",
            "",
            f"**Location:** {bid.location or 'N/A'}",
            f"**Due Date:** {bid.due_date.isoformat() if bid.due_date else 'N/A'}",
            f"**URL:** {_specific_bid_url(bid)}",
        ]
    )


def _specific_bid_url(bid: BidInput) -> str:
    listing_pattern = re.compile(
        r"/(?:sourcingevents\.aspx|bid-postings|bids-proposals|bids)/?(?:\?.*)?$",
        re.IGNORECASE,
    )
    if bid.documents_url and (not bid.bid_url or listing_pattern.search(bid.bid_url)):
        return bid.documents_url
    return bid.bid_url or bid.documents_url or "N/A"


def _task_payload(bid: BidInput, assignee_id: int) -> dict[str, Any]:
    score = _fit_score(bid)
    payload: dict[str, Any] = {
        "name": _task_name(bid),
        "markdown_description": _format_clickup_description(bid),
        "status": _clickup_status(bid),
        "tags": [
            bid.platform,
            dedupe_tag(bid),
            *(["needs-description"] if bid.description_quality in {"missing", "metadata"} else []),
        ],
        "priority": 2 if score >= 80 else 3 if score >= 55 else 4,
        "assignees": [assignee_id],
    }
    if bid.due_date:
        due = datetime.combine(bid.due_date, time.min, tzinfo=UTC)
        payload["due_date"] = int(due.timestamp() * 1000)
    return payload


class ClickUpClient:
    def __init__(self, token: str, timeout: float = 30) -> None:
        if not token.strip():
            raise OnlineClickUpError("CLICKUP_API_TOKEN is not configured.")
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({"Authorization": token, "Content-Type": "application/json"})

    def _json(self, response: requests.Response, operation: str) -> dict[str, Any]:
        if response.status_code >= 400:
            raise OnlineClickUpError(f"ClickUp {operation} failed ({response.status_code}).")
        try:
            payload = response.json()
        except ValueError as error:
            raise OnlineClickUpError(f"ClickUp {operation} returned invalid JSON.") from error
        if not isinstance(payload, dict):
            raise OnlineClickUpError(f"ClickUp {operation} returned an invalid response.")
        return payload

    def list_tasks(self, *, include_closed: bool = True, expired_before_ms: int | None = None) -> list[dict[str, Any]]:
        tasks: list[dict[str, Any]] = []
        page = 0
        while True:
            params: dict[str, str] = {
                "include_closed": str(include_closed).lower(),
                "archived": "false",
                "page": str(page),
            }
            if expired_before_ms is not None:
                params["due_date_lt"] = str(expired_before_ms)
                params["order_by"] = "due_date"
            response = self.session.get(
                f"{CLICKUP_API_BASE}/list/{PROSPECTS_LIST_ID}/task",
                params=params,
                timeout=self.timeout,
            )
            payload = self._json(response, "task lookup")
            page_tasks = payload.get("tasks", [])
            if not isinstance(page_tasks, list):
                raise OnlineClickUpError("ClickUp task lookup returned an invalid task list.")
            tasks.extend(task for task in page_tasks if isinstance(task, dict))
            if len(page_tasks) < 100:
                return tasks
            page += 1

    def create_task(self, payload: dict[str, Any]) -> None:
        response = self.session.post(
            f"{CLICKUP_API_BASE}/list/{PROSPECTS_LIST_ID}/task",
            json=payload,
            timeout=self.timeout,
        )
        self._json(response, "task creation")

    def update_task_description(
        self, task_id: str, description: str, status: str | None = None
    ) -> None:
        fields = {"markdown_description": description}
        if status:
            fields["status"] = status
        response = self.session.put(
            f"{CLICKUP_API_BASE}/task/{task_id}",
            json=fields,
            timeout=self.timeout,
        )
        self._json(response, "task description update")

    def archive_task(self, task_id: str) -> None:
        response = self.session.put(
            f"{CLICKUP_API_BASE}/task/{task_id}",
            json={"archived": True},
            timeout=self.timeout,
        )
        self._json(response, "task archive")


def _current_bids(reader: Any) -> list[BidInput]:
    bids = []
    for row in reader.list_bids():
        raw = row.get("raw_json", "{}")
        bids.append(BidInput.model_validate(json.loads(raw) if isinstance(raw, str) else raw))
    return bids


def sync_clickup_from_supabase(reader: Any, client: ClickUpClient, *, dry_run: bool = False) -> dict[str, Any]:
    all_bids = _current_bids(reader)
    texas_bids = [bid for bid in all_bids if bid.location.strip() not in NON_TEXAS_STATES]
    matches = [bid for bid in texas_bids if matches_clickup_keywords(bid)]
    existing = client.list_tasks(include_closed=True)
    tasks_by_name = {str(task.get("name") or ""): task for task in existing}
    tasks_by_tag = {
        str(tag.get("name")): task
        for task in existing
        for tag in task.get("tags", [])
        if isinstance(tag, dict) and str(tag.get("name", "")).startswith("dedupe-")
    }
    assignee_id = int(os.getenv("CLICKUP_DEFAULT_ASSIGNEE_ID", "114218682"))
    created = 0
    updated = 0
    skipped = 0
    for bid in matches:
        name = _task_name(bid)
        tag = dedupe_tag(bid)
        existing_task = tasks_by_tag.get(tag) or tasks_by_name.get(name)
        payload = _task_payload(bid, assignee_id)
        if existing_task:
            task_id = str(existing_task.get("id") or "")
            if not task_id:
                skipped += 1
                continue
            if not dry_run:
                current_status = str(
                    (existing_task.get("status") or {}).get("status") or ""
                ).lower()
                status = (
                    payload["status"]
                    if current_status in {"aggregates", "construction"}
                    else None
                )
                client.update_task_description(
                    task_id, payload["markdown_description"], status
                )
            updated += 1
            continue
        if not dry_run:
            client.create_task(payload)
        tasks_by_name[name] = {"name": name, "tags": [{"name": tag}]}
        tasks_by_tag[tag] = tasks_by_name[name]
        created += 1
    workspace = os.getenv("CLICKUP_WORKSPACE_ID", DEFAULT_WORKSPACE_ID)
    return {
        "status": "completed",
        "total_bids": len(texas_bids),
        "matched": len(matches),
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "list_url": f"https://app.clickup.com/{workspace}/v/li/{PROSPECTS_LIST_ID}",
        "logs": [
            f"Matched {len(matches)} of {len(texas_bids)} current Texas bids.",
            f"Created {created}, updated {updated}, skipped {skipped} ClickUp tasks.",
        ],
    }


def cleanup_expired_online(database_url: str, client: ClickUpClient, *, dry_run: bool = False) -> dict[str, int]:
    cutoff = datetime.combine(date.today(), time.min, tzinfo=UTC)
    tasks = client.list_tasks(include_closed=False, expired_before_ms=int(cutoff.timestamp() * 1000))
    archived = 0
    for task in tasks:
        task_id = str(task.get("id") or "").strip()
        if not task_id:
            continue
        if not dry_run:
            client.archive_task(task_id)
        archived += 1
    retired = 0
    with psycopg.connect(database_url, prepare_threshold=None) as connection:
        if dry_run:
            retired = int(
                connection.execute(
                    """
                    select count(*)
                    from public.bids
                    where is_current = true and due_date < current_date
                    """
                ).fetchone()[0]
            )
        else:
            rows = connection.execute(
                """
                update public.bids
                set is_current = false, updated_at = now()
                where is_current = true and due_date < current_date
                returning dedupe_key
                """
            ).fetchall()
            keys = [row[0] for row in rows]
            retired = len(keys)
            if keys:
                connection.execute(
                    """
                    update public.opportunity_sources
                    set is_current = false, updated_at = now()
                    where dedupe_key = any(%s)
                    """,
                    (keys,),
                )
    return {"deleted": retired, "clickup_archived": archived}
