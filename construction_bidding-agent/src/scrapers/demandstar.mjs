import { collectBidCards, ensureLoggedIn, writeDebugSnapshot } from "./common.mjs";

export async function scrapeDemandStar(page, portal) {
  await page.goto(portal.scrapeUrl || portal.url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await settle(page);
  await prepareDemandStarSearch(page);
  if (process.env.DEBUG_DEMANDSTAR_PAGES) {
    const body = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
    console.log(`DemandStar after prepare: ${body.match(/Showing\\s+\\d+-\\d+\\s+of\\s+\\d+/)?.[0] || body.match(/There are no results found/)?.[0] || "unknown"}`);
    console.log(`DemandStar status block: ${(await page.locator(".rt_BS_stpe3BS").innerText().catch(() => "")).replace(/\\s+/g, " ").slice(0, 160)}`);
  }

  const listBids = await extractListPages(page);
  if (listBids.length > 0) return { platform: "DemandStar", bids: listBids, debugText: "" };

  const detailBid = await extractDetailBid(page);
  if (detailBid) return { platform: "DemandStar", bids: [detailBid], debugText: "" };

  const login = await ensureLoggedIn(page, "DemandStar");
  if (!login.loggedIn) return { platform: "DemandStar", bids: [], warning: login.message };

  const body = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  if (/There are no results found/i.test(body)) {
    const debugText = process.env.DEBUG_SCRAPE ? await writeDebugSnapshot(page, "DemandStar") : "";
    return { platform: "DemandStar", bids: [], warning: "DemandStar returned no bid results for the current filter/session.", debugText };
  }

  const bids = await collectBidCards(page, "DemandStar", {
    selectors: [
      "[data-testid*='bid' i]",
      "[class*='bid' i]",
      "[class*='opportunity' i]",
      "[role='row']",
      "mat-row",
      "tr",
      "[class*='card' i]"
    ]
  });

  const debugText = process.env.DEBUG_SCRAPE ? await writeDebugSnapshot(page, "DemandStar") : "";
  return { platform: "DemandStar", bids, debugText };
}

async function prepareDemandStarSearch(page) {
  const body = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (!body.includes("Bids Search")) return;

  await clearDemandStarTextFilters(page);
  await ensureDemandStarActiveStatus(page);
  await refreshDemandStarActiveStatus(page);
  await ensureDemandStarCountyFilter(page, process.env.DEMANDSTAR_COUNTY || "Tarrant County, TX");
  await ensureDemandStarCountyArea(page, process.env.DEMANDSTAR_COUNTY_AREA || "50 miles");
  await clickDemandStarSearch(page);
}

async function clickDemandStarSearch(page) {
  const search = page.getByRole("button", { name: /^search$/i });
  if (await search.isVisible().catch(() => false)) {
    await waitForDemandStarOverlay(page);
    await search.last().click({ timeout: 5000 }).catch(async () => {
      await search.last().click({ force: true, timeout: 5000 }).catch(() => {});
    });
    await settle(page);
    await page.waitForTimeout(1000);
  }
}

async function clearDemandStarTextFilters(page) {
  const inputs = [
    "input[name='agencyText']",
    "input[name='bidName']",
    "input[name='bidIdentifier']",
    "input#datepickerId"
  ];
  for (const selector of inputs) {
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const input = locator.nth(index);
      const readOnly = await input.evaluate((element) => element.readOnly).catch(() => true);
      if (!readOnly) await input.fill("", { timeout: 1500 }).catch(() => {});
    }
  }
}

async function ensureDemandStarActiveStatus(page) {
  const status = page.locator(".rt_BS_stpe3BS").first();
  const text = await status.innerText({ timeout: 3000 }).catch(() => "");
  if (/Bid Status\s+Active/i.test(text) || /^Active$/i.test(text.trim())) return;

  const input = page.locator("input#Bid\\ Status").first();
  if (!(await input.isVisible().catch(() => false))) return;
  await input.click({ force: true }).catch(() => {});
  await page.waitForTimeout(500);

  let activeOption = page.locator("[role='option']").filter({ hasText: /^Active$/ }).first();
  if (!(await activeOption.isVisible().catch(() => false))) {
    await input.pressSequentially("Active").catch(() => {});
    await page.waitForTimeout(500);
    activeOption = page.locator("[role='option']").filter({ hasText: /^Active$/ }).first();
  }
  if (await activeOption.isVisible().catch(() => false)) {
    await activeOption.click({ force: true }).catch(() => {});
  } else {
    await input.press("Enter").catch(() => {});
  }
  await page.waitForTimeout(500);
}

async function refreshDemandStarActiveStatus(page) {
  const status = page.locator(".rt_BS_stpe3BS").first();
  if (!(await status.isVisible().catch(() => false))) return;
  await status.click({ force: true, timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);
  const activeOption = page.locator("[role='option']").filter({ hasText: /^Active$/ }).first();
  if (await activeOption.isVisible().catch(() => false)) {
    await activeOption.click({ force: true, timeout: 5000 }).catch(() => {});
  } else {
    await page.keyboard.press("Escape").catch(() => {});
  }
  await page.waitForTimeout(300);
}

async function ensureDemandStarCountyFilter(page, county) {
  const input = page.locator("input[name='locationText']").first();
  if (!(await input.isVisible().catch(() => false))) return;
  const current = await input.inputValue().catch(() => "");
  if (current.trim().toLowerCase() === county.toLowerCase()) return;

  await input.evaluate((element) => {
    element.scrollIntoView({ block: "center" });
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  }).catch(() => {});
  await page.waitForTimeout(600);

  const option = page.locator("ul.dd-list li").filter({ hasText: new RegExp(`^${escapeRegExp(county)}$`, "i") }).first();
  if (await option.isVisible().catch(() => false)) {
    await option.click({ force: true, timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(700);
  }
}

async function ensureDemandStarCountyArea(page, area) {
  const county = page.locator("input[name='locationText']").first();
  if (!(await county.isVisible().catch(() => false))) return;
  if (!(await county.inputValue().catch(() => ""))) return;

  const toggle = page.locator(".searchToggle").first();
  const body = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  if (!body.includes("County Area") && await toggle.isVisible().catch(() => false)) {
    await toggle.click({ force: true, timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
  }

  const areaWrapper = page.locator("label", { hasText: /^County Area$/ })
    .locator("xpath=ancestor::div[contains(@class,'selectWrapper')][1]")
    .first();
  if (!(await areaWrapper.isVisible().catch(() => false))) return;
  const current = await areaWrapper.innerText().catch(() => "");
  if (new RegExp(`\\b${escapeRegExp(area)}\\b`, "i").test(current)) return;

  await areaWrapper.locator(".dd-header").click({ force: true, timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
  const option = page.locator("ul.dd-list li").filter({ hasText: new RegExp(`^${escapeRegExp(area)}$`, "i") }).first();
  if (await option.isVisible().catch(() => false)) {
    await option.click({ force: true, timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
  }
}

async function waitForDemandStarOverlay(page) {
  await page.locator("#loaderOverlay, .overlay").first().waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
}

async function extractListPages(page) {
  const maxPages = Number(process.env.DEMANDSTAR_MAX_PAGES || 100);
  const bids = [];
  const visitedPages = new Set();

  for (let pageCount = 0; pageCount < maxPages; pageCount += 1) {
    const currentPage = await currentDemandStarPage(page);
    if (process.env.DEBUG_DEMANDSTAR_PAGES) console.log(`DemandStar page pass ${pageCount + 1}: ${currentPage || "unknown"}`);
    if (currentPage && visitedPages.has(currentPage)) break;
    if (currentPage) visitedPages.add(currentPage);

    const current = await extractListBids(page);
    if (process.env.DEBUG_DEMANDSTAR_PAGES) console.log(`DemandStar extracted ${current.length} on pass ${pageCount + 1}`);
    bids.push(...current);

    const clicked = await clickDemandStarNext(page);
    if (process.env.DEBUG_DEMANDSTAR_PAGES) console.log(`DemandStar next clicked: ${clicked}`);
    if (!clicked) break;
    await settle(page);
    await page.waitForTimeout(1500);
  }

  return dedupeBids(bids);
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
}

async function extractListBids(page) {
  const body = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (!body.includes("Bids Search") || !/Showing\s+\d+\s*-\s*\d+\s+of\s+\d+/i.test(body)) return [];

  const links = await page.locator("a[href*='/app/suppliers/bids/'][href*='/details']").evaluateAll((anchors) => {
    return anchors.map((anchor) => ({
      title: anchor.innerText.trim(),
      href: anchor.href,
      block: anchor.parentElement?.innerText || anchor.closest("div")?.innerText || anchor.innerText
    }));
  }).catch(() => []);

  const lines = body.split("\n").map((line) => line.trim()).filter(Boolean);

  return links
    .filter((link) => link.title && !/Bids$/i.test(link.title))
    .map((link, index, filtered) => {
      const nextTitle = filtered[index + 1]?.title || "";
      return parseListBlock({
        ...link,
        block: blockForTitle(lines, link.title, nextTitle) || link.block
      }, page.url());
    });
}

function parseListBlock(link, pageUrl) {
  const text = link.block.replace(/\s+/g, " ").trim();
  const id = matchValue(text, /\bID:\s*([^]+?)(?:\s+Broadcast:|\s+Due:|$)/i);
  const broadcast = matchValue(text, /\bBroadcast:\s*([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/i);
  const due = matchValue(text, /\bDue:\s*([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/i);
  const agency = text
    .replace(link.title, "")
    .split(/\s+ID:\s*/i)[0]
    .replace(/\s+- Demandstar Extended Network\s*/i, " ")
    .replace(/\s+Active\s*/i, " ")
    .trim();

  return {
    platform: "DemandStar",
    bidId: id,
    title: link.title,
    agency,
    location: agency,
    dueDate: parseDate(due),
    bidUrl: new URL(link.href, pageUrl).toString(),
    documentsUrl: new URL(link.href, pageUrl).toString(),
    estimatedValue: "",
    description: [text, broadcast ? `Broadcast: ${broadcast}` : ""].filter(Boolean).join(" | "),
    scrapedAt: new Date().toISOString()
  };
}

function blockForTitle(lines, title, nextTitle) {
  const start = lines.findIndex((line) => line === title);
  if (start < 0) return "";
  let end = lines.length;
  if (nextTitle) {
    const next = lines.findIndex((line, index) => index > start && line === nextTitle);
    if (next > start) end = next;
  }
  const footer = lines.findIndex((line, index) =>
    index > start && (/^Showing\s+\d+\s*-\s*\d+\s+of\s+\d+/i.test(line) || /^Your search returned/i.test(line) || /^©\s+\d{4}/.test(line))
  );
  if (footer > start) end = Math.min(end, footer);
  return lines.slice(start, end).join(" ");
}

function matchValue(text, pattern) {
  const match = text.match(pattern);
  return match ? match[1].trim() : "";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function extractDetailBid(page) {
  const body = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  if (!body.includes("Bid Details") || !body.includes("Bid ID")) return null;
  const title = findDemandStarTitle(body);

  return {
    platform: "DemandStar",
    bidId: valueAfter(body, "Bid ID"),
    title: title || "DemandStar Bid",
    agency: valueAfter(body, "Agency Name"),
    location: valueAfter(body, "Agency Name"),
    dueDate: parseDate(valueAfter(body, "Due") || valueAfter(body, "Due Date")),
    bidUrl: page.url(),
    documentsUrl: page.url(),
    estimatedValue: valueAfter(body, "Amount"),
    description: sectionText(body, "Scope of Work", "Documents"),
    scrapedAt: new Date().toISOString()
  };
}

function valueAfter(text, label) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const sameLine = lines.find((line) => line.toLowerCase().startsWith(`${label.toLowerCase()}\t`));
  if (sameLine) return sameLine.split("\t").slice(1).join(" ").trim();
  const index = lines.findIndex((line) => line.toLowerCase() === label.toLowerCase());
  return index >= 0 ? lines[index + 1] || "" : "";
}

function sectionText(text, start, end) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const startIndex = lines.findIndex((line) => line.toLowerCase() === start.toLowerCase());
  const endIndex = lines.findIndex((line, index) => index > startIndex && line.toLowerCase() === end.toLowerCase());
  if (startIndex < 0) return "";
  return lines.slice(startIndex + 1, endIndex > startIndex ? endIndex : startIndex + 8).join(" ");
}

function parseDate(value) {
  const match = value.match(/\d{1,2}\/\d{1,2}\/\d{2,4}|[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}/);
  if (!match) return "";
  const named = match[0].match(/^([A-Z][a-z]{2})\s+(\d{1,2}),\s+(\d{4})$/);
  if (named) {
    const months = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
    return `${named[3]}-${months[named[1]]}-${named[2].padStart(2, "0")}`;
  }
  const date = new Date(match[0]);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function findDemandStarTitle(text) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const requiredActions = lines.indexOf("Required Actions");
  if (requiredActions >= 0 && lines[requiredActions + 1]) return lines[requiredActions + 1];
  const bidDetails = lines.indexOf("Bid Details");
  if (bidDetails > 1) return lines[bidDetails - 1];
  return "";
}

async function currentDemandStarPage(page) {
  const body = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  const match = body.match(/Showing\s+(\d+)\s*-\s*(\d+)\s+of\s+(\d+)/i);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const active = await page.locator("button, a").evaluateAll((items) => {
    const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const item = items.find((el) => visible(el) && /^\d+$/.test(el.innerText.trim()) && /active|selected|current/i.test(el.className || ""));
    return item?.innerText.trim() || "";
  }).catch(() => "");
  return active;
}

async function clickDemandStarNext(page) {
  const nextPage = await nextDemandStarNumber(page);
  if (nextPage) {
    const pageButton = page.locator(".pagingWrapper li").filter({ hasText: new RegExp(`^${nextPage}$`) }).first();
    if (await pageButton.isVisible().catch(() => false)) {
      await pageButton.click({ force: true });
      return true;
    }
  }

  const nextControls = [
    "button:has-text('Next')",
    "a:has-text('Next')",
    "button[aria-label*='next' i]",
    "a[aria-label*='next' i]",
    "button:has-text('›')",
    "a:has-text('›')",
    "button:has-text('>')",
    "a:has-text('>')"
  ];

  for (const selector of nextControls) {
    const locator = page.locator(selector).last();
    if (!(await locator.isVisible().catch(() => false))) continue;
    if (await isDisabled(locator)) continue;
    await locator.click();
    return true;
  }

  return false;
}

async function nextDemandStarNumber(page) {
  return page.locator(".pagingWrapper li, button, a").evaluateAll((items) => {
    const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const numbers = items
      .filter((el) => visible(el) && /^\d+$/.test(el.innerText.trim()))
      .map((el) => Number(el.innerText.trim()))
      .filter(Number.isFinite);
    if (numbers.length === 0) return "";
    const selected = items.find((el) => visible(el) && /^\d+$/.test(el.innerText.trim()) && /active|selected|current/i.test(el.className || ""));
    const current = selected ? Number(selected.innerText.trim()) : Math.min(...numbers);
    const next = numbers.find((number) => number > current);
    return next ? String(next) : "";
  }).catch(() => "");
}

async function isDisabled(locator) {
  const disabled = await locator.getAttribute("disabled").catch(() => null);
  const ariaDisabled = await locator.getAttribute("aria-disabled").catch(() => null);
  const className = await locator.getAttribute("class").catch(() => "");
  return disabled !== null || ariaDisabled === "true" || /disabled/i.test(className || "");
}

function dedupeBids(items) {
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
