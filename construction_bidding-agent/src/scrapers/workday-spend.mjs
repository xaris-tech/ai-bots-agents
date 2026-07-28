// Workday Strategic Sourcing public portals (<agency>.public-portal.us.workdayspend.com)
// render a JS table of "events" (solicitations): one <tr> per event with an
// anchor to /bid-details/<id> and cells Title | Event ID | Type | Status |
// Invite | Publish Date | Submission Deadline. Status values seen live:
// OPEN, CLOSED, INTEND TO AWARD.
export async function scrapeWorkdaySpend(page, site) {
  await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.locator("a[href*='/bid-details/']").first()
    .waitFor({ state: "attached", timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const rows = await page.locator("tr:has(a[href*='/bid-details/'])").evaluateAll((trs) =>
    trs.map((tr) => ({
      text: tr.innerText,
      title: tr.querySelector("a[href*='/bid-details/']")?.innerText.trim() || "",
      href: tr.querySelector("a[href*='/bid-details/']")?.href || ""
    }))
  ).catch(() => []);

  const bids = normalizeWorkdayRows(rows, site);
  const body = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  const warning = rows.length === 0 && !/Displaying 0 of|BID OPPORTUNITIES 0/i.test(body)
    ? `${site.agency}: Workday portal rendered but no event rows were recognized.`
    : "";

  return { platform: "WorkdaySpend", sourceId: site.id, bids, warning };
}

const CLOSED_STATUSES = /\b(CLOSED|INTEND TO AWARD|AWARDED|CANCELLED|CANCELED)\b/i;

export function normalizeWorkdayRows(rows, site, scrapedAt = new Date().toISOString()) {
  const seen = new Set();
  const bids = [];
  const today = scrapedAt.slice(0, 10);

  for (const row of rows) {
    const text = cleanText(row.text);
    const title = cleanText(row.title).slice(0, 160);
    if (!title || title.length < 6) continue;
    if (CLOSED_STATUSES.test(text)) continue;

    const dates = [...text.matchAll(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g)]
      .map((match) => toIsoDate(match[0]))
      .filter(Boolean)
      .sort();
    // Publish date comes before the submission deadline; take the latest.
    const dueDate = dates.at(-1) || "";
    if (dueDate && dueDate < today) continue;

    const signature = `${site.id}|${title.toLowerCase()}|${dueDate}`;
    if (seen.has(signature)) continue;
    seen.add(signature);

    bids.push({
      platform: "WorkdaySpend",
      sourceId: site.id,
      bidId: row.href.match(/bid-details\/(\d+)/)?.[1] || "",
      title,
      agency: site.agency,
      location: site.location || "",
      dueDate,
      bidUrl: row.href || site.url,
      documentsUrl: row.href || site.url,
      estimatedValue: "",
      description: text.split("\n").map(cleanText).filter(Boolean).slice(0, 8).join(" | ").slice(0, 500),
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
