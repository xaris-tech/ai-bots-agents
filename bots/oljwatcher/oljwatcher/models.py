from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class JobPost:
    id: str
    title: str
    url: str
    posted_at: str
    job_type: str
    salary: str
    summary: str
    skills: list[str]
    detail: str = ""

    @property
    def searchable_text(self) -> str:
        return " ".join(
            [
                self.title,
                self.posted_at,
                self.job_type,
                self.salary,
                self.summary,
                " ".join(self.skills),
            ]
        ).lower()
