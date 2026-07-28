import { chromium } from "playwright";
import fs from "node:fs/promises";
import portals from "../config/portals.json" with { type: "json" };
import { loginGeneric, portalCredentials } from "../src/portal-login.mjs";

const userDataDir = "playwright/.auth/cortex-portals";

const browser = await chromium.launchPersistentContext(userDataDir, {
  headless: process.env.HEADLESS === "1",
  viewport: { width: 1440, height: 1000 }
});

try {
  for (const portal of portals.portals) {
    const creds = portalCredentials(portal.platform, process.env);
    if (!creds) {
      console.log(`${portal.platform}: missing env creds, skipped`);
      continue;
    }

    const page = await browser.newPage();
    try {
      await page.goto(portal.url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      await loginGeneric(page, creds.username, creds.password);
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      console.log(`${portal.platform}: attempted login, current URL ${page.url()}`);
    } catch (error) {
      await fs.mkdir("data/out", { recursive: true });
      const safeName = portal.platform.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      await page.screenshot({ path: `data/out/${safeName}-login-failed.png`, fullPage: true }).catch(() => {});
      console.log(`${portal.platform}: login failed - ${error.message}`);
    }
  }
} finally {
  await browser.close();
}
