import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDocListLinks } from "../../src/scrapers/civicplus-doclist.mjs";

const site = { id: "haslet-tx", agency: "City of Haslet", location: "Haslet, TX", platform: "CivicEngage", url: "https://www.haslet.org/395/BID-POSTINGS" };

test("keeps solicitation docs, drops budgets and fee schedules", () => {
  const bids = normalizeDocListLinks([
    { text: "Advertisement for Bid", href: "https://www.haslet.org/DocumentCenter/View/5377" },
    { text: "Adopted Operating Budget FY 2025-2026", href: "https://www.haslet.org/DocumentCenter/View/6196/Adopted-Budget" },
    { text: "Municipal Court Fine List", href: "https://www.haslet.org/DocumentCenter/View/244/Fine-List" },
    { text: "RFP 2026-18 Generator Project", href: "https://www.haslet.org/DocumentCenter/View/9000/RFP-2026-18-Generator" }
  ], site);
  assert.equal(bids.length, 2);
  assert.equal(bids[0].title, "Advertisement for Bid");
  assert.equal(bids[1].bidId, "RFP 2026-18");
  assert.equal(bids[0].sourceId, "haslet-tx");
});
