# Auth & Deployment

Passwordless (email-link) sign-in restricted to an email allowlist, enforced on
both the client (UX) and the server (the real boundary).

## Status (2026-07-25)

**Auth: DONE and working.**
- Firebase project **`cortex-bid-desk`** created; web app registered.
- **Email-link (passwordless) provider enabled** (verified: sign-in email sends).
- `frontend/.env.local` has the `NEXT_PUBLIC_FIREBASE_*` config; backend `.env`
  has `AUTH_ENABLED=true`, `FIREBASE_PROJECT_ID=cortex-bid-desk`,
  `AUTH_ALLOWED_EMAILS=ranjovidad@gmail.com,info@cortexconstruction.com`.
- Backend verifies tokens with the project ID only — **no service-account key
  needed** for verification.
- Console note: Firebase's default sign-in emails often land in spam
  (`noreply@cortex-bid-desk.firebaseapp.com`); customize the sender template for
  production deliverability.

**Deploy: NOT done, decided.** Frontend → Vercel. Backend → Render (Docker web
service via `Dockerfile` + `render.yaml`), not Cloud Run — avoids the
`cortex-bid-desk` Blaze-billing gate entirely. See "Deployment" below.

The setup steps below are kept as reference / for rebuilding on another project.

## How it works

- **Frontend** (`frontend/app/firebase.ts`, `AuthGate.tsx`): Firebase email-link
  sign-in. Only allowlisted emails can request a link; on success the app
  attaches the Firebase **ID token** as `Authorization: Bearer …` to every API
  call (`page.tsx` `api()`).
- **Backend** (`app/auth.py`): every `/api/*` route plus `/api/chat` and
  `/feedback` depend on `require_auth`, which verifies the ID token with
  `firebase-admin` and rejects any email not on the allowlist. `/healthz` is the
  only open route. **This is the security boundary** — editing the frontend
  can't get past it.

Allowlist (default): `ranjovidad@gmail.com`, `info@cortexconstruction.com`.

## One-time Firebase setup

1. **Create a Firebase project** — <https://console.firebase.google.com> → Add
   project (or reuse a GCP project).
2. **Enable Email-Link sign-in** — Authentication → Sign-in method → **Email/
   Password** → enable, and tick **Email link (passwordless sign-in)**.
3. **Authorize domains** — Authentication → Settings → Authorized domains: add
   `localhost` (dev) and your deploy domain (e.g. `<project>.web.app`).
4. **Web app config** — Project settings → General → Your apps → Web app →
   copy `apiKey`, `authDomain`, `projectId`, `appId` into `frontend/.env.local`
   (`NEXT_PUBLIC_FIREBASE_*`).
5. **Service account** (backend token verification) — Project settings →
   Service accounts → Generate new private key → save to
   `credentials/firebase-sa.json` (gitignored) and set `FIREBASE_CREDENTIALS` to
   its path. (Alternatively set only `FIREBASE_PROJECT_ID` and use ADC.)

Then set `AUTH_ENABLED=true` on the backend and restart. Sign in at the app URL
with an allowlisted email → click the link in the inbox → you're in.

### Local dev without Firebase

Leave the `NEXT_PUBLIC_FIREBASE_*` blank and set `AUTH_ENABLED=false`. Both
sides bypass auth so the dashboard runs unauthenticated — **never do this in a
deployed environment.**

## Adding / removing users

Edit `AUTH_ALLOWED_EMAILS` (backend, authoritative) and
`NEXT_PUBLIC_ALLOWED_EMAILS` (frontend, UX) — comma-separated. No password or
account provisioning needed; any allowlisted email can request a link.

## Deployment

- **Frontend** → **Vercel**. Standard Next.js project (`frontend/`). Set
  `NEXT_PUBLIC_FIREBASE_*` and `NEXT_PUBLIC_API_BASE_URL` (the Render backend
  URL, once known) as Vercel project env vars.
- **Backend** → **Render**, Docker web service. Not Cloud Run — Cloud Run
  needs `cortex-bid-desk` on Blaze billing (currently Spark/free), and has no
  native persistent disk (would need Cloud SQL on top).
  - `Dockerfile` (repo root) — installs Node 20 + Playwright Chromium alongside
    the Python/uv deps, since the scan feature shells out to `scripts/*.mjs`.
    The old ADK-scaffolded, Python-only Cloud Run image lives at
    `Dockerfile.adk` now (unused by this deploy target).
  - `render.yaml` — Blueprint spec: one web service on the free plan, health
    check on `/api/health`, and every required env var listed (`sync: false`
    ones need values pasted into the Render dashboard, never committed). No
    persistent disk on free plan — `BID_DATABASE_PATH` and Playwright profile
    dirs are ephemeral, wiped on every deploy/restart. Upgrade to `starter` +
    add a disk block once billing is set up.
  - `BID_DATABASE_PATH`, `PLAYWRIGHT_SITE_USER_DATA_DIR`,
    `PLAYWRIGHT_USER_DATA_DIR` are all repointed at `/code/data/...` in
    `render.yaml` so the SQLite DB and Playwright's persistent browser
    profiles (i.e. logged-in portal sessions) both survive redeploys/restarts,
    unlike Cloud Run's ephemeral filesystem.
  - Deploy: push this repo to GitHub → Render dashboard → New → Blueprint →
    pick the repo → Render reads `render.yaml` → fill in the `sync: false` env
    vars it prompts for (Gemini key, Firebase project id, portal credentials,
    allowed emails, and `CORS_ALLOWED_ORIGINS` once the Vercel URL exists).
  - **Cloudflare-walled sites still don't work here** (or on any container
    host) — `scripts/scrape-cloudflare-sites.mjs` and
    `scripts/scrape-via-real-chrome.mjs` need a real desktop Chrome over CDP.
    Run those locally on a schedule and let them write into the same
    `data/raw/*.json` files / DB; the other 67 sites + 3 batch portals scrape
    fine headless on Render.
  - Google Sheets/ClickUp sync is optional on Render: upload
    `credentials/cortex-sa.json` via Render's Secret Files if you want it, and
    point `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` at wherever Render mounts it.
