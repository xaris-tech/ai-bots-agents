# Scraper accuracy pass — 2026-07-24/25

Session log: diagnosed the Site Monitor "broken" bucket, fixed the real bugs,
and reclassified the rest honestly. Baseline moved from healthy 29 / broken 28
to healthy 35 / broken 7 / blocked 8 (of 77 enabled), ~188 bids.

## Fixes applied

1. **Cloudflare — unattended real-Chrome solver.** `scripts/scrape-cloudflare-sites.mjs`
   (`npm run scrape:cloudflare`) auto-spawns the real Chrome binary over CDP
   (port 9333, profile `~/.cortex-chrome`), scrapes every `cloudflare:true`
   site, tears Chrome down. Real Chrome clears the managed challenge; the
   `cf_clearance` cookie can't be transplanted into Playwright's Chromium
   (fingerprint mismatch → re-challenge, the "asks twice"), so we drive the
   real browser. `selectSites` skips `cloudflare:true` in the headless batch;
   `--include-cloudflare`/`--site` override. 8 sites flagged (haslet,
   trophy-club, sweetwater, stephenville, longview, mclennan, crowley,
   westworth — the last two turned out reachable/other issues).
2. **`gotoWithRetry`** (`src/scrapers/common.mjs`) — escalating waitUntil +
   backoff; retries transient timeouts and `ERR_HTTP2_PROTOCOL_ERROR`. Used by
   CivicEngage + StaticList. Fixes the flapping timeout sites (ellis, snyder,
   kendall, burkburnett).
3. **`classifyBlock` / `detectCloudflare`** (`common.mjs`) — adapters emit
   `blocked-cloudflare` / bot-block(403) / `origin-down` instead of the
   misleading "no rows recognized". Surfaced in the monitor as Blocked vs Broken.
4. **IonWave grid race** — `scrapeIonWaveSite` now waits for a real data row
   (or empty-state) before reading the Telerik grid. Recovered College
   Station's ~15 open bids (was 0/stale).
5. **StaticList keyword + undated-bid fixes** — `SOLICITATION_KEYWORDS` matches
   plurals ("Request for Proposals" was silently dropped by `\bproposal\b`);
   "Open Until Filled" undated bids are kept; row-vs-content-link duplicates are
   deduped by href. Recovered Crowley's 1 open bid.
6. **Report clobber bug** — `scripts/scrape-sites.mjs` merged the bids feed but
   overwrote the whole `site-scrape-report.json` on a `--site` run. Now merges
   the report too.
7. **Dead URLs disabled** — Aledo (hard 404, Revize) and Westworth Village
   (soft 404, `/bids` gone) set `enabled:false` with dated reasons.

## Remaining failures — for the record (all correctly classified)

**Blocked (infra, 8) — not scraper-fixable here:**
- Public Purchase ×5 (godley, hurst, cleburne, duncanville, north-richland-hills)
  — publicpurchase.com geo-blocks non-US traffic; needs a US egress IP.
- Coppell — bids moved behind a CivicPlus vendor sign-in (Cloudflare-fronted);
  needs a vendor account.
- Georgetown, Milam County — AWS WAF 403 (`server: awselb`), NOT Cloudflare;
  the CF pass won't help.

**Broken/parser (7) — mostly genuinely empty right now, one true gap:**
- Belton, Saginaw, Caldwell County, Bell County, Waco, Wichita County —
  verified via screenshots: pages load but have **no current open bids** (all
  past-dated / blank listings). Not bugs; the "verify page layout" warning
  overstates it. A future tweak: emit `empty` when rows exist but all are closed.
- Gregg County — genuine StaticList parser gap: bids render as div cards +
  "Read More" (not table rows) the adapter can't read. But its list is all
  2023 archive (no current opps), so low value until it posts a live bid.

**JS-render note:** the "SPA" hypothesis for gregg/waco/wichita/crowley/aledo was
disproven by probing (body length flat over 11s, no bid XHR). They are static
pages that are empty / dead-URL / card-layout — a render-wait adapter would not
help. Don't build one without re-checking.

## Verification
`npm run check` OK · `npm run test:scrapers` 32/32 · `.venv/bin/pytest -q`
21 passed / 3 skipped (auth bypass via `tests/conftest.py`).
