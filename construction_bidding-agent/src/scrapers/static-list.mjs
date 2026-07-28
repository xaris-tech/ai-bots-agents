import { classifyBlock, gotoWithRetry, waitForCloudflareClearance } from "./common.mjs";

// Generic scraper for static-HTML bid listings that don't run on a dedicated
// procurement platform: ezTask county sites (Texas Association of Counties CMS),
// Revize city sites, school-district purchasing pages, and one-off ASP.NET/CFM
// listing pages (San Antonio, Austin). Three extraction strategies, tried in
// order, results merged:
//   A. table rows that contain a date (deadline column layouts)
//   B. content links whose surrounding text looks like a solicitation
//   C. (opt-in via site.allowTextNotices) plain-text "NOTICE OF BID" blocks
//      with no links or dates — some county sites publish notices this way.
export async function scrapeStaticList(page, site) {
  const response = await gotoWithRetry(page, site.url, { timeout: 60000 });
  const httpStatus = response?.status() ?? 0;
  await waitForCloudflareClearance(page, { timeout: site.cloudflare ? 45000 : 12000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

  const body = cleanText(await page.locator("body").innerText({ timeout: 5000 }).catch(() => ""));
  const block = await classifyBlock(page, httpStatus);
  if (block !== "ok") {
    const warning =
      block === "blocked-cloudflare"
        ? `${site.agency}: Cloudflare challenge not cleared. Run through scripts/scrape-cloudflare-sites.mjs (real Chrome over CDP).`
        : block === "origin-down"
        ? `${site.agency}: origin server unreachable (HTTP ${httpStatus}); site down, not a scraper fault.`
        : `${site.agency}: page returned a bot-block (HTTP ${httpStatus || "403"}); not reachable headless.`;
    return { platform: "StaticList", sourceId: site.id, bids: [], warning };
  }

  const rows = await collectTableRows(page);
  const links = await collectContentLinks(page);
  const notices = site.allowTextNotices ? textNotices(body) : [];

  const bids = normalizeStaticItems([...rows, ...links, ...notices], site);
  const warning = bids.length === 0 && !/no (?:open )?bids?|no current|not accepting|no solicitations/i.test(body)
    ? `${site.agency}: no open solicitations recognized; verify page layout.`
    : "";

  return { platform: "StaticList", sourceId: site.id, bids, warning };
}

async function collectTableRows(page) {
  return page.locator("tr").evaluateAll((rows) => rows
    .filter((row) => row.querySelector("td") && !row.querySelector("table"))
    .filter((row) => row.innerText.length < 500)
    .map((row) => ({
      kind: "row",
      text: row.innerText,
      href: row.querySelector("a[href]")?.href || ""
    }))
  ).catch(() => []);
}

async function collectContentLinks(page) {
  return page.locator("a[href]").evaluateAll((anchors) => anchors
    .filter((anchor) => {
      const text = anchor.innerText.trim();
      if (text.length < 8) return false;
      if (anchor.closest("nav, header, footer, [role='navigation']")) return false;
      return true;
    })
    .map((anchor) => {
      // Climb to a small container so dates/status printed next to the link
      // (Austin's "Due Date:" card, ezTask deadline cells) come along.
      let container = anchor.parentElement;
      for (let depth = 0; depth < 3; depth += 1) {
        if (!container?.parentElement) break;
        if (/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|[A-Z][a-z]{2,8} \d{1,2}, \d{4}|due date/i.test(container.innerText)) break;
        // Don't absorb sibling postings: a wide container mixes this link's
        // context with other bids' dates and poisons the past-date filter.
        if (container.parentElement.innerText.length > 400) break;
        container = container.parentElement;
      }
      return {
        kind: "link",
        text: anchor.innerText,
        containerText: container?.innerText || anchor.innerText,
        href: anchor.href
      };
    })
  ).catch(() => []);
}

// Blocks like "NOTICE OF BID ... sealed bids for ... road materials" or
// "REQUEST FOR PROPOSAL (RFP) FOR ..." published as plain paragraphs with no
// link and sometimes no machine-readable deadline.
function textNotices(body) {
  const notices = [];
  const pattern = /(?:NOTICE (?:OF|TO) BID(?:DERS)?|REQUEST FOR (?:SEALED )?PROPOSALS? \(?RFP\)?|(?:RFP|RFQ|IFB|ITB)\s*#\s*[A-Z0-9][\w./-]*)[^\n]*/g;
  let match;
  while ((match = pattern.exec(body)) !== null) {
    const excerpt = body.slice(match.index, match.index + 400);
    notices.push({ kind: "notice", text: excerpt, href: "" });
  }
  // "27-01 Groceries and Catering\nDescription: DUE DATE: July 23, 2026 ..."
  // (Arlington ISD's Drive-folder listing renders titles as bare text lines.)
  const duePattern = /([^\n]{10,140})\n(?:Description:\s*)?DUE DATE:\s*([^\n]+)/g;
  while ((match = duePattern.exec(body)) !== null) {
    notices.push({ kind: "notice", text: `${match[1]}\nDUE DATE: ${match[2]}`, href: "" });
  }
  return notices;
}

// Plurals matter: "Request for Proposals" must match, so anchor with `s?`
// rather than the bare singular (a real Crowley open bid was silently dropped
// because `\bproposal\b` never matched "Proposals").
const SOLICITATION_KEYWORDS = /\b(bids?|rfps?|rfqs?|rfcsp|ifb|itb|proposals?|solicitations?|invitations?|notice to bidder|request for (?:proposal|qualification|bid|quote))/i;
const GENERIC_TITLES = /^(bids?|bid (?:opportunities|postings|information|notices?)|current bids?|open bids?|bid results?|closed bids?|purchasing|solicitations?|view (?:all|details)|read more|learn more|details|download(?: file)?|here|click here)$/i;
// Boilerplate procurement paperwork that sits next to real postings.
const BOILERPLATE_TITLES = /^(form\b|residence certification|list of government|vendor (?:registration|application|packet)|w-9\b|conflict of interest|inquiries and responses|how to|instructions|purchasing policy|federal procurement|terms (?:and|&) conditions|bid tabulation|skip (?:navigation|to)|scroll to top|translate\b|search\b)/i;
const CLOSED_MARKERS = /\b(closed|awarded|cancelled|canceled|rejected|expired|tabulation|bid results|past bids)\b/i;
const DOCUMENT_HREF = /\/upload\/|\/documentcenter\/|\.pdf(?:\?|$)|\.docx?(?:\?|$)|solicitation_details|content\.aspx\?id=|\/document_center\//i;
// Open-ended solicitations carry no closing date on purpose ("Open Until Filled"
// on Crowley's CivicPlus RFP list). They are open bids, so the no-date drop
// filters below must NOT discard them. Kept to specific procurement phrases to
// avoid matching stray "ongoing"/"continuous" boilerplate elsewhere.
const OPEN_ENDED = /\bopen until filled\b|\buntil filled\b|\buntil awarded\b|\bcontinuous(?:ly)? (?:open|accepted)\b/i;

export function normalizeStaticItems(items, site, scrapedAt = new Date().toISOString()) {
  const seen = new Set();
  const bids = [];

  for (const item of items) {
    const context = cleanText(item.containerText || item.text);
    const linkText = cleanText(item.text);
    if (!context) continue;
    // Notice blocks were matched by explicit solicitation patterns already;
    // their titles ("27-01 Groceries and Catering") may lack the keywords.
    if (item.kind !== "notice" && !SOLICITATION_KEYWORDS.test(context)) continue;

    let title = pickTitle(item.kind === "link" ? linkText : context);
    if (!title || GENERIC_TITLES.test(title) || BOILERPLATE_TITLES.test(title)) continue;
    if (CLOSED_MARKERS.test(title) || /^CLOSED/i.test(context)) continue;
    if (item.kind === "notice" && /^notice (?:of|to) bid(?:ders)?$/i.test(title)) {
      // Bare "NOTICE OF BID" heading — pull the subject from the body text.
      title = cleanText(context).split("\n").map((line) => line.trim()).filter(Boolean)
        .slice(0, 2).join(" — ").slice(0, 160);
    }

    const dueDate = lastFutureDate(context, scrapedAt) ?? "";
    const hasDocumentHref = DOCUMENT_HREF.test(item.href || "");
    const openEnded = OPEN_ENDED.test(context);
    // Require some evidence this is a real posting, not a stray nav mention:
    // a future deadline, a document link, an explicit text notice, or an
    // open-ended ("Open Until Filled") solicitation.
    if (!dueDate && !hasDocumentHref && item.kind !== "notice" && !openEnded) continue;
    // Rows/cards whose only dates are in the past are finished solicitations —
    // unless the posting is explicitly open-ended (a past "posted" date but no
    // deadline, e.g. "Posted 12/22/2025 - Open Until Filled").
    if (!dueDate && hasAnyDate(context) && !openEnded) continue;
    // Undated postings that name only bygone years ("Road Materials 2021",
    // "School Land-Lease June 2012") are stale leftovers, not open bids.
    if (!dueDate && !openEnded && isStaleByYear(`${title} ${context.slice(0, 200)}`, scrapedAt)) continue;

    // The same solicitation is often collected twice — once as a table row
    // (title = whole row incl. dates) and once as its content link (title =
    // anchor text) — which the title+date signature can't catch. When both
    // point at the same bid-detail URL, dedupe on that href first.
    const hrefKey = item.href && /[?/][^/]*(?:bid|rfp|rfq|id=|solicit)/i.test(item.href)
      ? `${site.id}|href|${item.href}`
      : "";
    if (hrefKey && seen.has(hrefKey)) continue;
    const signature = `${site.id}|${title.toLowerCase()}|${dueDate}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    if (hrefKey) seen.add(hrefKey);

    bids.push({
      platform: "StaticList",
      sourceId: site.id,
      bidId: findBidId(context),
      title,
      agency: site.agency,
      location: site.location || "",
      dueDate,
      bidUrl: item.href || site.url,
      documentsUrl: item.href || site.url,
      estimatedValue: "",
      description: context.split("\n").map(cleanText).filter(Boolean).slice(0, 8).join(" | ").slice(0, 500),
      scrapedAt
    });
  }

  return bids;
}

function pickTitle(text) {
  const line = cleanText(text).split("\n").map((value) => value.trim()).filter(Boolean)[0] || "";
  return line
    .replace(/\.(pdf|docx?|xlsx?)\s*$/i, "")
    .replace(/\s+/g, " ")
    .slice(0, 160)
    .trim();
}

function findBidId(text) {
  const match = text.match(/\b(?:bid|rfp|rfq|rfcsp|ifb|itb|solicitation)\s*(?:#|no\.?|number)?\s*[:\-#]?\s*(\d{2,4}[-\/]?\d{1,4}[-A-Z0-9]*)/i) ||
    text.match(/\b([A-Z]{2,6}[- ]?\d{2,4}[-–]\d{1,4})\b/);
  return match ? match[1].trim() : "";
}

const DATE_PATTERN = /\b(\d{1,2}\/\d{1,2}\/\d{2,4}|[A-Z][a-z]{2,8}\.? \d{1,2}, \d{4}|\d{4}-\d{2}-\d{2})\b/g;

function hasAnyDate(text) {
  return new RegExp(DATE_PATTERN.source).test(text);
}

function isStaleByYear(text, scrapedAt) {
  const currentYear = Number(scrapedAt.slice(0, 4));
  const years = [...text.matchAll(/\b(20\d{2})\b/g)].map((match) => Number(match[1]));
  return years.length > 0 && Math.max(...years) < currentYear;
}

function lastFutureDate(text, scrapedAt) {
  const today = scrapedAt.slice(0, 10);
  const dates = [...text.matchAll(DATE_PATTERN)]
    .map((match) => toIsoDate(match[1]))
    .filter((iso) => iso && iso >= today)
    .sort();
  return dates.at(-1) ?? null;
}

function toIsoDate(value) {
  const date = new Date(value.replace(/\./g, ""));
  if (Number.isNaN(date.getTime())) return "";
  // Interpret the parsed date in local terms; listings never carry timezones.
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function cleanText(value) {
  return String(value ?? "").replace(/\r/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
}
