# Cortex Bid Copilot

ADK 2 bid-intake agent and CEO operations dashboard for Cortex Constructions.

## Local Application

The application combines:

- An ADK 2 `Workflow` that scans IonWave, DemandStar, and Bonfire concurrently.
- An OpenAI-backed bid copilot with typed tools for search, scoring, scans, and action previews.
- A FastAPI API backed by SQLite with last-known-good portal protection.
- A Next.js operator dashboard with bid review, versioned company fit criteria,
  contextual chat, and immutable Google Sheets/ClickUp approval proposals.

Add the missing values from `.env.example` to the existing `.env`. At minimum,
chat requires `OPENAI_API_KEY` (from platform.openai.com, billed separately
from a ChatGPT subscription). Portal scans require either saved Playwright
sessions or portal credentials.

Start the API:

```bash
.venv/bin/python -m uvicorn app.fast_api_app:app --host 127.0.0.1 --port 8000 --reload
```

Start the dashboard in another terminal. It needs its own env file pointing at
the API:

```bash
cd frontend
npm install
echo "NEXT_PUBLIC_API_BASE_URL=http://localhost:8000" > .env.local
npm run dev
```

Open `http://localhost:3000`. The ADK web interface remains available through
the API server, and the A2A card is served under
`/a2a/construction_bid_copilot/.well-known/agent-card.json`.

### Gmail bid source

The dashboard can read bid notices from `info.cortexconstruction@gmail.com`.
For the simplest local setup, enable Google 2-Step Verification, create an App
Password named `Cortex Bid Desk`, and add it to `.env` (spaces are accepted):

```env
GMAIL_ACCOUNT=info.cortexconstruction@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
GMAIL_LABEL=Cortex Bids
```

The IMAP integration opens only the `Cortex Bids` label read-only and fetches
with `BODY.PEEK[]`, so it does not send, delete, archive, label, or mark
messages read. Gmail filters are responsible for applying the label to trusted
bid-notification senders.

OAuth remains available as a fallback. Create an OAuth 2.0 **Desktop app**
client in Google Cloud Console, download its JSON to
`credentials/gmail-oauth-client.json`, leave `GMAIL_APP_PASSWORD` empty, then
authorize the mailbox once:

```bash
.venv/bin/python scripts/auth-gmail.py
```

The resulting `credentials/gmail-token.json` is local and gitignored. Restart
the API, then use **Scan email** for Gmail only or **Scan all sources** to scan
websites, batch portals, and Gmail together. Gmail access never sends, deletes,
archives, labels, or marks messages read.

### Dashboard buttons

- **Scan portals** — runs the ADK workflow over IonWave/DemandStar/Bonfire only
  and stores results in the local SQLite repository (`data/bid-copilot.db`).
  This is what the bid table on screen reflects.
- **Scrape + sync sheet** — runs the full CLI pipeline (all 81 configured
  sites, 79 enabled, plus the three batch portals), combines and dedupes everything, and
  pushes the combined result to the canonical Google Sheet. Does **not**
  write into the local SQLite repository, so the on-screen bid table won't
  reflect it — check the sheet link in the success banner instead.
- **Scrape + sync ClickUp** — same scrape, then filters bids against the
  Aggregates/General Construction keyword lists and creates any missing
  ClickUp tasks (idempotent by task name), assigned to
  `CLICKUP_DEFAULT_ASSIGNEE_ID`.

Both sync buttons take several minutes per click (81 sites + 3 batch
platforms); the spinner holds for the whole run. Same pipelines are runnable
from the CLI: `npm run sync:sheet`, `npm run sync:clickup`.

- **Site Monitor** (nav tab) — read-only per-site scraping health. Joins the
  site catalog (`config/sites.json`) with the last-run report
  (`data/out/site-scrape-report.json`) and the scraped feed
  (`data/raw/site-bids.json`), served by `GET /api/site-monitor`
  (`app/site_monitor.py`). Shows a status per site (healthy / broken / stale /
  no-open-bids / never-run / disabled), a per-platform breakdown, and a
  drill-down of the actual scraped bid titles per site so you can eyeball
  accuracy. It does **not** trigger a scrape — the report/feed files are
  refreshed by the **Scrape + sync sheet** button (or `npm run scrape:sites`).

Action approvals (the in-dashboard proposal/approve flow, separate from the
sync buttons above) are written to the local immutable proposal log and do
not call an external API; destructive actions are not part of that schema.

## Verification

```bash
.venv/bin/pytest -q
npm run check
cd frontend && npm run lint && npm run build
```

## Current Status

**Last verified: July 25, 2026.** See `docs/site-coverage.md` for the catalog
and `docs/scraper-fixes-2026-07.md` for the latest accuracy pass.

- 81 configured site profiles (77 enabled) across 8 platforms — CivicEngage,
  StaticList, Bonfire, BidNet, IonWave, Public Purchase, WorkdaySpend,
  BeaconBid — plus the three batch portals (IonWave, DemandStar, Bonfire).
  Latest run: ~35 healthy / 7 broken(parser) / 8 blocked(infra) / rest empty,
  ~188 bids. Breakdown in the docs.
- Google Sheet push works: `npm run sync:sheet` or the dashboard button. The
  service account (`credentials/cortex-sa.json`) needs the Sheets API enabled
  on its GCP project — a 403 there is the one-time setup step, not a bug.
- ClickUp push works: `npm run clickup:push` (or `npm run sync:clickup` to
  scrape first) filters Texas bids by keyword and creates missing tasks on the
  single `Prospects` list, assigned to `CLICKUP_DEFAULT_ASSIGNEE_ID`.
- Known blockers, not fixable from this codebase alone: Public Purchase hosts
  are unreachable from most networks (likely geo-blocked, needs a US egress
  IP); Coppell's bid page now requires a CivicPlus vendor account.

## ClickUp Setup

The **live** workspace (id `9011646920`) has a space named **`Bid
Opportunities`** (no ampersand) with a single flat list:

- `Prospects` — id `901114103788` (hardcoded in `scripts/push-clickup-tasks.mjs`)

**Consolidated 2026-07-25:** the earlier two-list split (`Aggregates Supply` +
`2. General Construction`, id `901114103789`) was merged into one `Prospects`
board — the aggregate-vs-construction categorization kept mis-bucketing
one-word bids ("Concrete", "Culverts"). The push now sends any
aggregate-OR-general **Texas** bid to Prospects, deduped by task name. The old
General Construction list is empty but kept. `docs/clickup-manual-setup.md` and
`config/clickup-structure.json` describe a different, never-built plan — don't
trust them as ground truth.

The push is **Texas-only**: it drops rows whose `location` is a bare non-Texas
US state (the BidNet nationwide sweep pulls in CO/NY/etc.). Use `--all-states`
to include them.

## Task Fields

The `Prospects` list has no custom fields — task data goes into the markdown
description instead (see `scripts/push-clickup-tasks.mjs`).
`config/clickup-fields.json` describes the originally-planned (unbuilt) structure.

## Portal Access

- IonWave, DemandStar, Bonfire: browser-login automation, or set
  `IONWAVE_USERNAME`/`PASSWORD` etc. and `npm run login:portals`.
- Public Purchase: per-site or shared credentials in `.env`
  (`PUBLIC_PURCHASE_USERNAME`/`PASSWORD`), currently network-blocked — see
  Current Status above.
- BidNet: no login needed, scrapes the public open-bids listing.
- Cloudflare-walled sites (`cloudflare:true` in `config/sites.json`): use
  `npm run scrape:cloudflare` — it auto-spawns real Chrome over CDP and scrapes
  all of them unattended (see `docs/scraper-fixes-2026-07.md`). The older
  per-site `npm run scrape:real-chrome -- --site <id>` still works.

## Auth

Passwordless (Firebase email-link) sign-in restricted to an email allowlist,
enforced server-side on every `/api/*` route. Firebase project
`cortex-bid-desk` is configured. Local dev bypasses auth with `AUTH_ENABLED=false`.
Full details, setup, and deployment notes in `docs/auth-and-deploy.md`.

## Commands

```bash
npm install
npm run check              # validate config/sites.json, clickup structure, etc.
npm run test:scrapers      # 32 unit tests over the scraper/dedupe logic
npm run scrape:bids        # batch: IonWave + DemandStar + Bonfire
npm run scrape:sites       # all enabled site profiles (skips cloudflare:true)
npm run scrape:cloudflare  # Cloudflare-walled sites via auto-launched real Chrome
npm run sync:sheet         # scrape everything, push combined result to the Sheet
npm run sync:clickup       # scrape everything, push Texas keyword matches to ClickUp
npm run clickup:push:dry-run  # preview ClickUp matches without creating tasks
npm run score:sample
```
