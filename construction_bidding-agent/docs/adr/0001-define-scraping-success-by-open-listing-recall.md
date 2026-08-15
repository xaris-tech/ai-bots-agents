# ADR 0001: Define scraping success by open-listing recall

Date: 2026-08-04

## Status

Accepted

## Context

Scraper success needs a measurable denominator and a ground truth. The target
entities originate in two tabs of the canonical Google Sheet, while the
official bidding listings show the opportunities the scraper is expected to
collect. Keyword filtering happens later and must not hide extraction gaps.

## Decision

- The Target Entity Universe is the union of **Main Target Entities Agg** and
  **Additional Target Entities for Agg** in the canonical Google Sheet.
- Every target entity must have a configured site profile. Entity Profile
  Coverage targets 100%; only profiles with a working official bidding source
  count. Missing, disabled, dead-URL, or unresolved-source profiles are
  onboarding/readiness gaps rather than daily scraper-runtime failures.
- Each incomplete profile creates one persistent ClickUp onboarding task,
  separate from runtime incidents, with notifications sent to the ClickUp
  Notifications channel.
- Operational tasks and reviews live in the dedicated ClickUp Scraper
  Operations location (`90112388381`), separate from the Prospects list.
- Daily Human Review has no completion deadline; outstanding work remains
  visible but does not fail a timing KPI.
- The ClickUp Notifications channel receives a run update every day, including
  fully clean runs.
- Notifications use ClickUp Chat channel `8cj5me8-631`; Human Review uses
  channel `8cj5me8-671`.
- Each in-scope entity's official website bidding listing is the ground truth.
- The scraper is accountable for capturing every Open Listing, not only bids
  that match aggregate-supply or general-construction keywords.
- The primary completeness KPI is Listing Recall:

  `Captured Open Listings / Ground-truth Open Listings`

- The target Listing Recall is 100%.
- Capture does not require a strict set of metadata fields. Field Completeness
  is monitored separately and does not change Listing Recall.
- Multiple source occurrences of the same real procurement must produce one
  Consolidated Opportunity. Deduplication quality must track both remaining
  duplicates and false merges of distinct opportunities.
- A Consolidated Opportunity retains all discovered source links.
- The scraper operates daily. A newly posted Open Listing should be captured
  by the next successful daily run, scheduled for 7:00 AM America/Chicago.
- Every entity check must produce a durable status log. Blocked, timed-out, or
  unverifiable entities must be visible rather than treated as empty results.
- Runs with such failures generate both one ClickUp run summary and a separate
  actionable alert for every failed entity.
- Failed or unverifiable entity checks require Human Review; they must not be
  silently interpreted as zero open listings.
- ClickUp tracks at most one persistent open incident per entity. Repeated
  failures append run history to that incident rather than creating a new task
  each day.
- A later successful verified scrape automatically closes the entity incident
  with a recovery note.
- Every target entity receives an independent human ground-truth audit every
  day. This audit, not the scraper's own status, establishes actual Listing
  Recall.
- Initially, the human audit records pass/fail per entity because no audit UI
  exists. Entity Audit Pass Rate is the operational completeness KPI until
  listing-level evidence capture is built.
- An entity audit fails for a missed Open Listing or an inability to verify the
  source caused by website inaccessibility, scraper error, bot blocking, or
  Cloudflare blocking. Extra or stale records are outside this initial KPI.
- A reachable source that clearly contains zero Open Listings is a
  verified-empty pass.
- A run that finishes processing may be marked Completed with
  blockers/warnings even when some entities fail. Overall completion must not
  be presented as full coverage; the Entity Audit Pass Rate and incidents
  remain visible.
- Daily Run Status has three levels: Completed at 100% verified entities;
  Completed with blockers/warnings from 50% through less than 100%; and Failed
  below 50% or when processing cannot complete.
- Daily Human Review verifies every Captured Listing as Aggregate,
  Construction, Both, or Neither. Classification Review Pass Rate is measured
  separately from extraction completeness and targets 100%.
- Until a review UI exists, classification review produces a daily pass/fail
  summary. All mistakes from a failed daily review are grouped into one
  ClickUp Human Review task for that day.
- Daily Human Review also produces a pass/fail Consolidation Review covering
  duplicate merging, false merges, and preservation of all source links.
- Classification and consolidation failures share one daily ClickUp Human
  Review task with separate sections.

## Consequences

- Entity coverage must be reconciled against the Sheet tabs rather than
  inferred only from `config/sites.json`.
- Verification requires an independent observation of official listings; a
  successful scraper run cannot validate itself.
- Category relevance is measured after extraction and is not part of Listing
  Recall.
- Downstream eligibility applies geography by category: construction listings
  must be within 50 miles of ZIP 76180, while aggregate listings have no
  geographic restriction.
- The 50-mile construction boundary uses driving distance, not a straight-line
  geographic radius.
- Eligibility is category-OR: a Both-classified opportunity remains eligible
  at any distance because Aggregate has no geographic restriction.
- A construction listing without a usable project location is captured and
  routed to manual review. The issuing entity's office or city must not be
  substituted automatically for the project location.
