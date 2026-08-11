import test from "node:test";
import assert from "node:assert/strict";
import { toClickUpTask } from "../../src/bids.mjs";

test("ClickUp task body explains what the bid is for and its scope", () => {
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

  assert.match(task.markdown_description, /\*\*Due Date:\*\* N\/A/);
  assert.match(task.markdown_description, /\*\*Bid URL:\*\* https:\/\/example\.test\/bids\/roofing/);
  assert.match(task.markdown_description, /\*\*What the Bid Is About:\*\* Road Materials/);
  assert.match(task.markdown_description, /\*\*Purpose \/ Scope:\*\* Not less than 50,000 tons/);
  assert.doesNotMatch(task.markdown_description, /Commissioners' Court will be accepting/);
  assert.doesNotMatch(task.markdown_description, /CEO Decision/);
  assert.doesNotMatch(task.markdown_description, /Documents URL/);
  assert.doesNotMatch(task.markdown_description, /drive\.example\.test/);
});
