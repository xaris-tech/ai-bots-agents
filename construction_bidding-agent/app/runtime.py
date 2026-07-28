from __future__ import annotations

import functools
import os
from pathlib import Path

from app.repository import BidRepository


@functools.cache
def get_repository() -> BidRepository:
    configured = os.getenv("BID_DATABASE_PATH")
    path = Path(configured) if configured else Path("data/bid-copilot.db")
    return BidRepository(path)


def reset_repository() -> None:
    get_repository.cache_clear()

