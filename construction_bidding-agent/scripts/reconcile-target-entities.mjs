import fs from "node:fs";
import targetConfig from "../config/target-entities.json" with { type: "json" };
import siteConfig from "../config/sites.json" with { type: "json" };
import { extractTargetRows, reconcileTargetEntities } from "../src/target-entity-reconciliation.mjs";

const outputPath = "data/out/target-entity-reconciliation.json";
const tabRows = [];
for (const tab of targetConfig.tabs) {
  const url = `https://docs.google.com/spreadsheets/d/${targetConfig.spreadsheetId}/export?format=csv&gid=${tab.gid}`;
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Target workbook tab ${tab.name} returned HTTP ${response.status}`);
  tabRows.push(...extractTargetRows(await response.text(), tab));
}

const result = reconcileTargetEntities({
  tabRows,
  sites: siteConfig.sites,
  ownership: targetConfig.ownership,
  aliases: targetConfig.aliases
});
fs.mkdirSync("data/out", { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);

console.log(`Target Entity Universe: ${result.uniqueTargetCount} unique from ${result.sourceRowCount} rows`);
console.log(`Ready Entity Profile Coverage: ${result.coverage.ready}/${result.coverage.total} (${result.coverage.percent}%)`);
for (const tab of result.tabs) console.log(`${tab.tab}: ${tab.ready}/${tab.total} (${tab.percent}%)`);
if (result.uniqueTargetCount !== 139 || result.sourceRowCount !== 144) {
  console.warn("Target workbook drift detected from the accepted 144-row / 139-entity baseline.");
}
