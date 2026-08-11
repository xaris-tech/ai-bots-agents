import test from "node:test";
import assert from "node:assert/strict";
import { toClickUpTask } from "../../src/bids.mjs";

test("ClickUp task body uses the bid URL, website details, and N/A due date", () => {
  const task = toClickUpTask({
    platform: "StaticList",
    title: "Commercial roofing replacement",
    agency: "Callahan County",
    location: "Callahan County, TX",
    dueDate: "",
    bidUrl: "https://example.test/bids/roofing",
    documentsUrl: "https://drive.example.test/folder",
    description: "Replace the existing roof and repair damaged insulation.",
  });

  assert.match(task.markdown_description, /\*\*Due Date:\*\* N\/A/);
  assert.match(task.markdown_description, /\*\*Bid URL:\*\* https:\/\/example\.test\/bids\/roofing/);
  assert.match(task.markdown_description, /\*\*Bid Details:\*\* Replace the existing roof/);
  assert.doesNotMatch(task.markdown_description, /CEO Decision/);
  assert.doesNotMatch(task.markdown_description, /Documents URL/);
  assert.doesNotMatch(task.markdown_description, /drive\.example\.test/);
});
