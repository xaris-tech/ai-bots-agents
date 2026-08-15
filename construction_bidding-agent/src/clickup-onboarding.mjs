const TASK_PREFIX = "[Profile Onboarding] ";

export function createClickUpOnboardingClient(request, listId) {
  async function checked(path, init, action) {
    const response = await request(path, init);
    if (!response.ok) throw new Error(`ClickUp onboarding ${action} failed (${response.status}): ${await response.text()}`);
    return response;
  }
  return {
    async listTasks() {
      const response = await checked(`/api/v2/list/${listId}/task?include_closed=true&subtasks=true`, undefined, "fetch");
      return (await response.json()).tasks ?? [];
    },
    async createTask(body) {
      const response = await checked(`/api/v2/list/${listId}/task`, {
        method: "POST", body: JSON.stringify(body)
      }, "create");
      return response.json();
    },
    async commentTask(taskId, comment_text) {
      await checked(`/api/v2/task/${taskId}/comment`, {
        method: "POST", body: JSON.stringify({ comment_text, notify_all: false })
      }, "comment");
    },
    async updateTask(taskId, body) {
      await checked(`/api/v2/task/${taskId}`, { method: "PUT", body: JSON.stringify(body) }, "update");
    }
  };
}

export async function syncOnboardingTasks({ reconciliation, client, generatedAt = new Date().toISOString() }) {
  if (!reconciliation?.targets) throw new Error("Target entity reconciliation is required for onboarding sync.");
  const tasks = await client.listTasks();
  const existingByEntity = groupOnboardingTasks(tasks);
  const targetNames = new Set(reconciliation.targets.map((target) => target.normalizedName));
  const changes = [];

  for (const target of reconciliation.targets) {
    const existing = existingByEntity.get(target.normalizedName) ?? [];
    const task = existing.find((candidate) => !isClosed(candidate)) ?? existing[0];

    if (!target.ready) {
      for (const duplicate of existing.filter((candidate) => candidate !== task && !isClosed(candidate))) {
        await client.commentTask(duplicate.id, `${generatedAt}: duplicate onboarding task superseded by ${task.id}; closing.`);
        await client.updateTask(duplicate.id, { status: "complete" });
        changes.push({ type: "deduplicated", entity: target.name, taskId: duplicate.id });
      }
      const note = incompleteNote(target, generatedAt);
      if (!task) {
        const created = await client.createTask(onboardingTask(target, note));
        changes.push({ type: "created", entity: target.name, taskId: created?.id ?? "" });
      } else {
        await client.commentTask(task.id, note);
        if (isClosed(task)) {
          await client.updateTask(task.id, { status: "to do" });
          changes.push({ type: "reopened", entity: target.name, taskId: task.id });
        } else {
          // Refresh metadata on every run so legacy/open tasks gain canonical
          // check links as ownership evidence improves.
          await client.updateTask(task.id, {
            markdown_description: onboardingTask(target, note).markdown_description
          });
        }
      }
    } else {
      for (const openTask of existing.filter((candidate) => !isClosed(candidate))) {
        await client.commentTask(openTask.id, recoveryNote(target, generatedAt));
        await client.updateTask(openTask.id, { status: "complete" });
        changes.push({ type: "resolved", entity: target.name, taskId: openTask.id });
      }
    }
  }

  for (const [normalizedName, existing] of existingByEntity) {
    if (targetNames.has(normalizedName)) continue;
    for (const task of existing.filter((candidate) => !isClosed(candidate))) {
      await client.commentTask(task.id, `${generatedAt}: entity is no longer in the Target Entity Universe; closing onboarding task.`);
      await client.updateTask(task.id, { status: "complete" });
      changes.push({ type: "resolved", entity: entityFromTask(task), taskId: task.id });
    }
  }

  return { changes, incompleteCount: reconciliation.targets.filter((target) => !target.ready).length };
}

export function formatOnboardingNotification(result, coverage) {
  if (!result.changes.length) return "";
  const labels = { created: "Created", reopened: "Reopened", resolved: "Resolved", deduplicated: "Deduplicated" };
  return [
    "# Profile Onboarding Changes",
    "",
    `Ready Entity Profile Coverage: **${coverage.ready}/${coverage.total} (${coverage.percent}%)**`,
    `Open onboarding gaps: **${result.incompleteCount}**`,
    "",
    ...result.changes.map((change) => `- **${labels[change.type]}:** ${change.entity}`)
  ].join("\n");
}

function groupOnboardingTasks(tasks) {
  const grouped = new Map();
  for (const task of tasks ?? []) {
    if (!task.name?.startsWith(TASK_PREFIX)) continue;
    const normalizedName = task.name.slice(TASK_PREFIX.length);
    if (!grouped.has(normalizedName)) grouped.set(normalizedName, []);
    grouped.get(normalizedName).push(task);
  }
  return grouped;
}

function onboardingTask(target, note) {
  const tabs = [...new Set(target.sourceReferences.map((reference) => reference.tab))].join(", ");
  return {
    name: `${TASK_PREFIX}${target.normalizedName}`,
    markdown_description: [
      `**Target entity:** ${target.name}`,
      `**Source tabs:** ${tabs}`,
      `**Disposition:** ${target.disposition}`,
      `**Normalized key:** ${target.normalizedName}`,
      target.reason ? `**Reason:** ${target.reason}` : "",
      target.checkUrl ? `**Check source:** [Open the official source](${target.checkUrl})` : "",
      "",
      note
    ].filter(Boolean).join("\n"),
    priority: 2,
    tags: ["profile-onboarding", target.disposition]
  };
}

function incompleteNote(target, generatedAt) {
  return `${generatedAt}: still incomplete — ${target.disposition}${target.reason ? `: ${target.reason}` : ""}.`;
}

function recoveryNote(target, generatedAt) {
  const evidence = target.disposition === "direct-profile"
    ? `profile ${target.profileIds.join(", ")}`
    : `${target.disposition}${target.owner ? ` via ${target.owner}` : ""}`;
  return `${generatedAt}: target is ready (${evidence}); closing onboarding task.`;
}

function isClosed(task) {
  return task.status?.type === "closed" || task.status?.status === "complete";
}

function entityFromTask(task) {
  return task.name?.slice(TASK_PREFIX.length) || "Unknown target";
}
