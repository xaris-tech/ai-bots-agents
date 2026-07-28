# Portal Ingestion Runbook

## Daily Flow

1. Open each portal with saved browser session.
2. Search active opportunities.
3. Filter for construction and aggregates.
4. Capture:
   - platform
   - bid ID
   - title
   - agency
   - location
   - due date
   - bid URL
   - documents URL
   - estimated value if shown
5. Use dedupe key: `platform + bid ID/title + agency + due date`.
6. Score with `src/bids.mjs`.
7. Create or update ClickUp task.
8. Assign CEO and set `CEO Decision = Pending`.

## Browser Session Setup

Run:

```bash
npm run auth:portals
```

Log in to IonWave, DemandStar, and Bonfire in opened browser windows. Browser state saves under `playwright/.auth/cortex-portals`.

To refresh only the Bonfire session:

```bash
npm run auth:bonfire
```

Log in to Euna Supplier Network, confirm Agency Search loads, and then stop the
command with `Ctrl+C`. No Bonfire password is required in `.env` when the saved
browser session is used.

## Expired Session Recovery

`npm run scrape:bids` now detects an expired portal session (login wall instead
of the bid list) and recovers automatically when it can:

1. If the platform's `*_USERNAME`/`*_PASSWORD` variables are set in `.env`, the
   runner re-submits the login form once and retries the scrape.
2. If the credentials are missing, or the portal shows a CAPTCHA, or the login
   form is still visible after submitting, the run fails closed: the warning
   names the exact fix (set the env vars or run `npm run login:portals`), and
   the platform's last-known-good bids are retained.

The runner never bypasses CAPTCHA or MFA challenges — those always require a
manual login through `npm run auth:portals` or `npm run login:portals`.

Set `PLAYWRIGHT_USER_DATA_DIR` to point the batch runner at a different saved
browser profile (defaults to `playwright/.auth/cortex-portals`).

## Cloudflare Sites via Real Chrome

Some CivicPlus sites (Haslet, Trophy Club, Sweetwater, Stephenville, Copperas
Cove) sit behind a Cloudflare managed challenge that Playwright-launched
browsers cannot clear. Drive the operator's own Chrome instead — a normally
launched Chrome clears the challenge on its own, and Playwright attaches to it
over CDP.

1. Quit Chrome completely.
2. Launch Chrome with remote debugging on a dedicated profile:

   ```bash
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
     --remote-debugging-port=9222 \
     --user-data-dir="$HOME/.cortex-chrome"
   ```

3. Optional: open the target site once and let the Cloudflare check finish. The
   `cf_clearance` cookie then persists in that profile for future runs.
4. Scrape one site through that Chrome:

   ```bash
   npm run scrape:real-chrome -- --site haslet-tx
   ```

This automates a genuine browser session; it does not bypass an access control,
and it never solves a CAPTCHA. Set `CHROME_CDP_URL` to override the default
`http://localhost:9222` endpoint.

## Normalization

Once raw portal extraction exists at `data/raw/bids.json`, run:

```bash
npm run normalize:bids
```

Output goes to `data/out/clickup-review-tasks.json`.

## Scrape Command

After login sessions are saved, run:

```bash
npm run scrape:bids
npm run normalize:bids
```

For one configured municipality or county:

```bash
npm run scrape:sites -- --site kennedale-tx
```

For a new portal family or small-entity priority band:

```bash
npm run scrape:civicengage
npm run scrape:public-purchase
npm run scrape:sites -- --tab Main --priority 1
```

Site-level output is written to `data/raw/site-bids.json`. Failed or expired
site sessions retain only that site's previous non-empty records; they do not
replace results from other municipalities.

For visible browser debugging:

```bash
HEADLESS=0 npm run scrape:debug
```

Debug screenshots and reports go to `data/out/`.

## Portal Notes

- IonWave URL currently redirects to login.
- DemandStar app requires browser session.
- Bonfire requires a browser session. Agency Explorer supplies the Texas agency
  list, then the scraper keeps agencies mapped to Tarrant, Dallas, Denton, Ellis,
  Johnson, Parker, and Wise counties and reads each agency's public open-opportunity
  JSON feed.
- Historical `/dashboard/invitations` rows are not ingested. If the Texas
  filter or nearby-agency match cannot be confirmed, the run fails closed and
  the scrape runner retains the previous non-empty platform file. Override the default set with
  `BONFIRE_COUNTIES` as a comma-separated list of configured county names.
- Public agency requests are serialized with `BONFIRE_REQUEST_DELAY_MS` (default
  2000 ms). An HTTP 429 aborts the run and retains the previous dataset.
- If Agency Explorer authentication expires, known official public agency
  portals are still refreshed. Re-run `npm run auth:bonfire` to restore dynamic
  discovery of additional nearby agencies.
- Wise County currently publishes on its own county bid-posting page, so it is
  in the geographic configuration but not treated as a Bonfire portal.
- Ellis County remains in authenticated Agency Explorer discovery; its county
  website's legacy `ellis.bonfirehub.com` link does not currently resolve and is
  therefore not used as an unattended fallback.
- Run only Bonfire with `HEADLESS=0 npm run scrape:bonfire` after refreshing the session.
- Public Purchase reads `PUBLIC_PURCHASE_USERNAME` and
  `PUBLIC_PURCHASE_PASSWORD` from `.env`. Its agency profiles are in
  `config/sites.json`; never store credentials in that file.
- CivicEngage profiles use public bid-posting pages and do not require login.

## CEO Decision Flow

- Approved -> create task in `Approved Pursuits`, add checklist, create/link Drive folder.
- Rejected -> move to `Rejected Archive`, require reject reason.
