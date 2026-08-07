import test from "node:test";
import assert from "node:assert/strict";
import sitesConfig from "../../config/sites.json" with { type: "json" };
import targetConfig from "../../config/target-entities.json" with { type: "json" };
import {
  extractTargetRows,
  normalizeEntityName,
  parseCsv,
  reconcileTargetEntities
} from "../../src/target-entity-reconciliation.mjs";

test("parses quoted CSV fields and embedded commas", () => {
  assert.deepEqual(parseCsv('Type,Name\r\nCity,"Azle, TX"\r\n'), [["Type", "Name"], ["City", "Azle, TX"]]);
});

test("extracts entity names while excluding configured headings and blank rows", () => {
  const rows = extractTargetRows('Name,Login\nCities,Username\nAzle,secret\n,secret\n', {
    key: "Main", name: "Main targets", nameColumn: 0, headingRows: [1, 2]
  });
  assert.deepEqual(rows.map((row) => row.displayName), ["Azle"]);
  assert.equal(rows[0].row, 3);
});

test("normalizes presentation variants without conflating entity types", () => {
  assert.equal(normalizeEntityName(" City of Azle, TX "), normalizeEntityName("Azle"));
  assert.equal(normalizeEntityName("Williamson County, Texas"), "williamson county");
  assert.notEqual(normalizeEntityName("Brown County, TX"), normalizeEntityName("Brownwood, TX"));
});

test("deduplicates targets and preserves source-tab traceability", () => {
  const report = reconcileTargetEntities({
    tabRows: [row("Azle", "Main", 3), row("Azle, TX", "Additional", 8), row("Bedford", "Main", 4)],
    sites: [{ id: "azle-tx", agency: "City of Azle", enabled: true }],
    ownership: []
  });
  assert.equal(report.sourceRowCount, 3);
  assert.equal(report.uniqueTargetCount, 2);
  assert.equal(report.duplicateRowCount, 1);
  assert.equal(report.targets.find((target) => target.normalizedName === "azle").sourceReferences.length, 2);
  assert.deepEqual(report.tabs.map(({ tab, total }) => ({ tab, total })), [
    { tab: "Main", total: 2 }, { tab: "Additional", total: 1 }
  ]);
});

test("applies explicit aliases before cross-tab deduplication", () => {
  const report = reconcileTargetEntities({
    tabRows: [row("Williamson", "Main", 1), row("Williamson County, TX", "Additional", 2)],
    sites: [{ id: "williamson-county-tx", agency: "Williamson County", enabled: true }],
    aliases: [{ from: "Williamson", to: "Williamson County" }]
  });
  assert.equal(report.uniqueTargetCount, 1);
  assert.equal(report.targets[0].disposition, "direct-profile");
  assert.equal(report.targets[0].sourceReferences.length, 2);
});

test("assigns exactly one disposition and keeps config-only profiles visible", () => {
  const report = reconcileTargetEntities({
    tabRows: [row("Azle", "Main", 1), row("Plano", "Main", 2), row("Aledo", "Main", 3), row("Reno", "Main", 4)],
    sites: [
      { id: "azle-tx", agency: "City of Azle", enabled: true, url: "https://example.test/azle-bids" },
      { id: "aledo-tx", agency: "City of Aledo", enabled: false, url: "https://example.test/aledo-bids" },
      { id: "extra-tx", agency: "City of Extra", enabled: true }
    ],
    ownership: [{ entity: "Plano, TX", disposition: "batch-owned", owner: "IonWave" }]
  });
  assert.deepEqual(report.targets.map((target) => [target.normalizedName, target.disposition]), [
    ["aledo", "blocked"], ["azle", "direct-profile"], ["plano", "batch-owned"], ["reno", "unresolved"]
  ]);
  assert.deepEqual(report.coverage, { ready: 2, total: 4, percent: 50 });
  assert.equal(report.targets.find((target) => target.normalizedName === "aledo").checkUrl, "https://example.test/aledo-bids");
  assert.deepEqual(report.configOnlyProfiles, [{ id: "extra-tx", agency: "City of Extra", enabled: true }]);
});

test("reports source drift instead of assuming the accepted baseline", () => {
  const report = reconcileTargetEntities({ tabRows: [row("New Entity", "Main", 1)], sites: [], ownership: [] });
  assert.equal(report.sourceRowCount, 1);
  assert.equal(report.uniqueTargetCount, 1);
  assert.equal(report.coverage.percent, 0);
});

test("central DFW wave has an explicit accountable disposition for every target", () => {
  const targets = [
    "Euless", "Colleyville", "Farmers Branch", "Bedford", "Cedar Hill",
    "Blue Mound", "Everman", "Edgecliff Village", "River Oaks"
  ];
  const siteEntities = new Set(sitesConfig.sites.map((site) => normalizeEntityName(site.targetEntity ?? site.agency)));
  const ownership = new Map(targetConfig.ownership.map((record) => [normalizeEntityName(record.entity), record]));

  for (const target of targets) {
    const normalized = normalizeEntityName(target);
    assert.ok(siteEntities.has(normalized) || ownership.has(normalized), `${target} needs a profile or ownership record`);
  }
  assert.equal(ownership.get(normalizeEntityName("Cedar Hill")).disposition, "batch-owned");
  assert.equal(ownership.get(normalizeEntityName("Bedford")).disposition, "blocked");
  for (const target of ["Farmers Branch", "Blue Mound", "Everman", "Edgecliff Village", "River Oaks"]) {
    assert.equal(ownership.get(normalizeEntityName(target)).disposition, "manual");
  }
});

test("northwestern outer-market wave has an explicit accountable disposition for every target", () => {
  const targets = [
    "Rhome", "Bartonville", "Graham", "Jacksboro", "Graford", "Bridgeport",
    "Wichita Falls", "Young County", "Jack County", "Palo Pinto County"
  ];
  const siteEntities = new Set(sitesConfig.sites.map((site) => normalizeEntityName(site.targetEntity ?? site.agency)));
  const ownership = new Map(targetConfig.ownership.map((record) => [normalizeEntityName(record.entity), record]));

  for (const target of targets) {
    const normalized = normalizeEntityName(target);
    assert.ok(siteEntities.has(normalized) || ownership.has(normalized), `${target} needs a profile or ownership record`);
  }
  assert.equal(ownership.get(normalizeEntityName("Young County")).disposition, "blocked");
  for (const target of ["Rhome", "Bartonville", "Graham", "Graford", "Bridgeport"]) {
    assert.equal(ownership.get(normalizeEntityName(target)).disposition, "manual");
  }
});

test("remaining Main-tab portal targets are batch-owned without duplicate direct profiles", () => {
  const ownership = new Map(targetConfig.ownership.map((record) => [normalizeEntityName(record.entity), record]));
  const siteEntities = new Set(sitesConfig.sites.map((site) => normalizeEntityName(site.targetEntity ?? site.agency)));

  assert.equal(ownership.get("johnson county").owner, "Bonfire");
  assert.equal(ownership.get("grapevine").owner, "IonWave");
  assert.equal(siteEntities.has("johnson county"), false);
  assert.equal(siteEntities.has("grapevine"), false);
});

test("questionable Main-tab sources use human-approved canonical dispositions", () => {
  const ownership = new Map(targetConfig.ownership.map((record) => [normalizeEntityName(record.entity), record]));
  const sites = new Map(sitesConfig.sites.map((site) => [normalizeEntityName(site.targetEntity ?? site.agency), site]));

  for (const target of ["Reno", "Pelican Bay", "Cross Timber"]) {
    assert.equal(ownership.get(normalizeEntityName(target)).disposition, "manual");
  }
  assert.match(ownership.get("reno").owner, /Parker County/i);
  assert.match(ownership.get("pelican bay").reason, /one-off project/i);
  assert.match(ownership.get("cross timber").reason, /InstantMarkets/i);
  assert.equal(ownership.get("marfa").disposition, "blocked");
  assert.equal(sites.get("marfa").id, "marfa-tx");
  assert.equal(sites.get("marfa").url, "https://www.cityofmarfa.com/rfps");
  assert.equal(sites.get("marfa").enabled, false);
  assert.match(sites.get("marfa").disabledReason, /HTTP 403/i);
});

test("north and east Texas Additional wave has an explicit accountable disposition for every target", () => {
  const targets = [
    "Tyler", "Clay County", "Jones County", "Wood County", "Mount Pleasant",
    "Wilbarger County", "Brown County"
  ];
  const siteEntities = new Set(sitesConfig.sites.map((site) => normalizeEntityName(site.targetEntity ?? site.agency)));
  const ownership = new Map(targetConfig.ownership.map((record) => [normalizeEntityName(record.entity), record]));

  for (const target of targets) {
    const normalized = normalizeEntityName(target);
    assert.ok(siteEntities.has(normalized) || ownership.has(normalized), `${target} needs a profile or ownership record`);
  }
  assert.equal(ownership.get(normalizeEntityName("Tyler")).disposition, "manual");
  assert.equal(ownership.get(normalizeEntityName("Mount Pleasant")).disposition, "blocked");
  for (const target of ["Clay County", "Jones County", "Wood County", "Wilbarger County", "Brown County"]) {
    assert.ok(siteEntities.has(normalizeEntityName(target)), `${target} needs a direct site profile`);
  }
});

test("central Texas county wave has an explicit accountable disposition for every target", () => {
  const targets = ["Burnet County", "Blanco County", "Llano County", "Bexar County"];
  const siteEntities = new Set(sitesConfig.sites.map((site) => normalizeEntityName(site.targetEntity ?? site.agency)));
  const ownership = new Map(targetConfig.ownership.map((record) => [normalizeEntityName(record.entity), record]));

  for (const target of targets) {
    const normalized = normalizeEntityName(target);
    assert.ok(siteEntities.has(normalized) || ownership.has(normalized), `${target} needs a profile or ownership record`);
  }
  assert.ok(siteEntities.has(normalizeEntityName("Burnet County")));
  assert.ok(siteEntities.has(normalizeEntityName("Llano County")));
  assert.equal(ownership.get(normalizeEntityName("Blanco County")).disposition, "manual");
  assert.equal(ownership.get(normalizeEntityName("Bexar County")).disposition, "blocked");
  assert.match(ownership.get(normalizeEntityName("Bexar County")).reason, /supplier registration/i);
});

test("central Texas city wave has an explicit accountable disposition for every target", () => {
  const targets = ["Kyle", "Killeen", "Bryan", "Harker Heights", "Pflugerville"];
  const siteEntities = new Set(sitesConfig.sites.map((site) => normalizeEntityName(site.targetEntity ?? site.agency)));
  const ownership = new Map(targetConfig.ownership.map((record) => [normalizeEntityName(record.entity), record]));

  for (const target of targets) {
    const normalized = normalizeEntityName(target);
    assert.ok(siteEntities.has(normalized) || ownership.has(normalized), `${target} needs a profile or ownership record`);
  }
  assert.ok(siteEntities.has(normalizeEntityName("Pflugerville")));
  assert.equal(ownership.get(normalizeEntityName("Bryan")).disposition, "batch-owned");
  assert.equal(ownership.get(normalizeEntityName("Bryan")).owner, "IonWave");
  assert.equal(ownership.get(normalizeEntityName("Kyle")).disposition, "blocked");
  assert.equal(ownership.get(normalizeEntityName("Killeen")).disposition, "blocked");
  assert.equal(ownership.get(normalizeEntityName("Harker Heights")).disposition, "manual");
});

test("shared-source Additional entities use exact city profiles instead of geographic aliases", () => {
  const targets = ["Leander", "Cedar Park", "Boerne", "Lockhart", "Schertz", "Universal City"];
  const profiles = new Map();
  for (const site of sitesConfig.sites) {
    const entity = normalizeEntityName(site.targetEntity ?? site.agency);
    if (!profiles.has(entity)) profiles.set(entity, []);
    profiles.get(entity).push(site);
  }

  for (const target of targets) {
    assert.ok(profiles.get(normalizeEntityName(target))?.some((site) => site.enabled), `${target} needs an enabled direct profile`);
  }
  assert.equal(profiles.get(normalizeEntityName("Leander"))[0].domain, "leandertx.bonfirehub.com");
  assert.match(profiles.get(normalizeEntityName("Cedar Park"))[0].url, /cedarparktexas\.gov\/bids\.aspx/i);
  assert.equal(profiles.get(normalizeEntityName("Universal City")).length, 2);
});

function row(displayName, tab, line) {
  return { displayName, normalizedName: normalizeEntityName(displayName), tab, tabName: `${tab} targets`, row: line };
}
