import fs from "node:fs";
import googleSheet from "../config/google-sheet.json" with { type: "json" };
import { getSheetsClient } from "./google-sheets-auth.mjs";

const sheets = await getSheetsClient();
const { data } = await sheets.spreadsheets.get({
  spreadsheetId: googleSheet.spreadsheetId,
  fields: "spreadsheetUrl,sheets.properties(sheetId,title)"
});

const metadata = {
  spreadsheetId: googleSheet.spreadsheetId,
  spreadsheetUrl: data.spreadsheetUrl,
  sheets: data.sheets
};

fs.mkdirSync("data/out", { recursive: true });
fs.writeFileSync("data/out/google-sheet-metadata.json", `${JSON.stringify(metadata)}\n`);
console.log(`Wrote metadata for ${data.sheets.length} tabs`);
