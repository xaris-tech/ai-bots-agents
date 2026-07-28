import assert from "node:assert/strict";
import test from "node:test";

import {
  isSessionExpiredWarning,
  missingCredentialMessage,
  portalCredentials
} from "../../src/portal-login.mjs";

test("recognizes the login-wall warnings emitted by the adapters", () => {
  assert.equal(
    isSessionExpiredWarning("DemandStar appears to need login. Run npm run auth:portals, log in, then rerun scraping."),
    true
  );
  assert.equal(
    isSessionExpiredWarning("Bonfire Agency Explorer login expired; refreshed configured public portals only."),
    true
  );
  assert.equal(isSessionExpiredWarning("IonWave appears to need login."), true);
});

test("does not treat other warnings or empty results as expired sessions", () => {
  assert.equal(isSessionExpiredWarning(""), false);
  assert.equal(isSessionExpiredWarning(undefined), false);
  assert.equal(isSessionExpiredWarning("DemandStar returned no bid results for the current filter/session."), false);
  assert.equal(isSessionExpiredWarning("Bonfire rate-limited the refresh; previous last-known-good bids were retained."), false);
});

test("resolves portal credentials from the environment", () => {
  const env = { DEMANDSTAR_USERNAME: "user", DEMANDSTAR_PASSWORD: "pass" };
  assert.deepEqual(portalCredentials("DemandStar", env), { username: "user", password: "pass" });
  assert.equal(portalCredentials("DemandStar", {}), null);
  assert.equal(portalCredentials("UnknownPortal", env), null);
});

test("missing-credential message names the exact env vars", () => {
  assert.match(
    missingCredentialMessage("DemandStar"),
    /DEMANDSTAR_USERNAME and DEMANDSTAR_PASSWORD/
  );
  assert.match(missingCredentialMessage("UnknownPortal"), /no credential mapping/);
});
