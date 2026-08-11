import { spawnSync } from "node:child_process";

export const pipelineSteps = [
  "targets:reconcile",
  "scrape:sites",
  "scrape:cloudflare",
  "scrape:bids",
  "combine:bids",
  "publication:build"
];

if (!process.argv.includes("--yes")) {
  throw new Error("Scrape-and-publish requires --yes production confirmation");
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
for (const step of pipelineSteps) {
  const result = spawnSync(npmCommand, ["run", step], { stdio: "inherit", env: process.env });
  if (result.status !== 0) throw new Error(`${step} failed with exit code ${result.status ?? 1}`);
}

const publish = spawnSync(npmCommand, ["run", "publish:bids", "--", "--yes"], {
  stdio: "inherit",
  env: process.env
});
if (publish.status !== 0) throw new Error(`publish:bids failed with exit code ${publish.status ?? 1}`);
