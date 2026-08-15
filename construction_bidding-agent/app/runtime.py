from __future__ import annotations

import functools
import os
from pathlib import Path
from typing import Any

from app.postgres_bid_reader import PostgresBidReader
from app.publisher import PostgresPublisherStore
from app.repository import BidRepository


@functools.cache
def get_repository() -> BidRepository:
    configured = os.getenv("BID_DATABASE_PATH")
    path = Path(configured) if configured else Path("data/bid-copilot.db")
    return BidRepository(path)


@functools.cache
def get_bid_reader() -> Any:
    """Use Supabase for bid reads when configured; keep SQLite for local dev."""
    database_url = os.getenv("DATABASE_URL", "").strip()
    if database_url:
        return PostgresBidReader(database_url)
    return get_repository()


@functools.cache
def get_publisher_store() -> PostgresPublisherStore:
    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        raise RuntimeError("DATABASE_URL is required for publisher imports")
    return PostgresPublisherStore(database_url)


def reset_repository() -> None:
    get_repository.cache_clear()
    get_bid_reader.cache_clear()
    get_publisher_store.cache_clear()
