import fs from "node:fs";
import path from "node:path";
import { categorizeBid, dedupeKey, scoreBid, toClickUpTask } from "../src/bids.mjs";

const inputPath = process.argv[2] || "data/raw/bids.json";
const outputPath = process.argv[3] || "data/out/clickup-review-tasks.json";

if (!fs.existsSync(inputPath)) {
  console.error(`Missing input: ${inputPath}`);
  console.error("Expected JSON array of bid objects from portal extraction.");
  process.exit(1);
}

const bids = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const seen = new Set();
const tasks = [];

for (const bid of bids) {
  const category = bid.category || categorizeBid(bid);
  const normalized = {
    ...bid,
    category,
    fitScore: bid.fitScore ?? scoreBid({ ...bid, category })
  };
  const key = dedupeKey(normalized);
  if (seen.has(key)) continue;
  seen.add(key);
  tasks.push({
    dedupeKey: key,
    source: normalized,
    clickupTask: toClickUpTask(normalized)
  });
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(tasks, null, 2)}\n`);
console.log(`Wrote ${tasks.length} ClickUp review tasks to ${outputPath}`);
