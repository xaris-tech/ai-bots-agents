// Filters the combined bid feed against the client's keyword lists and creates
// any missing tasks on the single "Prospects" board (Bid Opportunities space).
// Both aggregate-material and general-construction matches now land on one
// board; "other" bids (pest control, towing, etc.) are still filtered out.
// The bid's category is still recorded in the task description for reference.

import fs from "node:fs";
import crypto from "node:crypto";
import { categorizeBid, dedupeKey, formatClickUpDescription, scoreBid } from "../src/bids.mjs";
import { hasUsableDescription } from "../src/description-quality.mjs";
import {
  classifyClickUpMatch,
  matchesClickUpKeywords
} from "../src/keywords.mjs";

const CLICKUP_API_TOKEN = process.env.CLICKUP_API_TOKEN;
if (!CLICKUP_API_TOKEN) throw new Error("Set CLICKUP_API_TOKEN in .env before running this script.");

const ASSIGNEE_ID = Number(process.env.CLICKUP_DEFAULT_ASSIGNEE_ID || 114218682); // Eric Robb

// Single consolidated board. (The old two-list split, Aggregates Supply
// 901114103788 / General Construction 901114103789, was merged into Prospects.)
const PROSPECTS = { id: "901114103788", name: "Prospects" };

const args = parseArgs(process.argv.slice(2));
const dryRun = Boolean(args["dry-run"]);
const updateExisting = Boolean(args["update-existing"]);
const onlyExisting = Boolean(args["only-existing"]);
const updateAllExisting = Boolean(args["update-all-existing"]);
const maxUpdates = Number(args["max-updates"] || Number.POSITIVE_INFINITY);
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
  if (matchesClickUpKeywords(text)) matches.push(bid);
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
let updated = 0;
let skipped = 0;
const {
  names: existingByName,
  dedupeTags: existingByDedupeTag,
  tasks: existingTasks
} = await fetchExistingTasks(PROSPECTS.id);
console.log(`\n${PROSPECTS.name}: ${existingByName.size} existing tasks`);
const updatedTaskIds = new Set();

for (const bid of matches) {
  const name = taskName(bid);
  const tag = dedupeTag(bid);
  // Name match covers tasks created before the dedupe tag existed; the tag
  // match is what actually survives an agency string formatted differently
  // across sources (same bug already fixed for the internal bid dedupe —
  // see dedupeKey in src/bids.mjs, which this tag is built from).
  const existingTask = existingByName.get(name)
    || existingByDedupeTag.get(tag)
    || uniqueTaskWithTitle(existingTasks, bid.title);
  if (existingTask) {
    if (updateExisting) {
      if (updateAllExisting && /^Source:/m.test(String(existingTask.description ?? ""))) {
        skipped += 1;
      } else {
        await updateTaskDescription(existingTask, bid);
        updatedTaskIds.add(existingTask.id);
        updated += 1;
        if (updated % 10 === 0) console.log(`Updated ${updated} existing tasks...`);
        await delay(100);
      }
    } else {
      skipped += 1;
    }
    continue;
  }
  if (onlyExisting) {
    skipped += 1;
    continue;
  }
  await createTask(PROSPECTS.id, bid, tag);
  const createdTask = { id: "", name };
  existingByName.set(name, createdTask);
  existingByDedupeTag.set(tag, createdTask);
  created += 1;
  await delay(300); // stay well under ClickUp's rate limit
}

if (updateAllExisting) {
  for (const task of existingTasks) {
    if (updated >= maxUpdates) break;
    if (updatedTaskIds.has(task.id) || /^Source:/m.test(String(task.description ?? ""))) continue;
    await updateTaskMarkdown(task.id, formatLegacyTaskDescription(task));
    updated += 1;
    if (updated % 10 === 0) console.log(`Updated ${updated} existing tasks...`);
    await delay(100);
  }
}

console.log(`\nCreated ${created}, updated ${updated}, skipped ${skipped} tasks on ${PROSPECTS.name}.`);

fs.mkdirSync("data/out", { recursive: true });
fs.writeFileSync(
  "data/out/clickup-push-report.json",
  `${JSON.stringify({
    totalBids: bids.length,
    matched: matches.length,
    created,
    updated,
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

function uniqueTaskWithTitle(tasks, title) {
  const prefix = `${String(title || "").trim()} - `;
  if (prefix === " - ") return null;
  const matches = tasks.filter((task) => String(task.name || "").startsWith(prefix));
  return matches.length === 1 ? matches[0] : null;
}

// Same signature as the internal bid dedupe (platform/bidId/title/dueDate,
// no agency), hashed down to a short tag ClickUp can store on the task.
function dedupeTag(bid) {
  const hash = crypto.createHash("sha1").update(dedupeKey(bid)).digest("hex").slice(0, 12);
  return `dedupe-${hash}`;
}

async function fetchExistingTasks(listId) {
  const names = new Map();
  const dedupeTags = new Map();
  const tasks = [];
  let page = 0;
  for (;;) {
    const response = await fetch(
      `https://api.clickup.com/api/v2/list/${listId}/task?include_closed=true&page=${page}`,
      { headers: { Authorization: CLICKUP_API_TOKEN } }
    );
    if (!response.ok) throw new Error(`ClickUp task list fetch failed (${response.status}): ${await response.text()}`);
    const payload = await response.json();
    for (const task of payload.tasks ?? []) {
      tasks.push(task);
      names.set(task.name, task);
      for (const tag of task.tags ?? []) {
        if (tag.name?.startsWith("dedupe-")) dedupeTags.set(tag.name, task);
      }
    }
    if (!payload.tasks || payload.tasks.length < 100) break;
    page += 1;
  }
  return { names, dedupeTags, tasks };
}

async function createTask(listId, bid, dedupeTagValue) {
  const category = classifyClickUpMatch(`${bid.title ?? ""} ${bid.description ?? ""}`) || categorizeBid(bid);
  const fitScore = scoreBid({ ...bid, category });
  const dueDateMs = bid.dueDate ? Date.parse(`${bid.dueDate}T00:00:00Z`) : undefined;

  const body = {
    name: taskName(bid),
    markdown_description: formatClickUpDescription(bid, category),
    status: category === "Aggregates" ? "aggregates" : "construction",
    tags: [
      bid.platform,
      dedupeTagValue,
      ...(!hasUsableDescription(bid) ? ["needs-description"] : [])
    ].filter(Boolean),
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

async function updateTaskDescription(task, bid) {
  const category = classifyClickUpMatch(`${bid.title ?? ""} ${bid.description ?? ""}`) || categorizeBid(bid);
  const currentStatus = String(task.status?.status || "").toLowerCase();
  const fields = { markdown_description: formatClickUpDescription(bid, category) };
  if (["aggregates", "construction"].includes(currentStatus)) {
    fields.status = category === "Aggregates" ? "aggregates" : "construction";
  }
  return updateTaskFields(task.id, fields);
}

async function updateTaskMarkdown(taskId, markdownDescription) {
  return updateTaskFields(taskId, { markdown_description: markdownDescription });
}

async function updateTaskFields(taskId, fields) {
  const response = await fetch(`https://api.clickup.com/api/v2/task/${taskId}`, {
    method: "PUT",
    headers: { Authorization: CLICKUP_API_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(fields)
  });
  if (!response.ok) {
    throw new Error(`ClickUp task update failed for task ${taskId} (${response.status}): ${await response.text()}`);
  }
}

function formatLegacyTaskDescription(task) {
  const description = String(task.description ?? "");
  const source = descriptionField(description, "Source Platform")
    || descriptionField(description, "Platform")
    || "N/A";
  const category = descriptionField(description, "Category") || "Other";
  const agency = descriptionField(description, "Agency / Buyer")
    || descriptionField(description, "Agency");
  const projectName = descriptionField(description, "Project Name")
    || legacyProjectName(task.name, agency);
  const directDescription = descriptionField(description, "Description");
  const what = descriptionField(description, "What the Bid Is About");
  const scope = descriptionField(description, "Purpose / Scope");
  const brief = directDescription
    || [what, scope].filter(Boolean).join(what && scope ? ": " : "")
    || "No project description was provided by the source.";
  const dueDate = descriptionField(description, "Due Date")
    || clickUpDueDate(task.due_date)
    || "N/A";

  return [
    `**Source:** ${source}`,
    `**Category:** ${category}`,
    "",
    `## ${projectName}`,
    "",
    brief,
    "",
    `**Location:** ${descriptionField(description, "Location") || agency || "N/A"}`,
    `**Due Date:** ${dueDate}`,
    `**URL:** ${descriptionField(description, "Bid URL") || descriptionField(description, "Bid Link") || "N/A"}`
  ].join("\n");
}

function descriptionField(description, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return description.match(new RegExp(`^${escaped}:\\s*(.+)$`, "mi"))?.[1]?.trim() || "";
}

function legacyProjectName(name, agency) {
  const suffix = agency ? ` - ${agency.replace(/,?\s+TX$/i, "")}` : "";
  if (suffix && name.endsWith(suffix)) return name.slice(0, -suffix.length);
  const separator = name.lastIndexOf(" - ");
  return separator > 0 ? name.slice(0, separator) : name || "Untitled project";
}

function clickUpDueDate(value) {
  const milliseconds = Number(value);
  return Number.isFinite(milliseconds) && milliseconds > 0
    ? new Date(milliseconds).toISOString().slice(0, 10)
    : "";
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
