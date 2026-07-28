import fs from "node:fs";

const metadata = readJson("data/out/google-sheet-metadata.json", {});
const sheetIds = Object.fromEntries((metadata.sheets || []).map((sheet) => [
  sheet.properties.title,
  sheet.properties.sheetId
]));

const sources = [
  ["IonWave", "data/raw/ionwave-bids.json", "https://supplier.ionwave.net"],
  ["DemandStar", "data/raw/demandstar-bids.json", "https://www.demandstar.com/app/suppliers/bids"],
  ["Bonfire", "data/raw/bonfire-bids.json", "https://vendor.bonfirehub.com/agencies/search"],
  ["Bidnet", "data/raw/bidnet-wide-bids.json", "https://www.bidnetdirect.com/private/supplier/solicitations/search"]
];

const headers = ["Platform", "Bid ID", "Title", "Agency / Buyer", "Location", "Due Date", "Bid URL", "Documents URL", "Estimated Value", "Description", "Scraped At"];
const requests = [];

for (const [title, path, sourceUrl] of sources) {
  const sheetId = sheetIds[title];
  if (sheetId === undefined) throw new Error(`Missing sheet: ${title}`);
  const bids = readJson(path, []);
  const rows = [
    [`=HYPERLINK("${sourceUrl}", "Source: ${sourceUrl}")`],
    headers,
    ...bids.map((bid) => [
      bid.platform || "",
      bid.bidId || "",
      bid.title || "",
      bid.agency || "",
      bid.location || "",
      bid.dueDate || "",
      bid.bidUrl || "",
      bid.documentsUrl || "",
      bid.estimatedValue || "",
      bid.description || "",
      bid.scrapedAt || ""
    ])
  ];

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
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: headers.length },
        cell: {
          userEnteredFormat: {
            backgroundColorStyle: { rgbColor: { red: 0.12, green: 0.31, blue: 0.47 } },
            textFormat: {
              bold: true,
              foregroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } },
              underline: true
            }
          }
        },
        fields: "userEnteredFormat(backgroundColorStyle,textFormat)"
      }
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: headers.length },
        cell: {
          userEnteredFormat: {
            backgroundColorStyle: { rgbColor: { red: 0.12, green: 0.31, blue: 0.47 } },
            textFormat: {
              bold: true,
              foregroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } }
            },
            horizontalAlignment: "CENTER",
            wrapStrategy: "WRAP"
          }
        },
        fields: "userEnteredFormat(backgroundColorStyle,textFormat,horizontalAlignment,wrapStrategy)"
      }
    },
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 2 } },
        fields: "gridProperties.frozenRowCount"
      }
    },
    {
      setBasicFilter: {
        filter: { range: { sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: headers.length } }
      }
    }
  );
}

fs.writeFileSync("data/out/site-tab-update-requests.json", `${JSON.stringify(requests, null, 2)}\n`);
console.log(`Wrote ${requests.length} site-tab requests`);

function toCell(value) {
  if (typeof value === "number") return { userEnteredValue: { numberValue: value } };
  const text = String(value ?? "");
  if (text.startsWith("=HYPERLINK(")) return { userEnteredValue: { formulaValue: text } };
  return { userEnteredValue: { stringValue: text } };
}

function readJson(path, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}
