import test from "node:test";
import assert from "node:assert/strict";
import { matchesClickUpKeywords } from "../../src/keywords.mjs";

test("drops civil infrastructure terms removed from the ClickUp filter", () => {
  const removedTerms = [
    "stormwater", "landscaping", "culvert", "resurfacing", "paving",
    "sewer", "main line", "pump station", "wastewater", "lift station",
    "transmission main", "levee", "flood control", "traffic signal",
    "widening", "bridge",
  ];

  for (const term of removedTerms) {
    assert.equal(matchesClickUpKeywords(term), false, term);
  }
});

test("keeps commercial remodel trade terms in the ClickUp filter", () => {
  const remodelTerms = [
    "carpentry", "structural steel", "framing", "roofing", "windows",
    "glazing", "stucco", "EIFS", "metal panel", "waterproofing", "sealants",
    "electrical", "plumbing", "HVAC", "fire protection", "sprinklers",
    "low-voltage", "data-comm", "drywall", "painting", "flooring", "tile",
    "carpet", "VCT", "epoxy", "ceilings", "ACT grid", "millwork",
    "cabinetry", "doors", "frames", "hardware", "fire alarm", "elevator",
    "signage", "insulation", "storefront systems", "concrete flatwork",
    "final cleaning", "permitting", "inspections coordination",
  ];

  for (const term of remodelTerms) {
    assert.equal(matchesClickUpKeywords(term), true, term);
  }
});

test("keeps scopes reflected in the active ClickUp Projects list", () => {
  assert.equal(matchesClickUpKeywords("Job Order Contract (JOC) for facilities installation and maintenance"), true);
  assert.equal(matchesClickUpKeywords("Rock and Base Materials - limestone flex base"), true);
  assert.equal(matchesClickUpKeywords("Bridge concrete riprap and RCP repairs"), true);
  assert.equal(matchesClickUpKeywords("Police station renovation"), true);
});

test("excludes professional services that only mention construction scopes", () => {
  assert.equal(matchesClickUpKeywords("Construction Manager at Risk for fire station improvements"), false);
  assert.equal(matchesClickUpKeywords("Professional engineering services for roadway realignment"), false);
  assert.equal(matchesClickUpKeywords("Construction inspection services for various projects"), false);
  assert.equal(matchesClickUpKeywords("Consulting services for well rehabilitation"), false);
});

test("does not exclude explicit aggregate supply opportunities", () => {
  assert.equal(matchesClickUpKeywords("Engineering department purchase of crushed rock and flex base"), true);
});
