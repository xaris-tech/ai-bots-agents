import test from "node:test";
import assert from "node:assert/strict";
import {
  createClickUpOnboardingClient,
  formatOnboardingNotification,
  syncOnboardingTasks
} from "../../src/clickup-onboarding.mjs";

test("ClickUp client uses the task, comment, and update APIs without live requests", async () => {
  const calls = [];
  const request = async (path, init) => {
    calls.push({ path, init });
    return response(path.includes("include_closed") ? { tasks: [] } : { id: "task-1" });
  };
  const client = createClickUpOnboardingClient(request, "operations-list");
  await client.listTasks();
  await client.createTask({ name: "Example" });
  await client.commentTask("task-1", "history");
  await client.updateTask("task-1", { status: "complete" });
  assert.deepEqual(calls.map((call) => [call.path, call.init?.method]), [
    ["/api/v2/list/operations-list/task?include_closed=true&subtasks=true", undefined],
    ["/api/v2/list/operations-list/task", "POST"],
    ["/api/v2/task/task-1/comment", "POST"],
    ["/api/v2/task/task-1", "PUT"]
  ]);
  assert.deepEqual(JSON.parse(calls[2].init.body), { comment_text: "history", notify_all: false });
});

test("creates one task then appends history without duplicating it", async () => {
  const client = fakeClient([]);
  const incomplete = target("reno", false, "unresolved");
  incomplete.checkUrl = "https://example.test/reno";
  const reconciliation = report([incomplete]);
  const first = await syncOnboardingTasks({ reconciliation, client, generatedAt: "2026-08-04T12:00:00Z" });
  assert.equal(first.changes[0].type, "created");
  assert.equal(client.created.length, 1);
  assert.match(client.created[0].markdown_description, /\[Open the official source\]\(https:\/\/example\.test\/reno\)/);

  client.tasks.push({ id: "task-1", name: "[Profile Onboarding] reno", status: { status: "to do", type: "open" } });
  const second = await syncOnboardingTasks({ reconciliation, client, generatedAt: "2026-08-05T12:00:00Z" });
  assert.deepEqual(second.changes, []);
  assert.equal(client.created.length, 1);
  assert.match(client.comments.at(-1).text, /still incomplete/);
});

test("closes a recovered task with profile evidence", async () => {
  const client = fakeClient([{ id: "task-1", name: "[Profile Onboarding] reno", status: { type: "open" } }]);
  const ready = target("reno", true, "direct-profile");
  ready.profileIds = ["reno-tx"];
  const result = await syncOnboardingTasks({ reconciliation: report([ready]), client, generatedAt: "2026-08-06T12:00:00Z" });
  assert.equal(result.changes[0].type, "resolved");
  assert.deepEqual(client.updates[0], { id: "task-1", body: { status: "complete" } });
  assert.match(client.comments[0].text, /profile reno-tx/);
});

test("reopens a closed task when coverage regresses", async () => {
  const client = fakeClient([{ id: "task-1", name: "[Profile Onboarding] reno", status: { type: "closed", status: "complete" } }]);
  const result = await syncOnboardingTasks({ reconciliation: report([target("reno", false, "blocked")]), client });
  assert.equal(result.changes[0].type, "reopened");
  assert.deepEqual(client.updates[0], { id: "task-1", body: { status: "to do" } });
});

test("closes duplicate open tasks so one actionable task remains", async () => {
  const client = fakeClient([
    { id: "task-1", name: "[Profile Onboarding] reno", status: { type: "open" } },
    { id: "task-2", name: "[Profile Onboarding] reno", status: { type: "open" } }
  ]);
  const result = await syncOnboardingTasks({ reconciliation: report([target("reno", false, "unresolved")]), client });
  assert.equal(result.changes[0].type, "deduplicated");
  assert.deepEqual(client.updates[0], { id: "task-2", body: { status: "complete" } });
  assert.equal(client.created.length, 0);
});

test("closes each legacy duplicate exactly once when a target recovers", async () => {
  const client = fakeClient([
    { id: "task-1", name: "[Profile Onboarding] reno", status: { type: "open" } },
    { id: "task-2", name: "[Profile Onboarding] reno", status: { type: "open" } }
  ]);
  const result = await syncOnboardingTasks({ reconciliation: report([target("reno", true, "batch-owned")]), client });
  assert.deepEqual(result.changes.map((change) => change.type), ["resolved", "resolved"]);
  assert.deepEqual(client.updates.map((update) => update.id), ["task-1", "task-2"]);
});

test("closes onboarding work when workbook drift removes the target", async () => {
  const client = fakeClient([
    { id: "task-1", name: "[Profile Onboarding] removed entity", status: { type: "open" } }
  ]);
  const result = await syncOnboardingTasks({ reconciliation: report([]), client });
  assert.equal(result.changes[0].type, "resolved");
  assert.match(client.comments[0].text, /no longer in the Target Entity Universe/);
  assert.deepEqual(client.updates[0], { id: "task-1", body: { status: "complete" } });
});

test("formats coverage changes separately from runtime incidents", () => {
  const message = formatOnboardingNotification({
    incompleteCount: 1,
    changes: [{ type: "created", entity: "Reno", taskId: "task-1" }]
  }, { ready: 138, total: 139, percent: 99.28 });
  assert.match(message, /^# Profile Onboarding Changes/);
  assert.match(message, /Created.*Reno/);
  assert.doesNotMatch(message, /Scraper Incident/);
});

function target(normalizedName, ready, disposition) {
  return {
    name: normalizedName[0].toUpperCase() + normalizedName.slice(1),
    normalizedName,
    ready,
    disposition,
    profileIds: [],
    sourceReferences: [{ tab: "Main" }]
  };
}

function report(targets) {
  return { targets, coverage: { ready: targets.filter((item) => item.ready).length, total: targets.length, percent: 0 } };
}

function fakeClient(tasks) {
  return {
    tasks,
    created: [],
    comments: [],
    updates: [],
    async listTasks() { return this.tasks; },
    async createTask(body) { this.created.push(body); return { id: `created-${this.created.length}` }; },
    async commentTask(id, text) { this.comments.push({ id, text }); },
    async updateTask(id, body) { this.updates.push({ id, body }); }
  };
}

function response(payload) {
  return { ok: true, status: 200, async json() { return payload; }, async text() { return ""; } };
}
