export async function scrape(page, site, { adapter }) {
  const base = await adapter(page, site);
  if (base.bids.length || !base.warning) return base;
  const links = await page.locator('.fr-view a[href*="/DocumentCenter/View/"]').evaluateAll((anchors) =>
    anchors.map((anchor) => ({
      text: anchor.innerText.trim(),
      context: anchor.parentElement?.innerText.trim() || anchor.innerText.trim(),
      href: anchor.href
    }))
  );
  const bids = normalizeWeatherfordLinks(links, site);
  return bids.length ? { platform: "StaticList", sourceId: site.id, bids, warning: "" } : base;
}

export function normalizeWeatherfordLinks(links, site, scrapedAt = new Date().toISOString()) {
  const opportunities = new Map();
  for (const link of links) {
    const context = `${link.context || ""} ${link.text || ""}`.trim();
    if (!/\b(?:RFP|RFQ|IFB|ITB)[\s#_-]*20\d{2}/i.test(context)) continue;
    if (/tabulation|award(?:ed)?|closed|cancelled/i.test(context)) continue;
    const id = context.match(/\b((?:RFP|RFQ|IFB|ITB)[\s#_-]*20\d{2}[\s#_-]*\d{2,4})\b/i)?.[1]
      ?.replace(/[\s_]+/g, "-").toUpperCase() ?? "";
    if (!id) continue;
    const existing = opportunities.get(id);
    if (/amendment|addendum|questions?|q\s*(?:and|&)\s*a/i.test(context)) {
      if (existing) existing.sourceLinks.push(link.href);
      else opportunities.set(id, { supplement: link.href });
      continue;
    }
    const sourceLinks = [link.href];
    if (existing?.supplement) sourceLinks.push(existing.supplement);
    opportunities.set(id, {
      platform: "StaticList",
      sourceId: site.id,
      bidId: id,
      title: link.text.trim(),
      agency: site.agency,
      location: site.location,
      dueDate: "",
      bidUrl: link.href,
      documentsUrl: link.href,
      sourceLinks,
      estimatedValue: "",
      description: context,
      scrapedAt
    });
  }
  return [...opportunities.values()].filter((item) => item.bidId);
}
