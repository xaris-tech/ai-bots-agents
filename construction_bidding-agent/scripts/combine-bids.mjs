import fs from "node:fs";
import path from "node:path";
import { dedupeBids } from "../src/site-runner.mjs";

const sources = [
  "data/raw/bonfire-bids.json",
  "data/raw/demandstar-bids.json",
  "data/raw/ionwave-bids.json",
  "data/raw/site-bids.json",
  "data/raw/bidnet-wide-bids.json"
];

const reportSources = [
  "data/out/scrape-report.json",
  "data/out/site-scrape-report.json"
];

const outputPath = process.argv[2] || "data/raw/bids.json";
const reportOutputPath = process.argv[3] || "data/out/scrape-report.json";

const combined = dedupeBids(sources.flatMap((filePath) => readJsonArray(filePath)));
const report = reportSources.flatMap((filePath) => readJsonArray(filePath));

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(combined, null, 2)}\n`);

fs.mkdirSync(path.dirname(reportOutputPath), { recursive: true });
fs.writeFileSync(reportOutputPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(`Combined ${combined.length} bids from ${sources.length} sources into ${outputPath}`);
console.log(`Combined ${report.length} report rows into ${reportOutputPath}`);

function readJsonArray(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
