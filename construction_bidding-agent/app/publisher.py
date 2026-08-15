from __future__ import annotations

import hashlib
import hmac
import json
import re
from collections.abc import Callable
from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from psycopg.types.json import Jsonb
from pydantic import BaseModel, ConfigDict, Field

from app.bid_models import BidInput


def _normalize_identity(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().casefold())


def _normalize_agency(value: str) -> str:
    primary = value.split(",", 1)[0]
    return re.sub(
        r"\b(?:texas|tx)$", "", re.sub(r"^(?:city|town|village) of ", "", _normalize_identity(primary))
    ).strip()


def consolidation_key(bid: BidInput | dict[str, Any]) -> str:
    value = bid if isinstance(bid, dict) else bid.model_dump(mode="json")
    due_date = value.get("due_date") or value.get("dueDate") or ""
    return "|".join(
        [
            _normalize_agency(str(value.get("agency", ""))),
            _normalize_identity(str(value.get("title", ""))),
            str(due_date),
        ]
    )


class PublishedBid(BidInput):
    source_id: str = Field(min_length=1, max_length=200)
    source_links: list[str] = Field(default_factory=list, max_length=20)


class EntityCheckResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_id: str = Field(min_length=1, max_length=200)
    status: Literal[
        "success",
        "verified_empty",
        "blocked",
        "timed_out",
        "parser_failed",
        "unverifiable",
    ]
    warning: str = Field(default="", max_length=1000)
    record_count: int = Field(default=0, ge=0)
    checked_at: datetime


class PublisherRunPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: int
    run_id: UUID
    content_checksum: str = Field(pattern=r"^[0-9a-f]{64}$")
    started_at: datetime
    finished_at: datetime
    status: Literal["completed", "completed_with_blockers", "failed"]
    bids: list[PublishedBid] = Field(max_length=5000)
    entity_checks: list[EntityCheckResult] = Field(min_length=1, max_length=500)


class PublisherImportResult(BaseModel):
    run_id: UUID
    created: int
    updated: int
    unchanged: int
    retained: int
    rejected: int


class PublicationConflict(Exception):
    pass


def compute_payload_checksum(payload: PublisherRunPayload | dict[str, Any]) -> str:
    if isinstance(payload, PublisherRunPayload):
        value = payload.model_dump(mode="json")
    else:
        candidate = dict(payload)
        candidate["content_checksum"] = "0" * 64
        value = PublisherRunPayload.model_validate(candidate).model_dump(mode="json")
    value.pop("content_checksum", None)
    canonical = json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def hash_publisher_key(key: str, salt: bytes) -> bytes:
    return hashlib.scrypt(
        key.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32
    )


class PostgresPublisherStore:
    def __init__(self, database_url: str) -> None:
        self.database_url = database_url

    def authenticate(self, publisher_id: str, key: str) -> bool:
        if not publisher_id or not key:
            return False
        with psycopg.connect(self.database_url, prepare_threshold=None) as connection:
            row = connection.execute(
                """
                select key_salt, key_hash
                from public.publisher_devices
                where id = %s and revoked_at is null
                """,
                (publisher_id,),
            ).fetchone()
        if row is None:
            return False
        candidate = hash_publisher_key(key, bytes(row[0]))
        return hmac.compare_digest(candidate, bytes(row[1]))

    def import_run(
        self, publisher_id: str, payload: PublisherRunPayload
    ) -> PublisherImportResult:
        created = 0
        updated = 0
        unchanged = 0
        retained = 0
        with psycopg.connect(self.database_url, prepare_threshold=None) as connection:
            prior = connection.execute(
                "select content_checksum, result_json from public.publication_runs where run_id = %s",
                (payload.run_id,),
            ).fetchone()
            if prior is not None:
                if prior[0] != payload.content_checksum:
                    raise PublicationConflict
                return PublisherImportResult.model_validate(prior[1])
            connection.execute(
                """
                insert into public.publication_runs
                  (run_id, publisher_id, schema_version, status, started_at,
                   finished_at, bid_count, content_checksum)
                values (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    payload.run_id,
                    publisher_id,
                    payload.schema_version,
                    payload.status,
                    payload.started_at,
                    payload.finished_at,
                    len(payload.bids),
                    payload.content_checksum,
                ),
            )
            for check in payload.entity_checks:
                authoritative = check.status in {"success", "verified_empty"}
                source_retained = 0
                if authoritative:
                    connection.execute(
                        "update public.opportunity_sources set is_current = false "
                        "where source_id = %s",
                        (check.source_id,),
                    )
                else:
                    source_retained = connection.execute(
                        "select count(*) from public.opportunity_sources "
                        "where source_id = %s and is_current = true",
                        (check.source_id,),
                    ).fetchone()[0]
                    retained += source_retained
                connection.execute(
                    """
                    insert into public.entity_check_results
                      (run_id, source_id, status, warning, record_count,
                       retained_count, checked_at)
                    values (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        payload.run_id,
                        check.source_id,
                        check.status,
                        check.warning,
                        check.record_count,
                        source_retained,
                        check.checked_at,
                    ),
                )
            for bid in payload.bids:
                key = consolidation_key(bid)
                previous = connection.execute(
                    "select raw_json from public.bids where dedupe_key = %s",
                    (key,),
                ).fetchone()
                raw = bid.model_dump(mode="json")
                if previous is None:
                    created += 1
                elif previous[0] == raw:
                    unchanged += 1
                else:
                    updated += 1
                connection.execute(
                    """
                    insert into public.bids
                      (dedupe_key, platform, bid_id, title, agency, location,
                       due_date, bid_url, documents_url, estimated_value,
                       description, scraped_at, raw_json, is_current, updated_at)
                    values
                      (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                       nullif(%s, '')::timestamptz, %s, true, now())
                    on conflict (dedupe_key) do update set
                      platform = excluded.platform,
                      bid_id = excluded.bid_id,
                      title = excluded.title,
                      agency = excluded.agency,
                      location = excluded.location,
                      due_date = excluded.due_date,
                      bid_url = excluded.bid_url,
                      documents_url = excluded.documents_url,
                      estimated_value = excluded.estimated_value,
                      description = excluded.description,
                      scraped_at = excluded.scraped_at,
                      raw_json = excluded.raw_json,
                      is_current = true,
                      updated_at = now()
                    """,
                    (
                        key,
                        bid.platform,
                        bid.bid_id,
                        bid.title,
                        bid.agency,
                        bid.location,
                        bid.due_date,
                        bid.bid_url,
                        bid.documents_url,
                        bid.estimated_value,
                        bid.description,
                        bid.scraped_at,
                        Jsonb(raw),
                    ),
                )
                links = bid.source_links or ([bid.bid_url] if bid.bid_url else [""])
                for source_url in links:
                    connection.execute(
                        """
                        insert into public.opportunity_sources
                          (dedupe_key, source_id, source_url, is_current,
                           first_seen_run_id, last_seen_run_id, updated_at)
                        values (%s, %s, %s, true, %s, %s, now())
                        on conflict (dedupe_key, source_id, source_url) do update set
                          is_current = true,
                          last_seen_run_id = excluded.last_seen_run_id,
                          updated_at = now()
                        """,
                        (key, bid.source_id, source_url, payload.run_id, payload.run_id),
                    )
            connection.execute(
                """
                update public.bids b set is_current = exists (
                  select 1 from public.opportunity_sources s
                  where s.dedupe_key = b.dedupe_key and s.is_current = true
                )
                where exists (
                  select 1 from public.opportunity_sources s
                  where s.dedupe_key = b.dedupe_key
                )
                """
            )
            connection.execute(
                "update public.publisher_devices set last_used_at = now() where id = %s",
                (publisher_id,),
            )
            result = PublisherImportResult(
                run_id=payload.run_id,
                created=created,
                updated=updated,
                unchanged=unchanged,
                retained=retained,
                rejected=0,
            )
            connection.execute(
                "update public.publication_runs set result_json = %s where run_id = %s",
                (Jsonb(result.model_dump(mode="json")), payload.run_id),
            )
        return result


PublisherStoreProvider = Callable[[], Any]
MAX_PUBLISH_BYTES = 5 * 1024 * 1024


def enforce_publisher_size(request: Request) -> None:
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > MAX_PUBLISH_BYTES:
        raise HTTPException(status_code=413, detail="Publication payload too large")


def create_publisher_router(store_provider: PublisherStoreProvider) -> APIRouter:
    router = APIRouter(prefix="/api/publisher", tags=["publisher"])

    def get_store() -> Any:
        return store_provider()

    @router.post(
        "/runs",
        response_model=PublisherImportResult,
        status_code=status.HTTP_201_CREATED,
        dependencies=[Depends(enforce_publisher_size)],
    )
    def publish_run(
        payload: PublisherRunPayload,
        store: Any = Depends(get_store),
        publisher_id: Annotated[str | None, Header(alias="X-Publisher-ID")] = None,
        authorization: Annotated[str | None, Header()] = None,
    ) -> PublisherImportResult:
        if payload.schema_version != 1:
            raise HTTPException(
                status_code=422,
                detail=f"Unsupported schema version {payload.schema_version}; expected 1",
            )
        if not hmac.compare_digest(
            payload.content_checksum, compute_payload_checksum(payload)
        ):
            raise HTTPException(status_code=422, detail="Content checksum mismatch")
        key = ""
        if authorization and authorization.startswith("Bearer "):
            key = authorization.removeprefix("Bearer ").strip()
        if not publisher_id or not store.authenticate(publisher_id, key):
            raise HTTPException(status_code=401, detail="Invalid publisher credentials")
        try:
            return store.import_run(publisher_id, payload)
        except PublicationConflict as error:
            raise HTTPException(
                status_code=409, detail="Run ID already exists with different content"
            ) from error
        except psycopg.Error as error:
            raise HTTPException(status_code=503, detail="Publication unavailable") from error

    return router
