// Haslet's BID POSTINGS page lists open solicitations as DocumentCenter links
// and sits behind a Cloudflare managed challenge. Run through
// scripts/scrape-via-real-chrome.mjs so the challenge clears in real Chrome.

import { scrapeCivicPlusDocList } from "../scrapers/civicplus-doclist.mjs";

export async function scrape(page, site) {
  return scrapeCivicPlusDocList(page, site);
}
