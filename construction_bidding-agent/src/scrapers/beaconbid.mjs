// BeaconBid public solicitation pages (beaconbid.com/solicitations/<agency>/open)
// render a JS table: Title | Release Date | Due Date | Days Left | Status | Reference.
// Open-tab rows all carry an OPEN status chip.
export async function scrapeBeaconBid(page, site) {
  await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.locator("text=/\\bOPEN\\b/").first()
    .waitFor({ state: "attached", timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const rows = await page.locator("tr, [role='row'], a[href*='/solicitations/']").evaluateAll((elements) => {
    const results = [];
    const seenNodes = new Set();
    for (const element of elements) {
      const rowNode = element.closest("tr, [role='row']") || element;
      if (seenNodes.has(rowNode)) continue;
      seenNodes.add(rowNode);
      results.push({
        text: rowNode.innerText,
        href: (rowNode.querySelector("a[href]") || (element.tagName === "A" ? element : null))?.href || ""
      });
    }
    return results;
  }).catch(() => []);

  const bids = normalizeBeaconBidRows(rows, site);
  const body = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  const warning = bids.length === 0 && !/Open \(0\)/i.test(body)
    ? `${site.agency}: BeaconBid page rendered but no OPEN rows were recognized.`
    : "";

  return { platform: "BeaconBid", sourceId: site.id, bids, warning };
}

export function normalizeBeaconBidRows(rows, site, scrapedAt = new Date().toISOString()) {
  const seen = new Set();
  const bids = [];
  const today = scrapedAt.slice(0, 10);

  for (const row of rows) {
    const text = cleanText(row.text);
    if (!text || !/\bOPEN\b/.test(text)) continue;

    const lines = text.split("\n").map(cleanText).filter(Boolean);
    const title = lines.find((line) => line.length > 6 && !/^(OPEN|E-BID|Title|Status)$/i.test(line));
    if (!title) continue;

    const dates = [...text.matchAll(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g)].map((match) => toIsoDate(match[0]));
    // Release date comes first, due date second; take the latest as due.
    const dueDate = dates.sort().at(-1) || "";
    if (dueDate && dueDate < today) continue;

    const bidId = text.match(/\b(?:Bid|RFP|RFQ|IFB)\s*(?:No\.?|#)?\s*([0-9]{2,4}-[0-9A-Z]+)/i)?.[1] || "";
    const signature = `${site.id}|${title.toLowerCase()}|${dueDate}`;
    if (seen.has(signature)) continue;
    seen.add(signature);

    bids.push({
      platform: "BeaconBid",
      sourceId: site.id,
      bidId,
      title: title.slice(0, 160),
      agency: site.agency,
      location: site.location || "",
      dueDate,
      bidUrl: row.href || site.url,
      documentsUrl: row.href || site.url,
      estimatedValue: "",
      description: lines.slice(0, 8).join(" | ").slice(0, 500),
      scrapedAt
    });
  }

  return bids;
}

function toIsoDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function cleanText(value) {
  return String(value ?? "").replace(/\r/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
}
