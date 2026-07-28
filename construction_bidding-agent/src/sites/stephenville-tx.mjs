// Stephenville's bids page lists postings as DocumentCenter links behind a
// Cloudflare managed challenge. Run through scripts/scrape-via-real-chrome.mjs.

import { scrapeCivicPlusDocList } from "../scrapers/civicplus-doclist.mjs";

export async function scrape(page, site) {
  return scrapeCivicPlusDocList(page, site);
}
