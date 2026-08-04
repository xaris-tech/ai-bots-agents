import fs from "node:fs";
import targetConfig from "../config/target-entities.json" with { type: "json" };
import { verifyBatchOwnership } from "../src/batch-ownership.mjs";

const results = verifyBatchOwnership(targetConfig.ownership, readJsonArray);
const report = {
  generatedAt: new Date().toISOString(),
  verified: results.filter((result) => result.verified).length,
  total: results.length,
  results
};
fs.mkdirSync("data/out", { recursive: true });
fs.writeFileSync("data/out/batch-ownership-verification.json", `${JSON.stringify(report, null, 2)}\n`);
for (const result of results) {
  console.log(`${result.entity}: ${result.verified ? "verified" : "INCOMPLETE"} via ${result.owner} (${result.listingCount} exact-attribution listings)`);
}
if (report.verified !== report.total) process.exitCode = 1;

function readJsonArray(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
