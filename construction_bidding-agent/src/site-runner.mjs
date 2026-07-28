import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultSitesDir = fileURLToPath(new URL("./sites/", import.meta.url));

const platformCredentialEnvs = {
  "Public Purchase": {
    usernameEnv: "PUBLIC_PURCHASE_USERNAME",
    passwordEnv: "PUBLIC_PURCHASE_PASSWORD"
  }
};

export function selectSites(sites, args) {
  return sites.filter((site) => {
    if (!site.enabled) return false;
    if (args.site && site.id !== args.site) return false;
    // Cloudflare-walled sites can't be cleared by a headless launch (the
    // launch fingerprint fails the managed challenge no matter how long we
    // wait). They are scraped through the operator's real Chrome over CDP by
    // scripts/scrape-cloudflare-sites.mjs. Skip them here unless the caller
    // explicitly targets one (--site) or opts in (--include-cloudflare), so
    // the headless batch neither wastes time on them nor overwrites the
    // real-Chrome results with empty rows.
    if (site.cloudflare && !args.site && !args["include-cloudflare"]) return false;
    if (args.platform && site.platform.toLowerCase() !== args.platform.toLowerCase()) return false;
    if (args.priority && site.priority !== Number(args.priority)) return false;
    if (args.tab && site.workbookTab.toLowerCase() !== args.tab.toLowerCase()) return false;
    return true;
  });
}

export function resolveSiteAuth(site, env = process.env) {
  const auth = site.auth;
  const mode = typeof auth === "string" ? auth : auth?.mode || "public";
  if (mode === "public" || mode === "browser-session") return { credentials: null };
  if (mode !== "credentials") {
    return { error: `${site.id}: unsupported auth mode "${mode}" in the site profile.` };
  }

  const defaults = platformCredentialEnvs[site.platform] || {};
  const usernameEnv = (typeof auth === "object" && auth.usernameEnv) || defaults.usernameEnv;
  const passwordEnv = (typeof auth === "object" && auth.passwordEnv) || defaults.passwordEnv;
  if (!usernameEnv || !passwordEnv) {
    return { error: `${site.id}: auth mode "credentials" requires usernameEnv and passwordEnv in the site profile.` };
  }

  const username = env[usernameEnv];
  const password = env[passwordEnv];
  if (!username || !password) {
    const missing = [username ? "" : usernameEnv, password ? "" : passwordEnv].filter(Boolean).join(" and ");
    return { error: `${site.id}: set ${missing} in .env before scraping ${site.agency}.` };
  }
  return { credentials: { username, password } };
}

export function resolveSiteHookPath(site, dir = defaultSitesDir) {
  const fileName = site.hook || `${site.id}.mjs`;
  const hookPath = path.join(dir, fileName);
  if (fs.existsSync(hookPath)) return hookPath;
  if (site.hook) {
    throw new Error(`${site.id}: configured site hook ${site.hook} was not found in src/sites/.`);
  }
  return null;
}

export async function loadSiteHook(site, dir = defaultSitesDir) {
  const hookPath = resolveSiteHookPath(site, dir);
  if (!hookPath) return null;
  const module = await import(pathToFileURL(hookPath).href);
  if (typeof module.scrape !== "function") {
    throw new Error(`${site.id}: site hook must export scrape(page, site, { adapter }).`);
  }
  return module;
}

export function dedupeBids(items) {
  const seen = new Set();
  return items.filter((item) => {
    // No agency, no bidId, no platform in the key: the same real-world bid
    // reaches this feed from more than one source, and each source can
    // format the same bid differently.
    //   - Agency: "City of Irving" vs "City of Irving, TX".
    //   - BidId: IonWave's central feed prefixes its own tracking code
    //     ("RFB - Sealed - Public-26-007") where Keller's own IonWave page
    //     shows the agency's plain number ("26-007").
    //   - Platform: a municipality can cross-post the identical bid to a
    //     syndication network (DemandStar) and its own portal (IonWave) —
    //     Keller's "2026 Janitorial Services" bid does exactly this.
    // Title stays in the key (with dueDate) so agencies that reuse the same
    // short bid-number prefix across unrelated projects (e.g. Copperas
    // Cove's "Bid No. PW ...") don't collapse into one, and so two
    // different agencies' bids that happen to close on the same date don't
    // collide.
    const key = `${normalizeText(item.title)}|${item.dueDate}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}
