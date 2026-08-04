import fs from "node:fs";
import { spawnSync } from "node:child_process";

const force = process.argv.includes("--force");
const statePath = "data/out/daily-scraper-state.json";
const parts = Object.fromEntries(
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23"
  }).formatToParts().filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
);
const texasDate = `${parts.year}-${parts.month}-${parts.day}`;
const texasHour = Number(parts.hour);
const state = readJson(statePath, {});

if (!force && texasHour !== 7) process.exit(0);
if (!force && state.lastAttemptedTexasDate === texasDate) process.exit(0);

writeJson(statePath, { ...state, lastAttemptedTexasDate: texasDate, startedAt: new Date().toISOString() });

const steps = ["targets:reconcile", "scrape:sites", "scrape:cloudflare", "scrape:bids", "combine:bids"];
const pipelineErrors = [];
for (const step of steps) {
  const result = spawnSync("/opt/homebrew/bin/npm", ["run", step], { stdio: "inherit", env: process.env });
  if (result.status !== 0) pipelineErrors.push({ step, exitCode: result.status ?? 1 });
}

const notify = spawnSync("/opt/homebrew/bin/npm", ["run", "scraper:notify"], {
  stdio: "inherit",
  env: { ...process.env, SCRAPER_PIPELINE_ERRORS: JSON.stringify(pipelineErrors) }
});
if (notify.status !== 0) pipelineErrors.push({ step: "scraper:notify", exitCode: notify.status ?? 1 });

writeJson(statePath, {
  lastAttemptedTexasDate: texasDate,
  finishedAt: new Date().toISOString(),
  successful: pipelineErrors.length === 0,
  pipelineErrors
});
process.exitCode = pipelineErrors.length ? 1 : 0;

function readJson(path, fallback) {
  try { return JSON.parse(fs.readFileSync(path, "utf8")); }
  catch { return fallback; }
}

function writeJson(path, value) {
  fs.mkdirSync("data/out", { recursive: true });
  fs.writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
