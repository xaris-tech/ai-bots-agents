import { chromium } from "playwright";
import portals from "../config/portals.json" with { type: "json" };

const userDataDir = "playwright/.auth/cortex-portals";
const browser = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  viewport: { width: 1440, height: 1000 }
});

const selectedPlatform = process.env.ONLY_PLATFORM;

for (const portal of portals.portals) {
  if (selectedPlatform && portal.platform !== selectedPlatform) continue;
  const page = await browser.newPage();
  const destination = portal.discoveryUrl || portal.url;
  await page.goto(destination, { waitUntil: "domcontentloaded", timeout: 60000 });
  console.log(`Opened ${portal.platform}: ${destination}`);
}

console.log("Login in each portal, then press Ctrl+C when sessions are saved.");
