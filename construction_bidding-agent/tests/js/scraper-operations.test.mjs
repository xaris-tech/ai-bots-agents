import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOperationsReport,
  buildMonitorSnapshot,
  formatDailyNotification,
  formatHumanReview
} from "../../src/scraper-operations.mjs";

function monitor(statuses) {
  return {
    generated_at: "2026-08-04T12:00:00.000Z",
    summary: { total_bids: 12 },
    sites: statuses.map((status, index) => ({
      id: `site-${index}`,
      agency: `Agency ${index}`,
      enabled: true,
      status,
      block_kind: status === "blocked" ? "cloudflare" : "",
      warning: status === "blocked" ? "Cloudflare challenge" : ""
    }))
  };
}

test("marks a fully verified run completed", () => {
  const report = buildOperationsReport(monitor(["healthy", "empty"]));
  assert.equal(report.status, "Completed");
  assert.equal(report.entityAuditPassRate, 100);
  assert.equal(report.verifiedEmptyEntities, 1);
});

test("uses the 50 percent failed threshold", () => {
  assert.equal(buildOperationsReport(monitor(["healthy", "blocked"])).status, "Completed with blockers/warnings");
  assert.equal(buildOperationsReport(monitor(["healthy", "blocked", "warning"])).status, "Failed");
});

test("disabled sites do not enter the daily runtime denominator", () => {
  const input = monitor(["healthy", "blocked"]);
  input.sites[1].enabled = false;
  const report = buildOperationsReport(input);
  assert.equal(report.totalEntities, 1);
  assert.equal(report.status, "Completed");
});

test("formats notification and review messages", () => {
  const report = buildOperationsReport(monitor(["healthy", "blocked"]));
  assert.match(formatDailyNotification(report), /Daily Scraper Update/);
  assert.match(formatDailyNotification(report), /Agency 1/);
  assert.match(formatHumanReview(report), /\[ \].*Agency 1/);
});

test("does not produce a human review message for a clean run", () => {
  assert.equal(formatHumanReview(buildOperationsReport(monitor(["empty"]))), "");
});

test("builds monitor statuses from scraper output", () => {
  const snapshot = buildMonitorSnapshot(
    [
      { id: "ok", agency: "OK", enabled: true },
      { id: "empty", agency: "Empty", enabled: true },
      { id: "cf", agency: "CF", enabled: true, url: "https://example.test/cf-bids" }
    ],
    [
      { sourceId: "ok", count: 2, warning: "" },
      { sourceId: "empty", count: 0, warning: "" },
      { sourceId: "cf", count: 0, warning: "blocked-cloudflare" }
    ],
    [{ title: "one" }, { title: "two" }]
  );
  assert.deepEqual(snapshot.sites.map((site) => site.status), ["healthy", "empty", "blocked"]);
  assert.equal(snapshot.sites[2].block_kind, "cloudflare");
  assert.equal(snapshot.sites[2].check_url, "https://example.test/cf-bids");
  assert.equal(buildOperationsReport(snapshot).failures[0].checkUrl, "https://example.test/cf-bids");
  assert.equal(snapshot.summary.total_bids, 2);
});

test("strips terminal formatting from ClickUp messages", () => {
  const input = monitor(["blocked"]);
  input.sites[0].warning = "Call log: \u001b[2m navigating\u001b[22m";
  const message = formatDailyNotification(buildOperationsReport(input));
  assert.doesNotMatch(message, /\u001b/);
  assert.match(message, /Call log: navigating/);
});

test("counts all four reviewed opportunity classifications", () => {
  const categories = ["aggregate", "construction", "both", "neither"];
  const report = buildOperationsReport(monitor(["healthy"]), {
    bids: categories.map((category) => ({ category })),
    categorize: (bid) => bid.category
  });
  assert.equal(report.listingsCaptured, 4);
  assert.deepEqual(report.categoryCounts, { aggregate: 1, construction: 1, both: 1, neither: 1 });
});

test("pipeline errors fail the run and enter both messages", () => {
  const report = buildOperationsReport(monitor(["healthy"]), {
    pipelineErrors: [{ step: "scrape:bids", exitCode: 1 }]
  });
  assert.equal(report.status, "Failed");
  assert.match(formatDailyNotification(report), /Pipeline errors/);
  assert.match(formatHumanReview(report), /scrape:bids/);
});

test("exposes reconciled ready profile coverage without changing runtime audit coverage", () => {
  const report = buildOperationsReport(monitor(["healthy"]), {
    reconciliation: {
      coverage: { ready: 76, total: 139, percent: 54.68 },
      targets: [{ ready: true }, { ready: false }],
      tabs: [
        { tab: "Main", ready: 50, total: 83, percent: 60.24 },
        { tab: "Additional", ready: 31, total: 61, percent: 50.82 }
      ]
    }
  });
  assert.equal(report.totalEntities, 1);
  assert.deepEqual(report.readyEntityProfileCoverage, { ready: 76, total: 139, percent: 54.68 });
  assert.equal(report.onboardingGapCount, 1);
  assert.match(formatDailyNotification(report), /Ready profile coverage.*76\/139 \(54.68%\)/);
  assert.match(formatDailyNotification(report), /Main.*50\/83/);
  assert.match(formatDailyNotification(report), /Profile onboarding gaps.*separate from runtime incidents/);
});
