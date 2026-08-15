import fields from "../config/clickup-fields.json" with { type: "json" };
import structure from "../config/clickup-structure.json" with { type: "json" };
import portals from "../config/portals.json" with { type: "json" };
import sites from "../config/sites.json" with { type: "json" };
import targetEntities from "../config/target-entities.json" with { type: "json" };

const requiredFieldNames = [
  "Source Platform",
  "Category",
  "Agency / Buyer",
  "Project Name",
  "Location",
  "Due Date",
  "Bid URL",
  "Documents URL / Drive Folder",
  "Estimated Value",
  "Fit Score",
  "CEO Decision",
  "Reject Reason",
  "Last Checked At"
];

assert(structure.workspaceId === "9011646920", "workspaceId must be 9011646920");
assert(structure.spaceName === "Bids & Opportunities", "spaceName mismatch");
assert(structure.folders.length === 5, "expected 5 folders");
assert(portals.portals.length === 3, "expected 3 portals");
assert(Array.isArray(sites.sites) && sites.sites.length > 0, "expected configured sites");
assert(targetEntities.spreadsheetId, "target entities need a spreadsheetId");
assert(targetEntities.tabs?.length === 2, "target entities need exactly two source tabs");
assert(new Set(targetEntities.tabs.map((tab) => tab.key)).size === 2, "target entity tab keys must be unique");
for (const tab of targetEntities.tabs) {
  assert(tab.name && tab.gid && Number.isInteger(tab.nameColumn), `invalid target entity tab: ${tab.key}`);
}
const ownershipEntities = new Set();
for (const record of targetEntities.ownership ?? []) {
  assert(record.entity && !ownershipEntities.has(record.entity), `duplicate target ownership: ${record.entity}`);
  ownershipEntities.add(record.entity);
  assert(["batch-owned", "manual", "blocked"].includes(record.disposition), `invalid ownership disposition: ${record.entity}`);
  if (record.disposition === "batch-owned") {
    assert(record.owner, `${record.entity}: batch ownership needs an owner`);
    assert(record.evidence?.source, `${record.entity}: batch ownership needs an evidence source`);
    assert(record.evidence?.agencyNames?.length > 0, `${record.entity}: batch ownership needs exact agency names`);
  }
}

const siteIds = new Set();
const siteUrls = new Set();
for (const site of sites.sites) {
  assert(site.id && !siteIds.has(site.id), `duplicate or missing site id: ${site.id}`);
  siteIds.add(site.id);
  assert(site.agency, `${site.id}: missing agency`);
  assert(site.url?.startsWith("https://"), `${site.id}: invalid URL`);
  assert(!siteUrls.has(site.url), `${site.id}: duplicate site URL ${site.url}`);
  siteUrls.add(site.url);
  assert([1, 2, 3, 4].includes(site.priority), `${site.id}: invalid priority`);
  assert(["Main", "Additional"].includes(site.workbookTab), `${site.id}: invalid workbook tab`);
  assert(["BidNet", "Bonfire", "CivicEngage", "IonWave", "Public Purchase", "StaticList", "WorkdaySpend", "BeaconBid"].includes(site.platform), `${site.id}: unsupported platform`);
  if (site.platform === "Bonfire") {
    assert(/^[a-z0-9.-]+\.bonfirehub\.com$/.test(site.domain || ""), `${site.id}: Bonfire sites need a *.bonfirehub.com domain`);
  }
  if (site.platform === "IonWave") {
    assert(/^https:\/\/[a-z0-9-]+\.ionwave\.net\//.test(site.url), `${site.id}: IonWave sites need an *.ionwave.net URL`);
  }
  if (site.platform === "BidNet") {
    assert(site.url.startsWith("https://www.bidnetdirect.com/"), `${site.id}: BidNet sites need a bidnetdirect.com URL`);
  }
  if (site.auth !== undefined) {
    if (typeof site.auth === "string") {
      assert(["credentials", "browser-session"].includes(site.auth), `${site.id}: invalid auth string`);
    } else {
      assert(["public", "credentials", "browser-session"].includes(site.auth?.mode), `${site.id}: invalid auth mode`);
      if (site.auth.mode === "credentials") {
        assert(site.auth.usernameEnv && site.auth.passwordEnv, `${site.id}: credentials auth needs usernameEnv and passwordEnv`);
      }
    }
  }
}

for (const name of requiredFieldNames) {
  assert(fields.fields.some((field) => field.name === name), `missing field: ${name}`);
}

console.log("Config OK");

function assert(condition, message) {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
}
