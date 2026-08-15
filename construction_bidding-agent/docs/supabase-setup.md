# Supabase setup

Production bid reads use Supabase PostgreSQL when `DATABASE_URL` is set.
SQLite remains the default for local development and tests.

## Link a project

Create a dedicated Cortex Bid Desk Supabase project. Do not reuse an unrelated
project. Then run:

```bash
npx supabase link --project-ref <project-ref>
npx supabase db push
```

Project linkage metadata is safe to commit. Database passwords, connection
strings, access tokens, secret keys, and service-role keys are not.

## Backend environment

Copy the transaction-mode pooler connection string from Supabase **Connect**
into the backend's secret environment:

```text
DATABASE_URL=postgresql://...
```

For Vercel runtime traffic, use Supavisor transaction mode (port 6543). Use a
direct or session connection for CLI migrations. Never prefix this variable
with `NEXT_PUBLIC_`.

## Verify

After applying migrations, insert a non-sensitive test bid through Supabase SQL
Editor, start FastAPI with `DATABASE_URL` configured, then request `/api/bids`
using an authorized Firebase token. Confirm the same bid appears in the
dashboard. Remove the test row after verification.

## Scraper computer publishing

Each authorized computer keeps portal credentials and browser profiles locally.
Configure a unique device credential in its ignored `.env`:

```text
PUBLISH_API_URL=https://your-api.example
PUBLISH_DEVICE_ID=unique-computer-name
PUBLISH_API_KEY=generated-device-secret
```

Validate an existing artifact without publishing:

```bash
npm run publication:build
npm run publish:bids -- --dry-run
```

Publish an existing artifact or run the complete local workflow:

```bash
npm run publish:bids -- --yes
npm run scrape-and-publish -- --yes
```

Cloudflare and portal profiles never leave the scraper computer. Failed entity
checks publish their warning/status so production retains last-known-good data.
