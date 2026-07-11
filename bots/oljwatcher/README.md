# oljwatcher

A 24/7 OnlineJobs.ph watcher that checks public job search/category pages, detects new matching posts, generates a detailed application draft, and sends everything to Telegram.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
cp .env.example .env
```

Edit `.env` with:

- `TELEGRAM_BOT_TOKEN`: from Telegram `@BotFather`
- `TELEGRAM_CHAT_ID`: from Telegram `@userinfobot`
- `OLJ_SEARCH_URLS`: one or more OnlineJobs.ph search/category URLs
- `JOB_KEYWORDS`: the jobs you want to be notified about
- `APPLICANT_*`: your profile details for application drafts

## Run Once

```bash
oljwatcher --once
```

## Run 24/7

```bash
oljwatcher
```

For production, run it under `systemd`, Docker, `pm2`, or a small VPS process manager.

For an Oracle Always Free VPS setup with Telegram instructions, see
`docs/oracle-vps-telegram-deploy.md`.

## Notes

This bot reads public job listing pages. Keep the interval respectful, review OnlineJobs.ph terms, and do not use it to spam applications. The bot generates a draft so you can personalize before sending.
