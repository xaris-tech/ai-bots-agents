export async function scrape(page, site, { adapter }) {
  const base = await adapter(page, site);
  if (base.bids.length) return base;
  const body = await page.locator("body").innerText().catch(() => "");
  if (!/Open Bid Requests/i.test(body)) return base;
  const links = await page.locator("a[href]").evaluateAll((anchors) => anchors.map((anchor) => ({
    text: anchor.innerText.trim(),
    href: anchor.href
  })));
  const bids = normalizeJoshuaOpenLinks(links, site);
  return bids.length ? { platform: "StaticList", sourceId: site.id, bids, warning: "" } : base;
}

export function normalizeJoshuaOpenLinks(links, site, scrapedAt = new Date().toISOString()) {
  return links.flatMap((link) => {
    const title = String(link.text ?? "").trim();
    if (!/^(?:RFP|RFQ|IFB|ITB|Bid)[\s#_-]/i.test(title)) return [];
    if (/scoring|tabulation|award(?:ed)?|closed|cancelled/i.test(title)) return [];
    const bidId = title.match(/\b((?:RFP|RFQ|IFB|ITB|Bid)[\s#_-]*(?:20)?\d{2}[\s#_-]*\d{1,4})\b/i)?.[1]
      ?.replace(/[\s_]+/g, "-").toUpperCase() ?? "";
    return [{
      platform: "StaticList",
      sourceId: site.id,
      bidId,
      title,
      agency: site.agency,
      location: site.location,
      dueDate: "",
      bidUrl: link.href,
      documentsUrl: link.href,
      sourceLinks: [link.href],
      estimatedValue: "",
      description: "Listed by the City under Open Bid Requests.",
      scrapedAt
    }];
  });
}
