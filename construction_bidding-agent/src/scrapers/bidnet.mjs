import { AGGREGATE_KEYWORDS } from "../keywords.mjs";

const SEARCH_URL = "https://www.bidnetdirect.com/private/supplier/solicitations/search";
// BidNet's own facet value for the Texas location filter, read from the
// filter checkbox's data-filter-item-value in the live search page.
const TEXAS_FILTER_VALUE = "277";

export async function scrapeBidNetSite(page, site) {
  await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

  const body = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (/^403 Forbidden/m.test(body.trim())) {
    return {
      platform: "BidNet",
      sourceId: site.id,
      bids: [],
      warning: `${site.agency}: BidNet returned 403 Forbidden (bot detection); rerun with the realistic browser profile.`
    };
  }

  const rows = await page
    .locator("a[href*='/solicitations/open-bids/']")
    .evaluateAll((links) => links.map((link) => {
      const box = link.closest("tr, li, [class*='row' i], [class*='item' i]") || link.parentElement;
      return {
        title: link.innerText.trim(),
        href: link.href,
        box: box ? box.innerText.replace(/\s+/g, " ").trim() : ""
      };
    }))
    .catch(() => []);

  const bids = normalizeBidNetRows(rows, site);
  const warning = bids.length === 0 && !/no (?:open )?solicitations|no results/i.test(body)
    ? `${site.agency}: no recognizable BidNet open solicitations were found.`
    : "";

  return { platform: "BidNet", sourceId: site.id, bids, warning };
}

export function normalizeBidNetRows(rows, site, scrapedAt = new Date().toISOString()) {
  const seen = new Set();
  const bids = [];

  for (const row of rows) {
    const title = clean(row.title);
    const href = String(row.href || "");
    // Real solicitations end in a numeric id; buyer nav links do not.
    if (!title || !/\/solicitations\/open-bids\/[^/?]+\/(\d+)/.test(href)) continue;

    const box = clean(row.box);
    const bidId = box.startsWith(title) ? "" : clean(box.split(title)[0]) || "";
    const dueDate = toIsoDate(box.match(/Closing\s+(\d{2}\/\d{2}\/\d{4})/i)?.[1]);
    const issueDate = box.match(/Published\s+(\d{2}\/\d{2}\/\d{4})/i)?.[1] || "";
    if (dueDate && dueDate < scrapedAt.slice(0, 10)) continue;

    const signature = `${site.id}|${bidId || title}|${dueDate}`;
    if (seen.has(signature)) continue;
    seen.add(signature);

    bids.push({
      platform: "BidNet",
      sourceId: site.id,
      bidId,
      title,
      agency: site.agency,
      location: site.location,
      dueDate,
      bidUrl: href.split("?")[0],
      documentsUrl: href.split("?")[0],
      estimatedValue: "",
      description: [box, issueDate ? `Published: ${issueDate}` : ""].filter(Boolean).join(" | "),
      scrapedAt
    });
  }

  return bids;
}

// --- Wide/authenticated search (the account-wide solicitation search, not a
// single buyer's page) -------------------------------------------------

// Deliberately does NOT wait for `networkidle`: BidNet's chat widget
// (Drift/yellow.ai) polls continuously, so the page often never truly goes
// idle and every call would eat its full timeout for no reason — this is
// what made the 40-keyword aggregate sweep take 20-30 minutes instead of a
// couple. Waiting for the actual results table (or its "no results" state)
// to settle is both faster and a more direct signal of "the search finished".
async function waitForSearchSettled(page) {
  await page.waitForFunction(() => !document.body.innerText.includes("Loading..."), { timeout: 15000 }).catch(() => {});
  await page.waitForFunction(
    () => document.querySelectorAll("a.solicitationsTitleLink").length > 0 || /no (?:results|solicitations)/i.test(document.body.innerText),
    { timeout: 15000 }
  ).catch(() => {});
  await page.waitForTimeout(300);
}

// Slower, networkidle-based settle for the location-filter toggle only
// (clearBidNetFilters / applyBidNetTexasFilter) — called at most 2-3 times
// per run, so its slowness doesn't matter, but the filter-apply AJAX and its
// effect on the results tile genuinely need the extra time to propagate
// server-side (proven: the fast wait above made applyBidNetTexasFilter fail
// to confirm the filter took, 4/4 attempts, even though the click itself
// worked).
async function waitForFilterSettled(page) {
  await page.waitForFunction(() => !document.body.innerText.includes("Loading..."), { timeout: 20000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1000);
}

// Removes every active search filter (location, category, keywords, ...).
export async function clearBidNetFilters(page) {
  await page.goto(`${SEARCH_URL}?target=clearAll`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForFilterSettled(page);
}

// Idempotent: does nothing if the Texas location filter is already active.
// This is the account's normal resting state — every wide-search run that
// clears filters for something else (e.g. the nationwide aggregate keyword
// sweep) must call this again afterward to restore it, since the filter is
// remembered server-side on the shared account and affects what anyone sees
// on a plain login.
// The JSF facet panel's expand/click sequence is genuinely flaky (animation
// timing, not a selector bug — the same steps succeed and fail run to run),
// so this retries and verifies via the checkbox's actual checked state
// before returning. Throws rather than returning silently if it can't
// confirm Texas is active after retrying — this filter is the shared
// account's normal resting state, so leaving it nationwide unnoticed would
// mean whoever next checks BidNet manually sees the wrong thing.
// The checkbox's own `checked` state is NOT reliable evidence the filter
// actually applied — it flips to checked optimistically on click even on
// the runs where the server-side AJAX filter silently doesn't take (proven
// by testing: checked=true, but the results tile still showed the
// nationwide "28K" total). The real signal is the results tile itself:
// BidNet abbreviates counts >= 1000 with a "K" suffix ("28K"), and only
// shows a full comma-formatted number ("2,516") once a filter narrows the
// count below that. Texas is consistently in the low thousands, so
// "comma-formatted, not K-suffixed" is a reliable proxy for "filtered".
async function isTexasFilterActive(page) {
  const tileText = await page.evaluate(() => {
    const idx = document.body.innerText.indexOf("Total Bids");
    return idx === -1 ? "" : document.body.innerText.slice(Math.max(0, idx - 20), idx);
  });
  return /,\d{3}\s*$/.test(tileText.trim());
}

export async function applyBidNetTexasFilter(page, { attempts = 4 } = {}) {
  await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForFilterSettled(page);

  if (await isTexasFilterActive(page)) return;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await page.locator("#panelregionId .mets-panel-header").click({ force: true });
    await page.waitForFunction(
      () => document.querySelector("#panelregionId")?.classList.contains("expanded"),
      { timeout: 10000 }
    ).catch(() => {});
    await page.waitForTimeout(500);

    const checkbox = page.locator(`#panelregionId-body li[data-filter-item-value="${TEXAS_FILTER_VALUE}"] span.checkbox`).first();
    const visible = await checkbox.isVisible().catch(() => false);
    if (visible) {
      await checkbox.click({ force: true }).catch(() => {});
      await waitForFilterSettled(page);
      await page.waitForTimeout(1500);
    }

    if (await isTexasFilterActive(page)) return;

    // The click may have registered as "checked" without the server-side
    // filter taking; reload fresh before the next attempt instead of
    // clicking an already-checked (but ineffective) box again.
    await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForFilterSettled(page);
    if (await isTexasFilterActive(page)) return;
  }

  throw new Error(`Could not apply the BidNet Texas location filter after ${attempts} attempts.`);
}

async function searchBidNetKeyword(page, keyword) {
  await page.locator("#solicitationSingleBoxSearch").fill(keyword);
  await page.locator("#topSearchButton").click();
  await waitForSearchSettled(page);
}

async function extractSearchRows(page) {
  return page.locator("a.solicitationsTitleLink").evaluateAll((links) =>
    links.map((link) => {
      const row = link.closest("tr") || link.parentElement;
      return {
        title: link.innerText.trim(),
        href: link.getAttribute("href") || "",
        rowText: row ? row.innerText.replace(/\s+/g, " ").trim() : "",
        locked: row ? /upgrade required/i.test(row.innerText) : false,
        agency: row?.querySelector(".buyerIdentification")?.innerText.trim() || "",
        category: row?.querySelector(".searchContentGroupName")?.innerText.trim() || ""
      };
    })
  );
}

// Never returns a locked ("upgrade required") row — those are visible only
// as a teaser (state + category, no agency, no detail link the free tier can
// open) and must not be scraped.
export function normalizeBidNetSearchRows(rows, sourceId, scrapedAt = new Date().toISOString()) {
  const seen = new Set();
  const bids = [];

  for (const row of rows) {
    if (row.locked) continue;

    const title = clean(row.title);
    const idMatch = row.href.match(/\/(?:open-solicitation|view-notice)\/(\d+)/);
    if (!title || !idMatch) continue;

    const dueDate = toIsoDate(row.rowText.match(/CLOSING DATE\s+(\d{2}\/\d{2}\/\d{4})/i)?.[1]);
    if (dueDate && dueDate < scrapedAt.slice(0, 10)) continue;

    const location = clean(
      row.rowText.match(/LOCATION\s+LOCATION\s+([A-Za-z][A-Za-z .]*?)\s+Published Date/i)?.[1] ||
      row.rowText.match(/LOCATION\s+([A-Za-z][A-Za-z .]*?)\s+Published Date/i)?.[1] ||
      ""
    );
    const published = row.rowText.match(/Published Date\s+(\d{2}\/\d{2}\/\d{4})/i)?.[1] || "";
    const agency = clean(row.agency) || clean(row.category) || "BidNet";
    const bidId = idMatch[1];

    const signature = `${bidId}|${title}|${dueDate}`;
    if (seen.has(signature)) continue;
    seen.add(signature);

    bids.push({
      platform: "BidNet",
      sourceId,
      bidId,
      title,
      agency,
      location,
      dueDate,
      bidUrl: `https://www.bidnetdirect.com${row.href.split("?")[0]}`,
      documentsUrl: `https://www.bidnetdirect.com${row.href.split("?")[0]}`,
      estimatedValue: "",
      description: [row.category, published ? `Published: ${published}` : ""].filter(Boolean).join(" | "),
      scrapedAt
    });
  }

  return bids;
}

async function collectBidNetSearchPages(page, { sourceId, maxPages = 60, pageSize = 100 }) {
  const bids = [];
  let truncated = false;

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    await page.goto(`${SEARCH_URL}?pageNumber=${pageNumber}&pageSize=${pageSize}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForSearchSettled(page);
    const rows = await extractSearchRows(page).catch(() => []);
    if (rows.length === 0) break;
    bids.push(...normalizeBidNetSearchRows(rows, sourceId));
    if (rows.length < pageSize) break;
    if (pageNumber === maxPages) truncated = true;
  }

  return { bids, truncated };
}

// The account's normal wide search: every open Texas solicitation this
// (free-tier) login can actually see, skipping upgrade-required teasers.
export async function scrapeBidNetTexasWide(page, { pageSize = 100, maxPages = 60 } = {}) {
  await applyBidNetTexasFilter(page);
  const { bids, truncated } = await collectBidNetSearchPages(page, { sourceId: "bidnet-wide-texas", pageSize, maxPages });
  const warning = truncated
    ? `bidnet-wide-texas: hit the ${maxPages}-page safety cap (${maxPages * pageSize} rows) — more open Texas solicitations may exist.`
    : "";
  return { platform: "BidNet", sourceId: "bidnet-wide-texas", bids, warning };
}

// Nationwide (no location filter) sweep using the client's own aggregate
// keyword list against BidNet's own keyword search, so we don't have to
// paginate all ~28k nationwide open solicitations to find the handful that
// are aggregate-material bids. Clears filters, searches each keyword,
// dedupes by bidId across keywords, then restores the Texas filter so the
// shared account's default view isn't left nationwide.
export async function scrapeBidNetAggregatesNationwide(page, { keywords = AGGREGATE_KEYWORDS, pageSize = 100, maxPagesPerKeyword = 20 } = {}) {
  await clearBidNetFilters(page);

  const seen = new Set();
  const bids = [];
  const warnings = [];

  for (const keyword of keywords) {
    await searchBidNetKeyword(page, keyword);
    const { bids: keywordBids, truncated } = await collectBidNetSearchPages(page, {
      sourceId: "bidnet-wide-aggregates",
      pageSize,
      maxPages: maxPagesPerKeyword
    });
    if (truncated) warnings.push(`"${keyword}" hit the ${maxPagesPerKeyword}-page safety cap.`);
    for (const bid of keywordBids) {
      if (seen.has(bid.bidId)) continue;
      seen.add(bid.bidId);
      bids.push(bid);
    }
  }

  // Best-effort: restoring the Texas filter is cosmetic (it only affects
  // what a human sees if they check the account later) — a flaky UI toggle
  // here must never throw away the keyword bids already scraped above.
  try {
    await applyBidNetTexasFilter(page);
  } catch (error) {
    warnings.push(`Could not restore the Texas filter afterward: ${error.message}`);
  }

  return { platform: "BidNet", sourceId: "bidnet-wide-aggregates", bids, warning: warnings.join(" ") };
}

function toIsoDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
