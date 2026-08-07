# Dashboard email scan control

Type: task
Status: resolved
Blocked by: 02

Add a Scan email action and clear success/failure feedback to Cortex Bid Desk.

## Acceptance

- Operator can start Gmail-only ingestion from the dashboard.
- Loading, result, and error states are visible.

## Verify

`cd frontend && npm run build`

## Comments

Added Scan email and Scan all sources controls, loading/error feedback, log
integration, and Gmail OAuth setup documentation. Frontend production build
passes.
