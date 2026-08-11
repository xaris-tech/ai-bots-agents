"""Slim read/publish API for Vercel; scraping and agent execution stay local."""

from __future__ import annotations

import json
import os
from datetime import date
from typing import Annotated, Any

import psycopg
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from app.auth import require_auth
from app.bid_models import BidInput, CleanupSummary, ClickUpSyncSummary, CompanyProfile
from app.clickup_online import (
    ClickUpClient,
    OnlineClickUpError,
    cleanup_expired_online,
    sync_clickup_from_supabase,
)
from app.publisher import create_publisher_router
from app.runtime import get_bid_reader, get_publisher_store
from app.scoring import score_bid

app = FastAPI(title="Cortex Bid Desk API")
origins = [
    value.strip()
    for value in os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:3000").split(",")
    if value.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(create_publisher_router(get_publisher_store))


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/bids", dependencies=[Depends(require_auth)])
def list_bids(platform: str | None = Query(default=None)) -> list[dict[str, Any]]:
    reader = get_bid_reader()
    profile = reader.get_company_profile()
    today = date.today()
    results = []
    for row in reader.list_bids(platform=platform):
        bid = BidInput.model_validate(json.loads(row["raw_json"]))
        results.append(
            {
                **bid.model_dump(mode="json"),
                "dedupe_key": row["dedupe_key"],
                "score": score_bid(bid, profile, today=today).model_dump(),
            }
        )
    return sorted(results, key=lambda item: (-item["score"]["total"], item["due_date"] or "9999"))


@app.get("/api/profile", response_model=CompanyProfile, dependencies=[Depends(require_auth)])
def get_profile() -> CompanyProfile:
    return get_bid_reader().get_company_profile()


@app.get("/api/actions", dependencies=[Depends(require_auth)])
def list_actions() -> list[Any]:
    return []


@app.get("/api/publication-runs/latest", dependencies=[Depends(require_auth)])
def latest_publication_run() -> dict[str, Any] | None:
    return get_bid_reader().latest_publication_run()


@app.post("/api/chat", dependencies=[Depends(require_auth)])
def unavailable_chat() -> None:
    raise HTTPException(status_code=503, detail="Agent chat runs locally and is unavailable in deployed mode.")


@app.post("/api/sync-clickup", response_model=ClickUpSyncSummary, dependencies=[Depends(require_auth)])
def sync_clickup(dry_run: bool = Query(default=False)) -> dict[str, Any]:
    try:
        client = ClickUpClient(os.getenv("CLICKUP_API_TOKEN", ""))
        return sync_clickup_from_supabase(get_bid_reader(), client, dry_run=dry_run)
    except (OnlineClickUpError, ValueError) as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.post(
    "/api/bids/cleanup-expired",
    response_model=CleanupSummary,
    dependencies=[Depends(require_auth)],
)
def cleanup_expired(dry_run: bool = Query(default=False)) -> dict[str, int]:
    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        raise HTTPException(status_code=503, detail="Database is not configured.")
    try:
        client = ClickUpClient(os.getenv("CLICKUP_API_TOKEN", ""))
        return cleanup_expired_online(database_url, client, dry_run=dry_run)
    except (OnlineClickUpError, psycopg.Error) as error:
        raise HTTPException(status_code=502, detail="ClickUp cleanup failed.") from error
