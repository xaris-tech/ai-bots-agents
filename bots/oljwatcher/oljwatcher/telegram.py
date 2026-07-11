from __future__ import annotations

import html
import logging
import time

import requests

from .models import JobPost

TELEGRAM_MESSAGE_LIMIT = 4096
LOG = logging.getLogger("oljwatcher")


class TelegramNotifier:
    def __init__(self, bot_token: str, chat_id: str) -> None:
        self.bot_token = bot_token
        self.chat_id = chat_id

    def send_job(self, job: JobPost, application: str) -> None:
        message = format_job_message(job, application)
        response = requests.post(
            f"https://api.telegram.org/bot{self.bot_token}/sendMessage",
            json={
                "chat_id": self.chat_id,
                "text": message,
                "parse_mode": "HTML",
                "disable_web_page_preview": False,
            },
            timeout=30,
        )
        if response.status_code == 429:
            retry_after = response.json().get("parameters", {}).get("retry_after", 30)
            LOG.warning("Telegram rate limited notification, retrying after %s seconds", retry_after)
            time.sleep(min(int(retry_after), 120))
            response = requests.post(
                f"https://api.telegram.org/bot{self.bot_token}/sendMessage",
                json={
                    "chat_id": self.chat_id,
                    "text": message,
                    "parse_mode": "HTML",
                    "disable_web_page_preview": False,
                },
                timeout=30,
            )
        if response.status_code == 429:
            LOG.warning("Telegram still rate limited; skipping this notification for now")
            return
        response.raise_for_status()


def format_job_message(job: JobPost, application: str) -> str:
    skills = ", ".join(job.skills[:8]) if job.skills else "Not listed"
    message = (
        f"<b>New OnlineJobs.ph match</b>\n\n"
        f"<b>{html.escape(job.title)}</b>\n"
        f"Posted: {html.escape(job.posted_at or 'Unknown')}\n"
        f"Type: {html.escape(job.job_type or 'Unknown')}\n"
        f"Salary: {html.escape(job.salary or 'Not listed')}\n"
        f"Skills: {html.escape(skills)}\n"
        f"Link: {html.escape(job.url)}\n\n"
        f"<b>Summary</b>\n{html.escape(job.summary[:700] or 'No summary found.')}\n\n"
        f"<b>Application draft</b>\n<pre>{html.escape(application)}</pre>"
    )
    if len(message) <= TELEGRAM_MESSAGE_LIMIT:
        return message
    room_for_application = max(500, TELEGRAM_MESSAGE_LIMIT - (len(message) - len(html.escape(application))) - 80)
    short_application = html.escape(application[:room_for_application].rstrip() + "\n\n[Draft truncated]")
    return (
        f"<b>New OnlineJobs.ph match</b>\n\n"
        f"<b>{html.escape(job.title)}</b>\n"
        f"Posted: {html.escape(job.posted_at or 'Unknown')}\n"
        f"Type: {html.escape(job.job_type or 'Unknown')}\n"
        f"Salary: {html.escape(job.salary or 'Not listed')}\n"
        f"Skills: {html.escape(skills)}\n"
        f"Link: {html.escape(job.url)}\n\n"
        f"<b>Summary</b>\n{html.escape(job.summary[:500] or 'No summary found.')}\n\n"
        f"<b>Application draft</b>\n<pre>{short_application}</pre>"
    )[:TELEGRAM_MESSAGE_LIMIT]
