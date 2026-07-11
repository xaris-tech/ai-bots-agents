from __future__ import annotations

from .models import JobPost


def matches_job(job: JobPost, include_keywords: list[str], exclude_keywords: list[str]) -> bool:
    text = job.searchable_text
    includes = any(keyword.lower() in text for keyword in include_keywords)
    excludes = any(keyword.lower() in text for keyword in exclude_keywords)
    return includes and not excludes
