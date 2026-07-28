import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCivicEngageRows } from "../../src/scrapers/civicengage.mjs";

const site = {
  id: "mansfield-tx",
  agency: "City of Mansfield",
  platform: "CivicEngage",
  url: "https://www.mansfieldtexas.gov/Bids.aspx"
};

test("normalizes an open CivicEngage bid row", () => {
  const bids = normalizeCivicEngageRows([{
    text: [
      "Parks & Recreation",
      "Robert and Ann Smith Park Disc Golf Improvements",
      "Bid No. 2026-20-99-01",
      "Status: Open",
      "Closes: 7/21/2026 2:00 PM"
    ].join("\n"),
    href: "/Bids.aspx?BidID=201"
  }], site, "2026-07-13T00:00:00.000Z");

  assert.equal(bids.length, 1);
  assert.deepEqual(bids[0], {
    platform: "CivicEngage",
    sourceId: "mansfield-tx",
    bidId: "2026-20-99-01",
    title: "Robert and Ann Smith Park Disc Golf Improvements",
    agency: "City of Mansfield",
    location: "Mansfield, TX",
    dueDate: "2026-07-21",
    bidUrl: "https://www.mansfieldtexas.gov/Bids.aspx?BidID=201",
    documentsUrl: "https://www.mansfieldtexas.gov/Bids.aspx?BidID=201",
    estimatedValue: "",
    description: "Parks & Recreation | Robert and Ann Smith Park Disc Golf Improvements | Bid No. 2026-20-99-01 | Status: Open | Closes: 7/21/2026 2:00 PM",
    scrapedAt: "2026-07-13T00:00:00.000Z"
  });
});

test("ignores closed CivicEngage rows and navigation text", () => {
  const bids = normalizeCivicEngageRows([
    { text: "Status: Closed\nRoad Maintenance\nBid No. 2025-01", href: "/Bids.aspx?BidID=1" },
    { text: "Home\nDepartments\nSign up for notifications", href: "/notify" }
  ], site, "2026-07-13T00:00:00.000Z");

  assert.deepEqual(bids, []);
});

test("reads the closing date when CivicEngage renders labels before values", () => {
  const bids = normalizeCivicEngageRows([{
    text: "Road Improvements\nBid No. 2026-01\nStatus:\nCloses:\nOpen\n7/30/2026 2:00 PM",
    href: "bids.aspx?bidID=197"
  }], site, "2026-07-13T00:00:00.000Z");

  assert.equal(bids[0].dueDate, "2026-07-30");
});

test("ignores stale rows that remain marked open after their closing date", () => {
  const bids = normalizeCivicEngageRows([{
    text: "Benefit Broker Services\nBid No. HR2026-01\nStatus:\nCloses:\nOpen\n3/2/2026 5:00 PM",
    href: "bids.aspx?bidID=123"
  }], site, "2026-07-13T00:00:00.000Z");

  assert.deepEqual(bids, []);
});
