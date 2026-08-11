import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function validatePublicationRun(run) {
  if (run?.schema_version !== 1) throw new Error("Unsupported publication schema version");
  if (!run.run_id || !run.started_at || !run.finished_at) throw new Error("Publication run metadata is incomplete");
  if (!Array.isArray(run.bids)) throw new Error("Publication bids must be an array");
  if (!Array.isArray(run.entity_checks) || run.entity_checks.length === 0) throw new Error("At least one entity check is required");
  return run;
}

export async function publishRun(run, options = {}) {
  validatePublicationRun(run);
  const apiUrl = String(options.apiUrl || process.env.PUBLISH_API_URL || "").replace(/\/$/, "");
  const publisherId = options.publisherId || process.env.PUBLISH_DEVICE_ID;
  const apiKey = options.apiKey || process.env.PUBLISH_API_KEY;
  if (!apiUrl || !publisherId || !apiKey) throw new Error("PUBLISH_API_URL, PUBLISH_DEVICE_ID, and PUBLISH_API_KEY are required");
  const response = await fetch(`${apiUrl}/api/publisher/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Publisher-ID": publisherId, Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(run),
    signal: AbortSignal.timeout(options.timeoutMs || 60_000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Publication failed (${response.status}): ${String(body.detail || "server error").slice(0, 300)}`);
  return body;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const filePath = process.argv.find((arg) => arg.endsWith(".json")) || "data/out/publication-run.json";
  const run = validatePublicationRun(JSON.parse(fs.readFileSync(filePath, "utf8")));
  if (process.argv.includes("--dry-run")) {
    console.log(`Valid publication: ${run.bids.length} bids, ${run.entity_checks.length} entity checks, ${run.status}`);
  } else {
    if (!process.argv.includes("--yes")) throw new Error("Publishing requires --yes");
    const result = await publishRun(run);
    console.log(`Published ${result.run_id}: created=${result.created} updated=${result.updated} unchanged=${result.unchanged} retained=${result.retained} rejected=${result.rejected}`);
  }
}
