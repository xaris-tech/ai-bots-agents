import { ensureLoggedIn, writeDebugSnapshot } from "./common.mjs";

const AGENCY_SEARCH_PATTERN = /\/v1\.0\/organizations\/searchByLocation/i;

export async function scrapeBonfire(page, portal) {
  if (process.env.BONFIRE_USERNAME && process.env.BONFIRE_PASSWORD) {
    await loginBonfire(page);
  }

  const capturedAgencies = [];
  const captureAgencies = async (response) => {
    if (!isAgencySearchResponse(response)) return;
    capturedAgencies.push(...await agenciesFromResponse(response));
  };
  page.on("response", captureAgencies);

  try {
    await page.goto(portal.scrapeUrl || "https://vendor.bonfirehub.com/agencies/search", {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });
    await settle(page);

    const countyMap = selectedCountyMap(portal.countyLocalities || {});
    const seedAgencies = configuredSeedAgencies(portal.seedAgencies || [], countyMap);
    const login = await ensureLoggedIn(page, "Bonfire");
    let discoveredAgencies = [];
    let discoveryWarning = "";

    if (login.loggedIn) {
      capturedAgencies.length = 0;
      const state = portal.state || process.env.BONFIRE_STATE || "Texas";
      const filterApplied = await applyStateFilter(page, state);
      if (filterApplied) {
        await collectAgencyPages(page);
        discoveredAgencies = selectNearbyAgencies(capturedAgencies, countyMap);
      } else {
        discoveryWarning = `Bonfire ${state} agency filter could not be confirmed; refreshed configured public portals only.`;
      }
    } else {
      discoveryWarning = "Bonfire Agency Explorer login expired; refreshed configured public portals only.";
    }

    const agencies = mergeAgencies(seedAgencies, discoveredAgencies);
    if (agencies.length === 0) {
      return await failedClosed(
        page,
        "Bonfire returned no agencies matching the configured counties near ZIP 76180."
      );
    }

    const maxAgencies = Number(process.env.BONFIRE_MAX_AGENCIES || 40);
    const bids = [];
    const portalWarnings = [];
    for (const agency of agencies.slice(0, maxAgencies)) {
      const result = await scrapeAgencyPortal(page.context(), agency);
      if (result.rateLimited) {
        return {
          platform: "Bonfire",
          bids: [],
          warning: "Bonfire rate-limited the refresh; previous last-known-good bids were retained."
        };
      }
      bids.push(...result.bids);
      if (result.warning) portalWarnings.push(result.warning);
      await delay(Number(process.env.BONFIRE_REQUEST_DELAY_MS || 2000));
    }

    const normalized = normalizeBonfireProjects(bids);
    const debugText = process.env.DEBUG_SCRAPE
      ? await writeDebugSnapshot(page, "Bonfire")
      : "";
    const warning = [
      discoveryWarning,
      portalWarnings.length > 0
        ? `${portalWarnings.length} nearby Bonfire agency portals could not be read.`
        : ""
    ].filter(Boolean).join(" ");

    return { platform: "Bonfire", bids: normalized, warning, debugText };
  } finally {
    page.off("response", captureAgencies);
  }
}

export async function scrapeBonfireSite(page, site) {
  const domain = clean(site.domain).toLowerCase();
  if (!/^[a-z0-9.-]+\.bonfirehub\.com$/.test(domain)) {
    return {
      platform: "Bonfire",
      sourceId: site.id,
      bids: [],
      warning: `${site.agency}: missing or invalid Bonfire domain in the site profile.`
    };
  }

  try {
    await delay(Number(process.env.BONFIRE_REQUEST_DELAY_MS || 2000));
    const response = await page.context().request.get(
      `https://${domain}/PublicPortal/getOpenPublicOpportunitiesSectionData?_=${Date.now()}`,
      { timeout: 30000 }
    );
    if (!response.ok()) {
      const reason = response.status() === 429 ? "rate limited" : `HTTP ${response.status()}`;
      return {
        platform: "Bonfire",
        sourceId: site.id,
        bids: [],
        warning: `${site.agency}: Bonfire open-opportunity feed unavailable (${reason}).`
      };
    }

    const projects = await projectsFromOpenPortalResponse(response);
    const agency = { name: site.agency, domain, counties: site.county ? [site.county] : [] };
    const bids = projects
      .map((project) => normalizeBonfireProject(project, new Date(), agency))
      .filter(Boolean)
      .map((bid) => ({ ...bid, sourceId: site.id, location: site.location || bid.location }));
    return { platform: "Bonfire", sourceId: site.id, bids, warning: "" };
  } catch (error) {
    return {
      platform: "Bonfire",
      sourceId: site.id,
      bids: [],
      warning: `${site.agency}: ${error.message}`
    };
  }
}

export function normalizeBonfireAgency(agency) {
  const name = clean(agency.OrganizationName || agency.Name);
  const domain = clean(agency.Domain || agency.domain).toLowerCase();
  if (!name || !domain || !/^[a-z0-9.-]+\.bonfirehub\.com$/.test(domain)) return null;

  return {
    id: clean(agency.OrganizationUUID || agency.OrganizationID),
    name,
    domain,
    portalUrl: `https://${domain}/portal/?tab=openOpportunities`
  };
}

export function selectNearbyAgencies(agencies, countyLocalities) {
  const selected = new Map();
  for (const rawAgency of agencies) {
    const agency = normalizeBonfireAgency(rawAgency);
    if (!agency) continue;

    const normalizedName = normalizeForMatch(agency.name);
    const counties = Object.entries(countyLocalities)
      .filter(([, localities]) => localities.some((locality) =>
        containsPhrase(normalizedName, normalizeForMatch(locality))
      ))
      .map(([county]) => county);
    if (counties.length === 0) continue;

    const existing = selected.get(agency.domain);
    if (existing) {
      existing.counties = [...new Set([...existing.counties, ...counties])];
    } else {
      selected.set(agency.domain, { ...agency, counties });
    }
  }
  return [...selected.values()];
}

export function normalizeBonfireProjects(projects, now = new Date()) {
  const seen = new Set();
  const bids = [];

  for (const project of projects) {
    const bid = project?.platform === "Bonfire"
      ? project
      : normalizeBonfireProject(project, now);
    if (!bid || (bid.dueDate && bid.dueDate < now.toISOString().slice(0, 10))) continue;
    const key = bid.bidId
      ? `${bid.agency}|${bid.bidId}`
      : `${bid.title}|${bid.agency}|${bid.dueDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    bids.push(bid);
  }

  return bids;
}

export function normalizeBonfireProject(project, now = new Date(), agency = {}) {
  const title = clean(project.ProjectName || project.projectName || project.Name);
  const projectId = clean(project.ProjectID || project.projectId || project.ProjectUUID);
  const bidId = clean(project.ReferenceID || project.referenceId || projectId);
  const dueDate = toDate(project.DateClose || project.dateClose || project.CloseDate);
  if (!title || !bidId || !dueDate || dueDate < now.toISOString().slice(0, 10)) {
    return null;
  }

  const organization = project.Organization || project.organization || {};
  const agencyName = clean(
    agency.name || organization.Name || organization.OrganizationName || project.OrganizationName
  );
  const location = agency.counties?.length
    ? agency.counties.map((county) => `${county}, Texas`).join(", ")
    : locationsToText(project.Locations || project.locations) || "Texas";
  const domain = agency.domain || organization.Domain || organization.domain;
  const bidUrl = project.ExternalLink || project.externalLink || bonfireProjectUrl(domain, projectId);

  return {
    platform: "Bonfire",
    bidId,
    title,
    agency: agencyName,
    location,
    dueDate,
    bidUrl,
    documentsUrl: bidUrl,
    estimatedValue: clean(project.EstimatedValue || project.estimatedValue),
    description: [
      title,
      agencyName,
      location,
      project.DateOpen ? `Open: ${project.DateOpen}` : "",
      `Due: ${project.DateClose || project.dateClose}`
    ].filter(Boolean).join(" | "),
    scrapedAt: new Date().toISOString()
  };
}

async function applyStateFilter(page, state) {
  const control = page.getByRole("combobox", { name: /all states\/provinces/i }).first();
  if (!await control.isVisible().catch(() => false)) return false;
  await control.click({ timeout: 5000 });

  const search = page.getByRole("textbox", { name: /^search$/i }).last();
  if (!await search.isVisible().catch(() => false)) return false;
  await search.fill(state);

  const stateItem = page.getByRole("treeitem", {
    name: new RegExp(`^${escapeRegex(state)}$`, "i")
  }).first();
  if (!await stateItem.isVisible().catch(() => false)) return false;

  const checkbox = stateItem.getByRole("checkbox").first();
  const responsePromise = page.waitForResponse((response) =>
    isAgencySearchResponse(response) &&
    response.url().includes("subregions=") &&
    !response.url().includes("counties=")
  , { timeout: 20000 }).catch(() => null);

  const checked = await checkbox.check({ timeout: 5000 }).then(() => true).catch(() => false);
  if (!checked) {
    const clicked = await stateItem.click({ timeout: 5000 }).then(() => true).catch(() => false);
    if (!clicked) return false;
  }
  await page.keyboard.press("Escape");
  const response = await responsePromise;
  return Boolean(response?.ok());
}

async function collectAgencyPages(page) {
  const maxPages = Number(process.env.BONFIRE_AGENCY_MAX_PAGES || 10);
  for (let pageNumber = 2; pageNumber <= maxPages; pageNumber += 1) {
    const next = page.getByRole("button", { name: /go to next page/i }).last();
    if (!await next.isVisible().catch(() => false) || await next.isDisabled()) break;

    const responsePromise = page.waitForResponse(isAgencySearchResponse, {
      timeout: 20000
    }).catch(() => null);
    await next.click({ timeout: 5000 });
    const response = await responsePromise;
    if (!response?.ok()) break;
  }
}

async function scrapeAgencyPortal(context, agency) {
  try {
    const response = await context.request.get(
      `https://${agency.domain}/PublicPortal/getOpenPublicOpportunitiesSectionData?_=${Date.now()}`,
      { timeout: 30000 }
    );
    if (!response?.ok()) {
      return {
        bids: [],
        rateLimited: response?.status() === 429,
        warning: `${agency.name}: open-opportunity feed unavailable (${response?.status() || "no status"})`
      };
    }

    const projects = await projectsFromOpenPortalResponse(response);
    return {
      bids: projects
        .map((project) => normalizeBonfireProject(project, new Date(), agency))
        .filter(Boolean),
      warning: ""
    };
  } catch (error) {
    return { bids: [], rateLimited: false, warning: `${agency.name}: ${error.message}` };
  }
}

async function agenciesFromResponse(response) {
  if (!response.ok()) return [];
  const payload = await response.json().catch(() => []);
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

async function projectsFromOpenPortalResponse(response) {
  const payload = await response.json().catch(() => ({}));
  const projects = payload?.payload?.projects;
  return projects && typeof projects === "object" ? Object.values(projects) : [];
}

function selectedCountyMap(countyLocalities) {
  const selected = clean(process.env.BONFIRE_COUNTIES);
  if (!selected) return countyLocalities;

  const allowed = new Set(selected.split(",").map((county) => clean(county).toLowerCase()));
  return Object.fromEntries(Object.entries(countyLocalities).filter(([county]) =>
    allowed.has(county.toLowerCase()) || allowed.has(`${county} county`.toLowerCase())
  ));
}

function configuredSeedAgencies(seedAgencies, countyMap) {
  const allowed = new Set(Object.keys(countyMap));
  return seedAgencies
    .map((agency) => ({
      ...normalizeBonfireAgency(agency),
      counties: (agency.counties || []).filter((county) => allowed.has(county))
    }))
    .filter((agency) => agency.domain && agency.counties.length > 0);
}

function mergeAgencies(...groups) {
  const merged = new Map();
  for (const agency of groups.flat()) {
    const existing = merged.get(agency.domain);
    if (existing) {
      existing.counties = [...new Set([...existing.counties, ...agency.counties])];
    } else {
      merged.set(agency.domain, { ...agency });
    }
  }
  return [...merged.values()];
}

async function failedClosed(page, warning) {
  const debugText = await writeDebugSnapshot(page, "Bonfire");
  return { platform: "Bonfire", bids: [], warning, debugText };
}

function isAgencySearchResponse(response) {
  return response.request().method() !== "OPTIONS" && AGENCY_SEARCH_PATTERN.test(response.url());
}

function bonfireProjectUrl(domain, projectId) {
  const host = clean(domain);
  const id = clean(projectId).split(".").at(-1);
  if (!host || !id) return "";
  return `https://${host}/opportunities/${id}`;
}

function locationsToText(locations) {
  if (!Array.isArray(locations)) return clean(locations);
  return locations.map((location) => {
    if (typeof location === "string") return location;
    return location?.Name || location?.RegionName || location?.Code || "";
  }).filter(Boolean).join(", ");
}

function toDate(value) {
  const match = clean(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

function normalizeForMatch(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function containsPhrase(text, phrase) {
  return phrase && ` ${text} `.includes(` ${phrase} `);
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function loginBonfire(page) {
  await page.goto("https://account.bonfirehub.com/login", {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });
  await page.waitForTimeout(1000);
  if (!page.url().includes("login")) return;

  await page.locator("input").first().fill(process.env.BONFIRE_USERNAME);
  await page.getByRole("button", { name: /continue/i }).click();
  await page.waitForTimeout(5000);
  await page.locator("input[type='password']").fill(process.env.BONFIRE_PASSWORD);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForTimeout(8000);
}
