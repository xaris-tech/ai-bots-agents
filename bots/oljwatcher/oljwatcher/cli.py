from __future__ import annotations

import argparse
import logging
import signal
import sys
import threading
from datetime import datetime

from .application import build_ai_application
from .config import Settings
from .matcher import matches_job
from .scraper import OnlineJobsScraper
from .storage import SeenStore
from .telegram import TelegramNotifier


LOG = logging.getLogger("oljwatcher")


def main() -> None:
    parser = argparse.ArgumentParser(description="Watch OnlineJobs.ph postings and send Telegram alerts.")
    parser.add_argument("--once", action="store_true", help="Run one check and exit.")
    parser.add_argument("--dry-run", action="store_true", help="Print matches instead of sending Telegram messages.")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    settings = Settings.from_env()
    if not args.dry_run:
        settings.validate()

    stop_event = threading.Event()

    def handle_stop(_signum: int, _frame: object) -> None:
        stop_event.set()

    signal.signal(signal.SIGINT, handle_stop)
    signal.signal(signal.SIGTERM, handle_stop)

    scraper = OnlineJobsScraper(
        settings.user_agent,
        settings.olj_cookie,
        settings.olj_email,
        settings.olj_password,
    )
    store = SeenStore(settings.database_path)
    notifier = TelegramNotifier(settings.telegram_bot_token, settings.telegram_chat_id)

    try:
        while not stop_event.is_set():
            check_once(settings, scraper, store, notifier, dry_run=args.dry_run)
            if args.once:
                break
            stop_event.wait(settings.check_interval_seconds)
    finally:
        store.close()


def check_once(settings: Settings, scraper: OnlineJobsScraper, store: SeenStore, notifier: TelegramNotifier, dry_run: bool) -> None:
    for url in settings.search_urls:
        LOG.info("Checking %s", url)
        try:
            jobs = scraper.fetch_jobs(url)
        except Exception as exc:
            LOG.exception("Failed to fetch %s: %s", url, exc)
            continue

        LOG.info("Found %s postings", len(jobs))
        for job in jobs:
            if store.has_seen(job.id):
                continue
            if not is_new_enough(job.posted_at, settings.notify_posted_after):
                store.mark_seen(job)
                continue
            if not matches_job(job, settings.job_keywords, settings.exclude_keywords):
                store.mark_seen(job)
                continue

            try:
                job = scraper.enrich_job(job)
            except Exception as exc:
                LOG.warning("Failed to fetch job details for %s: %s", job.url, exc)

            application = build_ai_application(
                job,
                settings.applicant,
                settings.groq_api_key,
                settings.groq_model,
                settings.application_style,
            )
            if dry_run:
                print(f"\nMATCH: {job.title}\n{job.url}\n\n{application}\n", flush=True)
            else:
                notifier.send_job(job, application)
            store.mark_seen(job)


def is_new_enough(posted_at: str, cutoff: datetime | None) -> bool:
    if cutoff is None:
        return True
    parsed = parse_posted_at(posted_at)
    return parsed is not None and parsed > cutoff


def parse_posted_at(value: str) -> datetime | None:
    value = value.strip()
    if not value:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            pass
    LOG.warning("Could not parse posted date: %s", value)
    return None


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        LOG.error("%s", exc)
        sys.exit(1)
