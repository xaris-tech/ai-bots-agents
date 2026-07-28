import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import siteConfig from "../config/sites.json" with { type: "json" };
import { scrapeBidNetSite } from "../src/scrapers/bidnet.mjs";
import { scrapeBonfireSite } from "../src/scrapers/bonfire.mjs";
import { scrapeCivicEngage } from "../src/scrapers/civicengage.mjs";
import { scrapeIonWaveSite } from "../src/scrapers/ionwave.mjs";
import { scrapePublicPurchase } from "../src/scrapers/public-purchase.mjs";
import { scrapeStaticList } from "../src/scrapers/static-list.mjs";
import { scrapeWorkdaySpend } from "../src/scrapers/workday-spend.mjs";
import { scrapeBeaconBid } from "../src/scrapers/beaconbid.mjs";
import { dedupeBids, loadSiteHook, resolveSiteAuth, selectSites } from "../src/site-runner.mjs";

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
const outputPath = args.output || "data/raw/site-bids.json";
const reportPath = process.env.SITE_SCRAPE_REPORT_PATH || "data/out/site-scrape-report.json";
const sites = selectSites(siteConfig.sites, args);
if (sites.length === 0) throw new Error("No enabled sites matched the requested filters.");

const browser = await chromium.launchPersistentContext(
  process.env.PLAYWRIGHT_SITE_USER_DATA_DIR || "playwright/.auth/cortex-sites",
  {
    headless: process.env.HEADLESS !== "0",
    viewport: { width: 1440, height: 1000 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    locale: "en-US",
    timezoneId: "America/Chicago"
  }
);

await browser.addInitScript(() => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
});

const previousBids = readJsonArray(outputPath);
const allBids = previousBids.filter((bid) => !sites.some((site) => site.id === bid.sourceId));
// Merge the report the same way as the bids feed: keep the rows for sites this
// run did NOT touch, so a targeted run (--site, --platform, --priority) refreshes
// only its own rows instead of clobbering the whole report to a single entry.
const selectedIds = new Set(sites.map((site) => site.id));
const report = readJsonArray(reportPath).filter((row) => !selectedIds.has(row.sourceId));

try {
  for (const site of sites) {
    const scrape = scrapers[site.platform];
    if (!scrape) throw new Error(`No scraper registered for ${site.platform}`);
    const page = await browser.newPage();
    console.log(`Scraping ${site.agency} (${site.platform})...`);

    try {
      const auth = resolveSiteAuth(site, process.env);
      if (auth.error) throw new Error(auth.error);
      const hook = await loadSiteHook(site);
      const siteWithAuth = { ...site, credentials: auth.credentials };
      const result = hook
        ? await hook.scrape(page, siteWithAuth, { adapter: scrape })
        : await scrape(page, siteWithAuth);
      const retained = result.bids.length === 0 && result.warning
        ? previousBids.filter((bid) => bid.sourceId === site.id)
        : [];
      allBids.push(...(retained.length > 0 ? retained : result.bids));
      report.push({
        sourceId: site.id,
        agency: site.agency,
        platform: site.platform,
        count: result.bids.length,
        retainedCount: retained.length,
        warning: result.warning || ""
      });
    } catch (error) {
      const retained = previousBids.filter((bid) => bid.sourceId === site.id);
      allBids.push(...retained);
      report.push({
        sourceId: site.id,
        agency: site.agency,
        platform: site.platform,
        count: 0,
        retainedCount: retained.length,
        warning: error.message
      });
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}

writeJson(outputPath, dedupeBids(allBids));
writeJson(reportPath, report);

for (const item of report) {
  const retained = item.retainedCount ? `, retained ${item.retainedCount}` : "";
  const warning = item.warning ? ` - ${item.warning}` : "";
  console.log(`${item.sourceId}: ${item.count} bids${retained}${warning}`);
}
console.log(`Wrote site bids to ${outputPath}`);

function parseArgs(values) {
  const args = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    args[key] = values[index + 1] && !values[index + 1].startsWith("--") ? values[++index] : true;
  }
  return args;
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
