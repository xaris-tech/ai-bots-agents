import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import portals from "../config/portals.json" with { type: "json" };
import { scrapeBonfire } from "../src/scrapers/bonfire.mjs";
import { scrapeDemandStar } from "../src/scrapers/demandstar.mjs";
import { scrapeIonWave } from "../src/scrapers/ionwave.mjs";
import {
  attemptPortalLogin,
  isSessionExpiredWarning,
  missingCredentialMessage,
  portalCredentials
} from "../src/portal-login.mjs";

const userDataDir = process.env.PLAYWRIGHT_USER_DATA_DIR || "playwright/.auth/cortex-portals";
const outputPath = process.argv[2] || "data/raw/bids.json";
const reportPath = process.env.SCRAPE_REPORT_PATH || "data/out/scrape-report.json";

const scrapers = {
  IonWave: scrapeIonWave,
  DemandStar: scrapeDemandStar,
  Bonfire: scrapeBonfire
};

const browser = await chromium.launchPersistentContext(userDataDir, {
  headless: process.env.HEADLESS !== "0",
  viewport: { width: 1440, height: 1000 },
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  locale: "en-US",
  timezoneId: "America/Chicago"
});

await browser.addInitScript(() => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
  Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
  window.chrome = window.chrome || { runtime: {} };
});

const allBids = [];
const report = [];
const selectedPlatform = process.env.ONLY_PLATFORM;
const previousBids = readPreviousBids(outputPath);

try {
  for (const portal of portals.portals) {
    if (selectedPlatform && portal.platform !== selectedPlatform) continue;
    const page = await browser.newPage();
    const scrape = scrapers[portal.platform];
    if (!scrape) throw new Error(`No scraper for ${portal.platform}`);

    console.log(`Scraping ${portal.platform}...`);
    await jitter();
    let result;
    try {
      result = await scrape(page, portal);
    } catch (error) {
      result = { platform: portal.platform, bids: [], warning: error.message.split("\n")[0] };
    }

    if (result.bids.length === 0 && isSessionExpiredWarning(result.warning)) {
      const credentials = portalCredentials(portal.platform, process.env);
      if (!credentials) {
        result.warning = `${portal.platform} session expired; ${missingCredentialMessage(portal.platform)}`;
      } else {
        console.log(`${portal.platform}: session expired, attempting credential re-login...`);
        const relogin = await attemptPortalLogin(page, portal, credentials);
        if (relogin.ok) {
          console.log(`${portal.platform}: re-login succeeded, retrying scrape...`);
          await jitter();
          result = await scrape(page, portal);
        } else {
          result.warning = `${portal.platform} session expired and automatic re-login failed: ${relogin.reason}.`;
        }
      }
    }
    const retainedBids = result.bids.length === 0 && result.warning
      ? previousBids.filter((bid) => bid.platform === portal.platform)
      : [];
    allBids.push(...(retainedBids.length > 0 ? retainedBids : result.bids));
    report.push({
      platform: result.platform,
      count: result.bids.length,
      retainedCount: retainedBids.length,
      warning: result.warning || "",
      debugText: result.debugText || ""
    });
    await page.close();
  }
} finally {
  await browser.close();
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(allBids, null, 2)}\n`);
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

for (const item of report) {
  const retained = item.retainedCount ? `, retained ${item.retainedCount} previous bids` : "";
  const suffix = item.warning ? ` - ${item.warning}` : "";
  console.log(`${item.platform}: ${item.count} bids${retained}${suffix}`);
}
console.log(`Wrote raw bids to ${outputPath}`);
console.log(`Wrote scrape report to ${reportPath}`);

async function jitter(min = 1500, max = 4500) {
  const duration = Math.floor(min + Math.random() * (max - min));
  await new Promise((resolve) => setTimeout(resolve, duration));
}

function readPreviousBids(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
