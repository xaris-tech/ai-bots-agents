import fs from "node:fs";
import siteConfig from "../config/sites.json" with { type: "json" };
import {
  AGGREGATE_KEYWORDS,
  GENERAL_CONSTRUCTION_KEYWORDS,
  buildKeywordPattern
} from "../src/keywords.mjs";
import {
  buildMonitorSnapshot,
  buildOperationsReport,
  formatDailyNotification,
  formatHumanReview
} from "../src/scraper-operations.mjs";
import {
  createClickUpOnboardingClient,
  formatOnboardingNotification,
  syncOnboardingTasks
} from "../src/clickup-onboarding.mjs";

const WORKSPACE_ID = process.env.CLICKUP_WORKSPACE_ID || "9011646920";
const NOTIFICATIONS_CHANNEL_ID = process.env.CLICKUP_NOTIFICATIONS_CHANNEL_ID || "8cj5me8-631";
const REVIEWS_CHANNEL_ID = process.env.CLICKUP_REVIEWS_CHANNEL_ID || "8cj5me8-671";
const OPERATIONS_LIST_ID = process.env.CLICKUP_SCRAPER_OPERATIONS_LIST_ID || "901114263533";
const args = new Set(process.argv.slice(2));
const send = args.has("--send");
const tasksOnly = args.has("--tasks-only");

const siteReport = readJson("data/out/site-scrape-report.json", []);
const siteBids = readJson("data/raw/site-bids.json", []);
const allBids = readJson("data/raw/bids.json", siteBids);
const monitor = buildMonitorSnapshot(siteConfig.sites, siteReport, siteBids, fileTimestamp("data/out/site-scrape-report.json"));
const aggregatePattern = buildKeywordPattern(AGGREGATE_KEYWORDS);
const constructionPattern = buildKeywordPattern(GENERAL_CONSTRUCTION_KEYWORDS);
const pipelineErrors = readPipelineErrors(process.env.SCRAPER_PIPELINE_ERRORS);
const reconciliation = readJson("data/out/target-entity-reconciliation.json", null);
const report = buildOperationsReport(monitor, {
  bids: allBids,
  categorize: classifyOpportunity,
  pipelineErrors,
  reconciliation
});
const notification = formatDailyNotification(report);
const humanReview = formatHumanReview(report);

fs.mkdirSync("data/out", { recursive: true });
fs.writeFileSync("data/out/scraper-operations-report.json", `${JSON.stringify(report, null, 2)}\n`);

if (!send) {
  console.log("DRY RUN — add --send to post to ClickUp\n");
  console.log(notification);
  if (humanReview) console.log(`\n--- Reviews channel ---\n${humanReview}`);
  process.exit(0);
}

const token = process.env.CLICKUP_API_TOKEN;
if (!token) throw new Error("CLICKUP_API_TOKEN is required with --send.");

if (!tasksOnly) {
  await postChatMessage(NOTIFICATIONS_CHANNEL_ID, notification);
  if (humanReview) await postChatMessage(REVIEWS_CHANNEL_ID, humanReview);
}
await syncEntityIncidents(report);
const onboarding = await syncOnboardingTasks({
  reconciliation,
  client: createClickUpOnboardingClient(clickupFetch, OPERATIONS_LIST_ID)
});
const onboardingNotification = formatOnboardingNotification(onboarding, reconciliation.coverage);
if (!tasksOnly && onboardingNotification) await postChatMessage(NOTIFICATIONS_CHANNEL_ID, onboardingNotification);
console.log(tasksOnly
  ? "Synchronized scraper incident and profile onboarding tasks in ClickUp."
  : `Posted daily update${humanReview ? " and Human Review" : ""} to ClickUp.`);

async function postChatMessage(channelId, content) {
  const response = await clickupFetch(
    `/api/v3/workspaces/${WORKSPACE_ID}/chat/channels/${channelId}/messages`,
    { method: "POST", body: JSON.stringify({ type: "message", content, content_format: "text/md" }) }
  );
  if (response.status !== 201) throw new Error(`ClickUp Chat post failed (${response.status}): ${await response.text()}`);
}

async function syncEntityIncidents(current) {
  const existing = await fetchIncidentTasks();
  const failedIds = new Set(current.failures.map((failure) => failure.sourceId));
  for (const failure of current.failures) {
    const task = existing.get(failure.sourceId);
    const note = `${current.generatedAt}: ${failure.blockKind || failure.status} — ${failure.warning || "Needs human review"}`;
    const desiredStatus = failure.status === "blocked" ? "blocked / no workaround" : "to do";
    if (task) {
      await addTaskComment(task.id, note);
      await updateTask(task.id, {
        status: desiredStatus,
        markdown_description: incidentDescription(failure, note)
      });
    } else {
      await createIncident(failure, note);
    }
  }
  for (const [sourceId, task] of existing) {
    if (failedIds.has(sourceId) || task.status?.type === "closed") continue;
    await addTaskComment(task.id, `${current.generatedAt}: verified scrape recovered; closing incident.`);
    await updateTask(task.id, { status: "complete" });
  }
}

async function fetchIncidentTasks() {
  const response = await clickupFetch(`/api/v2/list/${OPERATIONS_LIST_ID}/task?include_closed=true&subtasks=true`);
  if (!response.ok) throw new Error(`ClickUp incident fetch failed (${response.status}): ${await response.text()}`);
  const payload = await response.json();
  const tasks = new Map();
  for (const task of payload.tasks ?? []) {
    const match = task.name?.match(/^\[Scraper Incident\] (.+)$/);
    if (match) tasks.set(match[1], task);
  }
  return tasks;
}

async function createIncident(failure, note) {
  const response = await clickupFetch(`/api/v2/list/${OPERATIONS_LIST_ID}/task`, {
    method: "POST",
    body: JSON.stringify({
      name: `[Scraper Incident] ${failure.sourceId}`,
      markdown_description: incidentDescription(failure, note),
      priority: 2,
      tags: ["scraper-incident", failure.blockKind || failure.status]
    })
  });
  if (!response.ok) throw new Error(`ClickUp incident create failed (${response.status}): ${await response.text()}`);
}

function incidentDescription(failure, note) {
  return [
    `**Entity:** ${failure.agency}`,
    `**Source ID:** ${failure.sourceId}`,
    `**Failure:** ${failure.blockKind || failure.status}`,
    failure.checkUrl ? `**Check source:** [Open the official procurement page](${failure.checkUrl})` : "",
    "",
    note
  ].filter(Boolean).join("\n");
}

async function addTaskComment(taskId, comment_text) {
  const response = await clickupFetch(`/api/v2/task/${taskId}/comment`, {
    method: "POST",
    body: JSON.stringify({ comment_text, notify_all: false })
  });
  if (!response.ok) throw new Error(`ClickUp incident comment failed (${response.status}): ${await response.text()}`);
}

async function updateTask(taskId, body) {
  const response = await clickupFetch(`/api/v2/task/${taskId}`, { method: "PUT", body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`ClickUp incident update failed (${response.status}): ${await response.text()}`);
}

function clickupFetch(path, init = {}) {
  return fetch(`https://api.clickup.com${path}`, {
    ...init,
    headers: { Authorization: token, "Content-Type": "application/json", ...(init.headers ?? {}) }
  });
}

function readJson(path, fallback) {
  try { return JSON.parse(fs.readFileSync(path, "utf8")); }
  catch { return fallback; }
}

function fileTimestamp(path) {
  try { return fs.statSync(path).mtime.toISOString(); }
  catch { return new Date(0).toISOString(); }
}

function classifyOpportunity(bid) {
  const text = `${bid.title ?? ""} ${bid.description ?? ""}`;
  const aggregate = aggregatePattern.test(text);
  const construction = constructionPattern.test(text);
  if (aggregate && construction) return "both";
  if (aggregate) return "aggregate";
  if (construction) return "construction";
  return "neither";
}

function readPipelineErrors(value) {
  if (!value) return [];
  try { return JSON.parse(value); }
  catch { return [{ step: "scheduler", exitCode: 1 }]; }
}
