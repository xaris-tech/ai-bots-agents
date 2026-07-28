import assert from "node:assert/strict";
import test from "node:test";

import { normalizeDocListLinks as normalizeWestlakeLinks } from "../../src/scrapers/civicplus-doclist.mjs";

const site = {
  id: "westlake-tx",
  agency: "Town of Westlake",
  location: "Westlake, TX",
  platform: "CivicEngage",
  url: "https://www.westlake-tx.org/256/Bids-Proposals"
};

test("extracts solicitation documents from the Westlake content page", () => {
  const bids = normalizeWestlakeLinks([
    {
      text: "Backup Generator Installation Project",
      href: "https://www.westlake-tx.org/DocumentCenter/View/6769/Combined-Legal-Notice-and-Notice-to-Bidderes-for-RFP-2026-18-Backup-Generator-Installation-Project"
    },
    {
      text: "Town of Westlake Comprehensive Plan",
      href: "https://www.westlake-tx.org/DocumentCenter/View/6748/Comp-Plan-RFQ-2026"
    },
    { text: "Agenda Packet", href: "https://www.westlake-tx.org/DocumentCenter/View/9999/Council-Agenda" }
  ], site);

  assert.equal(bids.length, 2);
  assert.equal(bids[0].bidId, "RFP 2026-18");
  assert.equal(bids[0].sourceId, "westlake-tx");
  assert.equal(bids[1].bidId, "RFQ 2026");
  assert.match(bids[1].documentsUrl, /View\/6748/);
});

test("deduplicates repeated document links", () => {
  const link = {
    text: "Backup Generator Installation Project",
    href: "https://www.westlake-tx.org/DocumentCenter/View/6769/RFP-2026-18-Backup-Generator"
  };
  assert.equal(normalizeWestlakeLinks([link, link], site).length, 1);
});
