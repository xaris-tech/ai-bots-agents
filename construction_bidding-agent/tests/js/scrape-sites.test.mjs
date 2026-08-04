import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { scrapeBonfireSite } from "../../src/scrapers/bonfire.mjs";
import { staticListWarning } from "../../src/scrapers/static-list.mjs";
import {
  dedupeBids,
  loadSiteHook,
  resolveSiteAuth,
  resolveSiteHookPath
} from "../../src/site-runner.mjs";

const bonfireSite = {
  id: "burleson-tx",
  agency: "City of Burleson",
  location: "Burleson, TX",
  county: "Johnson County",
  platform: "Bonfire",
  domain: "burlesontx.bonfirehub.com",
  url: "https://burlesontx.bonfirehub.com/portal/?tab=openOpportunities"
};

function fakePage(response) {
  return {
    context: () => ({
      request: {
        get: async () => response
      }
    })
  };
}

function feedResponse(projects, { ok = true, status = 200 } = {}) {
  return {
    ok: () => ok,
    status: () => status,
    json: async () => ({ payload: { projects } })
  };
}

test("scrapeBonfireSite attributes open projects to the site profile", async () => {
  const closeDate = `${new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)} 14:00:00`;
  const page = fakePage(feedResponse({
    1: {
      ProjectID: "agency.777",
      ReferenceID: "RFP 2026-027",
      ProjectName: "Old Town Valet Services",
      DateClose: closeDate
    }
  }));

  const result = await scrapeBonfireSite(page, bonfireSite);

  assert.equal(result.warning, "");
  assert.equal(result.bids.length, 1);
  assert.equal(result.bids[0].sourceId, "burleson-tx");
  assert.equal(result.bids[0].bidId, "RFP 2026-027");
  assert.equal(result.bids[0].location, "Burleson, TX");
});

test("scrapeBonfireSite treats an empty feed as a valid zero-bid result", async () => {
  const result = await scrapeBonfireSite(fakePage(feedResponse({})), bonfireSite);
  assert.equal(result.bids.length, 0);
  assert.equal(result.warning, "");
});

test("scrapeBonfireSite fails closed on HTTP errors and rate limits", async () => {
  const blocked = await scrapeBonfireSite(
    fakePage(feedResponse({}, { ok: false, status: 429 })),
    bonfireSite
  );
  assert.equal(blocked.bids.length, 0);
  assert.match(blocked.warning, /rate limited/);

  const broken = await scrapeBonfireSite(
    fakePage(feedResponse({}, { ok: false, status: 503 })),
    bonfireSite
  );
  assert.match(broken.warning, /HTTP 503/);
});

test("scrapeBonfireSite rejects profiles without a Bonfire domain", async () => {
  const result = await scrapeBonfireSite(fakePage(feedResponse({})), {
    ...bonfireSite,
    domain: ""
  });
  assert.match(result.warning, /missing or invalid Bonfire domain/);
});

test("resolveSiteAuth resolves per-site credential env vars", () => {
  const site = {
    id: "hurst-tx",
    agency: "City of Hurst",
    platform: "Public Purchase",
    auth: {
      mode: "credentials",
      usernameEnv: "PP_HURST_USER",
      passwordEnv: "PP_HURST_PASS"
    }
  };

  const resolved = resolveSiteAuth(site, { PP_HURST_USER: "user", PP_HURST_PASS: "pass" });
  assert.deepEqual(resolved.credentials, { username: "user", password: "pass" });
});

test("resolveSiteAuth falls back to platform defaults for legacy string auth", () => {
  const site = {
    id: "godley-tx",
    agency: "City of Godley",
    platform: "Public Purchase",
    auth: "credentials"
  };

  const resolved = resolveSiteAuth(site, {
    PUBLIC_PURCHASE_USERNAME: "shared-user",
    PUBLIC_PURCHASE_PASSWORD: "shared-pass"
  });
  assert.equal(resolved.credentials.username, "shared-user");
});

test("resolveSiteAuth names the missing env vars in its failure", () => {
  const site = {
    id: "hurst-tx",
    agency: "City of Hurst",
    platform: "Public Purchase",
    auth: {
      mode: "credentials",
      usernameEnv: "PP_HURST_USER",
      passwordEnv: "PP_HURST_PASS"
    }
  };

  const resolved = resolveSiteAuth(site, {});
  assert.match(resolved.error, /PP_HURST_USER and PP_HURST_PASS/);
  assert.equal(resolved.credentials, undefined);
});

test("public and browser-session sites resolve without credentials", () => {
  assert.equal(resolveSiteAuth({ id: "a", platform: "Bonfire" }, {}).credentials, null);
  assert.equal(
    resolveSiteAuth({ id: "b", platform: "IonWave", auth: "browser-session" }, {}).credentials,
    null
  );
});

test("cross-source duplicates consolidate and preserve every source link", () => {
  const result = dedupeBids([
    {
      platform: "IonWave", agency: "City of Carrollton, TX", title: "Annual Materials Bid",
      dueDate: "2026-09-01", bidUrl: "https://ionwave.example/bid/1", documentsUrl: "https://ionwave.example/docs/1"
    },
    {
      platform: "DemandStar", agency: "City of Carrollton", title: "Annual Materials Bid",
      dueDate: "2026-09-01", bidUrl: "https://demandstar.example/bid/1"
    }
  ]);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].sourceLinks, [
    "https://ionwave.example/bid/1",
    "https://ionwave.example/docs/1",
    "https://demandstar.example/bid/1"
  ]);
});

test("same title and deadline from distinct agencies do not false-merge", () => {
  const result = dedupeBids([
    { agency: "City of Carrollton", title: "Annual Materials Bid", dueDate: "2026-09-01", bidUrl: "https://example.com/1" },
    { agency: "Parker County", title: "Annual Materials Bid", dueDate: "2026-09-01", bidUrl: "https://example.com/2" }
  ]);
  assert.equal(result.length, 2);
});

test("reviewed blank procurement pages are verified empty without hiding normal parser warnings", () => {
  assert.equal(staticListWarning([], "Current Solicitations", { agency: "Reviewed", reviewedBlankIsEmpty: true }), "");
  assert.match(staticListWarning([], "Current Solicitations", { agency: "Unknown" }), /verify page layout/);
});

test("site hooks load by site id and must export scrape()", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "site-hooks-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  fs.writeFileSync(
    path.join(dir, "custom-tx.mjs"),
    "export async function scrape(page, site) { return { platform: site.platform, sourceId: site.id, bids: [], warning: \"\" }; }\n"
  );
  fs.writeFileSync(path.join(dir, "broken-tx.mjs"), "export const scrape = 42;\n");

  const hook = await loadSiteHook({ id: "custom-tx" }, dir);
  const result = await hook.scrape(null, { id: "custom-tx", platform: "Bonfire" });
  assert.equal(result.sourceId, "custom-tx");

  assert.equal(resolveSiteHookPath({ id: "no-hook-tx" }, dir), null);
  assert.throws(
    () => resolveSiteHookPath({ id: "x", hook: "missing.mjs" }, dir),
    /was not found/
  );
  await assert.rejects(loadSiteHook({ id: "broken-tx" }, dir), /must export scrape/);
});
