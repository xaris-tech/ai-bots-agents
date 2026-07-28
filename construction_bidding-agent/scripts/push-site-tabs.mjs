// Pushes per-website tabs to the "Cortex Bid Intake - Latest" spreadsheet:
// one tab per configured site agency (config/sites.json), holding that
// site's current bids from data/raw/site-bids.json. Sites with no open bids
// get a marker row so coverage stays visible. Batch-portal feeds keep their
// existing per-platform tabs (IonWave / DemandStar / Bonfire / Bidnet).
//
// Run: npm run sheet:site-tabs   (after npm run scrape:sites)

import fs from "node:fs";
import googleSheet from "../config/google-sheet.json" with { type: "json" };
import siteConfig from "../config/sites.json" with { type: "json" };
import { getSheetsClient } from "./google-sheets-auth.mjs";

const HEADERS = ["Platform", "Bid ID", "Title", "Agency / Buyer", "Location", "Due Date", "Bid URL", "Documents URL", "Estimated Value", "Description", "Scraped At"];
const SOURCE_ROW_FORMAT = {
  backgroundColorStyle: { rgbColor: { red: 0.12, green: 0.31, blue: 0.47 } },
  textFormat: {
    bold: true,
    foregroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } },
    underline: true
  }
};
const HEADER_FORMAT = {
  backgroundColorStyle: { rgbColor: { red: 0.12, green: 0.31, blue: 0.47 } },
  textFormat: { bold: true, foregroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } } },
  horizontalAlignment: "CENTER",
  wrapStrategy: "WRAP"
};

const bids = readJson("data/raw/site-bids.json", []);
const bidsBySource = new Map();
for (const bid of bids) {
  if (!bidsBySource.has(bid.sourceId)) bidsBySource.set(bid.sourceId, []);
  bidsBySource.get(bid.sourceId).push(bid);
}

// One tab per agency: merge profiles that cover the same agency through
// different platforms (e.g. Kendall County via CivicEngage and BeaconBid).
const tabs = new Map();
for (const site of siteConfig.sites) {
  if (!site.enabled) continue;
  const title = tabTitle(site.agency);
  if (!tabs.has(title)) tabs.set(title, { sites: [], bids: [] });
  const tab = tabs.get(title);
  tab.sites.push(site);
  tab.bids.push(...(bidsBySource.get(site.id) || []));
}

const sheets = await getSheetsClient();
const meta = await sheets.spreadsheets.get({ spreadsheetId: googleSheet.spreadsheetId });
const existing = new Map(meta.data.sheets.map((sheet) => [sheet.properties.title, sheet.properties.sheetId]));

// Create any missing tabs first; collect their new sheetIds from the replies.
const missing = [...tabs.keys()].filter((title) => !existing.has(title));
if (missing.length > 0) {
  const res = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: googleSheet.spreadsheetId,
    requestBody: { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) }
  });
  for (const reply of res.data.replies) {
    existing.set(reply.addSheet.properties.title, reply.addSheet.properties.sheetId);
  }
  console.log(`Created ${missing.length} new tabs`);
}

const today = new Date().toISOString().slice(0, 10);
const requests = [];
for (const [title, tab] of tabs) {
  const sheetId = existing.get(title);
  // Row 1: the live source page(s) every bid on this tab was scraped from,
  // as clickable HYPERLINK cells.
  const sourceRow = tab.sites.map((site, index) =>
    `=HYPERLINK("${site.url}", "${index === 0 ? "Source: " : ""}${site.url}")`
  );
  const rows = [sourceRow, HEADERS];
  const sorted = tab.bids.sort((a, b) => (a.dueDate || "9999") < (b.dueDate || "9999") ? -1 : 1);
  for (const bid of sorted) {
    rows.push([
      bid.platform || "", bid.bidId || "", bid.title || "", bid.agency || "",
      bid.location || "", bid.dueDate || "", bid.bidUrl || "", bid.documentsUrl || "",
      bid.estimatedValue || "", bid.description || "", bid.scrapedAt || ""
    ]);
  }
  if (sorted.length === 0) {
    const note = tab.sites.every((site) => /Cloudflare|WAF|Akamai|Bot-protection/i.test(site.notes || ""))
      ? `Bot-protection wall - collect via real-Chrome run (last checked ${today})`
      : `No open bids as of ${today}`;
    rows.push([tab.sites[0].platform, "", note, tab.sites[0].agency, tab.sites[0].location || "", "", tab.sites[0].url, "", "", "", ""]);
  }

  requests.push(
    { updateCells: { range: { sheetId }, fields: "userEnteredValue" } },
    {
      updateCells: {
        range: { sheetId, startRowIndex: 0, startColumnIndex: 0 },
        rows: rows.map((row) => ({ values: row.map(toCell) })),
        fields: "userEnteredValue"
      }
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: HEADERS.length },
        cell: { userEnteredFormat: SOURCE_ROW_FORMAT },
        fields: "userEnteredFormat(backgroundColorStyle,textFormat)"
      }
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: HEADERS.length },
        cell: { userEnteredFormat: HEADER_FORMAT },
        fields: "userEnteredFormat(backgroundColorStyle,textFormat,horizontalAlignment,wrapStrategy)"
      }
    }
  );
}

// Sheets batchUpdate handles large request arrays, but chunk to stay well
// under the 10MB payload limit with long descriptions.
const CHUNK = 60;
for (let index = 0; index < requests.length; index += CHUNK) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: googleSheet.spreadsheetId,
    requestBody: { requests: requests.slice(index, index + CHUNK) }
  });
}

console.log(`Updated ${tabs.size} site tabs (${bids.length} bids) on ${googleSheet.spreadsheetUrl}`);

function tabTitle(agency) {
  return agency.replace(/[\[\]*?:\\\/]/g, " ").replace(/\s+/g, " ").trim().slice(0, 90);
}

function toCell(value) {
  const text = String(value ?? "");
  if (text.startsWith("=HYPERLINK(")) return { userEnteredValue: { formulaValue: text } };
  return { userEnteredValue: { stringValue: text } };
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}
