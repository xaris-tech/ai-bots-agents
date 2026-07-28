import { dedupeKey, toClickUpTask } from "../src/bids.mjs";

const samples = [
  {
    platform: "IonWave",
    bidId: "sample-1",
    title: "Annual Aggregate Materials Supply",
    agency: "Sample County",
    location: "Texas",
    dueDate: "2026-08-01",
    bidUrl: "https://supplier.ionwave.net/sample",
    hasDocuments: true
  },
  {
    platform: "DemandStar",
    bidId: "sample-2",
    title: "Roadway Drainage Construction",
    agency: "Sample City",
    location: "Florida",
    dueDate: "2026-07-20",
    bidUrl: "https://www.demandstar.com/sample",
    hasDocuments: true
  },
  {
    platform: "Bonfire",
    bidId: "sample-3",
    title: "Office Furniture Purchase",
    agency: "Sample District",
    dueDate: "2026-09-01",
    bidUrl: "https://vendor.bonfirehub.com/sample"
  }
];

for (const bid of samples) {
  console.log(JSON.stringify({ dedupeKey: dedupeKey(bid), task: toClickUpTask(bid) }, null, 2));
}
