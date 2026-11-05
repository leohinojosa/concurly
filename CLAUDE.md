# CLAUDE.md — concurly

## What is concurly?

**concurly** is a local CLI tool for reviewing HTML files concurrently with an AI peer. It serves an HTML file in the browser with an injected comment overlay, stores comments as JSON on disk, and exposes a CLI interface for AI agents (Claude Code) to read and resolve those comments. The tagline: *"Review software architecture concurrently with an expert AI peer."*

Repository: https://github.com/leohinojosa/concurly

---

## Project Structure

```
concurly/
├── src/
│   ├── cli.ts        ← Entry point; parses argv, routes commands, manages instance state
│   ├── server.ts     ← Express HTTP server + REST API + port auto-selection
│   ├── store.ts      ← Synchronous read/write of the comments JSON file
│   ├── watcher.ts    ← chokidar file watcher; pushes WebSocket messages on change
│   ├── remote.ts     ← Remote URL support: normalize, strip ?token=, review-folder cache layout, fetchRemote
│   ├── prefs.ts      ← User preferences (~/.concurly/preferences.json): read, validate, merge, atomic write
│   ├── paths.ts      ← concurlyHome(): CONCURLY_HOME or ~/.concurly
│   ├── themes.json   ← The 7 themes as data (54 tokens each); injected into client.js at inject time
│   └── client.js     ← Vanilla JS IIFE injected into the served HTML page (NOT TypeScript)
├── test/             ← node:test suites (run against dist/); `npm test` builds then runs them
├── dist/             ← Compiled output (tsc). client.js is copied here by postbuild.
├── skills/
│   └── concurly/
│       └── SKILL.md  ← Claude Code skill definition; install to ~/.claude/skills/concurly/
├── specs/
│   ├── concurly-phase1-spec.md
│   ├── concurly-phase2-spec.md
│   └── concurly-phase3-spec.md
├── README.md
├── package.json
└── tsconfig.json
```

---

## Tech Stack

- **Runtime**: Node.js 20+ (LTS), Windows-native (no WSL)
- **Language**: TypeScript 5 compiled to CommonJS (`module: "commonjs"`, `esModuleInterop: true`)
- **HTTP server**: Express 4
- **WebSockets**: `ws` v8 — `WebSocketServer` shared with the Express `http.createServer` instance
- **File watching**: chokidar v5 (`awaitWriteFinish` enabled for Windows reliability)
- **Browser opening**: `open` v9 (ESM — imported via dynamic `import()`)
- **Client script**: plain vanilla JS IIFE — no bundler, no imports, runs directly in the browser

---

## Build & Install

```powershell
npm install
npm run build        # tsc + copies src/client.js → dist/client.js (postbuild)
npm install -g .     # install concurly as a global CLI command
concurly --help
```

`tsc` does not copy `.js` files, so `postbuild` runs `copy src\client.js dist\client.js` (Windows CMD syntax).

---

## CLI Commands

```
concurly open <file.html | url>         Open a file or remote HTML URL; one server instance per file/URL
concurly list                           List all running instances (port, PID, status, URL)
concurly review [port|path|url]         Print open comments as JSON (for agent consumption)
concurly complete <port|path|url>       Stop a session gracefully (comments JSON preserved)
concurly refresh [port|url]             Refetch a remote page; a URL with a fresh ?token= replaces an expired link
concurly agent resolve <id> [port|path] Mark a specific comment as resolved
concurly <file.html | url>              Shorthand — defaults to "open"
```

---

## Multi-Instance Architecture

Each `concurly open` call spawns an independent Node process with its own port. Instance state is persisted to `%TEMP%/concurly-instances/<port>.json` so that separate CLI invocations (`concurly review`, `concurly complete`) can locate running servers without shared memory.

**State file shape** (`%TEMP%/concurly-instances/<port>.json`):
```json
{
  "htmlPath": "C:\\path\\to\\design.html",
  "storePath": "C:\\path\\to\\design.comments.json",
  "sourceUrl": "https://raw.githubusercontent.com/o/r/main/design.html",
  "port": 5391,
  "pid": 12345,
  "startedAt": "2026-06-28T00:00:00.000Z"
}
```

`sourceUrl` is present only for remote sessions and is always token-stripped (see "Remote sources").

- Liveness check: `process.kill(pid, 0)` — throws if dead, succeeds silently if alive
- On SIGTERM/SIGINT: removes state file and per-port temp client file; **never** deletes the comments JSON
- Port range: 5391–5401 (auto-increments to find a free port)

---

## Comment Data Model

Stored in `<filename>.comments.json` alongside the HTML file. Never deleted on session close — preserved for history.

```typescript
interface Comment {
  id: string;              // crypto.randomUUID()
  selector: string;        // CSS selector path, e.g. "body > div#hero > h1:nth-child(1)"
  excerpt: string;         // First 120 chars of element innerText
  body: string;            // Comment text from the user
  status: "open" | "resolved";
  createdAt: string;       // ISO 8601
  resolvedAt: string | null;
}
```

---

## REST API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Serves HTML with client script injected before `</body>` |
| `GET` | `/comments` | Returns all comments (`Comment[]`) |
| `POST` | `/comments` | Creates a new comment (`{ selector, excerpt, body }`) |
| `PATCH` | `/comments/:id` | Updates comment body (open comments only) |
| `PATCH` | `/comments/:id/resolve` | Marks comment resolved, sets `resolvedAt` |
| `DELETE` | `/comments/:id` | Deletes comment (open comments only) |
| `GET` | `/source` | Remote sessions: `{ sourceUrl, fetchedAt, isPinned }`. `404` for local files |
| `POST` | `/refresh` | Remote sessions: refetch; returns `{ status: "updated" \| "unchanged", fetchedAt }` or `502 { error }`. Optional `{ url }` body replaces the in-memory URL if it is the same source (token-stripped match), else `400` |
| `GET` | `/preferences` | Returns `{ theme?: string }` from `~/.concurly/preferences.json` (`{}` if none or unreadable) |
| `PUT` | `/preferences` | Body `{ theme }`; `theme` must match `^[a-z0-9-]{1,32}$` else `400`. Merged into the stored object (atomic write) |

---

## Themes

The UI has seven themes: **Paper**, **Midnight** (the two defaults), **Slate**, **Mint**, **Nord**, **Ember**, **Terminal**. A palette button in the header (right after ↻) opens a menu grouped Light / Dark: hovering a row previews it live, clicking keeps it, Esc / outside click / Tab / resize revert.

- **Data, not code.** Each theme is an entry in `src/themes.json`: `id`, `label`, `mode` (`light`|`dark`), two structural archetypes — `tabs` (`underline`|`pill`) and `cards` (`ruled`|`boxed`) — and `vars`, a flat map of 54 tokens. `cli.ts` injects the whole file into `client.js` via the `"__THEMES__"` placeholder.
- **Tokens → CSS.** `client.js` emits `html[data-dr-theme="<id>"]{ --dr-<token>: … }` for every theme and one token-driven stylesheet (`BASE_CSS`). Archetypes are `data-dr-tabs` / `data-dr-cards` attributes on `<html>`. The `--dr-` prefix keeps our variables off the reviewed page, and `color-scheme` is set only on concurly's own containers (never `<html>`).
- **No hard-coded colors in `client.js`.** Use `var(--dr-*)`. The only intentional literals are the yellow "Show in page" pulse and the swatch outline.
- **Persistence & resolution.** On load: `localStorage["concurly-theme"]` (sync, no flash) → else the OS (`prefers-color-scheme`: Midnight dark / Paper light). Right after, `GET /preferences` is authoritative: a different server theme is applied and re-cached; if the server has none but the browser does, it is seeded with `PUT`. Choosing a theme writes `localStorage` and `PUT /preferences`. With no saved choice the theme follows the OS live. **Why the server file:** every session runs on its own port, and browsers treat each port as a separate origin, so `localStorage` alone is not shared between sessions.
- **Adding or changing a theme.** Edit `src/themes.json`; every theme must define the same token set. `npm test` (`test/themes.test.js`) enforces identical token sets and **WCAG AA (4.5:1)** for every text/background pair (translucent colors are composited over the theme `bg`) — a theme that is unreadable fails the build. `accent-text` is the accent used *as text*; it can differ from `accent` (e.g. Midnight) when the accent is too dark/light to read.

---

## Remote sources

`concurly open <url>` fetches the page into a durable review folder and then treats the cached copy as an ordinary local file (server, watcher and store are unchanged).

```
~/.concurly/reviews/<sha1(identityUrl)[0:12]>/     # override root with CONCURLY_HOME
  <name>.html            cached copy (name = URL basename)
  <name>.comments.json   comments (same convention as local files)
  source.json            { sourceUrl, fetchedAt, sha256 }
```

- **Identity URL** = normalized URL with the `?token=` param removed (`stripSecrets()`). It is what is hashed, persisted, printed, and shown in the UI. Rotating tokens therefore map to the same folder and comment history.
- GitHub `blob/` links are rewritten to `raw.githubusercontent.com` (`normalizeUrl()`).
- **concurly adds no credentials** (no `gh`, no `GITHUB_TOKEN`). The only auth is whatever is already in the URL. An expired link fails with a "use a fresh Raw link" error; the cached copy and comments are kept.
- The full URL (with token) lives only in the running server's memory (`RemoteSource` in `cli.ts` → `server.ts`). After a restart, run `concurly open <fresh-url>`; a live session can be recovered with `concurly open|refresh <fresh-url>`.
- Refresh writes the cached HTML only when its sha256 changed; the existing chokidar watcher then sends `{ type: "reload" }`.
- The header always has a standalone `#__dr-header-refresh__` button right after the Read | Review toggle (the theme button follows it) (created in `injectHeader()`; default = `location.reload()`). `initRemoteControls()` re-points its `onclick` to `POST /refresh` for non-pinned remote sessions and adds the "fetched Xm ago" label and status text after it.
- A 40-hex commit SHA in the ref (`isPinnedUrl`) means content can't change: the UI shows "pinned to commit" and the button stays a plain page reload.
- Env vars (mainly for tests): `CONCURLY_HOME` (root for `~/.concurly`), `CONCURLY_NO_BROWSER` (skip launching a browser).

---

## WebSocket Events

The WebSocket server shares the same `http.createServer` instance as Express (same port).

| Event sent to browser | Trigger |
|-----------------------|---------|
| `{ type: "reload" }` | HTML file changed on disk (chokidar) |
| `{ type: "comments-updated" }` | Comments JSON file changed on disk |

The browser client auto-reconnects after 2 seconds if the WebSocket closes.

---

## Client Script (`src/client.js`)

Plain JS IIFE — **no TypeScript, no imports, no bundler**. Read from disk and injected as a raw `<script>` tag. Four placeholders are replaced at inject time:

- `"__PORT__"` → actual port number (string replacement in `cli.ts`)
- `"__FILE_PATH__"` → absolute path to the HTML file being served
- `"__THEMES__"` → the contents of `src/themes.json` (replaced with a function replacer so `$` in the data is never treated as a replacement pattern)
- `"__VERSION__"` → version string read from `package.json` (e.g. `0.6.0`)

Per-instance temp file: `%TEMP%/concurly-client-<port>.js` — prevents parallel sessions from overwriting each other's injected scripts.

### Browser UI layers (z-index stack)

| Element | ID | z-index | Position |
|---------|-----|---------|----------|
| Comment input box | `#__docreview__` | 999999 | Fixed, near click coords |
| Sidebar | `#__dr-sidebar__` | 999995 | Fixed, right edge |
| Theme menu | `#__dr-theme-menu__` | 999998 | Fixed, under the theme button, right-aligned |
| Tab bar | `#__dr-tabs__` | 999994 | Fixed, `top: 0` (pill style: `top: 7px`), centered over the header |
| Header bar | `#__dr-header__` | 999993 | Fixed, `top: 0` |
| History panel | `#__dr-history-panel__` | 999991 | Fixed, `top: 44px`, full-screen |
| Badges | `.__dr-badge__` | 999990 | Fixed, near annotated elements |

**Chrome height**: a single header bar of **44px** (`CHROME_H`); the tab bar is a separate element centered over it, not a second row. Body gets `padding-top: 44px !important`, and the sidebar and history panel start at `top: 44px`. Below 1100px the source path and "fetched" label hide, and below 860px the file name and version hide too, so the centered tabs never collide with header content.

### Module-level state in client.js

```javascript
let openCommentsBySelector = {}; // { [selector]: Comment[] } — open comments indexed for O(1) lookup
let hoveredEl = null;            // currently highlighted DOM element
let scrollTimer = null;          // debounce for badge repositioning on scroll
let activeTab = "review";        // "review" | "history" — controls event guard and panel visibility
let mode = "read";               // "read" | "review" — read mode disables commenting; badges and card edit/resolve/delete hidden via body class __dr-mode-review__
```

### Tab behavior

- **Review tab** (default): shows HTML with sidebar, hover highlights, badges, click-to-comment
- **View All Comments tab**: shows full-page history panel; sidebar hidden, badges cleared, click/hover handlers disabled via `activeTab` guard

### Mode behavior

- A **Read | Review** toggle lives in the header. Default is **Read** on every page load (not persisted).
- **Read mode**: no hover highlights or click-to-comment; badges and the Edit/Resolve/Delete card actions are hidden via CSS keyed off the `__dr-mode-review__` body class. "Show in page" stays available.
- **Review mode**: full commenting behavior.
- The sidebar always starts collapsed on page load; its state is not stored in `sessionStorage`.
- Clicking **Review** expands the sidebar; clicking **Read** collapses it (the collapse icon still toggles it manually in either mode).

---

## Skill Installation

```powershell
# Windows
New-Item -ItemType Directory -Force $HOME\.claude\skills\concurly | Out-Null
Copy-Item skills\concurly\* $HOME\.claude\skills\concurly\ -Recurse -Force

# macOS / Linux
mkdir -p ~/.claude/skills/concurly && cp -r skills/concurly/. ~/.claude/skills/concurly/
```

### Skill commands

| Skill command | What it does |
|---------------|--------------|
| `/concurly open <file.html \| url \| github-file-name> [owner/repo] [ref]` | Opens file or remote HTML URL in browser with overlay. A bare GitHub file name is resolved by the **skill** via `gh` (tree API → contents API `download_url`) — the CLI never depends on `gh` |
| `/concurly refresh [port\|url]` | Refetches a remote page (a fresh `?token=` URL replaces an expired link) |
| `/concurly list` | Lists running instances |
| `/concurly review [port\|path]` | Reads open comments, applies fixes, resolves each |
| `/concurly complete <port\|path>` | Says "we concur 🤝", stops session, preserves comments |

---

## Key Conventions

- **Never delete comments JSON** — it is historical record, preserved across `complete` calls
- **One process per file** — `cmdOpen` reuses an existing live instance for the same file path
- **client.js is plain JS** — do not add TypeScript syntax, imports, or `require()` calls to it
- **No hard-coded colors in client.js** — style with `var(--dr-*)` theme tokens (add new tokens to *every* theme in `src/themes.json`; the tests enforce it)
- **CSS class/ID prefix** — all injected DOM uses `__dr-` prefix to avoid colliding with the reviewed page
- **Windows paths** — always use `path.resolve()` / `path.join()`; never string-concatenate with `/`
- **`open` package** — must be imported via dynamic `import()` because it is ESM-only in v9
- **Never persist or print a URL containing `?token=`** — always go through `stripSecrets()`; the full URL stays in memory only

---

## Common Tasks

### Add a new REST endpoint
Add the route to `src/server.ts`. Add the corresponding store function to `src/store.ts` if it touches the JSON file.

### Add a new browser UI element
Edit `src/client.js`. Add CSS in `injectStyles()`, DOM in its own `inject*()` function, call it from the init block at the bottom. Use the `__dr-` prefix for all IDs and class names.

### Add a new CLI command
Add a `cmd*` function in `src/cli.ts`. Wire it into the `main()` dispatch block. Update `printHelp()` and `skills/concurly/SKILL.md`.

### After any change
```powershell
npm run build    # compiles TS + copies client.js to dist/
```
Then restart the concurly session (`concurly complete <port>` then `concurly open <file>`).
