export async function collectBidCards(page, platform, options = {}) {
  const selectors = options.selectors ?? defaultSelectors;
  const cards = [];

  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = Math.min(await locator.count().catch(() => 0), options.limit ?? 100);
    for (let index = 0; index < count; index += 1) {
      const element = locator.nth(index);
      const text = cleanText(await element.innerText({ timeout: 1000 }).catch(() => ""));
      if (!looksLikeBid(text)) continue;

      const href = await firstHref(element);
      cards.push(extractBidFromText({
        platform,
        text,
        href: href ? new URL(href, page.url()).toString() : page.url()
      }));
    }
    if (cards.length > 0) break;
  }

  return dedupeBySignature(cards);
}

// Navigate with retries. Municipal CMS origins (CivicPlus, ezTask, Revize) are
// frequently slow or flaky: a single goto intermittently trips "Timeout exceeded"
// or "ERR_HTTP2_PROTOCOL_ERROR", which then flaps a site between broken/stale/ok
// run to run. Retry with an escalating readiness bar (domcontentloaded → load →
// commit) and a short backoff; most transient timeouts and HTTP/2 negotiation
// errors clear on the second attempt. Returns the Response (or null) so callers
// can read the HTTP status for classifyBlock.
export async function gotoWithRetry(page, url, { timeout = 60000, attempts } = {}) {
  const waits = attempts ?? [
    { waitUntil: "domcontentloaded", timeout },
    { waitUntil: "load", timeout },
    { waitUntil: "commit", timeout }
  ];
  let lastError;
  for (const options of waits) {
    try {
      return await page.goto(url, options);
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(1500);
    }
  }
  throw lastError;
}

// Cloudflare "managed challenge" surfaces in two forms, and a single site can
// escalate from the first to the second on the same visit (the "asks twice"
// the operator sees):
//   passive     - interstitial JS check ("Just a moment..."), no user action;
//                 a real browser clears it on its own in a few seconds.
//   interactive - a Turnstile checkbox iframe the visitor must click.
// A bare headless Playwright launch fails BOTH (its automation fingerprint is
// detected), so these are only ever cleared through the operator's real Chrome
// over CDP. This helper reports which form is on screen so the CDP runner can
// wait appropriately and the headless adapters can fail fast with an honest
// status instead of burning 40s and reporting "no rows".
export async function detectCloudflare(page) {
  const body = cleanText(await page.locator("body").innerText({ timeout: 3000 }).catch(() => ""));
  const title = await page.title().catch(() => "");
  const challengeText = /just a moment|checking your browser|security verification|verify you are (?:a )?human|needs to review the security|enable javascript and cookies/i;
  const looksChallenged = challengeText.test(body) || /just a moment|attention required/i.test(title);
  if (!looksChallenged) return "none";

  // Turnstile renders in a challenges.cloudflare.com iframe; its presence means
  // the interactive checkbox variant is up.
  const hasTurnstile = await page
    .locator("iframe[src*='challenges.cloudflare.com'], iframe[title*='Cloudflare' i], input[type='checkbox']")
    .first()
    .isVisible()
    .catch(() => false);
  return hasTurnstile ? "interactive" : "passive";
}

// Poll until the Cloudflare challenge clears (real bid content renders) or the
// timeout elapses. Only makes progress in a real browser; in headless it just
// times out, which is the caller's signal to emit a blocked-cloudflare status.
// The interactive variant gets a longer budget because a human may need a beat
// to click the checkbox, and Cloudflare can re-issue it once (the double prompt).
export async function waitForCloudflareClearance(page, { timeout = 45000 } = {}) {
  const deadline = Date.now() + timeout;
  let mode = await detectCloudflare(page);
  const initialMode = mode;
  while (Date.now() < deadline) {
    mode = await detectCloudflare(page);
    if (mode === "none") return { cleared: true, mode: initialMode };
    await page.waitForTimeout(mode === "interactive" ? 3000 : 2000);
  }
  return { cleared: false, mode };
}

// Distinguish the real reason a page yielded no rows so the monitor stops
// collapsing everything into "no recognizable rows". Callers pass the response
// status when they have it (page.goto's Response.status()).
export async function classifyBlock(page, status = 0) {
  const cf = await detectCloudflare(page);
  if (cf !== "none") return "blocked-cloudflare";
  if (status === 403) return "blocked-forbidden";
  if (status === 429) return "rate-limited";
  if (status >= 520 && status <= 526) return "origin-down";
  const body = cleanText(await page.locator("body").innerText({ timeout: 3000 }).catch(() => ""));
  if (/access denied|been blocked|are you a human|unusual traffic/i.test(body)) return "blocked-forbidden";
  return "ok";
}

export async function writeDebugSnapshot(page, platform) {
  const safeName = platform.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  await page.screenshot({ path: `data/out/${safeName}-debug.png`, fullPage: true });
  const text = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  return cleanText(text).slice(0, 3000);
}

export function extractBidFromText({ platform, text, href }) {
  const lines = text.split("\n").map(cleanText).filter(Boolean);
  const title = pickTitle(lines);
  const dueDate = findDate(text);
  const agency = findAgency(lines);
  const estimatedValue = findMoney(text);

  return {
    platform,
    bidId: findBidId(text),
    title,
    agency,
    location: findLocation(lines),
    dueDate,
    bidUrl: href,
    documentsUrl: href,
    estimatedValue,
    description: lines.slice(0, 12).join(" | "),
    scrapedAt: new Date().toISOString()
  };
}

export async function ensureLoggedIn(page, platform) {
  const body = cleanText(await page.locator("body").innerText({ timeout: 5000 }).catch(() => ""));
  const hasPassword = await page.locator("input[type='password']").first().isVisible().catch(() => false);
  const lower = body.toLowerCase();
  const hasLoginWall = hasPassword || (
    (lower.includes("sign in") || lower.includes("log in") || lower.includes("login")) &&
    (lower.includes("password") || lower.includes("username") || lower.includes("email"))
  ) || lower.includes("login to euna supplier network");
  if (hasLoginWall) {
    return {
      loggedIn: false,
      message: `${platform} appears to need login. Run npm run auth:portals, log in, then rerun scraping.`
    };
  }
  return { loggedIn: true };
}

const defaultSelectors = [
  "[role='row']",
  "tr",
  "[class*='bid' i]",
  "[class*='opportunity' i]",
  "[class*='solicitation' i]",
  "[class*='event' i]",
  "[class*='card' i]",
  "article",
  "li"
];

function looksLikeBid(text) {
  if (text.length < 20) return false;
  const lower = text.toLowerCase();
  return [
    "bid",
    "due",
    "close",
    "closing",
    "opportunity",
    "solicitation",
    "rfp",
    "rfq",
    "itb",
    "project",
    "agency"
  ].some((term) => lower.includes(term));
}

async function firstHref(locator) {
  const href = await locator.locator("a[href]").first().getAttribute("href", { timeout: 500 }).catch(() => null);
  return href;
}

function pickTitle(lines) {
  const ignored = /^(bid|due|closing|status|agency|buyer|open|closed|view|actions)$/i;
  return lines.find((line) => line.length > 8 && !ignored.test(line)) || lines[0] || "Untitled Bid";
}

function findBidId(text) {
  const patterns = [
    /\b(?:bid|event|solicitation|rfp|rfq|itb)\s*(?:#|no\.?|number|id)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9._\-]{2,})/i,
    /\b([A-Z]{2,}[-_]\d{2,}[-_A-Z0-9]*)\b/
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return "";
}

function findDate(text) {
  const patterns = [
    /\b(\d{1,2}\/\d{1,2}\/\d{2,4})(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?/i,
    /\b([A-Z][a-z]{2,8}\s+\d{1,2},\s+\d{4})\b/,
    /\b(\d{4}-\d{2}-\d{2})\b/
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const date = new Date(match[1]);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  return "";
}

function findAgency(lines) {
  const agencyLine = lines.find((line) => /agency|buyer|owner|department|county|city|district/i.test(line));
  if (!agencyLine) return "";
  return agencyLine.replace(/^(agency|buyer|owner|department)\s*[:\-]\s*/i, "").trim();
}

function findLocation(lines) {
  const locationLine = lines.find((line) => /location|state|county|city/i.test(line));
  if (!locationLine) return "";
  return locationLine.replace(/^(location|state)\s*[:\-]\s*/i, "").trim();
}

function findMoney(text) {
  const match = text.match(/\$\s?[\d,]+(?:\.\d{2})?/);
  return match ? match[0].replace(/\s+/g, "") : "";
}

function dedupeBySignature(items) {
  const seen = new Set();
  const results = [];
  for (const item of items) {
    const key = `${item.platform}|${item.bidId || item.title}|${item.dueDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(item);
  }
  return results;
}

function cleanText(value) {
  return String(value ?? "").replace(/\r/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
}
