# Site-specific hooks

A hook is a per-site script used only when one source needs unique login,
navigation, pagination, or document handling. Shared portal behavior stays in
`src/scrapers/<platform>.mjs`; a hook must not duplicate normalization,
deduplication, retry policy, retention, or logging — the runner owns those.

## How a hook is discovered

`scripts/scrape-sites.mjs` looks for `src/sites/<site-id>.mjs` for every site it
runs. A profile can also point at a shared hook file explicitly:

```json
{ "id": "example-tx", "hook": "example-shared-login.mjs" }
```

If no hook file exists, the platform adapter runs directly.

## Contract

Export one async function:

```js
export async function scrape(page, site, { adapter }) {
  // site.credentials is already resolved from the profile's auth env vars.
  // Option A: custom login, then delegate UI parsing to the shared adapter.
  await customLogin(page, site.credentials);
  return adapter(page, site);

  // Option B: fully custom UI parsing. Return the same result shape:
  // { platform, sourceId: site.id, bids, warning }
}
```

Rules:

- Return `{ bids: [], warning: "..." }` on login walls, timeouts, or layout
  mismatches so the runner keeps the site's last-known-good bids. Never return
  an empty `bids` array with no warning unless the source genuinely has zero
  open bids.
- Never log credentials, cookies, tokens, or secret URLs.
- Set `sourceId: site.id` on every bid so attribution and retention work.
