// BidNet's own account-wide solicitation search (not a single buyer's page):
// every open Texas solicitation the account can see, plus a nationwide sweep
// for the client's aggregate-material keywords. Requires login
// (BIDNET_USERNAME/BIDNET_PASSWORD in .env) — the "Solicitation Search" view
// only exists behind /private/supplier/... and redirects to SSO otherwise.
//
// Never scrapes a solicitation tagged "upgrade required" (subscriber-only) —
// those are skipped entirely in src/scrapers/bidnet.mjs's row normalizer.

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import {
  scrapeBidNetAggregatesNationwide,
  scrapeBidNetTexasWide
} from "../src/scrapers/bidnet.mjs";
import { attemptPortalLogin, missingCredentialMessage, portalCredentials } from "../src/portal-login.mjs";

const userDataDir = process.env.PLAYWRIGHT_BIDNET_USER_DATA_DIR || "playwright/.auth/cortex-bidnet";
const outputPath = process.argv[2] || "data/raw/bidnet-wide-bids.json";
const reportPath = process.env.BIDNET_WIDE_REPORT_PATH || "data/out/bidnet-wide-report.json";
const skipAggregates = process.env.BIDNET_WIDE_SKIP_AGGREGATES === "1";

const credentials = portalCredentials("BidNet", process.env);
if (!credentials) {
  throw new Error(`BidNet wide search needs credentials; ${missingCredentialMessage("BidNet")}`);
}

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

  const loginUrl = "https://www.bidnetdirect.com/private/supplier/solicitations/search";
  const login = await attemptPortalLogin(page, { url: loginUrl }, credentials);
  if (!login.ok) {
    throw new Error(`BidNet login failed: ${login.reason}`);
  }
  console.log("BidNet: logged in");

  console.log("BidNet: scraping Texas wide search...");
  const texasResult = await scrapeBidNetTexasWide(page);
  allBids.push(...texasResult.bids);
  report.push({
    sourceId: texasResult.sourceId,
    count: texasResult.bids.length,
    warning: texasResult.warning || ""
  });
  console.log(`BidNet Texas wide: ${texasResult.bids.length} bids${texasResult.warning ? ` - ${texasResult.warning}` : ""}`);

  if (!skipAggregates) {
    console.log("BidNet: scraping nationwide aggregate-keyword search...");
    const aggregatesResult = await scrapeBidNetAggregatesNationwide(page);
    allBids.push(...aggregatesResult.bids);
    report.push({
      sourceId: aggregatesResult.sourceId,
      count: aggregatesResult.bids.length,
      warning: aggregatesResult.warning || ""
    });
    console.log(`BidNet nationwide aggregates: ${aggregatesResult.bids.length} bids${aggregatesResult.warning ? ` - ${aggregatesResult.warning}` : ""}`);
  }

  await page.close();
} finally {
  await browser.close();
}

// The Texas-wide and nationwide-aggregates sweeps can both surface the same
// bid (an aggregate-supply solicitation in Texas matches both); dedupe by id.
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
console.log(`Wrote ${reportPath}`);
