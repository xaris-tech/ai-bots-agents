import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyDescriptionQuality,
  hasUsableDescription,
} from "../../src/description-quality.mjs";

test("classifies missing, summary, and detailed source descriptions", () => {
  assert.equal(classifyDescriptionQuality(""), "missing");
  assert.equal(classifyDescriptionQuality("Install a standby generator at the operations building."), "summary");
  assert.equal(
    classifyDescriptionQuality("Install a standby generator at the operations building. ".repeat(5)),
    "detailed",
  );
});

test("only summary and detailed descriptions are usable as ClickUp briefs", () => {
  assert.equal(hasUsableDescription({ descriptionQuality: "metadata" }), false);
  assert.equal(hasUsableDescription({ descriptionQuality: "missing" }), false);
  assert.equal(hasUsableDescription({ descriptionQuality: "summary" }), true);
  assert.equal(hasUsableDescription({ descriptionQuality: "detailed" }), true);
  assert.equal(hasUsableDescription({ descriptionQuality: "unknown" }), true);
  assert.equal(hasUsableDescription({}), true);
});
