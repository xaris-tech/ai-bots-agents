// Bid category classification for the Opportunities filter.
//
// This is a faithful TS port of the CANONICAL rule that decides which ClickUp
// list a bid lands in — `src/keywords.mjs` (the keyword lists) plus the
// aggregate-vs-construction tie-break in `scripts/push-clickup-tasks.mjs`. Keep
// the three lists and the tie-break in sync with those files so the on-screen
// filter agrees with what actually gets pushed to ClickUp.

export type BidCategory = "aggregates" | "general" | "other";

const GENERAL_CONSTRUCTION_KEYWORDS = [
  "concrete",
  "sitework", "excavation", "grading", "drainage", "stormwater",
  "renovation", "remodeling", "construction", "building improvements",
  "general contractor", "joc", "job order contracting",
  "foundation", "structural concrete", "masonry", "steel erection",
  "parking lot", "landscaping", "fencing", "accessibility", "ada improvements", "ada",
  "bridge", "culvert", "paving", "resurfacing", "reconstruction", "rehabilitation",
  "water main", "waterline", "water line", "sewer", "wastewater",
  "lift station", "pump station", "transmission main", "levee", "sidewalk",
  "traffic signal", "roadway", "improvements", "flood control",
  "demolition", "abatement", "widening",
];

const AGGREGATE_KEYWORDS = [
  "aggregate", "aggregates", "construction aggregate",
  "crushed stone", "crushed rock", "limestone",
  "road base", "base material", "flexbase", "flex base",
  "gravel", "pea gravel", "washed gravel",
  "sand", "concrete sand", "masonry sand", "fill sand",
  "select fill", "screened fill", "common fill", "backfill",
  "crushed concrete", "recycled concrete", "recycled aggregate", "crushing",
  "riprap", "rip rap", "gabion stone",
  "topsoil", "stabilized soil",
  "aggregate supply", "material supply", "bulk material",
  "asphalt", "caliche",
];

// An aggregate-material bid that ALSO uses one of these repair/install verbs is
// a construction job that merely mentions a material — General Construction wins.
const CONSTRUCTION_CONTEXT_KEYWORDS = [
  "repair", "repairs", "rehabilitation", "placement", "demolition", "dredging",
];

function buildKeywordPattern(keywords: string[]): RegExp {
  const parts = keywords.map((keyword) => {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Single words tolerate a trailing "s" (bridge/bridges); multi-word phrases
    // already match as a substring inside their plural form.
    return keyword.includes(" ") ? escaped : `\\b${escaped}s?\\b`;
  });
  return new RegExp(parts.join("|"), "i");
}

const generalConstructionPattern = buildKeywordPattern(GENERAL_CONSTRUCTION_KEYWORDS);
const aggregatePattern = buildKeywordPattern(AGGREGATE_KEYWORDS);
const constructionContextPattern = buildKeywordPattern(CONSTRUCTION_CONTEXT_KEYWORDS);

export function categorizeBid(title: string, description = ""): BidCategory {
  const text = `${title ?? ""} ${description ?? ""}`;
  const isAggregateMaterial = aggregatePattern.test(text);
  const isConstructionJob = isAggregateMaterial && constructionContextPattern.test(text);
  if (isAggregateMaterial && !isConstructionJob) return "aggregates";
  if (isConstructionJob || generalConstructionPattern.test(text)) return "general";
  return "other";
}

export const CATEGORY_LABEL: Record<BidCategory, string> = {
  aggregates: "Aggregates",
  general: "General Construction",
  other: "Uncategorized",
};
