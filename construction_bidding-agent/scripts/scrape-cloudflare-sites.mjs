// Scrape every Cloudflare-walled site (config `cloudflare: true`) in one pass
// through a REAL Chrome (not Playwright's bundled Chromium) driven over CDP.
//
// Why real Chrome: a Cloudflare "managed challenge" fingerprints the browser
// launch. Playwright's Chromium fails it no matter how long we wait. The actual
// Google Chrome binary, running a genuine persistent profile, clears the
// passive challenge on its own — verified live against all 8 flagged sites. The
// cf_clearance cookie it earns is bound to that browser's fingerprint + IP + UA,
// so it cannot be replayed from headless Playwright (that mismatch is what
// re-triggers the challenge — the "it asks twice" the operator saw). We drive
// the real browser instead of copying its cookie out.
//
// This is NOT a bypass: it launches genuine Chrome and lets Cloudflare's own
// check run; we only automate a browser a person could drive by hand.
//
// Unattended by default: the script spawns Chrome itself, waits for the CDP
// endpoint, scrapes, then shuts Chrome down. cf_clearance persists in the
// profile dir (default ~/.cortex-chrome), so later runs clear instantly until
// the cookie expires. If an endpoint is ALREADY listening (operator launched
// Chrome, or a previous --keep-open run), it attaches to that instead of
// spawning, and leaves it running.
//
//   npm run scrape:cloudflare                 # auto-spawn, scrape all, shut down
//   npm run scrape:cloudflare -- --site haslet-tx
//   npm run scrape:cloudflare -- --keep-open   # leave Chrome up (warm cookie / debugging)
//   CHROME_BINARY=/path/to/chrome npm run scrape:cloudflare
//
// The rare interactive Turnstile checkbox still needs a human click in the
// Chrome window; the script waits, then reports which site to rerun. A warm
// profile makes that rare.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
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
import { waitForCloudflareClearance } from "../src/scrapers/common.mjs";
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
// Dedicated port (not the common 9222) so we never attach to — or fight — an
// unrelated app's Chrome that happens to expose remote debugging.
const port = Number(args.port || process.env.CHROME_CDP_PORT || 9333);
const endpoint = process.env.CHROME_CDP_URL || `http://localhost:${port}`;
const profileDir = args.profile || process.env.CHROME_PROFILE_DIR || path.join(os.homedir(), ".cortex-chrome");
const keepOpen = Boolean(args["keep-open"]);
const outputPath = args.output || "data/raw/site-bids.json";
const reportPath = process.env.SITE_SCRAPE_REPORT_PATH || "data/out/site-scrape-report.json";

const targets = siteConfig.sites.filter(
  (site) => site.enabled && site.cloudflare && (!args.site || site.id === args.site)
);
if (targets.length === 0) {
  throw new Error(
    args.site
      ? `--site ${args.site} is not an enabled cloudflare-flagged site.`
      : "No enabled cloudflare-flagged sites found in config/sites.json."
  );
}

const chrome = await ensureChrome();
let browser;
try {
  browser = await chromium.connectOverCDP(endpoint);
} catch (error) {
  await chrome.stop();
  throw new Error(`Could not attach to Chrome at ${endpoint}. ${error.message}`);
}

const context = browser.contexts()[0] || (await browser.newContext());

const previousBids = readJsonArray(outputPath);
const previousReport = readJsonArray(reportPath);
const touched = new Set(targets.map((site) => site.id));
const bids = previousBids.filter((bid) => !touched.has(bid.sourceId));
const report = previousReport.filter((row) => !touched.has(row.sourceId));

try {
  for (const site of targets) {
    const scrape = scrapers[site.platform];
    if (!scrape) {
      console.log(`${site.id}: no scraper registered for ${site.platform} - skipped`);
      continue;
    }
    const page = await context.newPage();
    console.log(`Scraping ${site.agency} (${site.platform}) via real Chrome...`);
    try {
      const auth = resolveSiteAuth(site, process.env);
      if (auth.error) throw new Error(auth.error);

      await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
      const clearance = await waitForCloudflareClearance(page, { timeout: 90000 });
      if (!clearance.cleared) {
        console.log(
          `  ${site.id}: Cloudflare still challenging (${clearance.mode}); ` +
            `click the checkbox in the Chrome window if shown, then rerun --site ${site.id}.`
        );
      }

      const hook = await loadSiteHook(site);
      const siteWithAuth = { ...site, credentials: auth.credentials };
      const result = hook
        ? await hook.scrape(page, siteWithAuth, { adapter: scrape })
        : await scrape(page, siteWithAuth);

      const retained = result.bids.length === 0 && result.warning
        ? previousBids.filter((bid) => bid.sourceId === site.id)
        : [];
      bids.push(...(retained.length > 0 ? retained : result.bids));
      report.push({
        sourceId: site.id,
        agency: site.agency,
        platform: site.platform,
        count: result.bids.length,
        retainedCount: retained.length,
        warning: result.warning || "",
        via: "real-chrome"
      });
      console.log(
        `  ${site.id}: ${result.bids.length} bids` +
          `${retained.length ? `, retained ${retained.length}` : ""}` +
          `${result.warning ? ` - ${result.warning}` : ""}`
      );
    } catch (error) {
      const retained = previousBids.filter((bid) => bid.sourceId === site.id);
      bids.push(...retained);
      report.push({
        sourceId: site.id,
        agency: site.agency,
        platform: site.platform,
        count: 0,
        retainedCount: retained.length,
        warning: error.message,
        via: "real-chrome"
      });
      console.log(`  ${site.id}: ERROR - ${error.message.split("\n")[0]}`);
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
  await chrome.stop();
}

writeJson(outputPath, dedupeBids(bids));
writeJson(reportPath, report);
console.log(`Wrote ${outputPath} and ${reportPath}.`);

// Ensure a CDP endpoint is reachable. If one already answers, attach to it and
// leave it alone. Otherwise spawn the real Chrome binary and own its lifecycle.
async function ensureChrome() {
  if (await cdpReady(endpoint)) {
    console.log(`Attaching to Chrome already listening at ${endpoint}.`);
    return { stop: async () => {} };
  }

  const binary = resolveChromeBinary();
  console.log(`Launching Chrome: ${binary}\n  profile: ${profileDir}\n  cdp: ${endpoint}`);
  fs.mkdirSync(profileDir, { recursive: true });
  const child = spawn(
    binary,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-features=Translate"
    ],
    { stdio: "ignore", detached: false }
  );
  child.on("error", (error) => {
    throw new Error(`Failed to launch Chrome at ${binary}: ${error.message}`);
  });

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await cdpReady(endpoint)) {
      let stopped = false;
      const stop = async () => {
        if (stopped || keepOpen) {
          if (keepOpen) console.log(`Leaving Chrome running at ${endpoint} (--keep-open).`);
          return;
        }
        stopped = true;
        try { child.kill("SIGTERM"); } catch { /* already gone */ }
      };
      return { stop };
    }
    await delay(500);
  }
  try { child.kill("SIGTERM"); } catch { /* ignore */ }
  throw new Error(`Chrome launched but CDP never came up on ${endpoint} within 30s.`);
}

async function cdpReady(base) {
  try {
    const res = await fetch(`${base}/json/version`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

function resolveChromeBinary() {
  if (process.env.CHROME_BINARY) return process.env.CHROME_BINARY;
  const candidates =
    process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta"
        ]
      : [
          "/usr/bin/google-chrome",
          "/usr/bin/google-chrome-stable",
          "/usr/bin/chromium",
          "/usr/bin/chromium-browser"
        ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(
      `No Chrome binary found. Set CHROME_BINARY to your Chrome path. Tried: ${candidates.join(", ")}`
    );
  }
  return found;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
