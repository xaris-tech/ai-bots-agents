const PASS_STATUSES = new Set(["healthy", "empty"]);
const REVIEW_STATUSES = new Set(["blocked", "warning", "stale", "never-run"]);

export function buildMonitorSnapshot(sites, reportRows, bidRows, generatedAt = new Date().toISOString()) {
  const reportById = new Map(reportRows.map((row) => [row.sourceId, row]));
  const views = sites.map((site) => {
    const entry = reportById.get(site.id);
    const warning = String(entry?.warning ?? "").trim();
    const blockKind = classifyBlock(warning);
    const count = Number(entry?.count ?? 0);
    const retainedCount = Number(entry?.retainedCount ?? 0);
    let status = "never-run";
    if (site.enabled === false) status = "disabled";
    else if (entry && count > 0) status = "healthy";
    else if (entry && warning && retainedCount > 0) status = "stale";
    else if (entry && warning) status = blockKind ? "blocked" : "warning";
    else if (entry) status = "empty";
    return {
      id: site.id,
      agency: site.agency,
      enabled: site.enabled !== false,
      status,
      block_kind: blockKind,
      warning,
      check_url: site.url || ""
    };
  });
  return {
    generated_at: generatedAt,
    summary: { total_bids: bidRows.length },
    sites: views
  };
}

export function buildOperationsReport(monitor, options = {}) {
  const sites = monitor.sites ?? [];
  const targetSites = sites.filter((site) => site.enabled !== false);
  const passed = targetSites.filter((site) => PASS_STATUSES.has(site.status));
  const failures = targetSites.filter((site) => REVIEW_STATUSES.has(site.status));
  const verifiedEmpty = passed.filter((site) => site.status === "empty");
  const total = targetSites.length;
  const passRate = total === 0 ? 0 : (passed.length / total) * 100;
  const pipelineErrors = options.pipelineErrors ?? [];
  const status = pipelineErrors.length
    ? "Failed"
    : passRate === 100
    ? "Completed"
    : passRate >= 50
      ? "Completed with blockers/warnings"
      : "Failed";

  const bids = options.bids ?? [];
  const categoryCounts = countCategories(bids, options.categorize);
  const profileCoverage = options.reconciliation?.coverage ?? null;
  const profileCoverageByTab = options.reconciliation?.tabs ?? [];
  const onboardingGapCount = options.reconciliation?.targets?.filter((target) => !target.ready).length ?? null;

  return {
    generatedAt: monitor.generated_at ?? new Date().toISOString(),
    status,
    totalEntities: total,
    passedEntities: passed.length,
    failedEntities: failures.length,
    verifiedEmptyEntities: verifiedEmpty.length,
    entityAuditPassRate: Number(passRate.toFixed(2)),
    readyEntityProfileCoverage: profileCoverage,
    readyEntityProfileCoverageByTab: profileCoverageByTab,
    onboardingGapCount,
    listingsCaptured: options.bids ? bids.length : Number(monitor.summary?.total_bids ?? 0),
    categoryCounts,
    pipelineErrors,
    failures: failures.map((site) => ({
      sourceId: site.id,
      agency: site.agency,
      status: site.status,
      blockKind: site.block_kind || "",
      warning: site.warning || "",
      checkUrl: site.check_url || ""
    }))
  };
}

export function formatDailyNotification(report) {
  const lines = [
    `# Daily Scraper Update — ${report.status}`,
    "",
    ...(report.readyEntityProfileCoverage
      ? [
          `- Ready profile coverage: **${report.readyEntityProfileCoverage.ready}/${report.readyEntityProfileCoverage.total} (${report.readyEntityProfileCoverage.percent}%)**`,
          ...report.readyEntityProfileCoverageByTab.map((tab) =>
            `  - ${tab.tab}: **${tab.ready}/${tab.total} (${tab.percent}%)**`
          ),
          `- Profile onboarding gaps: **${report.onboardingGapCount ?? report.readyEntityProfileCoverage.total - report.readyEntityProfileCoverage.ready}** (separate from runtime incidents)`
        ]
      : ["- Ready profile coverage: **Unavailable — run target reconciliation**"]),
    `- Entity audit: **${report.passedEntities}/${report.totalEntities} passed (${report.entityAuditPassRate}%)**`,
    `- Verified empty: **${report.verifiedEmptyEntities}**`,
    `- Failed/unverifiable: **${report.failedEntities}**`,
    `- Listings captured: **${report.listingsCaptured}**`,
    `- Categories: Aggregate **${report.categoryCounts.aggregate}** · Construction **${report.categoryCounts.construction}** · Both **${report.categoryCounts.both}** · Neither **${report.categoryCounts.neither}**`
  ];

  if (report.failures.length) {
    lines.push("", "## Blockers and warnings");
    for (const failure of report.failures) {
      const kind = failure.blockKind || failure.status;
      lines.push(`- **${failure.agency}** (${kind}): ${oneLine(failure.warning) || "Needs human review"}`);
    }
  } else {
    lines.push("", "No blockers or warnings detected.");
  }
  if (report.pipelineErrors.length) {
    lines.push("", "## Pipeline errors", ...report.pipelineErrors.map((error) => `- **${error.step}** exited ${error.exitCode}`));
  }
  return lines.join("\n");
}

export function formatHumanReview(report) {
  if (!report.failures.length && !report.pipelineErrors.length) return "";
  return [
    `# Human Review — ${report.generatedAt.slice(0, 10)}`,
    "",
    `${report.failedEntities} target entities could not be verified:`,
    "",
    ...report.failures.map((failure) => {
      const kind = failure.blockKind || failure.status;
      return `- [ ] **${failure.agency}** (\`${failure.sourceId}\`, ${kind}) — ${oneLine(failure.warning) || "Review official listing"}`;
    }),
    ...(report.pipelineErrors.length
      ? ["", "## Pipeline errors", ...report.pipelineErrors.map((error) => `- [ ] **${error.step}** exited ${error.exitCode}`)]
      : [])
  ].join("\n");
}

function countCategories(bids, categorize) {
  const counts = { aggregate: 0, construction: 0, both: 0, neither: 0 };
  if (!categorize) return counts;
  for (const bid of bids) {
    const value = String(categorize(bid) || "neither").toLowerCase();
    if (value === "both") counts.both += 1;
    else if (value.includes("aggregate")) counts.aggregate += 1;
    else if (value.includes("construction")) counts.construction += 1;
    else counts.neither += 1;
  }
  return counts;
}

function oneLine(value) {
  return String(value ?? "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function classifyBlock(warning) {
  const text = warning.toLowerCase();
  if (text.includes("cloudflare")) return "cloudflare";
  if (/bot-block|bot protection|403|access denied/.test(text)) return "bot-block";
  if (/origin server unreachable|\b522\b/.test(text)) return "origin-down";
  if (/err_connection|err_http2|err_name|net::|timeout|publicpurchase/.test(text)) return "network";
  return "";
}
