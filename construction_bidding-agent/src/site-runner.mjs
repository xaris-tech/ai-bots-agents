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
  const consolidated = new Map();
  for (const item of items) {
    // Platform and bid number deliberately stay out of the key because a
    // procurement can be cross-posted with different tracking identifiers.
    // The issuing entity stays in the key to prevent unrelated agencies'
    // generic titles from false-merging.
    const key = `${normalizeAgency(item.agency)}|${normalizeText(item.title)}|${item.dueDate || ""}`;
    const existing = consolidated.get(key);
    const links = sourceLinks(item);
    if (!existing) {
      consolidated.set(key, { ...item, sourceLinks: links });
      continue;
    }
    existing.sourceLinks = [...new Set([...existing.sourceLinks, ...links])];
  }
  return [...consolidated.values()];
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeAgency(value) {
  const primaryName = String(value || "").split(",")[0];
  return normalizeText(primaryName)
    .replace(/^(?:city|town|village) of /, "")
    .replace(/\b(?:texas|tx)$/, "")
    .trim();
}

function sourceLinks(item) {
  return [...new Set([
    ...(Array.isArray(item.sourceLinks) ? item.sourceLinks : []),
    item.bidUrl,
    item.documentsUrl
  ].filter(Boolean))];
}
