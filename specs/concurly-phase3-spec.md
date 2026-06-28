# concurly — Phase 3 Implementation Specification
> Feed this document to your LLM code generator after Phase 2 is complete and working.
> Phase 1 and Phase 2 must be fully functional before starting Phase 3.

---

## Phase 3 Goals

Phase 3 adds the features that make concurly a complete, reusable tool rather than a
single-session utility. The four objectives are:

1. **Live reload** — when Claude Code edits the HTML file on disk, the browser auto-refreshes
   and re-renders badges and comments without manual intervention
2. **Resolved comment history** — a toggle to show previously resolved comments in the sidebar,
   so the user can audit what the agent changed
3. **Multi-file support** — review a design system with multiple HTML files from one running
   server, switching between them in the sidebar
4. **Polish** — `--port` CLI flag, `concurly --help`, comment export as Markdown, keyboard
   shortcuts, error handling hardening

Phase 3 does not change the core comment data model, the REST API shape, or the agent nudge
mechanism defined in Phases 1 and 2. All changes are additive or refinements.

---

## Target Environment

Same as Phase 1 and 2:
- **OS**: Windows 10/11
- **Runtime**: Node.js 20+
- **Shell**: PowerShell and CMD

### New dependencies for Phase 3

```json
{
  "dependencies": {
    "chokidar": "^3.5.3"
  }
}
```

`chokidar` is used for file watching. It is CommonJS-compatible and works correctly on Windows
including on NTFS and network drives. Do not use `fs.watch` — it is unreliable on Windows for
detecting external edits.

---

## Files Changed or Added in Phase 3

```
concurly/
├── src/
│   ├── cli.ts           ← Add --port flag, --help, concurly export command
│   ├── server.ts        ← Add chokidar watcher, WebSocket live reload, multi-file support
│   ├── store.ts         ← No changes
│   ├── watcher.ts       ← New: chokidar wrapper that broadcasts reload via WebSocket
│   └── client.js        ← Add WebSocket reconnect, resolved history toggle, keyboard shortcuts
├── package.json         ← Add chokidar
└── skills/
    └── concurly/
        └── SKILL.md     ← Add /concurly-history and /concurly-export skill entries
```

---

## Feature 1 — Live Reload via WebSocket

### Overview

When Claude Code edits the HTML file on disk, the browser must detect the change, re-fetch
the served HTML, and re-render without requiring the user to press F5. The mechanism is:

1. The server watches the HTML file with chokidar
2. On change, the server sends a WebSocket message `{ type: "reload" }` to all connected browsers
3. The browser receives the message and calls `window.location.reload()`
4. After reload, the page re-injects the comment layer and re-fetches comments — badges and
   sidebar re-render as normal

### New file — `src/watcher.ts`

```typescript
import chokidar from "chokidar";
import { WebSocketServer, WebSocket } from "ws";

export function createWatcher(htmlPaths: string[], wss: WebSocketServer): void {
  const watcher = chokidar.watch(htmlPaths, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 300,  // Wait 300ms after last write before firing
      pollInterval: 100,
    },
  });

  watcher.on("change", (changedPath) => {
    console.log(`[concurly] File changed: ${changedPath} — reloading browsers`);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: "reload", file: changedPath }));
      }
    });
  });

  watcher.on("error", (err) => {
    console.error(`[concurly] Watcher error: ${err.message}`);
  });
}
```

### `awaitWriteFinish` — critical for Windows

Claude Code writes files in multiple chunks on Windows (open → truncate → write → close).
Without `awaitWriteFinish`, chokidar fires the `change` event after the truncate step, before
the file has new content, causing the browser to reload an empty HTML file. The 300ms
stabilityThreshold waits until the file size has not changed for 300ms before firing — this
reliably catches the end of the write cycle on Windows.

### WebSocket server setup (add to `server.ts`)

```typescript
import { WebSocketServer } from "ws";
import http from "http";

// In the startServer function:
const httpServer = http.createServer(app);
const wss = new WebSocketServer({ server: httpServer });

// Replace app.listen with:
httpServer.listen(port, "127.0.0.1", () => {
  console.log(`concurly running on http://localhost:${port}`);
});

// Start watcher after server is up
createWatcher([htmlPath], wss);
```

Add `ws` to dependencies:

```json
"ws": "^8.16.0",
"@types/ws": "^8.5.10"
```

### Client WebSocket connection (add to `client.js`)

```javascript
function connectReloadSocket() {
  const ws = new WebSocket(`ws://localhost:${PORT}`);

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "reload") {
      console.log("[concurly] File changed, reloading…");
      window.location.reload();
    }
  };

  ws.onclose = () => {
    // Reconnect after 2 seconds — handles server restart during dev
    setTimeout(connectReloadSocket, 2000);
  };

  ws.onerror = () => {
    ws.close();
  };
}

// Call on page load
connectReloadSocket();
```

The reconnect loop means the browser will automatically re-attach after a server restart,
which is useful during `concurly` development itself.

---

## Feature 2 — Resolved Comment History

### Overview

The sidebar gains a toggle: "Show resolved" / "Hide resolved". When enabled, resolved
comments appear below open ones in a visually distinct style (greyed out, strikethrough on
the excerpt, no action buttons). This lets the user audit what the agent changed and verify
the resolutions were correct.

### Data changes

No changes to the store format. The `GET /comments` endpoint already returns all comments
including resolved ones. The client currently filters to `status === "open"` — this becomes
configurable via the toggle.

### Toggle state

Stored in `sessionStorage` under `__dr_show_resolved__`. Defaults to `false`.

### Sidebar DOM addition

Add below the sidebar header, above the body:

```html
<div id="__dr-toggle-bar__">
  <label>
    <input type="checkbox" id="__dr-show-resolved__" />
    Show resolved (<span id="__dr-resolved-count__">0</span>)
  </label>
</div>
```

### Resolved thread card style

```css
.__dr-thread-resolved__ {
  opacity: 0.5;
  border-color: #e5e7eb;
  background: #f9fafb;
}
.__dr-thread-resolved__ .__dr-thread-excerpt__ {
  text-decoration: line-through;
}
.__dr-thread-resolved__ .__dr-resolved-label__ {
  font-size: 10px;
  color: #6b7280;
  margin-top: 4px;
}
```

### Client logic

In `refreshComments()`, after fetching all comments:

```javascript
async function refreshComments() {
  const all = await fetch(`http://localhost:${PORT}/comments`).then(r => r.json());

  const open = all.filter(c => c.status === "open");
  const resolved = all.filter(c => c.status === "resolved");
  const showResolved = sessionStorage.getItem("__dr_show_resolved__") === "true";

  // Rebuild openCommentsBySelector for click routing
  openCommentsBySelector = {};
  open.forEach(c => {
    if (!openCommentsBySelector[c.selector]) openCommentsBySelector[c.selector] = [];
    openCommentsBySelector[c.selector].push(c);
  });

  // Re-render badges (open comments only)
  clearBadges();
  Object.entries(openCommentsBySelector).forEach(([selector, comments]) => {
    injectBadge(selector, comments.length);
  });

  // Update sidebar counts
  document.getElementById("__dr-count__").textContent = open.length;
  document.getElementById("__dr-resolved-count__").textContent = resolved.length;

  // Render sidebar threads
  const body = document.getElementById("__dr-sidebar-body__");
  body.innerHTML = "";

  open.forEach(c => body.appendChild(buildThreadCard(c, false)));

  if (showResolved) {
    resolved.forEach(c => body.appendChild(buildThreadCard(c, true)));
  }

  if (open.length === 0 && (!showResolved || resolved.length === 0)) {
    const empty = document.createElement("div");
    empty.style.cssText = "color:#9ca3af; text-align:center; padding:24px; font-size:12px;";
    empty.textContent = "No open comments. Click any element to add one.";
    body.appendChild(empty);
  }
}
```

### New REST route — `GET /comments/resolved` (optional)

In Phase 3 you may prefer to paginate resolved comments separately to avoid loading a large
history on every refresh. Add:

```typescript
app.get("/comments/resolved", (_req, res) => {
  const all = readComments(storePath);
  const resolved = all.filter(c => c.status === "resolved");
  res.json(resolved);
});
```

The client can call this only when the toggle is enabled, reducing payload size during normal
operation.

---

## Feature 3 — Multi-File Support

### Overview

Instead of `concurly open <file.html>` accepting a single file, it can now accept a
directory or a glob pattern. All matching HTML files are served, watched, and reviewed under
a single running server. The sidebar gains a file picker at the top.

### CLI changes

```
concurly open design.html            # Single file (Phase 1/2 behavior, unchanged)
concurly open designs/               # All .html files in a directory
concurly open designs/*.html         # Explicit glob
```

The state file gains a `htmlPaths` array field (replacing the single `htmlPath`):

```json
{
  "htmlPaths": [
    "C:\\Users\\leo\\designs\\auth-flow.html",
    "C:\\Users\\leo\\designs\\dashboard.html"
  ],
  "activePath": "C:\\Users\\leo\\designs\\auth-flow.html",
  "storePaths": {
    "C:\\Users\\leo\\designs\\auth-flow.html": "C:\\Users\\leo\\designs\\auth-flow.comments.json",
    "C:\\Users\\leo\\designs\\dashboard.html": "C:\\Users\\leo\\designs\\dashboard.comments.json"
  },
  "port": 5391,
  "startedAt": "2026-06-27T14:30:00.000Z"
}
```

### Server routing for multiple files

Each HTML file is served at a path derived from its filename:

- `auth-flow.html` → `GET /auth-flow`
- `dashboard.html` → `GET /dashboard`
- `GET /` → redirects to the first file in the list

```typescript
htmlPaths.forEach((htmlPath) => {
  const slug = path.basename(htmlPath, ".html");
  app.get(`/${slug}`, (_req, res) => {
    serveHtmlWithInjection(htmlPath, res);
  });
});
```

The comment API is keyed by file slug:

```
GET  /comments?file=auth-flow      # Open comments for that file
POST /comments?file=auth-flow      # New comment on that file
PATCH /comments/:id/resolve        # ID is globally unique (UUID), no file needed
```

### File picker in sidebar

At the top of the sidebar, above the header, a horizontal tab bar:

```html
<div id="__dr-file-tabs__">
  <button class="__dr-tab__ active" data-slug="auth-flow">auth-flow</button>
  <button class="__dr-tab__" data-slug="dashboard">dashboard</button>
</div>
```

Clicking a tab navigates the browser to `http://localhost:5391/<slug>`. Because the server
serves each file at its own route, navigation is instant.

```javascript
document.querySelectorAll(".__dr-tab__").forEach(tab => {
  tab.addEventListener("click", () => {
    window.location.href = `http://localhost:${PORT}/${tab.dataset.slug}`;
  });
});
```

The active tab is determined by `window.location.pathname` on page load.

### Badge count in file tabs

Each tab shows the count of open comments for that file as a small badge:

```
auth-flow (3)   dashboard (1)
```

The client fetches comment counts for all files on load by calling
`GET /comments/summary` — a new route that returns per-file open comment counts:

```typescript
app.get("/comments/summary", (_req, res) => {
  const summary: Record<string, number> = {};
  Object.entries(state.storePaths).forEach(([htmlPath, storePath]) => {
    const slug = path.basename(htmlPath, ".html");
    const open = readComments(storePath).filter(c => c.status === "open");
    summary[slug] = open.length;
  });
  res.json(summary);
});
```

### `concurly review` with multi-file

Without a `--file` flag, `agent list` returns open comments across all files:

```json
{
  "files": [
    {
      "htmlFile": "C:\\Users\\leo\\designs\\auth-flow.html",
      "slug": "auth-flow",
      "openComments": [...]
    },
    {
      "htmlFile": "C:\\Users\\leo\\designs\\dashboard.html",
      "slug": "dashboard",
      "openComments": [...]
    }
  ],
  "totalOpen": 4
}
```

With `--file auth-flow`, returns only that file's comments.

---

## Feature 4 — Polish

### 4a. `--port` CLI flag

```
concurly open design.html --port 8080
```

In `cli.ts`, parse `--port` from `process.argv`. If provided, use that port directly without
auto-scanning. If that port is in use, exit with an error.

```typescript
const portArg = process.argv.includes("--port")
  ? parseInt(process.argv[process.argv.indexOf("--port") + 1])
  : null;

const port = portArg ?? await findFreePort(5391);
```

### 4b. `concurly --help`

```
concurly --help
```

Print a usage summary to stdout and exit 0. No external library needed — plain `console.log`.

```
concurly — local HTML design review tool

Commands:
  concurly open <file.html>           Serve a file and open the browser
  concurly open <directory/>          Serve all HTML files in a directory
  concurly review                 Print open comments as JSON
  concurly review --file <slug>   Open comments for a specific file
  concurly agent resolve <id>         Mark a comment as resolved
  concurly export                     Export open comments as Markdown

Options:
  --port <number>    Use a specific port instead of auto-selecting from 5391
  --help             Show this help message
```

### 4c. `concurly export` command

Exports all open comments to a Markdown file next to the HTML file. Useful for pasting into
Claude Code chat when you do not want to use the agent nudge button.

Output file: `<filename>-comments.md`

```markdown
# Review Comments — auth-flow.html
Generated: 2026-06-27T15:00:00.000Z

## Comment 1 of 3
**Element**: `body > div#hero > h1:nth-child(1)`
**Excerpt**: "Welcome to the platform"
**Comment**: This heading is too generic, needs to reflect the product name

---

## Comment 2 of 3
**Element**: `body > section:nth-child(3) > p:nth-child(2)`
**Excerpt**: "Sign up today to get started with our service"
**Comment**: CTA copy is vague — what does the user actually get?

---
```

The markdown file path is printed to stdout and copied to the Windows clipboard via:

```typescript
import { execSync } from "child_process";

function copyToClipboard(text: string): void {
  try {
    // Windows: pipe to clip.exe
    execSync(`echo ${JSON.stringify(text)} | clip`, { shell: true });
  } catch {
    // Silently ignore clipboard failures
  }
}
```

After writing the file, print:

```
Exported 3 comments to: C:\Users\leo\designs\auth-flow-comments.md
Path copied to clipboard — paste into Claude Code with @ to reference the file.
```

### 4d. Keyboard shortcuts (client.js)

| Shortcut | Action |
|----------|--------|
| `Escape` | Close comment box (Phase 1) or close sidebar |
| `Ctrl + Shift + R` | Trigger "▶ Review Comments" (same as clicking the button) |
| `Ctrl + Shift + H` | Toggle resolved comment history |
| `Ctrl + Shift + E` | Call `GET /export` (triggers server-side export, no page nav needed) |

The `Ctrl + Shift + R` shortcut is the most important — it lets the user keep focus in the
browser without reaching for the sidebar button.

```javascript
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const box = document.getElementById("__concurly__");
    if (box) { box.remove(); return; }
    const sidebar = document.getElementById("__dr-sidebar__");
    if (sidebar) sidebar.classList.toggle("collapsed");
    return;
  }
  if (e.ctrlKey && e.shiftKey && e.key === "R") {
    e.preventDefault();
    document.getElementById("__dr-nudge-btn__")?.click();
  }
  if (e.ctrlKey && e.shiftKey && e.key === "H") {
    e.preventDefault();
    const toggle = document.getElementById("__dr-show-resolved__");
    if (toggle) { toggle.checked = !toggle.checked; toggle.dispatchEvent(new Event("change")); }
  }
  if (e.ctrlKey && e.shiftKey && e.key === "E") {
    e.preventDefault();
    fetch(`http://localhost:${PORT}/export`).then(r => r.json()).then(d => {
      console.log(`[concurly] Exported to: ${d.path}`);
    });
  }
});
```

### 4e. `GET /export` server route

```typescript
app.get("/export", (_req, res) => {
  const state = readStateFile();
  if (!state) { res.status(400).json({ error: "No active session" }); return; }

  const comments = readComments(state.storePath).filter(c => c.status === "open");
  const md = buildMarkdownExport(state.htmlPath, comments);
  const outPath = state.htmlPath.replace(/\.html$/i, "-comments.md");
  fs.writeFileSync(outPath, md, "utf-8");

  // Copy path to clipboard
  try { execSync(`echo ${outPath} | clip`, { shell: true }); } catch {}

  res.json({ path: outPath, count: comments.length });
});
```

### 4f. Error handling hardening

All three phases accumulate error cases. Phase 3 adds formal error handling for:

| Scenario | Behavior |
|----------|----------|
| `claude` not found when nudge fires | Show in output panel: `claude is not installed or not on PATH. Run: npm install -g @anthropic-ai/claude-code` |
| HTML file deleted while server is running | Serve a `404` HTML page that says the file was moved or deleted, with the path |
| Comment JSON file corrupted (invalid JSON) | Print warning, treat as empty, do not crash server |
| WebSocket connection lost (server restart) | Client auto-reconnects every 2 seconds (implemented in Feature 1) |
| `concurly agent resolve` called with already-resolved ID | Print `Comment abc-123 is already resolved` and exit 0 (not 1) |
| glob pattern matches no files | Print `No HTML files found matching: <pattern>` and exit 1 |

---

## Updated Claude Code Skill File (full replacement)

Replace `skills/concurly/SKILL.md` with this complete version:

````markdown
# concurly

Review HTML design documents with inline comments and resolve them as an agent.
Works with single files and multi-file design systems.

## /concurly open

Opens one or more HTML design files in the browser with the comment layer active.

Usage:
  /concurly open design.html
  /concurly open designs/
  /concurly open designs/ --port 8080

Steps:
1. Run `concurly open <path>` in the shell
2. Tell the user the browser has opened and they can click any element to leave a comment
3. Mention the keyboard shortcut Ctrl+Shift+R to trigger a review from within the browser
4. Remind them to run `/concurly review` when ready for you to address the comments

## /concurly review

Reads all open comments on the active HTML file(s) and addresses each one.

Steps:
1. Run `concurly review` and parse the JSON output
2. For each file in the `files` array:
   a. For each comment in `openComments`:
      i.  Read the `selector` and `excerpt` to locate the element in the HTML
      ii. Read the `body` to understand what to change
      iii. Open the HTML file on disk and apply the change
      iv. Run `concurly agent resolve <id>` to mark it resolved
3. The browser will auto-reload after each file save (live reload is active)
4. After all comments are addressed, report what was changed per file

## /concurly-history

Shows all resolved comments for the active session.

Steps:
1. Run `concurly review` and look at resolved comments (status: "resolved")
2. Summarize what was changed, when, and on which elements

## /concurly-export

Exports open comments to a Markdown file and copies the path to clipboard.

Steps:
1. Run `concurly export` in the shell
2. Tell the user the file path and that it has been copied to their clipboard
3. They can paste it into a Claude Code chat with @ to reference it directly
````

---

## Build Changes for Phase 3

### Updated `postbuild` script

Phase 3 adds `watcher.ts` to the TypeScript source. No changes needed to tsconfig — it is
already set to compile all `src/**/*.ts` files. The `postbuild` copy command remains the same.

### Full `package.json` for Phase 3

```json
{
  "name": "concurly",
  "version": "0.3.0",
  "description": "Local HTML design review tool with AI agent comment loop",
  "main": "dist/cli.js",
  "bin": {
    "concurly": "dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "postbuild": "copy src\\client.js dist\\client.js",
    "dev": "tsc --watch",
    "start": "node dist/cli.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "open": "^9.1.0",
    "cors": "^2.8.5",
    "chokidar": "^3.5.3",
    "ws": "^8.16.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/cors": "^2.8.17",
    "@types/node": "^20.0.0",
    "@types/ws": "^8.5.10",
    "typescript": "^5.3.0"
  }
}
```

---

## Phase 3 Definition of Done

The following scenarios must all work end to end:

1. `concurly open designs/` opens the browser showing the first HTML file; file tabs in the
   sidebar show all discovered files with their open comment counts
2. Clicking a different file tab navigates to that file and shows its comments
3. Claude Code edits `auth-flow.html` on disk — the browser automatically reloads within
   ~500ms and re-renders badges without any user action
4. The "Show resolved" toggle reveals greyed-out resolved threads below open ones
5. `Ctrl + Shift + R` in the browser triggers the agent nudge without clicking the button
6. `concurly export` writes a Markdown file and the path is on the clipboard
7. `concurly open designs/ --port 8080` starts on the specified port
8. `concurly --help` prints the usage summary and exits
9. Deleting the HTML file while the server is running shows a graceful error page in the
   browser, not a server crash
10. Corrupting `design.comments.json` while the server is running does not crash the server —
    it logs a warning and treats comments as empty until the file is valid again
