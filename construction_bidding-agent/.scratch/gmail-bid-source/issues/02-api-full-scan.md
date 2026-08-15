# Gmail API and full-scan integration

Type: task
Status: resolved
Blocked by: 01

Persist Gmail opportunities through a dedicated endpoint and include Gmail as
an independent full-scan unit.

## Acceptance

- Gmail-only scan returns a normal scan summary.
- Full scan logs Gmail success/failure without aborting portal scans.

## Verify

`.venv/bin/pytest -q tests/integration`

## Comments

Added the Gmail-only API route and independent full-scan unit with persistence,
progress logs, and failure isolation.
