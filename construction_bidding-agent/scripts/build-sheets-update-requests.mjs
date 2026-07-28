import fs from "node:fs";

const rawBids = readJson(process.env.RAW_BIDS_PATH || "data/raw/bids.json", []);
const tasks = readJson(process.env.CLICKUP_TASKS_PATH || "data/out/clickup-review-tasks.json", []);
const report = readJson(process.env.SCRAPE_REPORT_INPUT_PATH || "data/out/scrape-report.json", []);
const metadata = readJson("data/out/google-sheet-metadata.json", {});

const sheetIds = Object.fromEntries((metadata.sheets || []).map((sheet) => [
  sheet.properties.title,
  sheet.properties.sheetId
]));

const requests = [
  ...replaceSheet("Summary", summaryRows(rawBids, tasks, report)),
  ...replaceSheet("Bids", bidRows(rawBids)),
  ...replaceSheet("Scrape Report", reportRows(report)),
  ...replaceSheet("ClickUp Tasks", taskRows(tasks))
];

fs.writeFileSync("data/out/google-sheet-update-requests.json", `${JSON.stringify(requests, null, 2)}\n`);
console.log(`Wrote ${requests.length} update requests`);

function replaceSheet(title, rows) {
  const sheetId = sheetIds[title];
  if (sheetId === undefined) throw new Error(`Missing sheet in metadata: ${title}`);
  return [
    {
      updateCells: {
        range: { sheetId },
        fields: "userEnteredValue"
      }
    },
    {
      updateCells: {
        range: {
          sheetId,
          startRowIndex: 0,
          startColumnIndex: 0
        },
        rows: rows.map((row) => ({
          values: row.map(toCell)
        })),
        fields: "userEnteredValue"
      }
    }
  ];
}

function summaryRows(rawBids, tasks, report) {
  const blockers = report.filter((item) => item.warning);
  return [
    ["Cortex Bid Intake"],
    [],
    ["Metric", "Value", "", "Portal", "Current Blocker / Note"],
    ["Generated At", new Date().toISOString(), "", blockers[0]?.platform || "", blockers[0]?.warning || ""],
    ["Raw Bids Found", rawBids.length, "", blockers[1]?.platform || "", blockers[1]?.warning || ""],
    ["ClickUp-Ready Tasks", tasks.length, "", blockers[2]?.platform || "", blockers[2]?.warning || ""],
    ["Portals Checked", report.length],
    ["Status", tasks.length > 0 ? "Bids ready for review" : "Login required before bid extraction"]
  ];
}

function bidRows(rawBids) {
  return [
    ["Platform", "Bid ID", "Title", "Agency / Buyer", "Location", "Due Date", "Bid URL", "Documents URL", "Estimated Value", "Description", "Scraped At"],
    ...rawBids.map((bid) => [
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
}

function reportRows(report) {
  return [
    ["Platform", "Count", "Warning", "Debug Text"],
    ...report.map((item) => [item.platform || "", item.count ?? 0, item.warning || "", item.debugText || ""])
  ];
}

function taskRows(tasks) {
  return [
    ["Dedupe Key", "Task Name", "Priority", "Due Date", "Tags", "Markdown Description"],
    ...tasks.map((item) => [
      item.dedupeKey || "",
      item.clickupTask?.name || "",
      item.clickupTask?.priority || "",
      item.clickupTask?.due_date || "",
      (item.clickupTask?.tags || []).join(", "),
      item.clickupTask?.markdown_description || ""
    ])
  ];
}

function toCell(value) {
  if (typeof value === "number") return { userEnteredValue: { numberValue: value } };
  if (typeof value === "boolean") return { userEnteredValue: { boolValue: value } };
  return { userEnteredValue: { stringValue: String(value ?? "") } };
}

function readJson(path, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}
