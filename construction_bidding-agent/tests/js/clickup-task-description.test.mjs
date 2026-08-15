import test from "node:test";
import assert from "node:assert/strict";
import { formatClickUpDescription, toClickUpTask } from "../../src/bids.mjs";

test("ClickUp task body uses the compact project brief layout", () => {
  const task = toClickUpTask({
    platform: "StaticList",
    title: "Commercial roofing replacement",
    agency: "Callahan County",
    location: "Callahan County, TX",
    dueDate: "",
    bidUrl: "https://example.test/bids/roofing",
    documentsUrl: "https://drive.example.test/folder",
    description: "NOTICE OF BID | The Commissioners' Court will be accepting sealed bids for the purchase of the following: | Road Materials: | Not less than 50,000 tons of flex base road material for county road maintenance.",
  });

  assert.equal(task.markdown_description, [
    "**Source:** StaticList",
    "**Category:** Construction",
    "",
    "## Commercial roofing replacement",
    "",
    "Road Materials: Not less than 50,000 tons of flex base road material for county road maintenance.",
    "",
    "**Location:** Callahan County, TX",
    "**Due Date:** N/A",
    "**URL:** https://example.test/bids/roofing"
  ].join("\n"));
  assert.doesNotMatch(task.markdown_description, /Commissioners' Court will be accepting/);
  assert.doesNotMatch(task.markdown_description, /CEO Decision/);
  assert.doesNotMatch(task.markdown_description, /Agency \/ Buyer|Project Name|Purpose \/ Scope|Documents URL/);
  assert.doesNotMatch(task.markdown_description, /drive\.example\.test/);
});

test("ClickUp task URL prefers a bid-specific document over a listing page", () => {
  const task = toClickUpTask({
    platform: "CivicEngage",
    title: "Generator installation",
    location: "Haslet, TX",
    bidUrl: "https://example.test/BID-POSTINGS",
    documentsUrl: "https://example.test/DocumentCenter/View/9000/Generator-RFP",
    description: "Install a standby generator."
  });

  assert.match(task.markdown_description, /\*\*URL:\*\* https:\/\/example\.test\/DocumentCenter\/View\/9000\/Generator-RFP/);
  assert.doesNotMatch(task.markdown_description, /\*\*URL:\*\* https:\/\/example\.test\/BID-POSTINGS/);
});

test("ClickUp task does not present listing metadata as a real project brief", () => {
  const description = formatClickUpDescription({
    platform: "IonWave",
    title: "Roof Replacement",
    agency: "Example City",
    location: "Example, TX",
    dueDate: "2026-09-01",
    bidUrl: "https://example.test/bid",
    description: "Roof Replacement Example City 8/1/2026 9/1/2026 Issued OPEN",
    descriptionQuality: "metadata",
  }, "Construction");

  assert.match(description, /No project description was provided by the source\./);
  assert.doesNotMatch(description, /Issued OPEN/);
});
