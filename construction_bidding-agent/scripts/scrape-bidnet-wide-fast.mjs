// One-off faster variant of scrape-bidnet-wide.mjs: the full run (maxPages 60
// for Texas, maxPagesPerKeyword 20 for all 40 aggregate keywords) ran past 30
// minutes with several common keywords (sand, gravel, etc.) likely hitting
// the page cap repeatedly. This caps more aggressively to get a real result
// quickly; rerun the full version later for complete coverage if needed.

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import {
  scrapeBidNetAggregatesNationwide,
  scrapeBidNetTexasWide
} from "../src/scrapers/bidnet.mjs";
import { attemptPortalLogin, portalCredentials } from "../src/portal-login.mjs";

const userDataDir = "playwright/.auth/cortex-bidnet";
const outputPath = "data/raw/bidnet-wide-bids.json";
const reportPath = "data/out/bidnet-wide-report.json";

const credentials = portalCredentials("BidNet", process.env);
if (!credentials) throw new Error("Missing BIDNET_USERNAME/BIDNET_PASSWORD in .env");

const browser = await chromium.launchPersistentContext(userDataDir, {
  headless: process.env.HEADLESS !== "0",
  viewport: { width: 1440, height: 1000 },
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  locale: "en-US",
  timezoneId: "America/Chicago"
});
await browser.addInitScript(() => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
});

const report = [];
let allBids = [];

try {
  const page = await browser.newPage();
  const login = await attemptPortalLogin(page, { url: "https://www.bidnetdirect.com/private/supplier/solicitations/search" }, credentials);
  if (!login.ok) throw new Error(`BidNet login failed: ${login.reason}`);
  console.log("BidNet: logged in");

  console.log("BidNet: scraping Texas wide search (maxPages 30)...");
  const texasResult = await scrapeBidNetTexasWide(page, { maxPages: 30 });
  allBids.push(...texasResult.bids);
  report.push({ sourceId: texasResult.sourceId, count: texasResult.bids.length, warning: texasResult.warning || "" });
  console.log(`BidNet Texas wide: ${texasResult.bids.length} bids${texasResult.warning ? ` - ${texasResult.warning}` : ""}`);

  console.log("BidNet: scraping nationwide aggregate-keyword search (maxPagesPerKeyword 4)...");
  const aggregatesResult = await scrapeBidNetAggregatesNationwide(page, { maxPagesPerKeyword: 4 });
  allBids.push(...aggregatesResult.bids);
  report.push({ sourceId: aggregatesResult.sourceId, count: aggregatesResult.bids.length, warning: aggregatesResult.warning || "" });
  console.log(`BidNet nationwide aggregates: ${aggregatesResult.bids.length} bids${aggregatesResult.warning ? ` - ${aggregatesResult.warning}` : ""}`);

  await page.close();
} finally {
  await browser.close();
}

const seen = new Set();
allBids = allBids.filter((bid) => {
  if (seen.has(bid.bidId)) return false;
  seen.add(bid.bidId);
  return true;
});

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(allBids, null, 2)}\n`);
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Wrote ${outputPath} (${allBids.length} bids)`);
