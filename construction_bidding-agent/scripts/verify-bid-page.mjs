import fs from "node:fs";
import { chromium } from "playwright";

const url = process.argv[2];
const outputPath = process.argv[3] || "data/out/verify-bid.json";
const userDataDir =
  process.env.PLAYWRIGHT_USER_DATA_DIR || "playwright/.auth/cortex-portals";

if (!url) {
  console.error("Usage: node scripts/verify-bid-page.mjs <url> <outputPath>");
  process.exit(1);
}

const browser = await chromium.launchPersistentContext(userDataDir, {
  headless: process.env.HEADLESS !== "0",
  viewport: { width: 1440, height: 1000 },
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  locale: "en-US",
  timezoneId: "America/Chicago"
});

await browser.addInitScript(() => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
  Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
  window.chrome = window.chrome || { runtime: {} };
});

let result;
try {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  const title = await page.title();
  const text = await page.evaluate(() => document.body?.innerText || "");
  result = {
    url,
    title,
    text: text.slice(0, 8000),
    fetchedAt: new Date().toISOString()
  };
} catch (error) {
  result = { url, error: error?.message || String(error) };
} finally {
  await browser.close();
}

fs.mkdirSync(outputPath.split("/").slice(0, -1).join("/") || ".", {
  recursive: true
});
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
console.log(result.error ? `Failed: ${result.error}` : `Fetched ${url}`);
