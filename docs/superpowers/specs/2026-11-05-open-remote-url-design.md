# Open a remote URL in concurly — Design

**Date:** 2026-11-05
**Status:** Draft for review

## Goal

`concurly open <url>` loads an HTML file from an `http(s)` URL (primary use case: GitHub raw HTML links) and starts a normal review session on it. The remote page can be re-fetched on demand without losing comments.

## Non-goals

- No credentials managed by concurly (no `gh auth token`, no `GITHUB_TOKEN`). Only auth is what is already in the URL (e.g. GitHub's `?token=`).
- No live proxying; the page is always served from a local cached copy.
- No automatic/background polling for changes.

## Approach

Fetch to a local cache, then treat the cached copy as a normal local file. The server, watcher, store, `review`, `resolve` and `complete` are unchanged apart from carrying a `sourceUrl`.

## Components

### `src/remote.ts` (new)
- `isUrl(arg)`: true for `http://` / `https://`.
- `normalizeUrl(url)`: rewrites `github.com/<o>/<r>/blob/<ref>/<path>` to `raw.githubusercontent.com/<o>/<r>/<ref>/<path>`.
- `stripSecrets(url)`: removes the `token` query param. The result is the **identity URL**, used for hashing and everything persisted or printed.
- `reviewDir(identityUrl)`: `~/.concurly/reviews/<sha1(identityUrl)[0:12]>/`.
- `fetchRemote(fullUrl, destPath)`: Node 20 global `fetch`, no auth headers added, follow redirects, timeout. Returns `{ changed, sha256, fetchedAt }`. Writes only on success and when content differs (atomic write via temp + rename). Non-2xx throws an error with a message: 401/403/404 → "link expired or not accessible (use a fresh Raw link)".

### Storage layout
```
~/.concurly/reviews/<hash>/
  <name>.html            cached copy (name = URL basename)
  <name>.comments.json   comments (same convention as local files; getStorePath unchanged)
  source.json            { sourceUrl (token stripped), fetchedAt, sha256 }
```
Never deleted by `complete`. A rotated token yields the same hash, so comment history carries over.

### `cli.ts`
- `cmdOpen(arg)`: if URL → normalize, compute identity, fetch into the review dir, then continue the existing flow with the cached path. If the fetch fails and a cache exists, open the cache with a printed "stale" warning; otherwise exit with the error.
- Instance reuse keyed on identity URL (state file gains `sourceUrl`; reuse check matches on it).
- New `concurly refresh <port|url>`: calls `POST /refresh` on the running instance.
- `list` / `review` output include `sourceUrl` when present. Full URL with token is never written to the state file or printed; it is passed to the server process in memory only.
- `printHelp` updated.

### `server.ts`
- `POST /refresh`: re-fetches using the in-memory full URL. Responses: `{ status: "updated" | "unchanged", fetchedAt }` or `{ error }` with 4xx/5xx. On `updated` the cached HTML is overwritten and the existing chokidar watcher sends `{type:"reload"}`; no new WebSocket event.
- `GET /source` (or injected values): `{ sourceUrl, fetchedAt, isPinned }`.
- `isPinned`: the ref in the URL is a 40-char hex SHA → refresh cannot change anything.

### `client.js`
- New injected placeholder for source info (same mechanism as `__PORT__`), absent for local files.
- Header: for remote sessions only, a **Refresh** button plus "fetched 5m ago" label. If pinned, button replaced by a "pinned to commit" label. Errors from `/refresh` show inline in the header ("Couldn't refetch: link expired or not accessible"); the cached page and comments remain.
- Uses `__dr-` prefixed IDs/classes, consistent with existing conventions.

## Data flow

1. `concurly open <url>` → normalize → strip token (identity) → fetch → write cache → start server pointing at cache path.
2. Browser loads `/` (cached HTML + overlay). Header shows source + fetched time.
3. Refresh click → `POST /refresh` → fetch → unchanged: "No changes"; changed: write file → chokidar → reload.
4. Comments persist in the review dir across refresh and across sessions.

## Error handling

| Situation | Behavior |
|---|---|
| Fetch fails on `open`, cache exists | Open cache, warn "stale, couldn't refetch" |
| Fetch fails on `open`, no cache | Exit non-zero with message and "use a fresh Raw link" hint |
| Refresh fails (expired token, offline) | Inline error in UI / CLI; keep cache and comments |
| Server restarted (token lost) | `refresh` unavailable; run `concurly open <fresh-url>` (same review folder) |
| Non-HTML / huge response | Reject non-2xx; cap size (e.g. 20 MB) |

## Open item (resolve during planning)

Comments whose selectors no longer match after a refresh: check how `client.js` currently treats missing selectors and decide whether an "orphaned / can't locate" state is needed.

## Testing (manual + scripted; repo has no test framework)

Use a local `http.server` as the fake remote:
- Open a URL; comments saved under `~/.concurly/reviews/<hash>/`.
- `blob/` URL rewrite.
- 404 on open (no cache) errors; 404 on open with cache warns and opens.
- Refresh with unchanged content → "No changes"; changed content → page reloads, comments preserved.
- `?token=` stripped from state file, `list`, `source.json`; two different tokens map to the same folder.
- SHA-pinned URL shows "pinned" and no refresh button.
- Local-file `open` behavior unchanged.

## Docs to update
`printHelp`, `skills/concurly/SKILL.md`, `README.md`, `CLAUDE.md` (CLI commands, REST API table, state file shape, storage layout).
