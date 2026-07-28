import { classifyBlock, gotoWithRetry, waitForCloudflareClearance, writeDebugSnapshot } from "./common.mjs";

export async function scrapeCivicEngage(page, site) {
  const response = await gotoWithRetry(page, site.url, { timeout: 60000 });
  const httpStatus = response?.status() ?? 0;
  await waitForCloudflareClearance(page, { timeout: site.cloudflare ? 45000 : 12000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  // CivicPlus lazy-loads the bid list; wait for a real bid link to appear.
  await page.locator("a[href*='bid.aspx?bidid=' i], a[href*='bids.aspx?bidid=' i]")
    .first().waitFor({ state: "attached", timeout: 8000 }).catch(() => {});

  const rows = await page.locator("a[href*='bid.aspx?bidid=' i], a[href*='bids.aspx?bidid=' i]")
    .evaluateAll((links) => links.map((link) => {
      let container = link.parentElement;
      while (container?.parentElement && !/(?:Status\s*:|Closes?\s*:)/i.test(container.innerText)) {
        container = container.parentElement;
      }
      return {
        text: container?.innerText || link.innerText,
        href: link.getAttribute("href") || ""
      };
    }))
    .catch(() => []);

  const bids = normalizeCivicEngageRows(rows, site);
  const body = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  const warning = bids.length === 0
    ? await describeEmptyResult(page, site, body, httpStatus)
    : "";
  const debugText = process.env.DEBUG_SCRAPE ? await writeDebugSnapshot(page, site.id) : "";

  return { platform: "CivicEngage", sourceId: site.id, bids, warning, debugText };
}

// Turn an empty result into an honest, actionable warning instead of always
// blaming the parser. A page blocked by Cloudflare, a 403, or a downed origin
// never rendered any rows to recognize — say so, so the monitor can classify
// it correctly and the operator knows to run the real-Chrome pass instead of
// hunting for a selector bug that isn't there.
async function describeEmptyResult(page, site, body, httpStatus) {
  if (/no bids|no open bids?|no current bids?|0 bids/i.test(body)) return "";
  const block = await classifyBlock(page, httpStatus);
  if (block === "blocked-cloudflare") {
    return `${site.agency}: Cloudflare challenge not cleared. Run through scripts/scrape-cloudflare-sites.mjs (real Chrome over CDP).`;
  }
  if (block === "blocked-forbidden") {
    return `${site.agency}: page returned a bot-block (HTTP ${httpStatus || "403"}); not reachable headless.`;
  }
  if (block === "origin-down") {
    return `${site.agency}: origin server unreachable (HTTP ${httpStatus}); site down, not a scraper fault.`;
  }
  return `${site.agency}: no recognizable CivicEngage open-bid rows were found.`;
}

export function normalizeCivicEngageRows(rows, site, scrapedAt = new Date().toISOString()) {
  const seen = new Set();
  const bids = [];

  for (const row of rows) {
    const text = cleanText(row.text);
    if (!text || !/Bid\s*(?:No\.?|Number|#)|Status\s*:/i.test(text)) continue;
    if (/Status\s*:\s*(?:Closed|Awarded|Cancelled|Canceled)/i.test(text)) continue;
    if (!/Status\s*:\s*Open/i.test(text) && !/Closes?\s*:/i.test(text)) continue;

    const lines = text.split("\n").map(cleanText).filter(Boolean);
    const bidId = text.match(/Bid\s*(?:No\.?|Number|#)\s*[:#]?\s*([A-Z0-9][A-Z0-9._/-]*)/i)?.[1] || "";
    const bidNumberIndex = lines.findIndex((line) => /^Bid\s*(?:No\.?|Number|#)/i.test(line));
    const title = (bidNumberIndex > 0 ? lines[bidNumberIndex - 1] : "") || lines.find((line) =>
      line.length > 8 &&
      !/^(?:Bid\s*(?:No\.?|Number|#)|Status|Closes?|Category)\s*:/i.test(line) &&
      !/^Bid\s+(?:No\.?|Number|#)/i.test(line)
    ) || "Untitled Bid";
    const inlineClose = text.match(/Closes?\s*:\s*([^\n]+)/i)?.[1] || "";
    const dates = [...text.matchAll(/\b\d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM))?/gi)];
    const dueDate = toIsoDate(inlineClose) || toIsoDate(dates.at(-1)?.[0] || "");
    if (dueDate && dueDate < scrapedAt.slice(0, 10)) continue;
    const bidUrl = absoluteUrl(row.href, site.url);
    // Include both bidId and title: some agencies (e.g. Copperas Cove) prefix
    // every bid "Bid No. PW ..." so the parsed bidId collides across rows.
    const signature = `${site.id}|${bidId}|${title}|${dueDate}`;
    if (seen.has(signature)) continue;
    seen.add(signature);

    bids.push({
      platform: "CivicEngage",
      sourceId: site.id,
      bidId,
      title,
      agency: site.agency,
      location: site.location || locationFromAgency(site.agency),
      dueDate,
      bidUrl,
      documentsUrl: bidUrl,
      estimatedValue: "",
      description: lines.slice(0, 12).join(" | "),
      scrapedAt
    });
  }

  return bids;
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
  return String(value || "").replace(/\r/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
}
