import test from "node:test";
import assert from "node:assert/strict";
import { matchesClickUpKeywords } from "../../src/keywords.mjs";

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
