from __future__ import annotations

import hashlib
import re
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup, Tag

from .models import JobPost


POSTED_RE = re.compile(r"Posted on\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})")


class OnlineJobsScraper:
    def __init__(self, user_agent: str, cookie: str = "", email: str = "", password: str = "") -> None:
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": user_agent})
        self.email = email
        self.password = password
        self._logged_in = False
        if cookie:
            self.session.headers.update({"Cookie": cookie})

    def fetch_jobs(self, search_url: str) -> list[JobPost]:
        if not self._logged_in and self.email and self.password:
            self.login()
        response = self.session.get(search_url, timeout=30)
        response.raise_for_status()
        jobs = parse_jobs(response.text, search_url)
        if jobs or not (self.email and self.password):
            return jobs

        self.login()
        response = self.session.get(search_url, timeout=30)
        response.raise_for_status()
        return parse_jobs(response.text, search_url)

    def enrich_job(self, job: JobPost) -> JobPost:
        response = self.session.get(job.url, timeout=30)
        response.raise_for_status()
        detail = parse_job_detail(response.text)
        return JobPost(
            id=job.id,
            title=job.title,
            url=job.url,
            posted_at=job.posted_at,
            job_type=job.job_type,
            salary=job.salary,
            summary=job.summary,
            skills=job.skills,
            detail=detail,
        )

    def login(self) -> None:
        response = self.session.get("https://www.onlinejobs.ph/login", timeout=30)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")
        token_input = soup.find("input", {"name": "csrf-token"})
        token = token_input.get("value", "") if isinstance(token_input, Tag) else ""
        payload = {
            "csrf-token": token,
            "info[email]": self.email,
            "info[password]": self.password,
            "login": "Login",
        }
        login_response = self.session.post(
            "https://www.onlinejobs.ph/authenticate",
            data=payload,
            headers={"Referer": "https://www.onlinejobs.ph/login"},
            timeout=30,
            allow_redirects=True,
        )
        login_response.raise_for_status()
        self._logged_in = True


def parse_jobs(html: str, base_url: str) -> list[JobPost]:
    soup = BeautifulSoup(html, "html.parser")
    cards = _find_job_cards(soup)
    jobs = [_parse_card(card, base_url) for card in cards]
    return [job for job in jobs if job and job.title and job.url]


def parse_job_detail(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for unwanted in soup(["script", "style", "nav", "footer", "header"]):
        unwanted.decompose()
    card = soup.select_one(".card-jobseeker")
    if card:
        detail = card.get_text("\n", strip=True)
        detail = re.sub(r"\n{3,}", "\n\n", detail).strip()
        return detail[:8000]

    heading = soup.find(string=re.compile(r"JOB OVERVIEW", re.IGNORECASE))
    if heading:
        container = heading.find_parent()
        parts: list[str] = []
        current = container
        while isinstance(current, Tag):
            text = current.get_text("\n", strip=True)
            if text and text not in parts:
                parts.append(text)
            current = current.find_next_sibling()
        detail = "\n".join(parts)
    else:
        detail = soup.get_text("\n", strip=True)
    detail = re.sub(r"\n{3,}", "\n\n", detail).strip()
    return detail[:8000]


def _find_job_cards(soup: BeautifulSoup) -> list[Tag]:
    explicit_cards = soup.select(".jobpost-cat-box")
    if explicit_cards:
        return [card for card in explicit_cards if isinstance(card, Tag)]

    candidates: list[Tag] = []
    for link in soup.select("a[href*='/jobseekers/job/']"):
        card = link.find_parent(["div", "li", "article", "tr"])
        for _ in range(4):
            if not isinstance(card, Tag):
                break
            text = card.get_text(" ", strip=True)
            if "Posted on" in text and len(text) > 40:
                candidates.append(card)
                break
            card = card.find_parent(["div", "li", "article", "tr"])

    unique: list[Tag] = []
    seen: set[int] = set()
    for card in candidates:
        marker = id(card)
        if marker not in seen:
            unique.append(card)
            seen.add(marker)
    return unique


def _parse_card(card: Tag, base_url: str) -> JobPost | None:
    link = card.find_parent("a", href=re.compile(r"/jobseekers/job/")) or card.select_one("a[href*='/jobseekers/job/']")
    if not link:
        return None

    title = _extract_title(card, link)
    url = urljoin(base_url, link.get("href", ""))
    text = card.get_text(" ", strip=True)
    posted_match = POSTED_RE.search(text)
    posted_at = posted_match.group(1).strip() if posted_match else ""

    desc = card.select_one(".desc")
    summary = _clean_summary(desc.get_text(" ", strip=True) if desc else text, title)
    skills = _extract_skills(card)
    job_type_badge = card.select_one("h4 .badge")
    job_type = job_type_badge.get_text(" ", strip=True) if job_type_badge else (_first_match(text, ["Full Time", "Part Time", "Any"]) or "")
    salary_node = card.select_one("dd.col")
    salary = salary_node.get_text(" ", strip=True) if salary_node else _extract_salary(text)
    job_id = _stable_id(url, title, posted_at)
    return JobPost(job_id, title, url, posted_at, job_type, salary, summary, skills)


def _extract_title(card: Tag, link: Tag) -> str:
    heading = card.select_one("h4")
    if not heading:
        return link.get_text(" ", strip=True)
    badge = heading.select_one(".badge")
    if badge:
        badge.extract()
    return heading.get_text(" ", strip=True)


def _clean_summary(text: str, title: str) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    text = text.replace(title, "", 1).strip()
    text = re.sub(r"See More\s*$", "", text).strip()
    return text[:900]


def _extract_skills(card: Tag) -> list[str]:
    skills: list[str] = []
    for item in card.select(".job-tag .badge, .job-skill"):
        text = item.get_text(" ", strip=True)
        if 2 <= len(text) <= 60 and "Posted on" not in text and "/jobseekers/job/" not in str(item):
            if text not in skills:
                skills.append(text)
    return skills[:12]


def _extract_salary(text: str) -> str:
    money = re.search(r"((?:PHP|USD|\$|₱)\s?[\w,./ -]+)", text, re.IGNORECASE)
    return money.group(1).strip()[:80] if money else ""


def _first_match(text: str, options: list[str]) -> str | None:
    for option in options:
        if option.lower() in text.lower():
            return option
    return None


def _stable_id(url: str, title: str, posted_at: str) -> str:
    digest = hashlib.sha256(f"{url}|{title}|{posted_at}".encode()).hexdigest()
    return digest[:24]
