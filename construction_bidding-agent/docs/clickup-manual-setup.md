# ClickUp Manual Setup

**Status as of July 14, 2026: this plan was never built.** The live
workspace (`9011646920`) has a differently-named space, **`Bid
Opportunities`** (no ampersand, not `Bids & Opportunities`), with no folders
— just two flat lists:

- `Aggregates Supply` — list id `901114103788`
- `General Construction` — list id `901114103789`

These two lists are what `scripts/push-clickup-tasks.mjs` actually pushes to
(IDs hardcoded there), filtering bids against the client's keyword lists for
each category and assigning `CLICKUP_DEFAULT_ASSIGNEE_ID`. See the README's
"ClickUp Setup" and "Current Status" sections and
`docs/site-coverage.md` for the current, real integration.

Everything below this line is the **original plan** — folders, statuses, and
task templates for a fuller CEO-review pipeline (Intake → CEO Review → Active
Pursuits → Submitted → Rejected/Archived) that was scoped but not
implemented. Kept for reference in case that fuller workflow gets built
later; `config/clickup-structure.json` and `config/clickup-fields.json`
describe this same unbuilt plan, not the live space.

## Space

Create Space: `Bids & Opportunities`

## Folders and Lists

1. `Intake`
   - `IonWave`
   - `DemandStar`
   - `Bonfire`
2. `CEO Review`
   - `CEO Approval Queue`
3. `Active Pursuits`
   - `Approved Pursuits`
4. `Submitted Bids`
   - `Submitted`
5. `Rejected / Archived`
   - `Rejected Archive`

## Statuses

- `New`
- `Needs Review`
- `CEO Review`
- `Approved`
- `Rejected`
- `Pursuing`
- `Submitted`
- `Closed`

## CEO Approval Task Template

Description:

```md
**Source Platform:**
**Category:**
**Agency / Buyer:**
**Project Name:**
**Location:**
**Due Date:**
**Bid URL:**
**Documents URL / Drive Folder:**
**Estimated Value:**
**Fit Score:**
**CEO Decision:** Pending
**Reject Reason:**
**Last Checked At:**
```

## Approved Pursuit Checklist

- Review bid documents
- Confirm scope fit
- Confirm materials/equipment availability
- Estimate pricing
- Assign estimator
- Prepare proposal package
- Internal final review
- Submit bid
- Upload submitted docs to Drive
- Mark as submitted
