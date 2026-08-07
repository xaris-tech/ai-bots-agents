# Spec: Gmail Bid Source

## Objective

Add `info.cortexconstruction@gmail.com` as a read-only opportunity source for
Cortex Bid Desk. Bid notices found in Gmail become normal dashboard bids,
participate in existing scoring, and deduplicate through the repository.

Acceptance criteria:

- A Gmail App Password enables read-only IMAP, with OAuth available as a
  fallback.
- The full scan includes Gmail and a dedicated API action can scan Gmail alone.
- Relevant recent messages are normalized as `platform="Gmail"` bids.
- Message IDs make repeated scans idempotent; Gmail does not send, delete,
  archive, label, or mark messages read.
- The dashboard exposes a **Scan email** action and reports scan results.
- Missing or expired Gmail authorization produces a useful warning without
  aborting the website scraper.

## Tech Stack

- Python 3.11–3.13, FastAPI, Pydantic, SQLite repository
- Gmail IMAP through Python `imaplib`; Gmail API OAuth remains a fallback
- Next.js/React dashboard
- OAuth scope: `https://www.googleapis.com/auth/gmail.readonly`

## Commands

```bash
uv sync
.venv/bin/python scripts/auth-gmail.py
.venv/bin/pytest -q
cd frontend && npm run build
```

## Project Structure

- `app/gmail_source.py` — authorization loading, search, parsing, normalization
- `app/api.py` — dedicated Gmail scan endpoint
- `app/full_scan.py` — Gmail unit in the full scan
- `scripts/auth-gmail.py` — optional interactive OAuth fallback setup
- `frontend/app/page.tsx` — Scan email control and feedback
- `tests/unit/test_gmail_source.py` — parsing and relevance tests
- `tests/integration/` — persistence and API behavior
- `credentials/` — gitignored OAuth client and token JSON

## Code Style

```python
async def scan_gmail_bids() -> PortalRunInput:
    messages = await asyncio.to_thread(fetch_recent_messages)
    return PortalRunInput.success("Gmail", [message_to_bid(item) for item in messages])
```

Use small pure parsing helpers and keep Gmail I/O behind one adapter boundary.

## Testing Strategy

- Unit-test relevance filtering, message decoding, due-date extraction, URL
  extraction, attachment metadata, and stable message-ID normalization.
- Integration-test API persistence with Gmail I/O replaced by a fake result.
- Run Python tests and the frontend production build.
- Perform a read-only live connection check after authorization.

## Boundaries

- Always: select IMAP read-only and use `BODY.PEEK[]`, use Gmail readonly scope
  for OAuth, preserve sender/message provenance, and make scans idempotent.
- Ask first: broader Gmail permissions, automated background scheduling, or
  interpretation of attachment contents.
- Never: store the main Gmail password, commit App Passwords/OAuth secrets or
  tokens, mutate mailbox state, or treat non-bid email as an opportunity.

## Success Criteria

- Authorized Gmail bid emails appear in Cortex Bid Desk with source `Gmail`.
- Re-running Gmail scan does not create duplicate rows.
- Full portal scans continue when Gmail is unconfigured or temporarily fails.
- UI accurately reports records ingested or authorization errors.

## Open Questions

- Attachment text/PDF extraction is intentionally deferred.
- Background scheduling is intentionally deferred; Gmail runs from dashboard
  scan actions in this version.
