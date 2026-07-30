// Filters the combined bid feed against the client's keyword lists and creates
// any missing tasks on the single "Prospects" board (Bid Opportunities space).
// Both aggregate-material and general-construction matches now land on one
// board; "other" bids (pest control, towing, etc.) are still filtered out.
// The bid's category is still recorded in the task description for reference.

import fs from "node:fs";
import crypto from "node:crypto";
import { categorizeBid, scoreBid, dedupeKey } from "../src/bids.mjs";
import {
  AGGREGATE_KEYWORDS,
  GENERAL_CONSTRUCTION_KEYWORDS,
  CONSTRUCTION_CONTEXT_KEYWORDS,
  buildKeywordPattern
} from "../src/keywords.mjs";

const CLICKUP_API_TOKEN = process.env.CLICKUP_API_TOKEN;
if (!CLICKUP_API_TOKEN) throw new Error("Set CLICKUP_API_TOKEN in .env before running this script.");

const ASSIGNEE_ID = Number(process.env.CLICKUP_DEFAULT_ASSIGNEE_ID || 114218682); // Eric Robb

// Single consolidated board. (The old two-list split, Aggregates Supply
// 901114103788 / General Construction 901114103789, was merged into Prospects.)
const PROSPECTS = { id: "901114103788", name: "Prospects" };

const generalConstructionPattern = buildKeywordPattern(GENERAL_CONSTRUCTION_KEYWORDS);
const aggregatePattern = buildKeywordPattern(AGGREGATE_KEYWORDS);
const constructionContextPattern = buildKeywordPattern(CONSTRUCTION_CONTEXT_KEYWORDS);

const args = parseArgs(process.argv.slice(2));
const dryRun = Boolean(args["dry-run"]);
const inputPath = args.input || "data/raw/bids.json";
// ClickUp is a Texas-only board. The BidNet nationwide aggregate sweep
// (data/raw/bidnet-wide-bids.json) pulls in out-of-state opportunities
// (Colorado, New York, Michigan, ...) that must NOT land on ClickUp. Those
// rows carry a bare US state name in `location`; every other source is
// Texas-by-construction and uses a city/county/agency there instead (e.g.
// "Colorado County, TX" stays because it isn't the bare word "Colorado").
// Pass --all-states to disable this and push nationwide.
const texasOnly = !args["all-states"];
const NON_TEXAS_STATES = new Set([
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut",
  "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa",
  "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan",
  "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada",
  "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina",
  "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island",
  "South Carolina", "South Dakota", "Tennessee", "Utah", "Vermont", "Virginia",
  "Washington", "West Virginia", "Wisconsin", "Wyoming"
]);

const allBids = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const bids = texasOnly
  ? allBids.filter((bid) => !NON_TEXAS_STATES.has(String(bid.location ?? "").trim()))
  : allBids;
if (texasOnly && bids.length < allBids.length) {
  console.log(`Texas-only: dropped ${allBids.length - bids.length} out-of-state bids (use --all-states to include).`);
}

// Keep only construction/aggregate-relevant bids (either keyword family);
// everything else ("other" — pest control, towing, scrap metal, ...) is skipped.
const matches = [];
for (const bid of bids) {
  const text = `${bid.title ?? ""} ${bid.description ?? ""}`;
  if (aggregatePattern.test(text) || generalConstructionPattern.test(text)) matches.push(bid);
}

console.log(`${bids.length} total bids in ${inputPath}`);
console.log(`Prospects matches (aggregate or general construction): ${matches.length}`);

if (dryRun) {
  console.log("\n--dry-run: no tasks created. Sample matches:");
  for (const bid of matches.slice(0, 15)) {
    console.log(`  - ${taskName(bid)}`);
  }
  process.exit(0);
}

let created = 0;
let skipped = 0;
const { names: existingNames, dedupeTags: existingDedupeTags } = await fetchExistingTasks(PROSPECTS.id);
console.log(`\n${PROSPECTS.name}: ${existingNames.size} existing tasks`);

for (const bid of matches) {
  const name = taskName(bid);
  const tag = dedupeTag(bid);
  // Name match covers tasks created before the dedupe tag existed; the tag
  // match is what actually survives an agency string formatted differently
  // across sources (same bug already fixed for the internal bid dedupe —
  // see dedupeKey in src/bids.mjs, which this tag is built from).
  if (existingNames.has(name) || existingDedupeTags.has(tag)) {
    skipped += 1;
    continue;
  }
  await createTask(PROSPECTS.id, bid, tag);
  existingNames.add(name);
  existingDedupeTags.add(tag);
  created += 1;
  await delay(300); // stay well under ClickUp's rate limit
}

console.log(`\nCreated ${created} tasks on ${PROSPECTS.name}, skipped ${skipped} already-existing.`);

fs.mkdirSync("data/out", { recursive: true });
fs.writeFileSync(
  "data/out/clickup-push-report.json",
  `${JSON.stringify({
    totalBids: bids.length,
    matched: matches.length,
    created,
    skipped,
    list: { id: PROSPECTS.id, name: PROSPECTS.name, url: listUrl(PROSPECTS.id) }
  }, null, 2)}\n`
);

function listUrl(listId) {
  return `https://app.clickup.com/${process.env.CLICKUP_WORKSPACE_ID || "9011646920"}/v/li/${listId}`;
}

function taskName(bid) {
  return `${bid.title} - ${bid.agency}`;
}

// Same signature as the internal bid dedupe (platform/bidId/title/dueDate,
// no agency), hashed down to a short tag ClickUp can store on the task.
function dedupeTag(bid) {
  const hash = crypto.createHash("sha1").update(dedupeKey(bid)).digest("hex").slice(0, 12);
  return `dedupe-${hash}`;
}

async function fetchExistingTasks(listId) {
  const names = new Set();
  const dedupeTags = new Set();
  let page = 0;
  for (;;) {
    const response = await fetch(
      `https://api.clickup.com/api/v2/list/${listId}/task?include_closed=true&page=${page}`,
      { headers: { Authorization: CLICKUP_API_TOKEN } }
    );
    if (!response.ok) throw new Error(`ClickUp task list fetch failed (${response.status}): ${await response.text()}`);
    const payload = await response.json();
    for (const task of payload.tasks ?? []) {
      names.add(task.name);
      for (const tag of task.tags ?? []) {
        if (tag.name?.startsWith("dedupe-")) dedupeTags.add(tag.name);
      }
    }
    if (!payload.tasks || payload.tasks.length < 100) break;
    page += 1;
  }
  return { names, dedupeTags };
}

async function createTask(listId, bid, dedupeTagValue) {
  const category = categorizeBid(bid);
  const fitScore = scoreBid({ ...bid, category });
  const dueDateMs = bid.dueDate ? Date.parse(`${bid.dueDate}T00:00:00Z`) : undefined;

  const body = {
    name: taskName(bid),
    markdown_description: [
      `**Source Platform:** ${bid.platform}`,
      `**Category:** ${category}`,
      `**Agency / Buyer:** ${bid.agency || ""}`,
      `**Project Name:** ${bid.title || ""}`,
      `**Location:** ${bid.location || ""}`,
      `**Due Date:** ${bid.dueDate || ""}`,
      `**Bid URL:** ${bid.bidUrl || ""}`,
      `**Documents URL / Drive Folder:** ${bid.documentsUrl || ""}`,
      `**Estimated Value:** ${bid.estimatedValue || ""}`,
      `**Fit Score:** ${fitScore}`,
      `**CEO Decision:** Pending`,
      `**Last Checked At:** ${bid.scrapedAt || new Date().toISOString()}`
    ].join("\n"),
    tags: [bid.platform, dedupeTagValue].filter(Boolean),
    priority: fitScore >= 80 ? 2 : fitScore >= 55 ? 3 : 4,
    assignees: [ASSIGNEE_ID]
  };
  if (Number.isFinite(dueDateMs)) body.due_date = dueDateMs;

  const response = await fetch(`https://api.clickup.com/api/v2/list/${listId}/task`, {
    method: "POST",
    headers: { Authorization: CLICKUP_API_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`ClickUp task create failed for "${body.name}" (${response.status}): ${await response.text()}`);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    if (!values[index].startsWith("--")) continue;
    const key = values[index].slice(2);
    parsed[key] = values[index + 1] && !values[index + 1].startsWith("--") ? values[++index] : true;
  }
  return parsed;
}
