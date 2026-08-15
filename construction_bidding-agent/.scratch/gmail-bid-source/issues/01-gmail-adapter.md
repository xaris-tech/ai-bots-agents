# Gmail adapter and OAuth

Type: task
Status: resolved

Implement read-only OAuth credential setup and a tested Gmail-to-BidInput
adapter.

## Acceptance

- OAuth uses only `gmail.readonly`.
- Relevant messages normalize deterministically and irrelevant messages skip.
- Missing authorization returns an actionable source failure.

## Verify

`.venv/bin/pytest -q tests/unit/test_gmail_source.py`

## Comments

Implemented tested normalization, relevance filtering, read-only credential
loading/refresh, account verification, Gmail search, and the OAuth setup command.
