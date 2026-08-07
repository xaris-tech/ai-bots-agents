# Repository Guidelines

## Current State — handoff (2026-07-25)

Read this first; parts of the older sections below are now out of date.

**Scraping coverage:** 81 site profiles in `config/sites.json` (77 enabled, 4
disabled with reasons: Pantego, Grand Prairie, Aledo + Westworth Village — the
last two are dead/404 bid URLs, disabled this session) across 8 platforms
(CivicEngage, StaticList, Bonfire, BidNet, IonWave, Public Purchase,
WorkdaySpend, BeaconBid) + the 3 batch portals. `docs/site-coverage.md` is the
catalog; `docs/scraper-fixes-2026-07.md` logs this session's scraper work.

**Scraper fixes this session** (all in `src/scrapers/`):
- **Cloudflare is now unattended.** `npm run scrape:cloudflare`
  (`scripts/scrape-cloudflare-sites.mjs`) auto-spawns the real Chrome binary
  over CDP (dedicated port 9333), scrapes all `cloudflare:true` sites, tears
  Chrome down. Wired into `sync:sheet`/`sync:clickup`. Headless batch
  (`scrape:sites`) skips `cloudflare:true` sites. 8 sites flagged.
- **`gotoWithRetry`** (`common.mjs`) — retries flaky/timeout/HTTP2 navs; used
  by CivicEngage + StaticList.
- **`classifyBlock`/`detectCloudflare`** (`common.mjs`) — adapters now emit
  honest `blocked-cloudflare` / `403` / `origin-down` warnings instead of a
  blanket "no rows".
- **IonWave grid race fixed** — `scrapeIonWaveSite` waits for the Telerik grid
  to populate (recovered College Station's ~15 bids).
- **StaticList**: matches plural keywords ("Proposals"), keeps "Open Until
  Filled" undated bids, dedupes row-vs-link duplicates (recovered Crowley).
- `scrape-sites.mjs` now MERGES the report on `--site` runs (was clobbering it).

**Site Monitor** (`app/site_monitor.py` + dashboard tab) now splits failures
into **Blocked (infra)** vs **Broken (parser)** with a `block_kind` sub-badge
and a `via: real-chrome` tag.

**ClickUp is ONE board now.** The two-list split (Aggregates Supply / General
Construction) was consolidated into a single **`Prospects`** list
(id `901114103788`) in the `Bid Opportunities` space. `push-clickup-tasks.mjs`
pushes aggregate-OR-general Texas bids to Prospects, **Texas-only** (drops
out-of-state rows from the BidNet nationwide sweep — bare non-TX state names in
`location`; `--all-states` to override), deduped by task name. The old
`2. General Construction` list is empty but kept.

**Frontend category filter** (`frontend/app/categorize.ts`) is a TS port of the
keyword logic — keep it in sync with `src/keywords.mjs`.

**Auth (Firebase passwordless):** `app/auth.py` verifies the Firebase ID token
+ email allowlist on every `/api/*`, `/api/chat`, `/feedback` (only `/healthz`
open). Frontend `AuthGate.tsx` does email-link sign-in and attaches the token.
Firebase project **`cortex-bid-desk`** is set up (email-link enabled). Config
in `frontend/.env.local` + backend `.env` (`AUTH_ENABLED`, `FIREBASE_PROJECT_ID`,
`AUTH_ALLOWED_EMAILS`). `AUTH_ENABLED=false` bypasses for local dev; tests set it
via `tests/conftest.py`. See `docs/auth-and-deploy.md`.

**Deploy: not done.** Frontend → Firebase Hosting (free); backend → Cloud Run
(needs billing; `cortex-bid-desk` is still Spark/no-billing). Scraping stays
local (Playwright/real-Chrome can't run serverless). SQLite is ephemeral on
Cloud Run.

**Nothing from this session is committed yet.**

## Project Structure & Module Organization

This repo has two halves: a Node.js browser-scraping pipeline (bid intake from
41+ site profiles and 3 batch portals) and a Python/FastAPI + Next.js agent
app (dashboard, chat, local approval workflow). They share data via the JSON
files under `data/raw/` and `data/out/`.

Node side:
- `src/` holds reusable scraping logic. `src/bids.mjs` normalizes, dedupes,
  categorizes, and scores bid records for the Sheet/ClickUp review flow.
  `src/scrapers/` has one adapter per portal platform (Bonfire, CivicEngage,
  DemandStar, IonWave, Public Purchase, BidNet, plus the shared
  `civicplus-doclist.mjs` for document-list-style CivicPlus pages).
  `src/site-runner.mjs` handles per-site selection, auth resolution, and
  hook loading for the 41-site registry. `src/sites/` holds site-specific
  hook scripts (only needed when a site's login/layout differs from its
  platform's shared adapter — see `src/sites/README.md`).
  `src/portal-login.mjs` is the shared login/expired-session-recovery logic
  used by the batch scraper.
- `scripts/` contains executable workflows: login, scrape (batch and
  per-site), combine, normalize, sheet building/push, ClickUp push, and
  config validation. `scrape-via-real-chrome.mjs` drives the operator's own
  Chrome over CDP for sites behind a Cloudflare managed challenge that
  Playwright-launched browsers can't pass — see
  `docs/portal-ingestion-runbook.md`.
- `config/` stores non-secret configuration: `sites.json` (the 41-site
  registry — auth mode, domain, notes on why a site is disabled/blocked),
  `portals.json` (the 3 batch portals), `clickup-fields.json` and
  `clickup-structure.json` (an **earlier, unbuilt** ClickUp plan — the live
  ClickUp space differs, see README's ClickUp Setup section), and
  `google-sheet.json` (the canonical Sheet ID/URL).
- `docs/` stores operator runbooks and the site coverage catalog
  (`docs/site-coverage.md` is the single, actively-updated source of truth
  for what's configured, what's live, and what's blocked and why).
- `data/raw/` and `data/out/` are generated scrape outputs, git-ignored
  except placeholders. `data/raw/bids.json` is the combined, deduped feed
  that the Sheet push, ClickUp push, and normalize step all read from
  (produced by `scripts/combine-bids.mjs`).
- `credentials/` (gitignored) holds the Google service account key
  (`cortex-sa.json`) — not `config/service-account.json`, an older default
  some docs still reference.

Python/agent side:
- `app/` — FastAPI app (`fast_api_app.py`), REST router (`api.py`), ADK
  agent (`agent.py`), SQLite repository, scoring, and two pipeline
  orchestrators that shell out to the Node scripts above:
  `sheet_sync.py` (`POST /api/sync-sheet`) and `clickup_sync.py`
  (`POST /api/sync-clickup`). Both run the full scrape-everything pipeline
  before pushing, so a call takes several minutes. `site_monitor.py`
  (`GET /api/site-monitor`) is a read-only join of `config/sites.json` +
  `data/out/site-scrape-report.json` + `data/raw/site-bids.json` powering the
  Site Monitor tab — it never scrapes, only reads the files the pipeline wrote.
- `frontend/` — Next.js dashboard (`app/page.tsx`). Needs its own
  `frontend/.env.local` with `NEXT_PUBLIC_API_BASE_URL` — it does not read
  the repo-root `.env`.

## Build, Test, and Development Commands

- `npm install` installs Playwright and project dependencies.
- `npm run check` validates key config files (site registry, ClickUp
  structure, Sheet fields).
- `npm run test:scrapers` runs the 31-test suite over scraper normalization,
  dedupe, auth resolution, and site-hook loading logic (`tests/js/`).
- `npm run auth:portals` / `npm run login:portals` — manual vs.
  credential-driven session setup for the 3 batch portals.
- `npm run scrape:bids` — batch: IonWave + DemandStar + Bonfire.
- `npm run scrape:sites` — all 41 configured site profiles (filter with
  `--site`, `--platform`, `--priority`, `--tab`).
- `npm run scrape:real-chrome -- --site <id>` — for Cloudflare-walled sites;
  requires Chrome launched separately with `--remote-debugging-port=9222`.
- `npm run combine:bids` — merges all raw sources (site + batch) into the
  single deduped `data/raw/bids.json` other steps read from.
- `npm run normalize:bids` — converts `data/raw/bids.json` into ClickUp
  review-task JSON for the Sheet's "ClickUp Tasks" tab (not the same thing
  as pushing real ClickUp tasks — see `clickup:push` below).
- `npm run sync:sheet` — full pipeline: scrape everything, combine,
  normalize, push to the Google Sheet.
- `npm run clickup:push` (or `clickup:push:dry-run`) — filter
  `data/raw/bids.json` against the client's Aggregates/General Construction
  keyword lists and create missing tasks in the live ClickUp lists.
  `npm run sync:clickup` scrapes first.
- `.venv/bin/uvicorn app.fast_api_app:app --reload` / `cd frontend && npm run
  dev` — run the agent dashboard (see README for full setup).

## Coding Style & Naming Conventions

Use modern ESM JavaScript (`.mjs`) with 2-space indentation. Prefer small pure
helpers in `src/` and thin orchestration scripts in `scripts/`. Name platform
scrapers after the platform, e.g. `src/scrapers/ionwave.mjs`. Site-specific
hooks live in `src/sites/<site-id>.mjs` and must delegate shared logic
(normalization, dedupe, retry) to the platform adapter — see
`src/sites/README.md` for the contract. Keep generated output out of source
control.

## Testing Guidelines

`npm run test:scrapers` (31 tests, `node --test`) covers normalization,
dedupe-key correctness (a real cross-source duplicate bug — same bid via
batch feed vs. per-site profile with differently formatted agency strings —
was fixed here; dedupe keys deliberately exclude `agency`), auth resolution,
and site-hook loading. Run it plus `npm run check` before any scraper/config
change. For live verification:

```bash
HEADLESS=0 npm run scrape:ionwave
npm run normalize:bids -- data/raw/ionwave-bids.json data/out/ionwave-clickup-tasks.json
```

For scraper changes, inspect `data/raw/<platform>-bids.json` and debug
screenshots under `data/out/`. For the Python side, `.venv/bin/pytest -q`
covers `tests/unit` and `tests/integration`.

## Commit & Pull Request Guidelines

Use concise imperative commits, e.g. `Add DemandStar list scraper`. PRs
should include changed portal behavior, commands run, sample row counts, and
any screenshots when selectors or login flows change.

## Security & Configuration Tips

Never commit portal passwords, cookies, session files, `credentials/`, or
`.env` files. Pass credentials via environment variables only. Keep
`playwright/.auth/`, `data/raw/`, and `data/out/` treated as sensitive
generated artifacts. If a live API token or password is ever pasted into a
chat/session transcript, treat it as compromised and rotate it — it's now in
plaintext history regardless of whether it gets used.

## Agent-Specific Instructions

Update the existing canonical Google Sheet from `config/google-sheet.json`;
do not create new Sheets unless explicitly requested. For one-by-one portal
work, replace only that platform's rows in the master `Bids` tab so other
platform data remains intact. For ClickUp, push to the single live `Prospects`
list (id `901114103788`, hardcoded in `scripts/push-clickup-tasks.mjs`) in the
`Bid Opportunities` space — the push is Texas-only. Do not assume
`config/clickup-structure.json` reflects reality; it describes an earlier plan
that was never built, and the two-list split it/older docs mention was
consolidated into the one Prospects board.

## Agent skills

### Issue tracker

Issues and specs are tracked as local Markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The default five-role triage vocabulary is used. See `docs/agents/triage-labels.md`.

### Domain docs

Domain documentation uses the single-context layout. See `docs/agents/domain.md`.
