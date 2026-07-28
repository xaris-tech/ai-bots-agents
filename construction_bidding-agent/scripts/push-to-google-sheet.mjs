import fs from "node:fs";
import googleSheet from "../config/google-sheet.json" with { type: "json" };
import { getSheetsClient } from "./google-sheets-auth.mjs";

const siteTabRequests = readJson("data/out/site-tab-update-requests.json", []);
const sheetUpdateRequests = readJson("data/out/google-sheet-update-requests.json", []);
const requests = [...siteTabRequests, ...sheetUpdateRequests];

if (requests.length === 0) {
  console.error("No requests found. Run npm run sheet:requests first.");
  process.exit(1);
}

const sheets = await getSheetsClient();
await sheets.spreadsheets.batchUpdate({
  spreadsheetId: googleSheet.spreadsheetId,
  requestBody: { requests }
});

console.log(`Pushed ${requests.length} requests to ${googleSheet.spreadsheetUrl}`);

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}
