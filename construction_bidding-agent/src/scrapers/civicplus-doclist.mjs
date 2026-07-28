// Shared adapter for CivicPlus "content" pages that list open solicitations as
// DocumentCenter links instead of the standard Bids.aspx module (e.g. Westlake,
// Haslet). Also waits out a Cloudflare managed challenge when the page is being
// driven through the operator's real Chrome (scripts/scrape-via-real-chrome.mjs).

export async function scrapeCivicPlusDocList(page, site) {
  await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForCloudflare(page);
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

  const body = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (/security verification|just a moment|verify you are (?:a )?human/i.test(body)) {
    return {
      platform: site.platform,
      sourceId: site.id,
      bids: [],
      warning: `${site.agency}: Cloudflare challenge not cleared. Run through scripts/scrape-via-real-chrome.mjs.`
    };
  }

  // The bid-postings module lazy-loads after the static sidebar links, so poll
  // until a solicitation-looking DocumentCenter link appears (or give up).
  await page.locator(
    "a[href*='/DocumentCenter/View/']:has-text('Bid'), " +
    "a[href*='/DocumentCenter/View/']:has-text('RFP'), " +
    "a[href*='/DocumentCenter/View/']:has-text('RFQ'), " +
    "a[href*='/DocumentCenter/View/']:has-text('Proposal')"
  ).first().waitFor({ state: "attached", timeout: 12000 }).catch(() => {});

  const links = await page
    .locator("a[href*='/DocumentCenter/View/']")
    .evaluateAll((anchors) => anchors.map((anchor) => ({
      text: anchor.innerText.trim(),
      href: anchor.href
    })))
    .catch(() => []);

  const bids = normalizeDocListLinks(links, site);
  const warning = bids.length === 0 && links.length === 0
    ? `${site.agency}: no DocumentCenter links found; page layout may have changed.`
    : "";

  return { platform: site.platform, sourceId: site.id, bids, warning };
}

export function normalizeDocListLinks(links, site, scrapedAt = new Date().toISOString()) {
  const seen = new Set();
  const bids = [];

  for (const link of links) {
    const title = clean(link.text);
    const slug = decodeURIComponent(link.href || "");
    if (!title || title.length < 8) continue;
    // Keep solicitation documents; drop budgets, minutes, fee schedules, etc.
    if (!/\b(rfp|rfq|rfb|ifb|itb|bid|proposal|qualification|solicitation|advertisement for bid)\b/i.test(`${title} ${slug}`)) continue;
    if (/budget|minutes|agenda|fine|fee schedule|newsletter/i.test(title)) continue;

    const bidId = slug.match(/\b(RF[PQB]|IFB|ITB)[-_ ]?(\d{2,4}[-_]?\d*)/i)
      ?.slice(1).join(" ").replace(/_/g, "-") || "";
    const signature = `${site.id}|${bidId || title}`;
    if (seen.has(signature)) continue;
    seen.add(signature);

    bids.push({
      platform: site.platform,
      sourceId: site.id,
      bidId,
      title,
      agency: site.agency,
      location: site.location,
      dueDate: "",
      bidUrl: site.url,
      documentsUrl: link.href,
      estimatedValue: "",
      description: `${title} | posted as solicitation document; due date is inside the linked document`,
      scrapedAt
    });
  }

  return bids;
}

async function waitForCloudflare(page) {
  for (let i = 0; i < 8; i += 1) {
    const body = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
    if (!/security verification|just a moment|verify you are (?:a )?human/i.test(body)) return;
    await page.waitForTimeout(5000);
  }
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
