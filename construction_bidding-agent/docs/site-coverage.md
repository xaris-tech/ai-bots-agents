# Site Coverage

**Last updated:** August 4, 2026

> **2026-07-25 note:** counts in this file are stale. The registry is now **81
> site profiles (77 enabled)** across 8 platforms; latest run ~35 healthy / 7
> broken / 8 blocked / rest empty. Aledo and Westworth Village were disabled
> (dead 404 URLs). Cloudflare is now scraped unattended via
> `npm run scrape:cloudflare`. See **`docs/scraper-fixes-2026-07.md`** for the
> current state and the per-site remaining-failure breakdown; the tables below
> remain the platform-by-platform reference.

> **2026-08-04 target-profile note:** the registry now has **99 profiles (93
> enabled)**. The central DFW wave added Euless and Colleyville as direct
> real-Chrome sources and identified Bedford's official, currently blocked,
> CivicEngage fallback. Cedar Hill is explicitly owned by the verified
> DemandStar batch feed; the remaining no-listing cities are explicit manual
> dispositions in `config/target-entities.json`. The northwestern outer-market
> wave added Jacksboro, Wichita Falls, Jack County, and Palo Pinto County as
> direct profiles, with Young County explicitly blocked on Public Purchase.

Single source of truth for scraper coverage: what's configured, what's live,
what's blocked and why, the dedupe history, and the architecture behind it.
Replaces `bidding-site-scraping-catalog.md`, `scraping-expansion-status.md`,
and `site-expansion-plan.md` (all merged in here, then removed).

## Purpose

This document is the coverage catalog for the bidding websites listed in the
workbook's `Main` and `Additional` tabs, grouped by portal family. It records
the owning public entity, portal family, current scraper status, and specific
extraction notes per source — plus the architecture, dedupe history, and
verification results behind that coverage.

This is a coverage specification, not evidence that every listed source
currently has a *production* scraper. Check the status column before treating
a source as live.

## Status Definitions

| Status | Meaning |
| --- | --- |
| `LIVE` | Supported and returned fresh bids in the latest verified run |
| `CHECKED` | Supported and checked; no fresh open bids were found |
| `BLOCKED` | Adapter exists, but login, timeout, or connectivity prevented a fresh result |
| `FAMILY` | Shared portal adapter exists, but this entity lacks a verified individual profile |
| `TODO` | No production scraper/profile exists yet |
| `MANUAL` | No suitable online source; requires an operator workflow |
| `REPLACE` | Supplied URL is a search page or third-party aggregator and needs an official source |

## Architecture

**Site profiles are the unit of operation.** One profile per agency lives in
`config/sites.json`: stable site ID, agency name, workbook tab (`Main` or
`Additional`), population-derived priority, county, portal family, official
source URL, auth mode, and any `src/sites/<id>.mjs` hook for a unique login or
page layout. Every site is independently runnable even when several share one
adapter:

```bash
npm run scrape:sites -- --site southlake-tx
npm run scrape:sites -- --tab Main --priority 1
```

Three layers, so fixes aren't duplicated across agencies:

1. `src/scrapers/<platform>.mjs` — reusable portal-family adapter (Bonfire,
   IonWave, DemandStar, CivicEngage, Public Purchase, BidNet).
2. `config/sites.json` — per-agency URL, population, location, auth env-var
   names.
3. `src/sites/<site-id>.mjs` — only when a source needs a unique login,
   navigation, pagination, or document-handling path.

**Priority bands** (population-derived, geography around ZIP 76180 takes
precedence over population when ordering work):

- Priority 1: population below 25,000
- Priority 2: population 25,000–50,000
- Priority 3: population 50,001–100,000
- Priority 4: population above 100,000 and large counties

**Secrets never live in the workbook or repo.** A profile's `auth` block names
environment variables only:

```json
{ "auth": { "mode": "credentials", "usernameEnv": "PUBLIC_PURCHASE_USERNAME", "passwordEnv": "PUBLIC_PURCHASE_PASSWORD" } }
```

Never log credentials, cookies, authorization headers, or tokenized download
URLs. Sources marked manual, newspaper-only, blank, or no-online-option stay
in the registry with `enabled: false` and a reason — never silently omitted.

## Operator Commands

```bash
# Run one site
npm run scrape:sites -- --site mansfield-tx

# Run a priority band within a tab
npm run scrape:sites -- --tab Main --priority 1

# Run one adapter family
npm run scrape:civicengage
npm run scrape:public-purchase
npm run scrape:bonfire-sites

# Visible browser for diagnosis
HEADLESS=0 DEBUG_SCRAPE=1 npm run scrape:sites -- --site north-richland-hills-tx

# Cloudflare-walled sites (see "Cloudflare managed challenge" below)
node --env-file=.env scripts/scrape-via-real-chrome.mjs --site keller-tx
```

## Coverage Summary

| Area | Count |
| --- | ---: |
| Total configured site profiles (`config/sites.json`) | 50 |
| `Main` profiles | 31 |
| `Additional` profiles | 19 |
| Batch platforms (central authenticated feeds, not per-site) | 3 (IonWave, DemandStar, Bonfire) |
| CivicEngage / CivicPlus site profiles | 27 |
| Bonfire site profiles | 7 |
| IonWave site profiles | 5 (Watauga, Keller, Flower Mound, Irving, College Station/BrazosBid) |
| Public Purchase site profiles | 5 |
| BidNet site profiles | 6 (Dallas, Travis, Caldwell, Comal, Guadalupe counties, Seguin) |
| BidNet wide search (separate from site profiles) | Texas-wide (~2,500 open) + nationwide aggregate-keyword sweep, both skip subscriber-only rows |
| Site hooks (`src/sites/`) | 1 (Westlake; shared doc-list adapter also used by Haslet, Stephenville) |
| Disabled profiles with reason | 1 (Pantego, soft-404 bids page) |
| Blocked (not code-fixable from this repo) | 2 groups — Coppell (vendor sign-in wall), all 5 Public Purchase sites (network geo-block) |
| JS test coverage (`npm run test:scrapers`) | 32 passed, 0 failed |

Catalog rows below (132 total, both workbook tabs) include the full aspirational
workbook list — configured profiles plus everything still `TODO`, `MANUAL`, or
`REPLACE`.

## Coverage by Platform

### CivicEngage / CivicPlus (34 — 1 BLOCKED, 9 LIVE, 17 CHECKED, 6 TODO, 1 MANUAL)

`src/scrapers/civicengage.mjs` handles standard CivicPlus/CivicEngage
`Bids.aspx` pages: open-bid extraction, bid number/agency/title/deadline/detail-URL
parsing (including layouts where the closing-date label and value sit in
different cells), duplicate removal, rejection of closed/awarded/cancelled/expired
bids, and a warning when a page no longer matches the expected layout. A
`waitForCloudflare` interstitial-poll (added for the Cloudflare-walled sites
below) waits out a transient "Just a moment..." challenge instead of scraping
an empty page.

| Entity | Tab | Link | Status | Notes |
| --- | --- | --- | --- | --- |
| Coppell | Main | [link](https://www.coppelltx.gov/Bids.aspx) | BLOCKED | Bids page redirects to a CivicPlus account sign-in behind Cloudflare — the bid list is no longer publicly viewable at all. Needs an operator decision: register a vendor account, or source Coppell bids elsewhere. |
| Haslet | Main | [link](https://www.haslet.org/395/BID-POSTINGS) | LIVE | Real-Chrome CDP clears Cloudflare; site hook `src/sites/haslet-tx.mjs` parses DocumentCenter links (1 open bid) |
| Mansfield | Main | [link](https://www.mansfieldtexas.gov/Bids.aspx) | LIVE | Verified against the live page: 2 bids with correct IDs/titles/dates/URLs (`2026-20-99-01`, `2026-45-20-01`) |
| Haltom City | Main | [link](https://www.haltomcitytx.com/Bids.aspx) | LIVE | Open bid rows, details and attachments |
| Westlake | Main | [link](https://www.westlake-tx.org/256/Bids-Proposals) | LIVE | Site hook `src/sites/westlake-tx.mjs` parses the document-list page (3 open solicitations); first production site hook |
| White Settlement | Main | [link](https://www.wstx.us/Bids.aspx) | LIVE | Open bid rows, details and attachments |
| Wise County | Main | [link](https://www.co.wise.tx.us/Bids.aspx) | LIVE | Open bid rows, details and attachments |
| Ellis County | Main | [link](https://www.co.ellis.tx.us/Bids.aspx) | LIVE | Open bid rows, details and attachments |
| Copperas Cove | Additional | [link](https://www.copperascovetx.gov/Bids.aspx) | LIVE | Real-Chrome CDP clears Cloudflare; 1 open bid |
| Marshall | Additional | [link](https://www.marshalltexas.net/Bids.aspx) | LIVE | Site profile `marshall-tx`; 1 open bid |
| San Marcos | Additional | [link](https://www.sanmarcostx.gov/Bids.aspx) | LIVE | Site profile `san-marcos-tx`; 3 open bids |
| Trophy Club | Main | [link](https://www.trophyclub.org/Bids.aspx) | CHECKED | Real-Chrome CDP clears Cloudflare; standard Bids.aspx, zero open bids currently |
| Kennedale | Main | [link](https://www.cityofkennedale.com/Bids.aspx?Status=open) | CHECKED | Open bid rows, details and attachments |
| Richland Hills | Main | [link](https://www.richlandhills.com/Bids.aspx) | CHECKED | Open bid rows, details and attachments |
| Azle | Main | [link](https://www.cityofazle.org/Bids.aspx) | CHECKED | Open bid rows, details and attachments |
| Forest Hill | Main | [link](https://www.foresthilltx.org/Bids.aspx) | CHECKED | Open bid rows, details and attachments |
| Alvarado | Main | [link](https://www.cityofalvarado.org/Bids.aspx) | CHECKED | Open bid rows, details and attachments |
| Roanoke | Main | [link](https://roanoketexas.com/Bids.aspx) | CHECKED | Open bid rows, details and attachments |
| Northlake | Main | [link](https://www.town.northlake.tx.us/Bids.aspx) | CHECKED | Open bid rows, details and attachments |
| Argyle | Main | [link](https://www.argyletx.com/Bids.aspx) | CHECKED | Open bid rows, details and attachments |
| Sweetwater | Additional | [link](https://www.sweetwatertx.gov/271/Bid-Postings) | CHECKED | Real-Chrome CDP clears Cloudflare; zero open bids currently |
| Stephenville | Additional | [link](https://www.stephenvilletx.gov/bids.aspx) | CHECKED | Real-Chrome CDP clears Cloudflare; DocumentCenter list, zero open solicitations |
| Azle (Additional dup) | Additional | [link](https://www.cityofazle.org/Bids.aspx) | CHECKED | Already covered by the Main profile; do not duplicate |
| Burkburnett | Additional | [link](https://www.burkburnett.org/Bids.aspx) | CHECKED | Site profile `burkburnett-tx`; parses, zero open bids |
| Mineral Wells | Additional | [link](https://www.mineralwellstx.gov/bids.aspx) | CHECKED | Site profile `mineral-wells-tx`; parses, zero open bids |
| Brownwood | Additional | [link](https://www.brownwoodtexas.gov/Bids.aspx) | CHECKED | Site profile `brownwood-tx`; parses, zero open bids |
| Snyder | Additional | [link](https://www.snydertx.gov/Bids.aspx) | CHECKED | Site profile `snyder-tx`; parses, zero open bids |
| Benbrook | Main | [link](https://www.benbrook-tx.gov/Bids.aspx) | CHECKED | Site profile `benbrook-tx`; official CivicEngage listing verified empty |
| Justin | Main | [link](https://www.cityofjustin.com/Bids.aspx) | CHECKED | Site profile `justin-tx`; official CivicEngage listing verified empty |
| Bedford | Main | [link](https://bedfordtx.gov/Bids.aspx) | BLOCKED | Official fallback identified and profile `bedford-tx` retained disabled. Headless and unattended real-Chrome runs terminate during CivicPlus load; DemandStar has no current exact Bedford attribution. |
| Jacksboro | Main | [link](https://www.cityofjacksboro.com/Bids.aspx) | CHECKED | Profile `jacksboro-tx`; official listing verified empty through unattended real Chrome after headless CivicPlus termination. |
| Wichita Falls | Main | [link](https://www.wichitafallstx.gov/bids.aspx) | LIVE | Profile `wichita-falls-tx`; official Current Bids listing returned 3 open bids through unattended real Chrome. |
| Longview | Additional | [link](https://www.longviewtexas.gov/Bids.aspx) | TODO | Open bid rows and attachments |
| McLennan County | Additional | [link](https://www.mclennan.gov/Bids.aspx) | TODO | Open bid rows, details and attachments |
| Killeen | Additional | [link](https://www.killeentexas.gov/414/Purchasing) | BLOCKED | Official page says OpenGov is the one location for all city bids; current solicitations require registration and the portal returns 403 unattended |
| Pflugerville | Additional | [link](https://www.pflugervilletx.gov/899/BidsRFQs) | CHECKED | Profile `pflugerville-tx`; official Bids/RFQs index live-verified empty |
| Boerne | Additional | [link](https://www.ci.boerne.tx.us/bids.aspx) | CHECKED | Profile `boerne-tx`; city-specific listing replaces Kendall County alias; unattended real Chrome verified empty |
| Cedar Park | Additional | [link](https://www.cedarparktexas.gov/bids.aspx) | LIVE | Profile `cedar-park-tx`; city-specific consolidated listing returned 6 open bids through unattended real Chrome |
| Lockhart | Additional | [link](https://www.cityoflockhart.gov/Bids.aspx) | LIVE | Profile `lockhart-tx`; city-specific listing replaces Caldwell County alias and returned 6 open bids through unattended real Chrome |
| Universal City | Additional | [link](https://universalcitytexas.gov/Bids.aspx) | CHECKED | Profiles `universal-city-tx` and `universal-city-rfps-tx` cover both official city listings; both verified empty |
| Pantego | Main | [link](https://www.townofpantego.com/bids) | MANUAL | `/bids` page is a soft 404; notices run only in the Commercial Recorder newspaper. Profile disabled with this reason. |

Irving (`irving-tx`) is CivicEngage-labeled in the original workbook but
actually runs on IonWave — see the IonWave table below.

### Bonfire (12 — all LIVE except 1 TODO/FAMILY note)

`src/scrapers/bonfire.mjs` scrapes an agency's public Bonfire portal feed
without login and attributes results to the site profile.

| Entity | Tab | Link | Status | Notes |
| --- | --- | --- | --- | --- |
| Fort Worth | Main | [link](https://fortworthtexas.bonfirehub.com/portal/?tab=openOpportunities) | LIVE | Open City of Fort Worth projects and documents |
| Southlake | Main | [link](https://southlake.bonfirehub.com/portal/?tab=openOpportunities) | LIVE | Site profile `southlake-tx`; 1 open bid |
| Williamson County | Main+Additional | [link](https://wilco.bonfirehub.com/portal/?tab=openOpportunities) | LIVE | Site profile `williamson-county-tx`; county source only—city attribution is handled independently |
| Burleson | Main | [link](https://burlesontx.bonfirehub.com/portal/?tab=openOpportunities) | LIVE | Site profile `burleson-tx`; 2 open bids |
| Lewisville | Main | [link](https://cityoflewisville.bonfirehub.com/portal/?tab=openOpportunities) | LIVE | Open City of Lewisville projects and documents |
| Denton County | Main | [link](https://dentoncounty.bonfirehub.com/portal/?tab=openOpportunities) | LIVE | Open county projects and documents |
| Johnson County | Main | [link](https://johnsoncountytx.bonfirehub.com/portal/?tab=openOpportunities) | LIVE (via central feed) | Explicit Bonfire batch owner; exact verifier found 1 retained county-attributed listing. The official public feed was independently checked 2026-08-04 and currently has zero open projects, so no duplicate direct profile is enabled. |
| Round Rock | Additional | [link](https://roundrocktexas.bonfirehub.com/portal/?tab=openOpportunities) | LIVE | Site profile `round-rock-tx`; 3 open bids |
| Temple | Additional | [link](https://templetx.bonfirehub.com/portal/?tab=openOpportunities) | LIVE | Site profile `temple-tx`; 12 open bids (after the Bonfire rate-limit window cleared) |
| Smith County | Additional | [link](https://smithcounty.bonfirehub.com/portal/?tab=openOpportunities) | CHECKED | Site profile `smith-county-tx`; feed live, zero open bids |
| Parker County | Main | [link](https://parkercountytx.bonfirehub.com/portal/?tab=openOpportunities) | CHECKED | Public portal seeded; verify when open bids appear |
| Frisco | Main | [link](https://friscotexas.bonfirehub.com/portal/?tab=openOpportunities) | LIVE | Site profile `frisco-tx` added 2026-07-15 (was FAMILY); 1 open opportunity (Teel Parkway Parking Addition) |
| Leander | Additional | [link](https://leandertx.bonfirehub.com/portal/?tab=openOpportunities) | LIVE | Profile `leander-tx`; official City Bonfire returned 1 open project and replaces Williamson County alias |
| Schertz | Additional | [link](https://schertz.bonfirehub.com/portal/?tab=openOpportunities) | LIVE | Profile `schertz-tx`; official city portal returned 1 open project |

Leander and Cedar Park use city-specific official sources. Williamson County
is not accepted as a geographic alias because it cannot prove city attribution.

### IonWave (8 — 4 configured site profiles LIVE/CHECKED, rest FAMILY/deferred)

`scrapeIonWaveSite` in `src/scrapers/ionwave.mjs` scrapes an agency's public
`SourcingEvents.aspx?SourceType=1` page — no login required.

| Entity | Tab | Link | Status | Notes |
| --- | --- | --- | --- | --- |
| Irving | Main | [link](https://cityofirving.ionwave.net/SourcingEvents.aspx?SourceType=1) | LIVE | Reclassified from CivicEngage to IonWave; 12 open bids, no Cloudflare |
| Keller | Main | [link](https://cityofkeller.ionwave.net/Login.aspx) | LIVE | Central feed never actually carried Keller. Site profile `keller-tx` scrapes the public `SourcingEvents.aspx` page directly — Cloudflare-walled under a bare headless launch (title stays "Just a moment..."), cleared by the site-runner's spoofed UA + hidden `navigator.webdriver`. 1 open bid (`26-007`, 2026 Janitorial Services - The Keller Pointe, closes 7/28/2026). `scrape-via-real-chrome.mjs` verified as a fallback. |
| Flower Mound | Main | [link](https://flower-mound.ionwave.net/Login.aspx) | LIVE | Same story as Keller — site profile `flower-mound-tx`; 2 open bids (`2026-101-A Addendum 2`, `2026-95-A Addendum 3`) |
| Watauga | Main | [link](https://cityofwatauga.ionwave.net/SourcingEvents.aspx?SourceType=1) | CHECKED | Site profile `watauga-tx`; zero open events currently |
| Arlington | Main | [link](https://arlington-tx.ionwave.net/Login.aspx) | LIVE (via central feed) | Attributed via the central authenticated IonWave feed, not a per-site profile |
| Grapevine | Main | [link](https://gpvine.ionwave.net/SourcingEvents.aspx?SourceType=1) | LIVE (via central feed) | Explicit IonWave batch owner; exact verifier found 2 listings, matching the same 2 projects independently present in DemandStar. Direct official portal audit on 2026-08-04 found zero currently open events, so no duplicate profile is enabled. |
| Tarrant County | Main | [link](https://tarrantcountytx.ionwave.net/SourcingEvents.aspx?SourceType=1) | LIVE (via central feed) | Attributed via the central authenticated IonWave feed |
| College Station | Additional | [link](https://brazosbid.ionwave.net/SourcingEvents.aspx?SourceType=1) | LIVE | Site profile `college-station-tx` added 2026-07-15 (was FAMILY); BrazosBid portal, 10 open events |

Arlington, Grapevine, and Tarrant County public pages parse correctly when
probed directly, but per-agency profiles for them are deferred — they already
flow through the central authenticated feed, and adding a redundant per-site
profile is exactly what caused the DemandStar/IonWave duplicate bug (see
"Cross-Source Dedupe History" below) for Keller. Only add a direct per-site
profile for an IonWave agency once it's confirmed the central feed doesn't
already carry it — as it turned out not to for Keller and Flower Mound.

### Public Purchase (6 — all BLOCKED, network-level)

`src/scrapers/public-purchase.mjs` handles username/password login from env
vars, agency-specific login pages, official `www1.publicpurchase.com` profiles,
staged navigation fallbacks, open-bid table parsing, expired-bid rejection,
login-wall detection, and per-site failure reporting with last-known-good
retention.

| Entity | Tab | Link | Status | Notes |
| --- | --- | --- | --- | --- |
| North Richland Hills | Main | [link](https://www1.publicpurchase.com/gems/northrichlandhills%2Ctx/buyer/public/publicInfo) | BLOCKED | Both publicpurchase.com hosts time out from this machine at the network level — raw `curl` and a full browser fail identically. Not a scraper/login/credential problem; matches geo-blocking of non-US traffic. |
| Hurst | Main | [link](https://www1.publicpurchase.com/gems/hurst%2Ctx/buyer/public/publicInfo) | BLOCKED | Same network-level block |
| Cleburne | Main | [link](https://www1.publicpurchase.com/gems/cleburne%2Ctx/buyer/public/publicInfo) | BLOCKED | Same network-level block |
| Duncanville | Main | [link](https://www1.publicpurchase.com/gems/duncanville%2Ctx/buyer/public/publicInfo) | BLOCKED | Same network-level block |
| Godley | Main | [link](https://www1.publicpurchase.com/gems/godley%2Ctx/buyer/public/publicInfo) | BLOCKED | Same network-level block |
| Young County | Main | [link](https://www1.publicpurchase.com/gems/buyer/public/home?region=TX&syndicatedOrgId=22721) | BLOCKED | Official County of Young portal requires login; profile `young-county-tx` retained disabled under the same Public Purchase access/geo-block. |

**Fix:** run the scraper from a US egress IP (VPN or US-hosted machine). No
code change needed — credentials are already configured in `.env` and the
login flow is ready; all 5 should come alive on the first run from a US IP.

### BidNet (6 — 1 LIVE, 5 FAMILY)

`src/scrapers/bidnet.mjs` scrapes a buyer's public open-solicitations listing
on bidnetdirect.com — no login for the list view. BidNet returns 403 to
default headless fingerprints, so the site runner uses a realistic Chrome UA
and hides `navigator.webdriver`.

| Entity | Tab | Link | Status | Notes |
| --- | --- | --- | --- | --- |
| Dallas County | Main | [link](https://www.bidnetdirect.com/texas/dallas-county/solicitations/open-bids?selectedContent=BUYER) | LIVE | Site profile `dallas-county-tx`; 7 open solicitations |
| Travis County | Additional | [link](https://www.bidnetdirect.com/texas/traviscounty) | LIVE | Site profile `travis-county-tx` added 2026-07-15 (was FAMILY); 8 open solicitations |
| Caldwell County | Additional | [link](https://www.bidnetdirect.com/texas/caldwellcounty) | CHECKED | Site profile `caldwell-county-tx` added 2026-07-15 (was FAMILY); page loads correctly, zero open solicitations currently |
| Comal County | Additional | [link](https://www.bidnetdirect.com/texas/comalcounty) | LIVE | Site profile `comal-county-tx` added 2026-07-15 (was FAMILY); 3 open solicitations |
| Guadalupe County | Additional | [link](https://www.bidnetdirect.com/texas/guadalupecounty) | CHECKED | Site profile `guadalupe-county-tx` added 2026-07-15 (was FAMILY). The workbook's original link (`/private/supplier/solicitations/search`) is BidNet's login-only search page — this is the correct public buyer page. Loads correctly; page explicitly states "There are no open bids at this time". |
| Seguin | Additional | [link](https://www.bidnetdirect.com/texas/cityofseguin) | LIVE | Site profile `seguin-tx` added 2026-07-15 (was FAMILY); 4 open solicitations |

**BidNet wide search (July 14, 2026).** Separate from the per-buyer profiles
above: `scripts/scrape-bidnet-wide.mjs` logs into the account's own
"Solicitation Search" (`https://www.bidnetdirect.com/private/supplier/solicitations/search`
— requires `BIDNET_USERNAME`/`BIDNET_PASSWORD`, already in `.env`, or it
redirects to SSO login) and runs two sweeps:

1. **Texas, all categories.** Applies the account's Texas location filter
   (facet value `277`), then paginates every result (`?pageNumber=N&pageSize=100`).
   Live-verified at ~2,500 open Texas solicitations.
2. **Nationwide, aggregate keywords only.** Clears the location filter, runs
   each term from `src/keywords.mjs`'s `AGGREGATE_KEYWORDS` (the same list
   `push-clickup-tasks.mjs` uses — extracted from that script into a shared
   module so the two don't drift) through BidNet's own keyword search
   (`#solicitationSingleBoxSearch` + `#topSearchButton`), dedupes by bid ID
   across keywords, then re-applies the Texas filter before finishing.
   Nationwide, unfiltered by location, per the client's instruction that
   aggregate-supply opportunities aren't limited to the DFW service area.

**Every "upgrade required" row is skipped, never scraped.** BidNet's free
tier shows a teaser for solicitations outside the account's paid coverage —
title, state, and category only, no agency, no detail link the account can
actually open. `normalizeBidNetSearchRows` drops these before they ever
become a bid record; confirmed live (~84% of nationwide open solicitations
are locked to this account) and covered by a unit test
(`tests/js/site-adapters.test.mjs`).

**The Texas filter is flaky to apply, not to detect.** BidNet's facet panel
is a JSF ajax component whose checkbox can report `checked` after a click
even when the server-side filter silently didn't take (verified: checkbox
`checked=true`, results tile still showed the nationwide count). The real
signal is the results tile itself — nationwide is abbreviated with a "K"
suffix ("28K"), Texas is small enough to render as a full comma-formatted
number ("2,516") — so `applyBidNetTexasFilter` verifies against that instead
of the checkbox, and retries (reloading fresh between attempts) up to 4
times before throwing. Verified reliable across repeated clear→reapply
cycles.

**Restoring the Texas filter matters:** it's remembered server-side on the
shared BidNet account, so it's what anyone sees on a plain manual login —
`scrapeBidNetAggregatesNationwide` always re-applies it before returning,
even on a keyword-search-only run, so the nationwide sweep never leaves the
account looking wrong to a human checking it afterward.

Not yet wired into the automatic dashboard sync (`Scrape + sync sheet`
button) — it's credential-based and mutates shared account state each run,
so it's a standalone `npm run scrape:bidnet-wide` for now pending a decision
on making it part of the regular pipeline. Feeds `data/raw/bidnet-wide-bids.json`,
already added to `scripts/combine-bids.mjs`'s source list.

Lockhart uses its city-specific CivicEngage listing. Caldwell County is not
accepted as a geographic alias because it cannot prove city attribution.

### DemandStar (3 — batch feed, central authenticated account)

DemandStar is one of the 3 batch platforms, not per-site profiles. The central
feed's expired-session auto-relogin was verified end to end from a cold
browser profile (expiry detected → credential login → retry → 48 bids
retained).

| Entity | Tab | Link | Status | Notes |
| --- | --- | --- | --- | --- |
| Cedar Hill | Main | [link](https://www.demandstar.com/app/suppliers/bids) | LIVE | 2 City of Cedar Hill bids in the latest central-feed run |
| Bedford | Main | [link](https://network.demandstar.com/) | CHECKED | Central feed live; no Bedford bids in current results |
| Plano | Main | [link](https://www.demandstar.com/app/suppliers/bids) | CHECKED | Central feed live; no Plano bids in current results |

### CivCast, OpenGov, Infor/Lawson, Workday, BeaconBid

No adapter built yet.

| Entity | Tab | Platform | Link | Notes |
| --- | --- | --- | --- | --- |
| Pelican Bay | Additional | CivCast | [link](https://www.civcastusa.com/project/67240224f73b74d21c98ff3c/summary) | Project details, owner, bid date and plans |
| Mount Pleasant | Additional | OpenGov | [link](https://procurement.opengov.com/portal/mpcity) | BLOCKED — official city purchasing page confirms this as the complete portal, but unattended access receives a Cloudflare block; retained for daily human review |
| Kyle | Additional | OpenGov | [link](https://procurement.opengov.com/portal/cityofkyle) | BLOCKED — official city RFPs & Bids destination returns 403 to unattended access; retained for human review |
| Bexar County | Additional | Infor/Lawson + CivCast | [link](https://www.bexar.org/2377/Do-Business-with-Bexar-County) | BLOCKED — official coverage is split between registered Infor supplier access for goods/services/facilities/parks and a CivCast Public Works listing that returns 403 unattended; partial coverage is not ready |
| Universal City | Additional | City CivicEngage + RFP page | [link](https://universalcitytexas.gov/Bids.aspx) | City-specific profiles replace the unproven Bexar Infor alias; dedupe preserves links from both official city sources |
| New Braunfels | Additional | Workday Spend | [link](https://city-of-new-braunfels.public-portal.us.workdayspend.com/) | Public sourcing events, details and documents |
| Kendall County | Additional | BeaconBid | [link](https://www.beaconbid.com/solicitations/kendall-county/open) | Open solicitations, dates, details and documents |

### Official city/county page, no portal family

No reusable adapter — each needs a configurable HTML/PDF adapter or a
one-off.

| Entity | Tab | Link | Notes |
| --- | --- | --- | --- |
| Euless | Main | [link](https://www.eulesstx.gov/departments/purchasing-office/bids-and-quotes) | Site profile `euless-tx`; official page real-Chrome verified 4 open records; WAF returns 403 to the headless runner |
| Colleyville | Main | [link](https://www.colleyville.com/government/bid-opportunities) | Site profile `colleyville-tx`; official city page replaces generic CivCast search and real-Chrome verified empty |
| Jack County | Main | [link](https://www.jackcounty.org/pages/auditor.html) | Site profile `jack-county-tx`; official Auditor Competitive Bidding section verified empty through unattended real Chrome |
| Palo Pinto County | Main | [link](https://www.co.palo-pinto.tx.us/page/PublicNotices) | Site profile `palo-pinto-county-tx`; official County Bids/RFP section returned 1 current undated RFP after stale month/year and Q&A artifacts were excluded |
| Saginaw | Main | [link](https://www.ci.saginaw.tx.us/government/bid_opportunities.php) | Open opportunities and linked solicitation files |
| Crowley | Main | [link](https://www.ci.crowley.tx.us/rfps) | RFP/RFQ listings, deadlines and PDFs |
| Sansom Park | Main | [link](https://www.sansompark.org/2245/BIDS) | Open bids and linked documents |
| Lake Worth | Main | [link](https://www.lakeworthtx.org/Bids.aspx) | Site profile `lake-worth-tx`; replacement for the retired workbook URL; verified empty |
| Westworth Village | Main | [link](https://www.cityofwestworth.com/bids) | Open bids, deadlines and attachments |
| Dalworthington Gardens | Main | [link](https://www.cityofdwg.net/bidding-request-for-proposals) | Open RFP/bid postings and documents |
| Aledo | Main | [link](https://www.aledotx.gov/finance-department/pages/bid-opportunities-city-auctions) | Open bid opportunities and documents |
| Grand Prairie | Main | [link](https://www.gptx.org/Departments/Engineering/Engineering-Design-and-CIP-Projects/Bid-Proposals) | Engineering/CIP bid proposals and files |
| Willow Park | Main | [link](https://www.willowparktx.gov/344/Public-Notices-RFPs-RFQs) | Site profile `willow-park-tx`; reviewed blank solicitation section verified empty |
| Weatherford | Main | [link](https://weatherfordtx.gov/654/BidNotices) | Site profile `weatherford-tx`; site hook live-verified 2 open RFPs and amendment provenance |
| Cresson | Main | [link](https://www.cressontx.org/rfps) | Site profile `cresson-tx`; official listing verified empty |
| Springtown | Main | [link](https://cityofspringtown.com/city-services/bid-invitations/) | Site profile `springtown-tx`; reviewed blank Current Solicitations section verified empty |
| Carrollton | Main | [link](https://www.cityofcarrollton.com/departments/departments-a-f/engineering/current-bids) | Engineering current bids and plan documents |
| Joshua | Main | [link](https://www.cityofjoshuatx.us/open-records-request/pages/bids-proposals) | Site profile `joshua-tx`; real-Chrome site hook captures 2 items from the official Open Bid Requests section |
| Reno | Main | [link](https://www.renotx.gov/) | MANUAL — human-approved as the Parker County city; official site has no complete online procurement index and required advertisements use the official city paper |
| Marfa | Main | [link](https://www.cityofmarfa.com/rfps) | BLOCKED — official open/closed Bids and RFPs index confirmed; disabled after HTTP 403 in both headless and unattended real-Chrome runs on 2026-08-04 |
| Vernon | Additional | [link](https://www.vernontx.gov/413/Bid-Solicitation) | Bid solicitations and linked files |
| Tyler | Additional | [link](https://www.cityoftyler.org/City-Government/Vendors-and-Bids) | MANUAL — notices are published in the newspaper and departments maintain separate vendor lists; the online RFQ/RFP section is not a complete citywide source |
| Wichita County | Additional | [link](https://wichitacountytx.com/rfp/) | RFP/bid postings and linked files |
| Clay County | Additional | [link](https://www.claycountytx.net/legal-notice) | Site profile `clay-county-tx`; official Legal Notices page live-verified empty |
| Callahan County | Additional | [link](https://www.callahancounty.org/page/callahan.County.Bids) | Open county bids and documents |
| Eastland County | Additional | [link](https://www.eastlandcountytexas.com/page/eastland.Bids) | Open county bids and documents |
| Gregg County | Additional | [link](https://greggcounty.texas.gov/departments/purchasing/bids-addendums) | Bids, addenda and purchasing documents |
| Bell County | Additional | [link](https://www.bellcountytx.com/purchasing/current_bids.php) | Current bids, details and documents |
| Burnet County | Additional | [link](https://www.burnetcountytexas.org/page/auditor.bids) | Site profile `burnet-county-tx`; official County Auditor current-bid index, live-verified empty after closed archive and past deadline filtering |
| Bastrop County | Additional | [link](https://www.co.bastrop.tx.us/page/pur.bids) | Open bids and documents |
| Milam County | Additional | [link](https://www.milamcounty.net/departments/public_notices_bid_proposals/index.php) | Bid/proposal notices and linked documents |
| Blanco County | Additional | [link](https://www.blancocountytexas.gov/) | MANUAL — official county site has no complete procurement list; workbook URL belongs to the City of Blanco and is rejected as the wrong entity |
| Llano County | Additional | [link](https://www.llanocounty.gov/page/Public.Notices) | Site profile `llano-county-tx`; official Public Notices page live-verified empty |
| Georgetown | Additional | [link](https://www.georgetowntexas.gov/government/finance_and_purchasing/doing_business_with_the_city/bid_opportunities.php) | Bid opportunities, dates and documents |
| Austin | Additional | [link](https://financeonline.austintexas.gov/afo/account_services/solicitation/solicitations.cfm) | Open solicitations, commodity data and documents (Finance Online) |
| San Antonio | Additional | [link](https://webapp1.sanantonio.gov/BidContractOpps/Default.aspx) | Bid/contract opportunities and documents (custom portal) |
| Waco | Additional | [link](https://www.waco-texas.com/Home/Connect-with-Waco/Current-Bid-Opportunities) | Current bid opportunities and linked files |
| Bryan | Additional | [link](https://www.bryantx.gov/purchasing-services/) | BATCH-OWNED — city states all vendor bids use Brazos Valley Online Bidding; exact `City of Bryan` attribution verified in the central IonWave feed |
| Belton | Additional | [link](https://www.beltontexas.gov/government/city_clerk/bid_postings/index.php) | Bid postings and linked files |
| Coryell County | Additional | [link](https://www.coryellcounty.org/page/coryell.Bids.RFQ) | Open bids/RFQs and linked documents |
| Wood County (public notices) | Additional | [link](https://www.mywoodcounty.com/page/public_notice_main) | Site profile `wood-county-tx`; official designated public-notice source live-verified empty |
| Jones County (public notices) | Additional | [link](https://www.co.jones.tx.us/) | Site profile `jones-county-tx`; official homepage replaces the estray page and past bid deadlines are filtered; live-verified empty |
| Wilbarger County | Additional | [link](https://www.co.wilbarger.tx.us/page/PublicNotices) | Site profile `wilbarger-county-tx`; official Public Notices calendar replaces BidOcean; live-verified empty |
| Brown County | Additional | [link](https://www.browncountytx.gov/page/brown.PublicNotices) | Site profile `brown-county-tx`; official Public Notices page replaces TexasBids; live-verified empty |

### Manual — no scrapeable source

MANUAL means the entity publishes no scrapeable online listing at all — no
automation can exist. The registry keeps them visible so they're never
silently forgotten. These never count as scraper failures.

| Entity | Tab | Why manual | Operator action |
| --- | --- | --- | --- |
| River Oaks | Main | No procurement page; workbook notes voicemail left, awaiting callback | Call/email the city; enter any verified bid by hand |
| Everman | Main | Publishes legal notices in the Star-Telegram newspaper only | Check Star-Telegram legal notices or call 817-293-0525 ext. 314 |
| Edgecliff Village | Main | No portal; existing relationship with the city | Confirm opportunities with the known contact (Joe Sloan) and enter manually |
| Blue Mound | Main | Official city site exposes contacts and records but no complete current-bid listing | Contact the city and enter verified opportunities manually |
| Farmers Branch | Main | Official purchasing page has no complete public solicitation list; GovCB is rejected as a third-party source | Contact Purchasing or check the authenticated vendor workflow manually |
| Rhome | Main | Official city site has no complete current-bid list; TexasBids rejected | Contact the city and enter verified opportunities manually |
| Bartonville | Main | Town Secretary publishes legal notices, but no complete procurement list; TexasBids rejected | Check official notices/contact the Town Secretary |
| Graham | Main | Official site publishes occasional individual RFP documents but no complete current index | Contact City Purchasing and enter verified opportunities manually |
| Graford | Main | No official complete online current-bid listing identified as of 2026-08-04 | Confirm directly with the city |
| Bridgeport | Main | Official vendor page explicitly states purchasing is decentralized and there is no central bid list | Contact the relevant city department directly |
| Reno | Main | Human-approved as the Parker County city; official site has no complete online procurement index | Check the official city paper/public notices or contact City Hall |
| Pelican Bay | Main | Supplied CivCast URL is a one-off project; official city News has occasional bid notices but no complete enduring index | Check official News and contact the City Secretary |
| Cross Timber | Main | Incorporated Johnson County town has no complete procurement index; InstantMarkets rejected | Confirm opportunities directly with the Town |
| Tyler | Additional | Official page says notices are published in the newspaper and departments maintain separate vendor lists; no single online list is complete | Check the official page/newspaper and contact the relevant city department |
| Blanco County | Additional | Official county site has no complete procurement listing; supplied City of Blanco URL is a different entity | Check county notices and contact the County Auditor/administration |
| Harker Heights | Additional | Official site documents competitive purchasing but has no complete current-bid index; TexasBids is rejected | Contact City Finance and enter verified opportunities manually |

(Pantego is also effectively manual — see the CivicEngage table above, where
it's tracked with its disabled site profile.)

### Aggregators needing an official source (0)

REPLACE means the supplied URL is a search page or third-party aggregator, not
an official source. Aggregators are discovery-only, never a production source.

Cross Timber's InstantMarkets row was rejected after human review. The
canonical entity is the incorporated Town of Cross Timber, retained as manual
because its official site has no complete procurement index.

## Cloudflare Managed Challenge — Solved via Real Chrome

Several CivicPlus sites and two IonWave public pages sat behind a Cloudflare
*managed challenge* (not a clickable Turnstile widget — a passive JS
fingerprint check). A bare Playwright launch fails it even headed and with
stealth patches, because the launch flags carry an automation fingerprint
Cloudflare detects; waiting it out does not help on its own.

**What works, in order of preference:**

1. **Regular headless `scrape:sites`.** The per-site runner
   (`scripts/scrape-sites.mjs`) already launches a persistent context with a
   realistic desktop Chrome UA and `navigator.webdriver` hidden — that alone
   clears the challenge for Keller and Flower Mound under normal headless
   operation.
2. **`scripts/scrape-via-real-chrome.mjs`** attaches Playwright to the
   operator's own Chrome over CDP. Chrome launched normally is
   indistinguishable from real browsing, so it clears the challenge in ~10s;
   we then drive that real session. This is not a bypass of an access
   control — it's automating a genuine browser the operator started. Used for
   the CivicPlus sites where (1) doesn't apply (no persistent-context runner
   path for those pages), and verified as a fallback for Keller/Flower Mound
   too.

The CivicEngage, CivicPlus-doc-list, and IonWave site adapters all gained a
`waitForCloudflare` step that polls for the challenge to clear.

**Results:** Haslet (1 bid), Copperas Cove (1 bid), Keller (1 bid), Flower
Mound (2 bids) — all LIVE. Trophy Club, Stephenville, Sweetwater — CHECKED
(cleared, zero open bids). Irving turned out to run on IonWave, not CivicPlus,
and needs no Cloudflare handling at all.

**Still blocked, not Cloudflare-fixable:**

- **Coppell** — bids page now redirects to a CivicPlus vendor sign-in
  (itself behind Cloudflare); the bid list isn't publicly viewable at all.
  Needs an operator decision (vendor account, or another source).
- **Public Purchase (5 sites)** — network-level geo-block, not an anti-bot
  challenge; needs a US egress IP, not a code change.
- **Pantego** — soft-404, not Cloudflare; disabled with reason, notices run
  in the Commercial Recorder newspaper instead.

## Cross-Source Dedupe History

Two real duplicate bugs found and fixed while expanding coverage — both in
`src/site-runner.mjs`'s `dedupeBids`, the cross-source merge used by
`scripts/combine-bids.mjs` and `scripts/scrape-sites.mjs`.

**1. Agency-string mismatch (Irving).** The same Irving bid (`125LR-26F`) came
in twice — once via the batch IonWave feed, once via the new `irving-tx`
per-site profile — with differently formatted agency strings
(`"City of Irving, TX"` vs. `"City of Irving"`). Every dedupe key in the
codebase included `agency`, so the near-identical spelling defeated matching
(327 bids instead of 315). Fixed by dropping `agency` from every dedupe
signature — kept in the key only conceptually via `title`, which stays
because Copperas Cove prefixes every bid with the same short code
(`"Bid No. PW ..."`), and without `title` in the key five distinct bids would
collapse into one. Fixed in `src/site-runner.mjs`, `src/scrapers/common.mjs`,
`src/scrapers/ionwave.mjs`, `src/scrapers/demandstar.mjs`, and
`src/bids.mjs`'s `dedupeKey`.

**2. Cross-platform posting (Keller and 57 others).** Adding the Keller
profile surfaced a much bigger version of the same problem: 58 duplicate
groups (59 extra records) system-wide. Many municipalities and school
districts (Arlington, Frisco, Mansfield ISD, Grapevine, Carroll ISD, Keller
itself) cross-post the identical bid to DemandStar *and* their own portal
(Bonfire/IonWave direct). The agency fix above only dropped `agency` —
`platform` and `bidId` were still enough to keep these apart, because
DemandStar assigns its own tracking-style bid number
(`"RFB - Sealed - Public-26-007"`) to a bid the origin portal calls something
else (`"26-007"`), and it's naturally a different `platform` value by
definition. Fixed in `src/site-runner.mjs`'s `dedupeBids` only (not the four
per-source dedupe functions, which correctly keep `platform`/`bidId` — they
dedupe *within* one source's own scrape) by dropping both `platform` and
`bidId`, leaving `title` + `dueDate` (case/whitespace-normalized) as the sole
signature. Verified every collapsed group by hand: all differ only in
formatting of the same agency/bid-number/platform, none are genuinely
distinct bids. Combined feed went from 315 to 271 bids.

**Don't reintroduce `agency`, `platform`, or `bidId` into
`src/site-runner.mjs`'s cross-source `dedupeBids` key without re-checking both
of these cases.**

## Verification Results

```text
npm run check          Config OK
npm run test:scrapers  32 passed, 0 failed
node --check            Runner and adapters pass syntax checks
```

Tests cover: CivicEngage normalization and empty/stale rows, split
closing-date layouts, Public Purchase normalization and empty/stale rows,
Bonfire batch and site-profile behavior (empty feeds, HTTP/rate-limit
fail-closed), IonWave site-row normalization, BidNet row normalization,
Westlake document-list extraction and dedupe, per-site credential resolution
and missing-variable failures, site hook discovery/loading/contract
validation, expired-session detection for the login-wall warnings all three
batch platforms emit.

## Credential Status

- Portal credentials from the client workbook (Main tab, columns B/C) live
  only in the gitignored `.env` — IonWave, DemandStar, Bonfire, Public
  Purchase, plus CivCast and BidNet for future adapters.
- Not in source code, configuration, tests, reports, or logs.
  `.env.example` contains only empty placeholders.
- The Google service account key lives in `credentials/cortex-sa.json`;
  `credentials/` is gitignored.
- The plaintext credentials in the source workbook should still be rotated
  and removed from that workbook.

## Batch Platform Status

The 3 batch platforms use one central authenticated supplier account each,
covering many agencies without a per-agency profile — separate from the 43
site profiles above.

- **IonWave** — 158 bids with workbook credentials.
- **DemandStar** — 48 bids; expired-session auto-relogin verified end to end
  from a cold browser profile (expiry detected → credential login → retry →
  48 bids).
- **Bonfire** — 64 bids from the 11 configured seed agency portals. The
  Agency Explorer discovery filter couldn't be confirmed after login (UI
  change) — the adapter degrades to seed-only refresh with a warning instead
  of failing the whole run. Discovery selector needs a future fix.
- **Public Purchase** — credentials configured, but both hosts are
  unreachable from this machine at the network level (see the Public
  Purchase table above).

## Pipeline Integration

- `scripts/combine-bids.mjs` merges all raw sources (site profiles + batch
  platforms) into one deduped `data/raw/bids.json`, feeding both the Sheet
  push and `normalize:bids`.
- `npm run sync:sheet` / dashboard "Scrape + sync sheet" button pushes the
  combined feed to the canonical Google Sheet.
- **ClickUp push:** `scripts/push-clickup-tasks.mjs` reads
  `data/raw/bids.json`, matches each bid against the client's
  Aggregates/General Construction keyword lists (word-boundary regex for
  single words, phrase match for multi-word terms), and creates a task in
  each matching list for bids not already there (dedupe by exact task name,
  `"{title} - {agency}"`). Every created task is assigned to
  `CLICKUP_DEFAULT_ASSIGNEE_ID` (Eric Robb, `114218682`). Writes
  `data/out/clickup-push-report.json` for the API/UI layer. First real run:
  315 combined bids → 2 Aggregates + 14 General Construction matches, 15
  created (1 pre-existed); a rerun is idempotent (0 created the second pass).
  Live ClickUp workspace has a `Bid Opportunities` space with two flat lists
  — `Aggregates Supply` (`901114103788`) and `General Construction`
  (`901114103789`) — not the `Bids & Opportunities` space with folders that
  `config/clickup-structure.json` describes; see
  `docs/clickup-manual-setup.md`.
- **Dashboard sync button:** `frontend/app/page.tsx`'s "Scrape + sync sheet"
  button (`POST /api/sync-sheet`, `app/sheet_sync.py`) shells out to the same
  Node CLI steps a human would run (`scrape:sites` → `scrape:bids` →
  `combine:bids` → push step) — a click takes several minutes (43 sites + 3
  batch platforms) — then automatically chains into
  `POST /api/sync-clickup` (`app/clickup_sync.py`) using the same
  already-scraped feed, no second scrape. A standalone "Sync ClickUp" button
  also exists for re-pushing without re-scraping. Neither writes into the
  dashboard's own SQLite repository — only "Scan portals" does that. Both
  endpoints follow the fail-closed convention: errors come back as
  `{status: "failed", error: "..."}` in the response body, not an HTTP 5xx.

## Remaining Work

- Add CivCast for Colleyville and Pelican Bay.
- Investigate Euless Cityworks.
- Add reusable official-city-page adapters for the 22 official-page TODO
  entries (Main + Additional).
- Resolve Public Purchase connectivity (needs a US egress IP — not fixable
  from this codebase) and complete authenticated live checks for all five
  agencies once reachable.
- Coppell requires an operator decision (vendor account or alternate
  source).
- Expand BidNet for Travis, Caldwell, Comal, Guadalupe, Seguin — adapter is
  live, just needs profiles copying the `dallas-county-tx` pattern.
- Add OpenGov for Mount Pleasant and Kyle.
- Investigate Bexar Infor/Lawson and New Braunfels Workday as isolated
  adapters.
- Replace the 8 aggregator/manual-search URLs with official sources.
- Reconcile source counts before enabling scheduled runs.
- Add per-site health and authentication status to the operator UI.
- Confirm whether Lockhart (Additional tab) needs its own BidNet filter
  or should keep aliasing to the `caldwell-county-tx` feed now that profile
  exists.

**2026-07-15: closed out all 6 FAMILY entries.** Frisco (Bonfire),
College Station/BrazosBid (IonWave), and Travis/Caldwell/Comal/Guadalupe
counties + Seguin (BidNet) all had working adapters but no dedicated site
profile — added all 6 to `config/sites.json` and live-verified each
individually via `scripts/scrape-sites.mjs --site <id>`. Results: Frisco 1
bid, College Station 10 bids, Travis County 8, Comal County 3, Seguin 4,
Caldwell County and Guadalupe County both load correctly with genuinely
zero open solicitations right now (CHECKED, not broken). Guadalupe
County's workbook URL was wrong (pointed at BidNet's login-only search
page) — corrected to the public buyer page. No adapter code changes
needed; `npm run check` and `npm run test:scrapers` (32/32) both pass.

**2026-07-16: swept the "Copy of Bidding URLS" Google Sheet (82 URLs) into
coverage.** Live-checked every URL (curl batch + headless Playwright retry),
then added 25 site profiles and three new adapters:

- `src/scrapers/static-list.mjs` (`StaticList` platform) — generic static-HTML
  listings: table rows with deadline columns, content links to bid documents,
  and (opt-in `allowTextNotices` profile flag) plain-text "NOTICE OF BID"/
  "RFP# ..."/"Title + DUE DATE:" blocks. Covers the ezTask county CMS family
  (Colorado, Coryell, Upshur, Callahan, Eastland, Bastrop), Revize cities
  (Saginaw, Belton construction sub-page, Bell County), school districts
  (Arlington ISD, HEB ISD), one-off apps (Austin CFM, San Antonio ASP.NET),
  and small CivicPlus content pages (Sansom Park, Vernon, DWG).
- `src/scrapers/workday-spend.mjs` (`WorkdaySpend`) — Workday Strategic
  Sourcing public portals; New Braunfels profile. Status values seen live:
  OPEN / CLOSED / INTEND TO AWARD.
- `src/scrapers/beaconbid.mjs` (`BeaconBid`) — BeaconBid open-solicitations
  pages; Kendall County profile.

Config-only adds: Hays County (BidNet), Kendall County (CivicEngage,
usually empty — BeaconBid has the live ones), Longview + McLennan County
(CivicEngage, Cloudflare-walled, need the real-Chrome runbook).
Live-verified counts on 2026-07-16: Austin 24, San Antonio 20, Coryell 6,
Upshur 4, Eastland 4, Arlington ISD 3, Kendall/BeaconBid 3, plus 1 each
for Colorado, Callahan, Sansom Park, Vernon, DWG, HEB ISD, Hays. Sites
that load fine with zero open bids right now (CHECKED, not broken):
Bastrop, Saginaw, Belton, Bell County, Wichita County, Gregg County,
Kendall CivicPlus, New Braunfels (27 events, all CLOSED/INTEND TO AWARD).
Grand Prairie profile added disabled — its page hosts bid-book templates,
not solicitations. Dead sheet URLs (404/gone): TCU PDF, Lake Worth,
Castleberry ISD, Godley ISD, Tyler, Blanco. Bot-blocked beyond headless:
Crowley, Westworth Village, Aledo, BidOcean/Wilbarger, OpenGov (Mount
Pleasant, Kyle, and Killeen's portal), Georgetown, Milam County, Waco.
Bryan needs no scraper — its bids ride the BrazosBid IonWave instance the
College Station profile already scrapes. Wrote "Scrape Status" + "Reason"
columns back to the sheet (Sheet1 D:E) via the cortex service account, and
pushed the combined feed to ClickUp (15 new tasks; 17 aggregates / 116
general-construction matches). `npm run check` and `npm run test:scrapers`
(32/32) both pass.

## Key Files

- `config/sites.json` — site registry, priorities, per-site auth/notes
- `scripts/scrape-sites.mjs` — independent per-site runner
- `scripts/scrape-via-real-chrome.mjs` — CDP-attach runner for Cloudflare-walled sites
- `scripts/scrape-bidnet-wide.mjs` — BidNet account-wide search (Texas-wide + nationwide aggregate keywords)
- `scripts/combine-bids.mjs` — merges all raw sources into deduped `data/raw/bids.json`
- `scripts/push-clickup-tasks.mjs` — keyword-filters and pushes bids to the live ClickUp lists
- `src/site-runner.mjs` — site selection, auth resolution, hook loading, cross-source dedupe
- `src/portal-login.mjs` — shared login + expired-session recovery for batch portals
- `src/keywords.mjs` — client's Aggregates/General Construction keyword lists, shared by the ClickUp push and the BidNet wide search
- `src/sites/README.md` — site hook contract and example
- `src/scrapers/bonfire.mjs` — Bonfire batch and per-site adapters
- `src/scrapers/civicengage.mjs` — CivicEngage adapter
- `src/scrapers/civicplus-doclist.mjs` — shared adapter for document-list CivicPlus pages
- `src/scrapers/ionwave.mjs` — IonWave batch and per-site adapters
- `src/scrapers/bidnet.mjs` — BidNet per-site adapter, plus the account-wide Texas/aggregate-keyword search
- `src/scrapers/public-purchase.mjs` — Public Purchase adapter
- `src/scrapers/static-list.mjs` — generic static-HTML listing adapter (ezTask counties, Revize cities, ISDs, Austin/San Antonio)
- `src/scrapers/workday-spend.mjs` — Workday Strategic Sourcing public portals (New Braunfels)
- `src/scrapers/beaconbid.mjs` — BeaconBid open-solicitations pages (Kendall County)
- `src/bids.mjs` — categorization, scoring, and dedupe key for the Sheet/ClickUp review flow
- `app/sheet_sync.py` / `app/clickup_sync.py` — dashboard sync-button orchestrators
- `tests/js/` — 32 tests: CivicEngage/Public Purchase/Bonfire/BidNet (site + wide-search)/IonWave/
  Westlake/site-adapter parsers, auth resolution, hook loading, portal-login
- `docs/portal-ingestion-runbook.md` — operator commands and recovery guidance
- `docs/clickup-manual-setup.md` — reconciles the original ClickUp plan vs. the live space
