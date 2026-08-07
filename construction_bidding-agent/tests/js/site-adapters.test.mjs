import assert from "node:assert/strict";
import test from "node:test";

import { normalizeBidNetRows, normalizeBidNetSearchRows } from "../../src/scrapers/bidnet.mjs";
import { normalizeIonWaveSiteRows } from "../../src/scrapers/ionwave.mjs";
import { normalizeStaticItems } from "../../src/scrapers/static-list.mjs";

const FUTURE = new Date(Date.now() + 14 * 86400000);
const futureUs = `${FUTURE.getMonth() + 1}/${FUTURE.getDate()}/${FUTURE.getFullYear()}`;
const futureUsPadded = futureUs.split("/").map((p, i) => (i < 2 ? p.padStart(2, "0") : p)).join("/");

const ionSite = {
  id: "watauga-tx",
  agency: "City of Watauga, TX",
  location: "Watauga, TX",
  url: "https://cityofwatauga.ionwave.net/SourcingEvents.aspx?SourceType=1"
};

test("IonWave site rows normalize with header and pager rows removed", () => {
  const bids = normalizeIonWaveSiteRows([
    { cells: ["Bid Number", "Bid Title", "Bid Type", "Bid Issue Date", "Bid Close Date/Time"] },
    { cells: ["1 2 items in 1 pages", "Data pager", "select"] },
    { cells: ["PWSM26007", "2026 Concrete Panel Replacement", "Bid Posting", "Public Works", "6/29/2026", `${futureUs} 02:00:00 PM (CT)`] },
    { cells: ["OLD-1", "Expired thing", "Bid Posting", "1/2/2026", "1/9/2026 02:00:00 PM (CT)"] }
  ], ionSite);

  assert.equal(bids.length, 1);
  assert.equal(bids[0].bidId, "PWSM26007");
  assert.equal(bids[0].sourceId, "watauga-tx");
  assert.equal(bids[0].agency, "City of Watauga, TX");
  assert.ok(bids[0].dueDate > new Date().toISOString().slice(0, 10));
});

const bidnetSite = {
  id: "dallas-county-tx",
  agency: "Dallas County",
  location: "Dallas County, TX",
  url: "https://www.bidnetdirect.com/texas/dallas-county/solicitations/open-bids?selectedContent=BUYER"
};

test("BidNet rows normalize; nav links and expired items rejected", () => {
  const bids = normalizeBidNetRows([
    {
      title: "Open Solicitations",
      href: "https://www.bidnetdirect.com/texas/dallas-county/solicitations/open-bids?selectedContent=BUYER",
      box: "Open Solicitations"
    },
    {
      title: "Central Trail Extension",
      href: "https://www.bidnetdirect.com/texas/solicitations/open-bids/Central-Trail-Extension/0000428105?purchasingGroupId=840755",
      box: `2026-613-6994 Central Trail Extension Texas Calendar Published 06/18/2026 Clock Closing ${futureUsPadded}`
    },
    {
      title: "Expired Thing",
      href: "https://www.bidnetdirect.com/texas/solicitations/open-bids/Expired-Thing/0000001111",
      box: "2026-000 Expired Thing Texas Calendar Published 01/02/2026 Clock Closing 01/09/2026"
    }
  ], bidnetSite);

  assert.equal(bids.length, 1);
  assert.equal(bids[0].bidId, "2026-613-6994");
  assert.equal(bids[0].title, "Central Trail Extension");
  assert.equal(bids[0].bidUrl, "https://www.bidnetdirect.com/texas/solicitations/open-bids/Central-Trail-Extension/0000428105");
  assert.equal(bids[0].sourceId, "dallas-county-tx");
});

test("BidNet wide search never scrapes an upgrade-required (subscriber-only) row", () => {
  const bids = normalizeBidNetSearchRows([
    {
      title: "FORM 2615 MET ENVELOPES",
      href: "/private/supplier/interception/view-notice/444095486336",
      rowText: `FORM 2615 MET ENVELOPES Michigan State & Local upgrade required State & Local Bids CALENDAR CLOSING DATE ${futureUsPadded} 08:00 AM EDT LOCATION LOCATION Michigan Published Date 07/14/2026`,
      locked: true,
      agency: "",
      category: "State & Local Bids"
    },
    {
      title: "JESP TENNIS COURTS CONSTRUCTION",
      href: "/private/supplier/interception/open-solicitation/9354909253?target=view",
      rowText: `JESP TENNIS COURTS CONSTRUCTION Comal County Member Agency Bids CALENDAR CLOSING DATE ${futureUsPadded} 04:00 PM EDT LOCATION LOCATION Texas Published Date 07/14/2026`,
      locked: false,
      agency: "Comal County",
      category: "Member Agency Bids"
    },
    {
      title: "Already Closed Thing",
      href: "/private/supplier/interception/open-solicitation/1111111111?target=view",
      rowText: "Already Closed Thing Some Agency Member Agency Bids CALENDAR CLOSING DATE 01/09/2026 08:00 AM EDT LOCATION LOCATION Texas Published Date 01/02/2026",
      locked: false,
      agency: "Some Agency",
      category: "Member Agency Bids"
    }
  ], "bidnet-wide-texas");

  assert.equal(bids.length, 1);
  assert.equal(bids[0].bidId, "9354909253");
  assert.equal(bids[0].title, "JESP TENNIS COURTS CONSTRUCTION");
  assert.equal(bids[0].agency, "Comal County");
  assert.equal(bids[0].location, "Texas");
  assert.equal(bids[0].bidUrl, "https://www.bidnetdirect.com/private/supplier/interception/open-solicitation/9354909253");
  assert.equal(bids[0].sourceId, "bidnet-wide-texas");
});

test("StaticList rejects undated solicitation documents labeled with a past month", () => {
  const site = {
    id: "palo-pinto-county-tx",
    agency: "Palo Pinto County",
    location: "Palo Pinto County, TX",
    url: "https://www.co.palo-pinto.tx.us/page/PublicNotices"
  };
  const bids = normalizeStaticItems([
    {
      kind: "link",
      text: "RFP package - Courthouse roof - Apr 2026",
      href: "https://www.co.palo-pinto.tx.us/upload/roof-rfp.pdf"
    },
    {
      kind: "link",
      text: "Court House RFP Q/A's",
      href: "https://www.co.palo-pinto.tx.us/upload/roof-rfp-questions.pdf"
    },
    {
      kind: "link",
      text: "RFP Grant Administrator",
      href: "https://www.co.palo-pinto.tx.us/upload/grant-rfp.pdf"
    }
  ], site, "2026-08-04T00:00:00Z");

  assert.deepEqual(bids.map((bid) => bid.title), ["RFP Grant Administrator"]);
});

test("StaticList rejects solicitation documents inside a closed-bids section", () => {
  const bids = normalizeStaticItems([{
    kind: "link",
    text: "BID 26-5600-01 230 kW DIESEL GENERATOR",
    containerText: "BID 26-5600-01 230 kW DIESEL GENERATOR",
    sectionText: "Closed Bids",
    href: "https://county.example/upload/generator.pdf"
  }], {
    id: "county-example",
    agency: "Example County",
    location: "Example County, TX"
  }, "2026-08-04T12:00:00.000Z");

  assert.deepEqual(bids, []);
});

test("StaticList rejects a bid whose adjacent posting context has a past deadline", () => {
  const bids = normalizeStaticItems([{
    kind: "link",
    text: "RE-BID 26-4090-08 FUEL CARD SERVICES",
    containerText: "RE-BID 26-4090-08 FUEL CARD SERVICES\nDue Date Tuesday, June 30, 2026, 10:00 AM",
    href: "https://county.example/upload/fuel-card-services.pdf"
  }], {
    id: "county-example",
    agency: "Example County",
    location: "Example County, TX"
  }, "2026-08-04T12:00:00.000Z");

  assert.deepEqual(bids, []);
});
