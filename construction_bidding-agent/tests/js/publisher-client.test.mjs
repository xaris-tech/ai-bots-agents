import test from "node:test";
import assert from "node:assert/strict";

import { buildPublicationRun } from "../../scripts/build-publication-run.mjs";
import { publishRun, validatePublicationRun } from "../../scripts/publish-scrape-run.mjs";

test("builds honest publication status and normalized bid provenance", () => {
  const run = buildPublicationRun(
    [{
      platform: "CivicEngage",
      title: "Road bid",
      agency: "Example",
      sourceId: "example",
      bidUrl: "https://example.test/bid",
      descriptionQuality: "summary",
      descriptionSource: "detail-page",
      descriptionSourceUrl: "https://example.test/bid",
    }],
    [
      { sourceId: "example", count: 1, warning: "" },
      { sourceId: "blocked", count: 0, warning: "Cloudflare challenge" }
    ],
    { runId: "94cc8e1a-6e93-4bf6-bdd8-26da43360739", now: "2026-08-09T00:00:00.000Z" }
  );

  assert.equal(run.status, "completed_with_blockers");
  assert.equal(run.bids[0].source_id, "example");
  assert.deepEqual(run.bids[0].source_links, ["https://example.test/bid"]);
  assert.equal(run.bids[0].description_quality, "summary");
  assert.equal(run.bids[0].description_source, "detail-page");
  assert.equal(run.bids[0].description_source_url, "https://example.test/bid");
  assert.equal(run.entity_checks[1].status, "blocked");
  assert.doesNotThrow(() => validatePublicationRun(run));
});

test("verified empty differs from failed source", () => {
  const run = buildPublicationRun([], [{ sourceId: "empty", count: 0, warning: "" }]);
  assert.equal(run.entity_checks[0].status, "verified_empty");
});

test("normalizes nonzero milliseconds to Python-compatible microseconds", () => {
  const run = buildPublicationRun(
    [],
    [{ sourceId: "empty", count: 0, warning: "" }],
    { now: "2026-08-09T00:00:00.123Z" }
  );
  assert.equal(run.started_at, "2026-08-09T00:00:00.123000Z");
  assert.equal(run.entity_checks[0].checked_at, "2026-08-09T00:00:00.123000Z");
});

test("publisher validation rejects missing entity checks", () => {
  assert.throws(
    () => validatePublicationRun({ schema_version: 1, run_id: "id", started_at: "now", finished_at: "now", bids: [], entity_checks: [] }),
    /entity check/i
  );
});

test("publish client returns structured counts without exposing key", async () => {
  const run = buildPublicationRun([], [{ sourceId: "empty", count: 0, warning: "" }]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, request) => {
    assert.equal(request.headers.Authorization, "Bearer top-secret");
    return new Response(JSON.stringify({ run_id: run.run_id, created: 0, updated: 0, unchanged: 0, retained: 0, rejected: 0 }), { status: 201 });
  };
  try {
    const result = await publishRun(run, { apiUrl: "https://api.example", publisherId: "office", apiKey: "top-secret" });
    assert.equal(result.created, 0);
    assert.doesNotMatch(JSON.stringify(result), /top-secret/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
