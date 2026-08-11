import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function buildPublicationRun(bids, report, options = {}) {
  const now = options.now || new Date().toISOString();
  const entityChecks = report.map((row) => ({
    source_id: String(row.sourceId || row.source_id || row.platform || "unknown"),
    status: entityStatus(row),
    warning: String(row.warning || "").slice(0, 1000),
    record_count: Math.max(0, Number(row.count || row.record_count || 0)),
    checked_at: normalizeIso(row.checkedAt || row.checked_at || now)
  }));
  const passed = entityChecks.filter((row) => ["success", "verified_empty"].includes(row.status)).length;
  const ratio = entityChecks.length ? passed / entityChecks.length : 0;
  const payload = {
    schema_version: 1,
    run_id: options.runId || crypto.randomUUID(),
    started_at: normalizeIso(options.startedAt || now),
    finished_at: normalizeIso(options.finishedAt || now),
    status: ratio === 1 ? "completed" : ratio >= 0.5 ? "completed_with_blockers" : "failed",
    bids: bids.map(normalizeBid),
    entity_checks: entityChecks
  };
  payload.content_checksum = checksum(payload);
  return payload;
}

function normalizeIso(value) {
  const iso = new Date(value).toISOString();
  if (iso.endsWith(".000Z")) return iso.replace(".000Z", "Z");
  return iso.replace(/\.(\d{3})Z$/, ".$1000Z");
}

function normalizeBid(bid) {
  const bidUrl = bid.bidUrl || bid.bid_url || "";
  const links = bid.sourceLinks || bid.source_links || [bidUrl].filter(Boolean);
  return {
    platform: String(bid.platform || "Unknown"),
    bid_id: String(bid.bidId || bid.bid_id || ""),
    title: String(bid.title || ""),
    agency: String(bid.agency || ""),
    location: String(bid.location || ""),
    due_date: bid.dueDate || bid.due_date || null,
    bid_url: String(bidUrl),
    documents_url: String(bid.documentsUrl || bid.documents_url || ""),
    estimated_value: String(bid.estimatedValue || bid.estimated_value || ""),
    description: String(bid.description || ""),
    description_quality: String(bid.descriptionQuality || bid.description_quality || "unknown"),
    description_source: String(bid.descriptionSource || bid.description_source || ""),
    description_source_url: String(bid.descriptionSourceUrl || bid.description_source_url || ""),
    scraped_at: String(bid.scrapedAt || bid.scraped_at || ""),
    source_id: String(bid.sourceId || bid.source_id || bid.platform || "unknown"),
    source_links: [...new Set(links.map(String))].slice(0, 20)
  };
}

function entityStatus(row) {
  const warning = String(row.warning || "").toLowerCase();
  if (!warning) return Number(row.count || row.record_count || 0) > 0 ? "success" : "verified_empty";
  if (warning.includes("cloudflare") || warning.includes("403") || warning.includes("blocked")) return "blocked";
  if (warning.includes("timeout") || warning.includes("timed out")) return "timed_out";
  if (warning.includes("parser") || warning.includes("selector")) return "parser_failed";
  return "unverifiable";
}

export function checksum(value) {
  const copy = structuredClone(value);
  delete copy.content_checksum;
  return crypto.createHash("sha256").update(stableJson(copy)).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const bidsPath = process.argv[2] || "data/raw/bids.json";
  const reportPath = process.argv[3] || "data/out/scrape-report.json";
  const outputPath = process.argv[4] || "data/out/publication-run.json";
  const run = buildPublicationRun(readArray(bidsPath), readArray(reportPath));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(run, null, 2)}\n`);
  console.log(`Built ${outputPath}: ${run.bids.length} bids, ${run.entity_checks.length} entity checks, ${run.status}`);
}

function readArray(filePath) {
  const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(value)) throw new Error(`${filePath} must contain a JSON array`);
  return value;
}
