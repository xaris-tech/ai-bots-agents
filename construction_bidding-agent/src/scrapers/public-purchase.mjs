import { ensureLoggedIn, writeDebugSnapshot } from "./common.mjs";

export async function scrapePublicPurchase(page, site) {
  const username = site.credentials?.username || process.env.PUBLIC_PURCHASE_USERNAME;
  const password = site.credentials?.password || process.env.PUBLIC_PURCHASE_PASSWORD;
  if (username && password) {
    await loginPublicPurchase(page, site, username, password);
  }

  await gotoWithRetry(page, site.url);
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await acceptCookies(page);

  const login = await ensureLoggedIn(page, "Public Purchase");
  if (!login.loggedIn) {
    return { platform: "Public Purchase", sourceId: site.id, bids: [], warning: login.message };
  }

  const rows = await page.locator("table tr").evaluateAll((items) => items.map((row) => {
    const cells = [...row.querySelectorAll("th, td")].map((cell) => cell.innerText.replace(/\s+/g, " ").trim());
    const link = row.querySelector("a[href]");
    return {
      cells,
      text: row.innerText,
      href: link?.getAttribute("href") || ""
    };
  })).catch(() => []);

  const bids = normalizePublicPurchaseRows(rows, site);
  const body = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  const warning = bids.length === 0 && !/no bids about to end|no open bids|there are no bids/i.test(body)
    ? `${site.agency}: no recognizable Public Purchase open-bid rows were found.`
    : "";
  const debugText = process.env.DEBUG_SCRAPE ? await writeDebugSnapshot(page, site.id) : "";

  return { platform: "Public Purchase", sourceId: site.id, bids, warning, debugText };
}

export function normalizePublicPurchaseRows(rows, site, scrapedAt = new Date().toISOString()) {
  const seen = new Set();
  const bids = [];

  for (const row of rows) {
    const cells = (row.cells || []).map(cleanText).filter(Boolean);
    const text = cleanText(row.text || cells.join(" "));
    if (cells.length < 3 || /^Title\s+Start Date\s+End Date/i.test(text)) continue;
    if (/no bids about to end|please log in to view/i.test(text)) continue;

    const rawTitle = cells[0];
    const idMatch = rawTitle.match(/\b(?:RFB|RFP|RFQ|IFB|ITB|Bid)\s*#?\s*([A-Z0-9][A-Z0-9._/-]*)/i);
    if (!idMatch && !/\b(?:bid|proposal|qualification|quotation|project)\b/i.test(rawTitle)) continue;
    const bidId = idMatch?.[1] || "";
    const title = rawTitle
      .replace(/^\s*(?:RFB|RFP|RFQ|IFB|ITB|Bid)\s*#?\s*[A-Z0-9][A-Z0-9._/-]*\s*[-:]?\s*/i, "")
      .trim() || rawTitle;
    const dueDate = toIsoDate(cells[2]);
    if (dueDate && dueDate < scrapedAt.slice(0, 10)) continue;
    const bidUrl = absoluteUrl(row.href, site.url);
    const signature = `${site.id}|${bidId || title}|${dueDate}`;
    if (seen.has(signature)) continue;
    seen.add(signature);

    bids.push({
      platform: "Public Purchase",
      sourceId: site.id,
      bidId,
      title,
      agency: site.agency,
      location: site.location || locationFromAgency(site.agency),
      dueDate,
      bidUrl,
      documentsUrl: bidUrl,
      estimatedValue: "",
      description: cells.join(" | "),
      scrapedAt
    });
  }

  return bids;
}

async function loginPublicPurchase(page, site, username, password) {
  const loginUrl = site.loginUrl || site.url.replace(/\/publicInfo(?:\?.*)?$/i, "/home");
  await gotoWithRetry(page, loginUrl);
  const userInput = await firstVisible(page, "input[name*='user' i], input[id*='user' i], input[type='text']");
  const passwordInput = await firstVisible(page, "input[type='password']");
  if (!userInput || !passwordInput) return;

  await userInput.fill(username);
  await passwordInput.fill(password);
  const submit = page.locator("button[type='submit'], input[type='submit'], button:has-text('Login'), button:has-text('Log in')").first();
  if (await submit.isVisible().catch(() => false)) await submit.click();
  else await passwordInput.press("Enter");
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
}

async function firstVisible(page, selector) {
  const items = page.locator(selector);
  const count = Math.min(await items.count().catch(() => 0), 20);
  for (let index = 0; index < count; index += 1) {
    const item = items.nth(index);
    if (await item.isVisible().catch(() => false)) return item;
  }
  return null;
}

async function gotoWithRetry(page, url) {
  const attempts = [
    { waitUntil: "domcontentloaded", timeout: 30000 },
    { waitUntil: "load", timeout: 30000 },
    { waitUntil: "commit", timeout: 30000 }
  ];
  let lastError;

  for (const options of attempts) {
    try {
      await page.goto(url, options);
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

async function acceptCookies(page) {
  const accept = page.getByRole("button", { name: /accept cookies|yes, i accept/i }).first();
  if (await accept.isVisible().catch(() => false)) await accept.click().catch(() => {});
}

function absoluteUrl(href, baseUrl) {
  if (!href) return baseUrl;
  return new URL(href, baseUrl).toString();
}

function toIsoDate(value) {
  if (!value) return "";
  const date = new Date(value.replace(/\b(?:CST|CDT)\b/i, ""));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function locationFromAgency(agency) {
  return `${agency.replace(/^(?:City|Town|County) of /i, "")}, TX`;
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
