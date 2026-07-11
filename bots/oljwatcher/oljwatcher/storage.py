from __future__ import annotations

import sqlite3
from pathlib import Path

from .models import JobPost


class SeenStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.path)
        self.connection.execute(
            """
            CREATE TABLE IF NOT EXISTS seen_jobs (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                url TEXT NOT NULL,
                posted_at TEXT,
                first_seen_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        self.connection.commit()

    def has_seen(self, job_id: str) -> bool:
        cursor = self.connection.execute("SELECT 1 FROM seen_jobs WHERE id = ?", (job_id,))
        return cursor.fetchone() is not None

    def mark_seen(self, job: JobPost) -> None:
        self.connection.execute(
            "INSERT OR IGNORE INTO seen_jobs (id, title, url, posted_at) VALUES (?, ?, ?, ?)",
            (job.id, job.title, job.url, job.posted_at),
        )
        self.connection.commit()

    def close(self) -> None:
        self.connection.close()
