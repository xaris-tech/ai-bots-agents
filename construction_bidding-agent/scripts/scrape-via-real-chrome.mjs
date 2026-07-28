// Drive the operator's own already-running Chrome over CDP for sites behind a
// Cloudflare managed challenge that Playwright-launched browsers cannot pass.
//
// This is not a bypass: Chrome is launched normally by the operator, clears the
// challenge as ordinary browsing, and we attach to that real session.
//
// Setup (operator, one terminal):
//   1. Quit Chrome completely.
//   2. Launch it with remote debugging on a separate profile:
//      macOS:
//        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//          --remote-debugging-port=9222 \
//          --user-data-dir="$HOME/.cortex-chrome"
//   3. In that Chrome, open the site and let the Cloudflare check clear
//      (click the checkbox if one appears). Leave the tab open.
//   4. Run: node --env-file=.env scripts/scrape-via-real-chrome.mjs --site haslet-tx
//
// The cf_clearance cookie lives in that Chrome profile, so later headless runs
// reusing --user-data-dir="$HOME/.cortex-chrome" work until the cookie expires.

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import siteConfig from "../config/sites.json" with { type: "json" };
import { scrapeCivicEngage } from "../src/scrapers/civicengage.mjs";
import { scrapeBidNetSite } from "../src/scrapers/bidnet.mjs";
import { scrapeBonfireSite } from "../src/scrapers/bonfire.mjs";
import { scrapeIonWaveSite } from "../src/scrapers/ionwave.mjs";
import { scrapePublicPurchase } from "../src/scrapers/public-purchase.mjs";
import { scrapeStaticList } from "../src/scrapers/static-list.mjs";
import { scrapeWorkdaySpend } from "../src/scrapers/workday-spend.mjs";
import { scrapeBeaconBid } from "../src/scrapers/beaconbid.mjs";
import { dedupeBids, loadSiteHook, resolveSiteAuth } from "../src/site-runner.mjs";

const scrapers = {
  BidNet: scrapeBidNetSite,
  Bonfire: scrapeBonfireSite,
  CivicEngage: scrapeCivicEngage,
  IonWave: scrapeIonWaveSite,
  "Public Purchase": scrapePublicPurchase,
  StaticList: scrapeStaticList,
  WorkdaySpend: scrapeWorkdaySpend,
  BeaconBid: scrapeBeaconBid
};

const args = parseArgs(process.argv.slice(2));
const endpoint = process.env.CHROME_CDP_URL || "http://localhost:9222";
const outputPath = args.output || "data/raw/site-bids.json";
const site = siteConfig.sites.find((entry) => entry.id === args.site);
if (!site) throw new Error(`Unknown --site ${args.site}`);

let browser;
try {
  browser = await chromium.connectOverCDP(endpoint);
} catch (error) {
  throw new Error(
    `Could not attach to Chrome at ${endpoint}. Start Chrome with ` +
    `--remote-debugging-port=9222 first (see the header of this file). ${error.message}`
  );
}

const context = browser.contexts()[0] || (await browser.newContext());
const page = await context.newPage();

try {
  const auth = resolveSiteAuth(site, process.env);
  if (auth.error) throw new Error(auth.error);
  const hook = await loadSiteHook(site);
  const scrape = scrapers[site.platform];
  const siteWithAuth = { ...site, credentials: auth.credentials };
  const result = hook
    ? await hook.scrape(page, siteWithAuth, { adapter: scrape })
    : await scrape(page, siteWithAuth);
  console.log(`${site.id}: ${result.bids.length} bids${result.warning ? ` - ${result.warning}` : ""}`);

  // Merge into the shared site-bids file, replacing this site's rows.
  // On a warning with zero bids, keep the site's last-known-good records.
  const previous = readJsonArray(outputPath);
  const others = previous.filter((bid) => bid.sourceId !== site.id);
  const retained = result.bids.length === 0 && result.warning
    ? previous.filter((bid) => bid.sourceId === site.id)
    : [];
  const merged = dedupeBids([...others, ...(retained.length > 0 ? retained : result.bids)]);
  writeJson(outputPath, merged);
  console.log(`Wrote ${outputPath} (${merged.length} bids total)`);
} finally {
  await page.close();
  await browser.close();
}

function readJsonArray(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    if (!values[index].startsWith("--")) continue;
    const key = values[index].slice(2);
    parsed[key] = values[index + 1] && !values[index + 1].startsWith("--") ? values[++index] : true;
  }
  return parsed;
}
