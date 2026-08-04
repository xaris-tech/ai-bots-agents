# Scraper KPI Specification

**Status:** Accepted
**Date:** 2026-08-04
**Decision record:** [ADR 0001](adr/0001-define-scraping-success-by-open-listing-recall.md)

## Objective

Verify that the daily scraper captures every open bidding listing from the
target entities, consolidates duplicate occurrences, classifies opportunities
correctly, and surfaces anything that prevents trustworthy verification.

## Scope and ground truth

The **Target Entity Universe** is the union of these tabs in the canonical
Google Sheet:

- `Main Target Entities Agg`
- `Additional Target Entities for Agg`

Each entity's official website bidding listing is the ground truth. The
scraper must collect every open listing before applying category or geographic
filters. A reachable listing that clearly shows zero open opportunities is a
verified-empty success.

## KPI scorecard

| KPI | Formula or result | Target | Current measurement |
| --- | --- | ---: | --- |
| Ready Entity Profile Coverage | ready target profiles / all target entities | 100% | Automated Sheet-to-registry reconciliation |
| Listing Recall | captured open listings / official open listings | 100% | Target metric; exact calculation deferred until a listing-level audit UI exists |
| Entity Audit Pass Rate | target entities passing daily audit / target entities audited | 100% | Daily human pass/fail per entity |
| Classification Review Pass Rate | correctly classified listings / reviewed listings | 100% | Daily pass/fail summary until a review UI exists |
| Consolidation Review | Duplicate merging, false-merge prevention, and source-link preservation | Pass | Daily human pass/fail |
| Daily Run Cadence | Run starts once per day at 7:00 AM `America/Chicago` | 100% of days | Automated run log |

Field Completeness is monitored separately and does not gate capture success.
Official websites may legitimately omit metadata.

## Entity audit rules

An entity passes when its official listing is reachable and every visible open
listing appears in scraper output. A reachable source with zero open listings
also passes.

An entity fails when:

- an open listing is missed;
- the website is inaccessible;
- the scraper errors;
- bot protection blocks access; or
- Cloudflare blocks access.

Extra or stale output records are outside the initial completeness KPI.

## Daily run status

| Status | Rule |
| --- | --- |
| `Completed` | 100% of target entities pass verification |
| `Completed with blockers/warnings` | At least 50% but fewer than 100% pass |
| `Failed` | Fewer than 50% pass, or processing cannot complete |

A completed run with warnings is not full coverage. Its failed entities and
reduced pass rate must remain visible.

## Classification and eligibility

Every captured opportunity is reviewed as one of:

- Aggregate
- Construction
- Both
- Neither

Eligibility rules:

- Aggregate: no geographic restriction.
- Construction: project location must be within a 50-mile drive of ZIP 76180.
- Both: eligible regardless of distance because Aggregate eligibility applies.
- Construction without a usable project location: Human Review; do not
  substitute the issuing entity's office or city.

## Consolidation

Multiple occurrences of the same real procurement become one Consolidated
Opportunity. The record must retain every discovered source link. Daily review
checks for duplicate leakage, false merges, and lost source links.

## Logging and ClickUp workflow

Every entity check records a durable status: success, verified empty, blocked,
timed out, parser error, or otherwise unverifiable.

Operational work lives in ClickUp **Scraper Operations**:
<https://app.clickup.com/9011646920/v/s/90112388381>.

- One persistent runtime incident per failed entity; repeated failures append
  run history.
- A later successful verified scrape automatically closes the incident with a
  recovery note.
- One persistent onboarding task per incomplete target profile, separate from
  runtime incidents.
- One combined daily Human Review task contains separate classification and
  consolidation sections when either review fails.
- Human Review has no completion deadline.
- The ClickUp **Notifications** channel receives an update every day, including
  clean runs: <https://app.clickup.com/9011646920/chat/r/8cj5me8-631>.
- Human Review messages are posted to the dedicated reviews channel:
  <https://app.clickup.com/9011646920/chat/r/8cj5me8-671>.

The local macOS LaunchAgent `com.cortex.daily-scraper` checks every 15 minutes
and starts one run during the 7:00 AM `America/Chicago` hour. The host Mac must
be awake during that hour.

## Daily ClickUp notification

The daily message contains:

- run status;
- Ready Entity Profile Coverage;
- entity pass, fail, and verified-empty counts;
- Entity Audit Pass Rate;
- listings captured;
- Aggregate, Construction, and Both counts;
- open blockers and Human Review tasks; and
- newly recovered entities.

## Verification limitation and next phase

The initial manual workflow records pass/fail rather than listing-level counts.
Therefore, Entity Audit Pass Rate is the operational proxy for completeness.
A future audit UI should record visible listing count, captured count, missed
listing evidence, reviewer, and timestamp so exact Listing Recall and numeric
Classification Review Pass Rate can be calculated.
