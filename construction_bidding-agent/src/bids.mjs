export const pursuitChecklist = [
  "Review bid documents",
  "Confirm scope fit",
  "Confirm materials/equipment availability",
  "Estimate pricing",
  "Assign estimator",
  "Prepare proposal package",
  "Internal final review",
  "Submit bid",
  "Upload submitted docs to Drive",
  "Mark as submitted"
];

const aggregateTerms = [
  "aggregate",
  "aggregates",
  "stone",
  "gravel",
  "sand",
  "asphalt",
  "base material",
  "riprap"
];

const constructionTerms = [
  "construction",
  "road",
  "bridge",
  "site work",
  "concrete",
  "drainage",
  "utility",
  "earthwork"
];

export function categorizeBid(bid) {
  const text = `${bid.title ?? ""} ${bid.description ?? ""}`.toLowerCase();
  if (aggregateTerms.some((term) => text.includes(term))) return "Aggregates";
  if (constructionTerms.some((term) => text.includes(term))) return "Construction";
  return "Other";
}

export function dedupeKey(bid) {
  // No agency: the same bid scraped from two sources can carry differently
  // formatted agency strings for an identical bidId/title/dueDate. Title is
  // always included (not just as a bidId fallback) so agencies that reuse
  // the same short bid-number prefix across unrelated projects don't
  // collapse into one record.
  return [
    bid.platform,
    normalize(bid.bidId),
    normalize(bid.title),
    bid.dueDate || ""
  ].join("|");
}

export function scoreBid(bid, now = new Date()) {
  let score = 0;
  const category = bid.category || categorizeBid(bid);

  if (category === "Aggregates") score += 35;
  if (category === "Construction") score += 30;
  if (bid.location) score += 10;
  if (bid.documentsUrl || bid.hasDocuments) score += 20;
  if (bid.agency) score += 10;

  const dueScore = scoreDueDate(bid.dueDate, now);
  score += dueScore;

  return Math.max(0, Math.min(100, score));
}

export function toClickUpTask(bid, now = new Date()) {
  const category = bid.category || categorizeBid(bid);
  const fitScore = bid.fitScore ?? scoreBid({ ...bid, category }, now);

  return {
    name: `${bid.platform}: ${bid.title}`,
    markdown_description: [
      `**Source Platform:** ${bid.platform}`,
      `**Category:** ${category}`,
      `**Agency / Buyer:** ${bid.agency || ""}`,
      `**Project Name:** ${bid.title || ""}`,
      `**Location:** ${bid.location || ""}`,
      `**Due Date:** ${bid.dueDate || ""}`,
      `**Bid URL:** ${bid.bidUrl || ""}`,
      `**Documents URL / Drive Folder:** ${bid.documentsUrl || ""}`,
      `**Estimated Value:** ${bid.estimatedValue || ""}`,
      `**Fit Score:** ${fitScore}`,
      `**CEO Decision:** Pending`,
      `**Last Checked At:** ${now.toISOString()}`
    ].join("\n"),
    due_date: bid.dueDate,
    priority: fitScore >= 80 ? "high" : fitScore >= 55 ? "normal" : "low",
    tags: [bid.platform, category].filter(Boolean)
  };
}

function scoreDueDate(value, now) {
  if (!value) return 0;
  const due = new Date(value);
  if (Number.isNaN(due.getTime())) return 0;
  const days = Math.ceil((due.getTime() - now.getTime()) / 86400000);
  if (days < 0) return 0;
  if (days <= 7) return 25;
  if (days <= 14) return 20;
  if (days <= 30) return 15;
  return 8;
}

function normalize(value = "") {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
