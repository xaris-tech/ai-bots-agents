const OWNERSHIP_DISPOSITIONS = new Set(["batch-owned", "manual", "blocked"]);

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

export function normalizeEntityName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(?:city|town|village)\s+of\s+/gi, "")
    .replace(/,?\s+(?:texas|tx)\.?\s*$/i, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

export function extractTargetRows(csvText, tab) {
  const skipped = new Set(tab.headingRows ?? []);
  return parseCsv(csvText).flatMap((row, index) => {
    const rowNumber = index + 1;
    if (skipped.has(rowNumber)) return [];
    const displayName = String(row[tab.nameColumn] ?? "").trim();
    const normalizedName = normalizeEntityName(displayName);
    if (!normalizedName) return [];
    return [{ displayName, normalizedName, tab: tab.key, tabName: tab.name, row: rowNumber }];
  });
}

export function reconcileTargetEntities({ tabRows, sites, ownership = [], aliases = [], generatedAt = new Date().toISOString() }) {
  const aliasMap = new Map(aliases.map((alias) => [normalizeEntityName(alias.from), normalizeEntityName(alias.to)]));
  const canonicalName = (value) => aliasMap.get(normalizeEntityName(value)) ?? normalizeEntityName(value);
  const targetsByName = new Map();
  for (const sourceRow of tabRows) {
    const normalizedName = canonicalName(sourceRow.normalizedName);
    const existing = targetsByName.get(normalizedName);
    if (existing) existing.sourceReferences.push(sourceReference(sourceRow));
    else {
      targetsByName.set(normalizedName, {
        name: sourceRow.displayName,
        normalizedName,
        sourceReferences: [sourceReference(sourceRow)]
      });
    }
  }

  const sitesByName = new Map();
  for (const site of sites) {
    const normalized = canonicalName(site.targetEntity ?? site.agency);
    if (!sitesByName.has(normalized)) sitesByName.set(normalized, []);
    sitesByName.get(normalized).push(site);
  }
  const ownershipByName = new Map();
  for (const record of ownership) {
    if (!OWNERSHIP_DISPOSITIONS.has(record.disposition)) {
      throw new Error(`Invalid ownership disposition for ${record.entity}: ${record.disposition}`);
    }
    const normalized = canonicalName(record.entity);
    if (ownershipByName.has(normalized)) throw new Error(`Duplicate ownership record: ${record.entity}`);
    ownershipByName.set(normalized, record);
  }

  const targets = [...targetsByName.values()].map((target) => {
    const profiles = sitesByName.get(target.normalizedName) ?? [];
    const readyProfiles = profiles.filter((profile) => profile.enabled !== false);
    const explicit = ownershipByName.get(target.normalizedName);
    let disposition = "unresolved";
    let ready = false;
    if (readyProfiles.length) {
      disposition = "direct-profile";
      ready = true;
    } else if (explicit) {
      disposition = explicit.disposition;
      ready = disposition === "batch-owned";
    } else if (profiles.length) disposition = "blocked";
    return {
      ...target,
      disposition,
      ready,
      profileIds: profiles.map((profile) => profile.id),
      ...(checkUrl(explicit, profiles) ? { checkUrl: checkUrl(explicit, profiles) } : {}),
      ...(explicit?.owner ? { owner: explicit.owner } : {}),
      ...(explicit?.reason ? { reason: explicit.reason } : {}),
      ...(explicit?.evidence ? { evidence: explicit.evidence } : {})
    };
  }).sort((left, right) => left.normalizedName.localeCompare(right.normalizedName));

  const targetNames = new Set(targetsByName.keys());
  const configOnlyProfiles = sites
    .filter((site) => !targetNames.has(canonicalName(site.targetEntity ?? site.agency)))
    .map((site) => ({ id: site.id, agency: site.agency, enabled: site.enabled !== false }))
    .sort((left, right) => left.id.localeCompare(right.id));

  const tabs = [...new Set(tabRows.map((row) => row.tab))].map((tab) => {
    const names = new Set(tabRows.filter((row) => row.tab === tab).map((row) => canonicalName(row.normalizedName)));
    const tabTargets = targets.filter((target) => names.has(target.normalizedName));
    return coverageSummary(tabTargets, tab);
  });

  return {
    generatedAt,
    sourceRowCount: tabRows.length,
    uniqueTargetCount: targets.length,
    duplicateRowCount: tabRows.length - targets.length,
    coverage: coverageSummary(targets),
    tabs,
    dispositionCounts: countDispositions(targets),
    targets,
    configOnlyProfiles
  };
}

function checkUrl(explicit, profiles) {
  const evidenceSource = explicit?.evidence?.source;
  if (/^https?:\/\//i.test(String(evidenceSource ?? ""))) return evidenceSource;
  return profiles.find((profile) => /^https?:\/\//i.test(String(profile.url ?? "")))?.url ?? "";
}

function coverageSummary(targets, tab) {
  const ready = targets.filter((target) => target.ready).length;
  return {
    ...(tab ? { tab } : {}),
    ready,
    total: targets.length,
    percent: targets.length ? Number(((ready / targets.length) * 100).toFixed(2)) : 0
  };
}

function countDispositions(targets) {
  const counts = { "direct-profile": 0, "batch-owned": 0, manual: 0, blocked: 0, unresolved: 0 };
  for (const target of targets) counts[target.disposition] += 1;
  return counts;
}

function sourceReference(row) {
  return { tab: row.tab, tabName: row.tabName, row: row.row, displayName: row.displayName };
}
