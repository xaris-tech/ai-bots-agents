// One-off cleanup: existing tasks in the "General Construction" ClickUp list
// that were created before scripts/push-clickup-tasks.mjs made list
// assignment mutually exclusive. Any task whose name/description now matches
// AGGREGATE_KEYWORDS gets moved to "Aggregates Supply" (recreated there,
// then deleted from General Construction — this plan doesn't have ClickUp's
// paid "Tasks in Multiple Lists" ClickApp, so no native move op exists).
//
// Usage:
//   node scripts/fix-clickup-categorization.mjs --dry-run   # report only
//   node scripts/fix-clickup-categorization.mjs             # actually move

import { AGGREGATE_KEYWORDS, buildKeywordPattern } from "../src/keywords.mjs";

const CLICKUP_API_TOKEN = process.env.CLICKUP_API_TOKEN;
if (!CLICKUP_API_TOKEN) throw new Error("Set CLICKUP_API_TOKEN in .env before running this script.");

const LISTS = {
  aggregates: { id: "901114103788", name: "Aggregates Supply" },
  generalConstruction: { id: "901114103789", name: "General Construction" }
};

const aggregatePattern = buildKeywordPattern(AGGREGATE_KEYWORDS);

const args = parseArgs(process.argv.slice(2));
const dryRun = Boolean(args["dry-run"]);

const tasks = await fetchAllTasks(LISTS.generalConstruction.id);
console.log(`${tasks.length} tasks in ${LISTS.generalConstruction.name}`);

const toMove = tasks.filter((task) => {
  const text = `${task.name ?? ""} ${task.description ?? task.text_content ?? ""}`;
  return aggregatePattern.test(text);
});

console.log(`${toMove.length} match AGGREGATE_KEYWORDS and should move to ${LISTS.aggregates.name}:`);
for (const task of toMove) console.log(`  - ${task.name}`);

if (dryRun) {
  console.log("\n--dry-run: no changes made.");
  process.exit(0);
}

let moved = 0;
for (const task of toMove) {
  // "Add task to list"/multi-list-membership API 403s on this plan
  // (ClickUp's "Tasks in Multiple Lists" is a paid ClickApp), so move by
  // recreating in the target list, then deleting the original outright.
  await createTaskCopy(LISTS.aggregates.id, task);
  await deleteTask(task.id);
  moved += 1;
  await delay(300); // stay well under ClickUp's rate limit
}

console.log(`\nMoved ${moved} tasks from ${LISTS.generalConstruction.name} to ${LISTS.aggregates.name}.`);

async function fetchAllTasks(listId) {
  const tasks = [];
  let page = 0;
  for (;;) {
    const response = await fetch(
      `https://api.clickup.com/api/v2/list/${listId}/task?include_closed=true&page=${page}`,
      { headers: { Authorization: CLICKUP_API_TOKEN } }
    );
    if (!response.ok) throw new Error(`ClickUp task list fetch failed (${response.status}): ${await response.text()}`);
    const payload = await response.json();
    tasks.push(...(payload.tasks ?? []));
    if (!payload.tasks || payload.tasks.length < 100) break;
    page += 1;
  }
  return tasks;
}

async function createTaskCopy(listId, task) {
  const body = {
    name: task.name,
    markdown_description: task.text_content || task.description || "",
    tags: (task.tags ?? []).map((tag) => tag.name).filter(Boolean),
    priority: task.priority?.id ? Number(task.priority.id) : undefined,
    assignees: (task.assignees ?? []).map((assignee) => assignee.id)
  };
  if (task.due_date) body.due_date = Number(task.due_date);

  const response = await fetch(`https://api.clickup.com/api/v2/list/${listId}/task`, {
    method: "POST",
    headers: { Authorization: CLICKUP_API_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`Create copy of task "${task.name}" in list ${listId} failed (${response.status}): ${await response.text()}`);
  }
}

async function deleteTask(taskId) {
  const response = await fetch(`https://api.clickup.com/api/v2/task/${taskId}`, {
    method: "DELETE",
    headers: { Authorization: CLICKUP_API_TOKEN }
  });
  if (!response.ok) {
    throw new Error(`Delete task ${taskId} failed (${response.status}): ${await response.text()}`);
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
