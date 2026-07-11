from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from urllib.parse import quote_plus

from dotenv import load_dotenv


def _csv(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


@dataclass(frozen=True)
class ApplicantProfile:
    name: str
    experience: str
    skills: str
    tools: str
    availability: str
    portfolio: str
    rate: str


@dataclass(frozen=True)
class Settings:
    telegram_bot_token: str
    telegram_chat_id: str
    search_urls: list[str]
    search_keywords: list[str]
    job_keywords: list[str]
    exclude_keywords: list[str]
    check_interval_seconds: int
    database_path: Path
    user_agent: str
    olj_cookie: str
    olj_email: str
    olj_password: str
    notify_posted_after: datetime | None
    groq_api_key: str
    groq_model: str
    application_style: str
    applicant: ApplicantProfile

    @classmethod
    def from_env(cls) -> "Settings":
        load_dotenv()
        return cls(
            telegram_bot_token=os.getenv("TELEGRAM_BOT_TOKEN", ""),
            telegram_chat_id=os.getenv("TELEGRAM_CHAT_ID", ""),
            search_urls=_search_urls(
                _csv(os.getenv("OLJ_SEARCH_URLS")),
                _csv(os.getenv("OLJ_SEARCH_KEYWORDS")),
            ),
            search_keywords=_csv(os.getenv("OLJ_SEARCH_KEYWORDS")),
            job_keywords=_csv(os.getenv("JOB_KEYWORDS")),
            exclude_keywords=_csv(os.getenv("EXCLUDE_KEYWORDS")),
            check_interval_seconds=int(os.getenv("CHECK_INTERVAL_SECONDS", "300")),
            database_path=Path(os.getenv("DATABASE_PATH", "data/oljwatcher.sqlite3")),
            user_agent=os.getenv("USER_AGENT", "oljwatcher/0.1"),
            olj_cookie=os.getenv("OLJ_COOKIE", ""),
            olj_email=os.getenv("OLJ_EMAIL", ""),
            olj_password=os.getenv("OLJ_PASSWORD", ""),
            notify_posted_after=_datetime(os.getenv("NOTIFY_POSTED_AFTER")),
            groq_api_key=os.getenv("GROQ_API_KEY", ""),
            groq_model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
            application_style=os.getenv("APPLICATION_STYLE", "developer"),
            applicant=ApplicantProfile(
                name=os.getenv("APPLICANT_NAME", "Your Name"),
                experience=os.getenv("APPLICANT_EXPERIENCE", ""),
                skills=os.getenv("APPLICANT_SKILLS", ""),
                tools=os.getenv("APPLICANT_TOOLS", ""),
                availability=os.getenv("APPLICANT_AVAILABILITY", ""),
                portfolio=os.getenv("APPLICANT_PORTFOLIO", ""),
                rate=os.getenv("APPLICANT_RATE", ""),
            ),
        )

    def validate(self) -> None:
        missing = []
        if not self.telegram_bot_token:
            missing.append("TELEGRAM_BOT_TOKEN")
        if not self.telegram_chat_id:
            missing.append("TELEGRAM_CHAT_ID")
        if not self.search_urls:
            missing.append("OLJ_SEARCH_URLS")
        if not self.job_keywords:
            missing.append("JOB_KEYWORDS")
        if missing:
            joined = ", ".join(missing)
            raise ValueError(f"Missing required environment values: {joined}")


def _datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    value = value.strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            pass
    raise ValueError("NOTIFY_POSTED_AFTER must use YYYY-MM-DD HH:MM:SS")


def _search_urls(urls: list[str], keywords: list[str]) -> list[str]:
    generated = [
        f"https://www.onlinejobs.ph/jobseekers/jobsearch?jobkeyword={quote_plus(keyword)}"
        for keyword in keywords
    ]
    combined = generated + urls
    unique: list[str] = []
    seen: set[str] = set()
    for url in combined:
        if url not in seen:
            unique.append(url)
            seen.add(url)
    return unique
