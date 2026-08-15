import test from "node:test";
import assert from "node:assert/strict";
import { verifyBatchOwnership } from "../../src/batch-ownership.mjs";

test("verifies ownership only from exact normalized agency attribution", () => {
  const records = [{
    entity: "Arlington",
    disposition: "batch-owned",
    owner: "IonWave",
    evidence: { source: "ionwave.json", agencyNames: ["City of Arlington"] }
  }];
  const result = verifyBatchOwnership(records, () => [
    { platform: "IonWave", agency: "Arlington ISD, TX", scrapedAt: "2026-08-01T00:00:00Z" },
    { platform: "IonWave", agency: "City of Arlington, TX", scrapedAt: "2026-08-02T00:00:00Z" },
    { platform: "DemandStar", agency: "City of Arlington", scrapedAt: "2026-08-03T00:00:00Z" }
  ])[0];
  assert.equal(result.verified, true);
  assert.equal(result.listingCount, 1);
  assert.deepEqual(result.attributedAgencies, ["City of Arlington, TX"]);
});

test("does not mistake a related school district for city ownership", () => {
  const records = [{
    entity: "Carrollton",
    disposition: "batch-owned",
    owner: "IonWave",
    evidence: { source: "ionwave.json", agencyNames: ["City of Carrollton"] }
  }];
  const result = verifyBatchOwnership(records, () => [
    { platform: "IonWave", agency: "Carrollton-Farmers Branch ISD, TX" }
  ])[0];
  assert.equal(result.verified, false);
  assert.equal(result.listingCount, 0);
});

test("verifies Johnson County and Grapevine only from their configured batch owners", () => {
  const records = [
    {
      entity: "Johnson County",
      disposition: "batch-owned",
      owner: "Bonfire",
      evidence: { source: "bonfire.json", agencyNames: ["Johnson County"] }
    },
    {
      entity: "Grapevine",
      disposition: "batch-owned",
      owner: "IonWave",
      evidence: { source: "ionwave.json", agencyNames: ["City of Grapevine, TX"] }
    }
  ];
  const feeds = {
    "bonfire.json": [
      { platform: "Bonfire", agency: "Johnson County" },
      { platform: "Bonfire", agency: "City of Burleson" }
    ],
    "ionwave.json": [
      { platform: "IonWave", agency: "City of Grapevine, TX" },
      { platform: "DemandStar", agency: "Grapevine TX Purchasing, Grapevine, TX" }
    ]
  };

  const results = verifyBatchOwnership(records, (source) => feeds[source]);
  assert.deepEqual(results.map(({ entity, verified, listingCount }) => ({ entity, verified, listingCount })), [
    { entity: "Johnson County", verified: true, listingCount: 1 },
    { entity: "Grapevine", verified: true, listingCount: 1 }
  ]);
});
