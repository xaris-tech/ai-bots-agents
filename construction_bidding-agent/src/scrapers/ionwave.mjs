import { collectBidCards, ensureLoggedIn, writeDebugSnapshot } from "./common.mjs";

export async function scrapeIonWave(page, portal) {
  if (process.env.IONWAVE_USERNAME && process.env.IONWAVE_PASSWORD) {
    await loginIonWave(page, portal.url || "https://supplier.ionwave.net");
  }

  await gotoWithRetry(page, portal.scrapeUrl || portal.url);
  await settle(page);
  await jitter();

  const login = await ensureLoggedIn(page, "IonWave");
  if (!login.loggedIn) return { platform: "IonWave", bids: [], warning: login.message };

  const tableBids = await extractIonWavePages(page);
  const bids = tableBids.length > 0 ? tableBids : await collectBidCards(page, "IonWave", {
    selectors: [
      "#grdBidList tr",
      "table tr",
      "[id*='VendorResponse'] tr",
      "[class*='response' i]",
      "[class*='bid' i]"
    ]
  });

  const debugText = process.env.DEBUG_SCRAPE ? await writeDebugSnapshot(page, "IonWave") : "";
  return { platform: "IonWave", bids, debugText };
}

async function extractIonWavePages(page) {
  const sections = [
    {
      name: "My Invitations",
      tableId: "ctl00_mainContent_ucInvitedListGrid_rgResponse_ctl00",
      maxPages: Number(process.env.IONWAVE_INVITED_MAX_PAGES || process.env.IONWAVE_MAX_PAGES || 30)
    },
    {
      name: "Other Bid Opportunities",
      tableId: "ctl00_mainContent_ucNotInvitedListGrid_rgResponse_ctl00",
      maxPages: Number(process.env.IONWAVE_OTHER_MAX_PAGES || process.env.IONWAVE_MAX_PAGES || 30)
    }
  ];

  const bids = [];
  for (const section of sections) {
    bids.push(...await extractIonWaveSectionPages(page, section));
  }

  return dedupeBids(bids);
}

async function extractIonWaveSectionPages(page, section) {
  const bids = [];
  const visited = new Set();

  for (let pageCount = 0; pageCount < section.maxPages; pageCount += 1) {
    const signature = `${section.name}|${await ionWaveGridSignature(page, section.tableId)}`;
    if (visited.has(signature)) break;
    visited.add(signature);
    if (process.env.DEBUG_IONWAVE_PAGES) {
      console.log(`IonWave ${section.name} page pass ${pageCount + 1}: ${signature.slice(0, 160)}`);
    }

    bids.push(...await extractIonWaveTable(page, section));

    const next = await nextIonWavePage(page, section.tableId, pageCount + 2);
    if (process.env.DEBUG_IONWAVE_PAGES) {
      console.log(`IonWave ${section.name} next: ${next?.href || "none"}`);
    }
    if (!next) break;
    const before = await ionWaveGridSignature(page, section.tableId);
    await waitForTelerikOverlay(page);
    await runIonWavePostBack(page, next.href);
    await settle(page);
    await waitForTelerikOverlay(page);
    await waitForIonWaveGridChange(page, section.tableId, before);
    await jitter(500, 1500);
  }

  return bids;
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
}

async function gotoWithRetry(page, url) {
  const attempts = [
    { waitUntil: "domcontentloaded", timeout: 60000 },
    { waitUntil: "load", timeout: 60000 },
    { waitUntil: "commit", timeout: 60000 }
  ];

  let lastError;
  for (const options of attempts) {
    try {
      await page.goto(url, options);
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(1500);
    }
  }
  throw lastError;
}

async function extractIonWaveTable(page, section = {}) {
  const table = section.tableId ? page.locator(`[id="${section.tableId}"]`) : page.locator("body");
  const rows = await table.locator("tr").evaluateAll((trs) => trs.map((tr) => {
    const cells = [...tr.querySelectorAll("th,td")].map((cell) => cell.innerText.replace(/\s+/g, " ").trim()).filter(Boolean);
    const link = tr.querySelector("a[href*='VResponseEvent'], a[href*='__doPostBack'], a[href]")?.getAttribute("href") || "";
    return { cells, link };
  })).catch(() => []);

  const bids = [];
  for (const row of rows) {
    const cells = row.cells;
    if (cells.length < 6) continue;
    const joined = cells.join(" ");
    if (/Agency Bid Number Title Issue Date Close Date/i.test(joined)) continue;
    if (!/(Issued|No Response|Submitted|Closed|\d{1,2}\/\d{1,2}\/\d{4})/i.test(joined)) continue;

    const parsed = parseIonWaveCells(cells);
    if (!parsed.title) continue;

    bids.push({
      platform: "IonWave",
      section: section.name || "",
      bidId: parsed.bidId,
      title: parsed.title,
      agency: parsed.agency,
      location: parsed.agency,
      dueDate: parsed.closeDate,
      bidUrl: absoluteUrl(row.link, page.url()),
      documentsUrl: absoluteUrl(row.link, page.url()),
      estimatedValue: "",
      description: joined,
      scrapedAt: new Date().toISOString()
    });
  }
  return bids;
}

function parseIonWaveCells(cells) {
  if (cells.length >= 8) {
    return {
      agency: cells[0],
      bidId: cells[1],
      title: cells[2],
      issueDate: toIsoDate(cells[3]),
      closeDate: toIsoDate(cells[4]),
      timeLeft: cells[5],
      bidStatus: cells[6],
      responseStatus: cells[7]
    };
  }

  const text = cells.join(" ");
  const dates = [...text.matchAll(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g)].map((match) => match[0]);
  const closeDate = dates[1] || dates[0] || "";
  const bidId = findBidId(text);
  const agency = text.split(/\s+(?:RFP|RFQ|IFB|ITB|Bid|Quote|Proposal|#)/i)[0]?.trim() || "";
  const title = text
    .replace(agency, "")
    .replace(bidId, "")
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g, "")
    .replace(/\b\d{1,2}:\d{2}\s*(?:AM|PM)\s*\(CT\)\b/gi, "")
    .replace(/\b\d+\s+Days?\b/gi, "")
    .replace(/\bIssued\b|\bNo Response\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return { agency, bidId, title, issueDate: toIsoDate(dates[0]), closeDate: toIsoDate(closeDate) };
}

function findBidId(text) {
  const match = text.match(/\b(?:RFP|RFQ|IFB|ITB|Bid|Quote|Proposal)?\s*#?\s*([A-Z0-9]{2,}[-_][A-Z0-9._/-]{2,})\b/i);
  return match ? match[1] : "";
}

function toIsoDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function absoluteUrl(href, baseUrl) {
  if (!href || href.startsWith("javascript:")) return baseUrl;
  return new URL(href, baseUrl).toString();
}

async function ionWaveGridSignature(page, tableId) {
  return page.locator(`[id="${tableId}"] tr`).evaluateAll((rows) => {
    const dataRow = rows.find((row) => {
      const text = row.innerText.replace(/\s+/g, " ").trim();
      return /(Issued|No Response|Submitted|Closed|\d{1,2}\/\d{1,2}\/\d{4})/i.test(text) &&
        !/Agency Bid Number Title Issue Date Close Date/i.test(text);
    });
    return dataRow?.innerText.replace(/\s+/g, " ").trim() || "";
  }).catch(() => "");
}

async function nextIonWavePage(page, tableId, targetPage) {
  const locator = page.locator(`[id="${tableId}"] a[href*='Page$'], [id="${tableId}"] a[href*='__doPostBack']`);
  const candidates = await locator.evaluateAll((anchors) => {
    return anchors.map((anchor, index) => ({
      index,
      text: anchor.innerText.trim(),
      href: anchor.getAttribute("href") || "",
      title: anchor.getAttribute("title") || "",
      className: anchor.className || "",
      disabled: anchor.getAttribute("disabled") !== null || anchor.getAttribute("aria-disabled") === "true",
      visible: !!(anchor.offsetWidth || anchor.offsetHeight || anchor.getClientRects().length)
    }));
  }).catch(() => []);

  const target = candidates.find((candidate) =>
    candidate.visible &&
    !candidate.disabled &&
    !/disabled/i.test(candidate.className) &&
    new RegExp(`^Go to Page ${targetPage}$`, "i").test(candidate.title)
  );
  if (target) {
    return {
      locator: locator.nth(target.index),
      href: target.href
    };
  }

  for (const candidate of candidates) {
    if (!candidate.visible) continue;
    if (candidate.disabled || /current|disabled/i.test(candidate.className)) continue;
    if (!/Next Pages|next|>/i.test(candidate.title || candidate.text)) continue;
    return {
      locator: locator.nth(candidate.index),
      href: candidate.href
    };
  }

  return null;
}

async function runIonWavePostBack(page, href) {
  const script = String(href || "").replace(/^javascript:/i, "");
  if (!script) return;
  await page.evaluate((source) => window.setTimeout(source, 0), script);
}

async function waitForIonWaveGridChange(page, tableId, previous) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const current = await ionWaveGridSignature(page, tableId);
    if (current && current !== previous) return;
    await page.waitForTimeout(250);
  }
}

async function waitForTelerikOverlay(page) {
  await page.locator(".TelerikModalOverlay, .raDiv, .RadAjax, [class*='LoadingPanel']").first()
    .waitFor({ state: "hidden", timeout: 10000 })
    .catch(() => {});
}

async function waitForCloudflare(page) {
  for (let i = 0; i < 8; i += 1) {
    const body = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
    if (!/security verification|just a moment|verify you are (?:a )?human/i.test(body)) return;
    await page.waitForTimeout(5000);
  }
}

async function jitter(min = 1500, max = 4500) {
  await new Promise((resolve) => setTimeout(resolve, Math.floor(min + Math.random() * (max - min))));
}

function dedupeBids(items) {
  const seen = new Set();
  const results = [];
  for (const item of items) {
    const key = `${item.platform}|${item.bidId || item.title}|${item.dueDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(item);
  }
  return results;
}

async function loginIonWave(page, url) {
  await page.goto(url, { waitUntil: "commit", timeout: 60000 }).catch(async () => {
    await page.goto(url, { waitUntil: "load", timeout: 30000 }).catch(() => {});
  });
  await settle(page);
  if (!page.url().toLowerCase().includes("vendorlogin")) return;

  const userInput = await firstVisible(page, [
    "input[name*='User' i]",
    "input[id*='User' i]",
    "input[type='email']",
    "input[type='text']"
  ]);
  const passwordInput = await firstVisible(page, ["input[type='password']"]);
  await userInput.fill(process.env.IONWAVE_USERNAME);
  await passwordInput.fill(process.env.IONWAVE_PASSWORD);

  const submit = page.locator("input[type='submit'], button[type='submit'], input[value*='Login' i], button:has-text('Login')").first();
  if (await submit.isVisible().catch(() => false)) await submit.click({ noWaitAfter: true });
  else await page.keyboard.press("Enter");
  await settle(page);
}

async function firstVisible(page, selectors) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const locator = page.locator(selector);
      const count = Math.min(await locator.count().catch(() => 0), 20);
      for (let index = 0; index < count; index += 1) {
        const item = locator.nth(index);
        if (await item.isVisible().catch(() => false)) return item;
      }
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`No visible IonWave input found: ${selectors.join(", ")}`);
}

export async function scrapeIonWaveSite(page, site) {
  await gotoWithRetry(page, site.url);
  await waitForCloudflare(page);
  await settle(page);

  // The public SourcingEvents grid (Telerik) populates its rows via an async
  // callback that lands AFTER networkidle, so reading immediately can catch an
  // empty table and wrongly report "no rows" (this silently dropped all 14 of
  // College Station's open events). Wait until either a real event row (a date)
  // or an explicit empty-state message is present before scraping.
  await page.waitForFunction(() => {
    const text = document.body ? document.body.innerText : "";
    return /\d{1,2}\/\d{1,2}\/\d{4}/.test(text) ||
      /No records to display|items in \d+ pages|no open/i.test(text);
  }, { timeout: 15000 }).catch(() => {});

  const rows = await page.locator("table tr").evaluateAll((items) => items.map((row) => ({
    cells: [...row.querySelectorAll("th, td")]
      .map((cell) => cell.innerText.replace(/\s+/g, " ").trim())
      .filter(Boolean)
  }))).catch(() => []);

  const bids = normalizeIonWaveSiteRows(rows, site);
  const body = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  const warning = bids.length === 0 && !/No records to display|0 items in \d+ pages/i.test(body)
    ? `${site.agency}: no recognizable IonWave sourcing-event rows were found.`
    : "";

  return { platform: "IonWave", sourceId: site.id, bids, warning };
}

export function normalizeIonWaveSiteRows(rows, site, scrapedAt = new Date().toISOString()) {
  const seen = new Set();
  const bids = [];

  for (const row of rows) {
    const cells = (row.cells || []).map((cell) => String(cell || "").trim()).filter(Boolean);
    if (cells.length < 4) continue;
    const joined = cells.join(" ");
    if (/^Bid Number\b/i.test(cells[0]) || /items in \d+ pages|Data pager/i.test(joined)) continue;

    const [bidId, title] = cells;
    if (!bidId || !title || bidId.length > 40) continue;
    const dueDate = toIsoDate(cells.at(-1));
    if (!dueDate) continue;
    if (dueDate < scrapedAt.slice(0, 10)) continue;

    const signature = `${site.id}|${bidId}|${dueDate}`;
    if (seen.has(signature)) continue;
    seen.add(signature);

    bids.push({
      platform: "IonWave",
      sourceId: site.id,
      bidId,
      title,
      agency: site.agency,
      location: site.location,
      dueDate,
      bidUrl: site.url,
      documentsUrl: site.url,
      estimatedValue: "",
      description: joined,
      scrapedAt
    });
  }

  return bids;
}
