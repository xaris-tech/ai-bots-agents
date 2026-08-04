// Keyword lists as supplied by the client, one entry per line item under each
// heading. Multi-word phrases match as phrases; single words use a word
// boundary so "sand" doesn't match inside unrelated words. Shared by
// scripts/push-clickup-tasks.mjs (categorize the combined feed) and
// scripts/scrape-bidnet-wide.mjs (drive BidNet's own keyword search).

export const GENERAL_CONSTRUCTION_KEYWORDS = [
  "concrete",
  "sitework", "excavation", "grading", "drainage", "stormwater",
  "renovation", "remodeling", "construction", "building improvements",
  "general contractor", "joc", "job order contracting",
  "foundation", "structural concrete", "masonry", "steel erection",
  "parking lot", "landscaping", "fencing", "accessibility", "ada improvements", "ada",
  // Civil/utility infrastructure terms — added after auditing the no-match
  // backlog and finding these clearly-construction bids (bridge repairs,
  // water main replacements, road resurfacing, etc.) fell through because
  // none of the above generic terms matched them.
  "bridge", "culvert", "paving", "resurfacing", "reconstruction", "rehabilitation",
  "water main", "waterline", "water line", "sewer", "wastewater",
  "lift station", "pump station", "transmission main", "levee", "sidewalk",
  "traffic signal", "roadway", "improvements", "flood control",
  "demolition", "abatement", "widening"
];

export const AGGREGATE_KEYWORDS = [
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
  "asphalt", "caliche"
  // Removed (all false positives on audit): bare "granite" (matched proper
  // nouns like "Granite Hills", "Mack Granite" truck model), "hauling" and
  // "delivery" (too generic — matched fuel/waste/biodiesel hauling with no
  // aggregate material involved), bare "soil" (matched an unrelated "Soil &
  // Water Conservation District" audit). "topsoil"/"stabilized soil" cover
  // the legitimate soil-material cases without the false-positive risk.
];

// A bid that matches an AGGREGATE keyword but ALSO uses one of these
// repair/installation-service verbs is a construction job that happens to
// mention a material (e.g. "Bridge Concrete Riprap and RCP Repairs"), not a
// material-supply contract — route those to General Construction instead.
export const CONSTRUCTION_CONTEXT_KEYWORDS = [
  "repair", "repairs", "rehabilitation", "placement", "demolition", "dredging"
];

// Professional-services solicitations often contain broad words such as
// "construction", "roadway", or "improvements" but do not represent work
// Cortex self-performs. Keep these as a narrow exclusion layer instead of
// deleting valid construction keywords and losing real JOC/repair projects.
export const CLICKUP_EXCLUDE_KEYWORDS = [
  "construction management", "construction manager", "manager at risk", "cmar",
  "inspection services", "engineering services", "architectural services",
  "design services", "consulting services"
];

export function buildKeywordPattern(keywords) {
  const parts = keywords.map((keyword) => {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Single words tolerate a trailing "s" (bridge/bridges, sidewalk/sidewalks)
    // — found via "HEIDEKE SIDEWALKS PROJECT" silently missing "sidewalk".
    // Multi-word phrases don't need this: "pump station" already matches
    // inside "pump stations" as a plain substring, no boundary anchor.
    return keyword.includes(" ") ? escaped : `\\b${escaped}s?\\b`;
  });
  return new RegExp(parts.join("|"), "i");
}

const aggregatePattern = buildKeywordPattern(AGGREGATE_KEYWORDS);
const generalConstructionPattern = buildKeywordPattern(GENERAL_CONSTRUCTION_KEYWORDS);
const clickUpExcludePattern = buildKeywordPattern(CLICKUP_EXCLUDE_KEYWORDS);

export function matchesClickUpKeywords(text) {
  // Material supply remains eligible even when a description mentions
  // engineering/design context. Exclusions apply to general-construction-only
  // matches, where those phrases reliably identify professional services.
  return aggregatePattern.test(text)
    || (generalConstructionPattern.test(text) && !clickUpExcludePattern.test(text));
}
