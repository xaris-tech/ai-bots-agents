import assert from "node:assert/strict";
import test from "node:test";
import { normalizePublicPurchaseRows } from "../../src/scrapers/public-purchase.mjs";

const site = {
  id: "north-richland-hills-tx",
  agency: "City of North Richland Hills",
  platform: "Public Purchase",
  url: "https://www.publicpurchase.com/gems/northrichlandhills%2Ctx/buyer/public/publicInfo"
};

test("normalizes a Public Purchase open-bid row", () => {
  const bids = normalizePublicPurchaseRows([{
    cells: [
      "RFB #26-017 - Main Street Smithfield Improvements",
      "May 22, 2026 8:00:00 AM CDT",
      "Jul 17, 2026 2:00:00 PM CDT",
      "2 days",
      "1"
    ],
    text: "RFB #26-017 - Main Street Smithfield Improvements",
    href: "/gems/northrichlandhills%2Ctx/bid/bidView?bidId=123"
  }], site, "2026-07-13T00:00:00.000Z");

  assert.equal(bids.length, 1);
  assert.equal(bids[0].bidId, "26-017");
  assert.equal(bids[0].title, "Main Street Smithfield Improvements");
  assert.equal(bids[0].agency, "City of North Richland Hills");
  assert.equal(bids[0].dueDate, "2026-07-17");
  assert.equal(bids[0].bidUrl, "https://www.publicpurchase.com/gems/northrichlandhills%2Ctx/bid/bidView?bidId=123");
  assert.equal(bids[0].sourceId, "north-richland-hills-tx");
});

test("ignores Public Purchase headers and empty-state rows", () => {
  const bids = normalizePublicPurchaseRows([
    { cells: ["Title", "Start Date", "End Date", "Time Left", "Addendums"], text: "Title Start Date End Date", href: "" },
    { cells: ["There are no bids about to end for the agency at this time."], text: "There are no bids about to end for the agency at this time.", href: "" }
  ], site, "2026-07-13T00:00:00.000Z");

  assert.deepEqual(bids, []);
});

test("ignores Public Purchase bids after their end date", () => {
  const bids = normalizePublicPurchaseRows([{
    cells: ["RFB #26-001 - Old Road Work", "Jan 01, 2026", "Mar 01, 2026", "Ended", "0"],
    text: "RFB #26-001 - Old Road Work",
    href: "/bid/1"
  }], site, "2026-07-13T00:00:00.000Z");

  assert.deepEqual(bids, []);
});
