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
│   └── client.js     ← Vanilla JS IIFE injected into the served HTML page (NOT TypeScript)
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
concurly open <file.html>               Open a file; starts one server instance per file
concurly list                           List all running instances (port, PID, status, URL)
concurly review [port|path]             Print open comments as JSON (for agent consumption)
concurly complete <port|path>           Stop a session gracefully (comments JSON preserved)
concurly agent resolve <id> [port|path] Mark a specific comment as resolved
concurly <file.html>                    Shorthand — defaults to "open"
```

---

## Multi-Instance Architecture

Each `concurly open` call spawns an independent Node process with its own port. Instance state is persisted to `%TEMP%/concurly-instances/<port>.json` so that separate CLI invocations (`concurly review`, `concurly complete`) can locate running servers without shared memory.

**State file shape** (`%TEMP%/concurly-instances/<port>.json`):
```json
{
  "htmlPath": "C:\\path\\to\\design.html",
  "storePath": "C:\\path\\to\\design.comments.json",
  "port": 5391,
  "pid": 12345,
  "startedAt": "2026-06-28T00:00:00.000Z"
}
```

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

Plain JS IIFE — **no TypeScript, no imports, no bundler**. Read from disk and injected as a raw `<script>` tag. Three placeholders are replaced at inject time:

- `"__PORT__"` → actual port number (string replacement in `cli.ts`)
- `"__FILE_PATH__"` → absolute path to the HTML file being served
- `"__VERSION__"` → version string read from `package.json` (e.g. `0.3.0`)

Per-instance temp file: `%TEMP%/concurly-client-<port>.js` — prevents parallel sessions from overwriting each other's injected scripts.

### Browser UI layers (z-index stack)

| Element | ID | z-index | Position |
|---------|-----|---------|----------|
| Comment input box | `#__docreview__` | 999999 | Fixed, near click coords |
| Sidebar | `#__dr-sidebar__` | 999995 | Fixed, right edge |
| Tab bar | `#__dr-tabs__` | 999994 | Fixed, `top: 45px` |
| Header bar | `#__dr-header__` | 999993 | Fixed, `top: 0` |
| History panel | `#__dr-history-panel__` | 999991 | Fixed, `top: 85px`, full-screen |
| Badges | `.__dr-badge__` | 999990 | Fixed, near annotated elements |

**Chrome height**: header (45px) + tab bar (40px) = **85px**. Body gets `padding-top: 85px !important` to prevent content from being hidden under the chrome.

### Module-level state in client.js

```javascript
let openCommentsBySelector = {}; // { [selector]: Comment[] } — open comments indexed for O(1) lookup
let hoveredEl = null;            // currently highlighted DOM element
let scrollTimer = null;          // debounce for badge repositioning on scroll
let activeTab = "review";        // "review" | "history" — controls event guard and panel visibility
```

### Tab behavior

- **Review tab** (default): shows HTML with sidebar, hover highlights, badges, click-to-comment
- **View All Comments tab**: shows full-page history panel; sidebar hidden, badges cleared, click/hover handlers disabled via `activeTab` guard

---

## Skill Installation

```powershell
# Windows
Copy-Item -Recurse -Force skills\concurly $HOME\.claude\skills\concurly

# macOS / Linux
cp -r skills/concurly ~/.claude/skills/concurly
```

### Skill commands

| Skill command | What it does |
|---------------|--------------|
| `/concurly open <file.html>` | Opens file in browser with overlay |
| `/concurly list` | Lists running instances |
| `/concurly review [port\|path]` | Reads open comments, applies fixes, resolves each |
| `/concurly complete <port\|path>` | Says "we concur 🤝", stops session, preserves comments |

---

## Key Conventions

- **Never delete comments JSON** — it is historical record, preserved across `complete` calls
- **One process per file** — `cmdOpen` reuses an existing live instance for the same file path
- **client.js is plain JS** — do not add TypeScript syntax, imports, or `require()` calls to it
- **CSS class/ID prefix** — all injected DOM uses `__dr-` prefix to avoid colliding with the reviewed page
- **Windows paths** — always use `path.resolve()` / `path.join()`; never string-concatenate with `/`
- **`open` package** — must be imported via dynamic `import()` because it is ESM-only in v9

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
