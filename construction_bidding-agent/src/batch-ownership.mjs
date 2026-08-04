import { normalizeEntityName } from "./target-entity-reconciliation.mjs";

export function verifyBatchOwnership(records, readBids) {
  return records
    .filter((record) => record.disposition === "batch-owned")
    .map((record) => {
      const evidence = record.evidence ?? {};
      const acceptedAgencies = new Set((evidence.agencyNames ?? []).map(normalizeEntityName));
      const bids = evidence.source ? readBids(evidence.source) : [];
      const matches = bids.filter((bid) =>
        bid.platform === record.owner && acceptedAgencies.has(normalizeEntityName(bid.agency))
      );
      return {
        entity: record.entity,
        owner: record.owner,
        source: evidence.source ?? "",
        verified: matches.length > 0,
        listingCount: matches.length,
        attributedAgencies: [...new Set(matches.map((bid) => bid.agency))].sort(),
        latestScrapedAt: matches.map((bid) => bid.scrapedAt).filter(Boolean).sort().at(-1) ?? ""
      };
    });
}
