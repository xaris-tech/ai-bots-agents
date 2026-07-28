// Westlake posts open bids as DocumentCenter links on a CivicPlus content page
// (/256/Bids-Proposals), not in the standard Bids.aspx module. Shares the
// CivicPlus document-list adapter with Haslet.

import { scrapeCivicPlusDocList } from "../scrapers/civicplus-doclist.mjs";

export async function scrape(page, site) {
  return scrapeCivicPlusDocList(page, site);
}
