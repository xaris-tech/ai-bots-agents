import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWeatherfordLinks } from "../../src/sites/weatherford-tx.mjs";
import { normalizeJoshuaOpenLinks } from "../../src/sites/joshua-tx.mjs";

const weatherford = { id: "weatherford-tx", agency: "City of Weatherford", location: "Weatherford, TX" };
const joshua = { id: "joshua-tx", agency: "City of Joshua", location: "Joshua, TX" };

test("Weatherford extracts primary current RFPs, attaches amendments, and excludes tabulations", () => {
  const bids = normalizeWeatherfordLinks([
    { text: "RFP-2026-012 Substation Transformer", context: "RFP-2026-012 Substation Transformer", href: "https://official/12" },
    { text: "RFP 2026-015 Sale of Properties", context: "RFP 2026-015 Sale of Properties", href: "https://official/15" },
    { text: "QandA", context: "RFP 2026-015 AMENDMENT 1 - QandA", href: "https://official/15-amendment" },
    { text: "RFP 2026-013 Audit Services Bid Tabulation", context: "RFP 2026-013 Audit Services Bid Tabulation", href: "https://official/13" }
  ], weatherford, "2026-08-04T00:00:00Z");
  assert.equal(bids.length, 2);
  assert.deepEqual(bids.find((bid) => bid.bidId === "RFP-2026-015").sourceLinks, [
    "https://official/15", "https://official/15-amendment"
  ]);
});

test("Joshua trusts the official Open Bid Requests section but excludes scoring artifacts", () => {
  const bids = normalizeJoshuaOpenLinks([
    { text: "RFQ- Design-Build Services", href: "https://official/design-build" },
    { text: "RFQ Scoring-Design Build Services", href: "https://official/scoring" },
    { text: "RFQ-Bank Depository", href: "https://official/bank" },
    { text: "Bids & Proposals", href: "https://official/nav" }
  ], joshua, "2026-08-04T00:00:00Z");
  assert.deepEqual(bids.map((bid) => bid.title), ["RFQ- Design-Build Services", "RFQ-Bank Depository"]);
  assert.ok(bids.every((bid) => bid.sourceLinks.length === 1));
});
