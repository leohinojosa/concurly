# docreview — Phase 1 Build Specification
> Feed this document to your LLM code generator as the sole source of truth for Phase 1.

---

## Project Overview

You are building **docreview** — a local CLI tool that serves an HTML file in the browser with an injected comment layer, stores comments as JSON, and exposes a CLI interface for an AI agent (Claude Code) to read and resolve those comments.

This is Phase 1 only. The goal is a working end-to-end loop:
- User runs `docreview open design.html`
- Browser opens, user clicks an element, types a comment, submits it
- Developer runs `docreview agent list` in terminal — sees all open comments as JSON
- Developer runs `docreview agent resolve <id>` — comment marked resolved
- Browser reflects the change without full page reload

No UI polish, no sidebar panel, no live reload of the HTML file on disk change. Those are Phase 2+.

---

## Target Environment

- **OS**: Windows 10/11
- **Runtime**: Node.js 20+ (LTS)
- **Package manager**: npm
- **Shell**: PowerShell and CMD must both work for CLI commands
- **Install method**: `npm install -g .` from the project root (local global install during dev)
- **No WSL dependency** — must run natively on Windows

---

## Project Structure

```
docreview/
├── package.json
├── tsconfig.json
├── src/
│   ├── cli.ts           ← Entry point, parses argv, routes to commands
│   ├── server.ts        ← Express HTTP server + API routes
│   ├── store.ts         ← Read/write comments JSON file
│   ├── inject.ts        ← Builds the script tag string to inject into HTML
│   └── client.js        ← Vanilla JS injected into the browser (NOT TypeScript)
└── dist/                ← Compiled output (tsc target)
```

> `client.js` is plain JavaScript, not TypeScript. It runs in the browser and must have zero build dependencies — it is read from disk and injected as a raw `<script>` tag by the server.

---

## package.json

```json
{
  "name": "docreview",
  "version": "0.1.0",
  "description": "Local HTML design review tool with AI agent comment loop",
  "main": "dist/cli.js",
  "bin": {
    "docreview": "dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "start": "node dist/cli.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "open": "^9.1.0",
    "cors": "^2.8.5"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/cors": "^2.8.17",
    "@types/node": "^20.0.0",
    "typescript": "^5.3.0"
  }
}
```

**Important**: Use `open` v9 (ESM-compatible via dynamic import or require workaround). See the `cli.ts` section for how to import it correctly in CommonJS TypeScript.

---

## tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

---

## Comment Data Model

This is the canonical shape for every comment. Stored in an array in the JSON file.

```typescript
interface Comment {
  id: string;           // UUID v4, generated at creation time using crypto.randomUUID()
  selector: string;     // CSS selector path to the clicked element (e.g. "body > div#hero > p:nth-child(2)")
  excerpt: string;      // First 120 chars of the element's innerText, for human readability
  body: string;         // The comment text entered by the user
  status: "open" | "resolved";
  createdAt: string;    // ISO 8601 timestamp
  resolvedAt: string | null;
}
```

---

## Comment Store — `src/store.ts`

Responsibilities:
- Derive the comments file path from the HTML file path: `design.html` → `design.comments.json` (same directory)
- Read all comments from disk
- Write a new comment
- Update a comment's status to "resolved"
- All file I/O is synchronous (`fs.readFileSync` / `fs.writeFileSync`) — no async needed here

```typescript
import fs from "fs";
import path from "path";

export function getStorePath(htmlPath: string): string {
  const dir = path.dirname(path.resolve(htmlPath));
  const base = path.basename(htmlPath, path.extname(htmlPath));
  return path.join(dir, `${base}.comments.json`);
}

export function readComments(storePath: string): Comment[] {
  if (!fs.existsSync(storePath)) return [];
  return JSON.parse(fs.readFileSync(storePath, "utf-8"));
}

export function writeComment(storePath: string, comment: Comment): void {
  const comments = readComments(storePath);
  comments.push(comment);
  fs.writeFileSync(storePath, JSON.stringify(comments, null, 2), "utf-8");
}

export function resolveComment(storePath: string, id: string): boolean {
  const comments = readComments(storePath);
  const target = comments.find(c => c.id === id);
  if (!target) return false;
  target.status = "resolved";
  target.resolvedAt = new Date().toISOString();
  fs.writeFileSync(storePath, JSON.stringify(comments, null, 2), "utf-8");
  return true;
}
```

---

## Client Script — `src/client.js`

This file is injected verbatim into the served HTML page via a `<script>` tag. It must:

- Be plain JavaScript (no imports, no TypeScript, no bundler)
- Be self-contained in an IIFE to avoid polluting the page's global scope
- Communicate with the server via `fetch` to `http://localhost:<PORT>/comments`

### Behavior spec

1. **On load**: fetch `GET /comments` and render badges on anchored elements (Phase 1: just a console.log is acceptable — badge rendering is Phase 2)
2. **On element click**:
   - Ignore clicks on the injected comment UI itself (check `event.target.closest('#__docreview__')`)
   - Compute a CSS selector path for `event.target`
   - Capture `event.target.innerText.slice(0, 120)` as the excerpt
   - Show a minimal floating input UI near the click coordinates
3. **Floating input UI** (minimal, inline styles only):
   - A small `div` absolutely positioned at click X/Y
   - A `textarea` for the comment body
   - A "Submit" button and a "Cancel" button
   - On Submit: `POST /comments` with `{ selector, excerpt, body }`
   - On Cancel or after Submit: remove the div from DOM
4. **Selector generation**: implement a `getSelector(el)` function that walks up the DOM from the clicked element and builds a selector string. Use `id` if present (`#hero`), otherwise `tagName + :nth-child(n)`. Stop at `<body>`.

```javascript
(function () {
  const PORT = "__PORT__"; // Replaced at inject time by server.ts

  function getSelector(el) {
    if (el === document.body) return "body";
    const parts = [];
    while (el && el !== document.body) {
      let selector = el.tagName.toLowerCase();
      if (el.id) {
        selector = `#${el.id}`;
        parts.unshift(selector);
        break;
      } else {
        const siblings = Array.from(el.parentNode?.children || []);
        const index = siblings.indexOf(el) + 1;
        selector += `:nth-child(${index})`;
      }
      parts.unshift(selector);
      el = el.parentElement;
    }
    return "body > " + parts.join(" > ");
  }

  function showCommentBox(x, y, selector, excerpt) {
    const existing = document.getElementById("__docreview__");
    if (existing) existing.remove();

    const box = document.createElement("div");
    box.id = "__docreview__";
    box.style.cssText = `
      position: fixed;
      top: ${Math.min(y, window.innerHeight - 180)}px;
      left: ${Math.min(x, window.innerWidth - 320)}px;
      width: 300px;
      background: #fff;
      border: 2px solid #6366f1;
      border-radius: 8px;
      padding: 12px;
      z-index: 999999;
      box-shadow: 0 4px 24px rgba(0,0,0,0.18);
      font-family: system-ui, sans-serif;
      font-size: 13px;
    `;

    const label = document.createElement("div");
    label.style.cssText = "margin-bottom:6px; color:#555; font-size:11px;";
    label.textContent = `On: ${excerpt.slice(0, 60)}${excerpt.length > 60 ? "…" : ""}`;

    const textarea = document.createElement("textarea");
    textarea.style.cssText = "width:100%; height:72px; box-sizing:border-box; border:1px solid #ccc; border-radius:4px; padding:6px; font-size:13px; resize:vertical;";
    textarea.placeholder = "Leave a comment…";

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex; gap:8px; margin-top:8px; justify-content:flex-end;";

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.style.cssText = "padding:4px 12px; border:1px solid #ccc; background:#f5f5f5; border-radius:4px; cursor:pointer;";
    cancelBtn.onclick = () => box.remove();

    const submitBtn = document.createElement("button");
    submitBtn.textContent = "Submit";
    submitBtn.style.cssText = "padding:4px 12px; background:#6366f1; color:#fff; border:none; border-radius:4px; cursor:pointer;";
    submitBtn.onclick = async () => {
      const body = textarea.value.trim();
      if (!body) return;
      submitBtn.disabled = true;
      submitBtn.textContent = "Saving…";
      try {
        await fetch(`http://localhost:${PORT}/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selector, excerpt, body }),
        });
        box.remove();
      } catch (e) {
        submitBtn.textContent = "Error — retry";
        submitBtn.disabled = false;
      }
    };

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(submitBtn);
    box.appendChild(label);
    box.appendChild(textarea);
    box.appendChild(btnRow);
    document.body.appendChild(box);
    textarea.focus();
  }

  document.addEventListener("click", (e) => {
    if (e.target.closest("#__docreview__")) return;
    const selector = getSelector(e.target);
    const excerpt = (e.target.innerText || e.target.textContent || "").trim().slice(0, 120);
    showCommentBox(e.clientX + 8, e.clientY + 8, selector, excerpt);
  });

  // Keyboard: Escape closes the box
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const box = document.getElementById("__docreview__");
      if (box) box.remove();
    }
  });
})();
```

---

## Server — `src/server.ts`

Responsibilities:
- Accept the resolved HTML file path and a port number
- Serve the HTML file at `GET /` with the client script injected before `</body>`
- If `</body>` is not present, append the script at the end
- Serve the REST comment API
- Return the Express app instance (do not call `listen` inside this module — let `cli.ts` do that)

### Port selection
- Default port: `5391`
- If port is in use, increment and retry up to 10 times
- Chosen port must be passed back to `cli.ts` so it can be replaced in the client script

### HTML injection
Read the HTML file from disk on every request to `GET /` (so edits on disk are reflected on browser refresh without restarting the server). Replace `__PORT__` in `client.js` with the actual port number before injecting.

```typescript
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { readComments, writeComment, resolveComment, getStorePath } from "./store";

export function createServer(htmlPath: string, clientScriptPath: string) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const storePath = getStorePath(htmlPath);

  // Serve the HTML with injected comment layer
  app.get("/", (_req, res) => {
    let html = fs.readFileSync(path.resolve(htmlPath), "utf-8");
    // Port replacement happens in cli.ts before this runs — see below
    const scriptTag = `<script>\n${fs.readFileSync(clientScriptPath, "utf-8")}\n</script>`;
    if (html.includes("</body>")) {
      html = html.replace("</body>", `${scriptTag}\n</body>`);
    } else {
      html += scriptTag;
    }
    res.setHeader("Content-Type", "text/html");
    res.send(html);
  });

  // REST API
  app.get("/comments", (_req, res) => {
    res.json(readComments(storePath));
  });

  app.post("/comments", (req, res) => {
    const { selector, excerpt, body } = req.body;
    if (!selector || !body) {
      res.status(400).json({ error: "selector and body are required" });
      return;
    }
    const comment: Comment = {
      id: crypto.randomUUID(),
      selector,
      excerpt: excerpt || "",
      body,
      status: "open",
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    };
    writeComment(storePath, comment);
    res.status(201).json(comment);
  });

  app.patch("/comments/:id/resolve", (req, res) => {
    const ok = resolveComment(storePath, req.params.id);
    if (!ok) {
      res.status(404).json({ error: "Comment not found" });
      return;
    }
    res.json({ success: true });
  });

  return app;
}
```

### Port auto-selection helper (add to `server.ts`)

```typescript
import net from "net";

export function findFreePort(startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(startPort, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
    server.on("error", () => {
      if (startPort < 5401) resolve(findFreePort(startPort + 1));
      else reject(new Error("No free port found in range 5391–5401"));
    });
  });
}
```

---

## CLI — `src/cli.ts`

Entry point. Parses `process.argv` and dispatches to one of three commands.

### Commands

#### `docreview open <file.html>`
1. Validate the file exists — exit with clear error if not
2. Find a free port starting at 5391
3. Read `src/client.js` from disk, replace `"__PORT__"` with the actual port string
4. Write the port-replaced script to a temp path (`os.tmpdir()/docreview-client.js`) so the server can read it
5. Start the Express server on the chosen port
6. Open the browser to `http://localhost:<port>` using the `open` package
7. Print: `docreview running on http://localhost:<port>` and `Comments stored at: <storePath>`
8. Keep the process alive (the server keeps it alive)

#### `docreview agent list`
- Find the store path (requires knowing which HTML file is being reviewed)
- **Problem**: the `open` command and the `agent list` command run in separate processes — the server process doesn't share memory with the CLI process
- **Solution**: write a small state file to `os.tmpdir()/docreview-state.json` when `open` runs, containing `{ htmlPath, storePath, port }`. The `agent list` command reads this file.
- Read comments from the store, filter to `status === "open"`, print as JSON to stdout
- Output format:
```json
{
  "htmlFile": "C:\\Users\\leo\\designs\\auth-flow.html",
  "openComments": [
    {
      "id": "abc-123",
      "selector": "body > div#hero > h1:nth-child(1)",
      "excerpt": "Welcome to the platform",
      "body": "This heading is too generic, needs to reflect the product name",
      "createdAt": "2026-06-27T14:32:00.000Z"
    }
  ]
}
```

#### `docreview agent resolve <id>`
- Read state file to get store path
- Call `resolveComment(storePath, id)`
- Print: `Resolved comment <id>` or `Comment not found`

### Handling the `open` package on Windows (CommonJS)
The `open` package v9+ is ESM. Use a dynamic import workaround:

```typescript
async function openBrowser(url: string) {
  const { default: open } = await import("open");
  await open(url);
}
```

### Windows path safety
- Always use `path.resolve()` for file paths — never concatenate with `/`
- Use `path.join()` for constructing paths from parts
- The state file uses `os.tmpdir()` which returns a Windows-safe temp path

---

## State File

Written to `os.tmpdir()/docreview-state.json` when `docreview open` runs:

```json
{
  "htmlPath": "C:\\Users\\leo\\designs\\auth-flow.html",
  "storePath": "C:\\Users\\leo\\designs\\auth-flow.comments.json",
  "port": 5391,
  "startedAt": "2026-06-27T14:30:00.000Z"
}
```

This is how `agent list` and `agent resolve` find the active session without needing the server process to be involved.

---

## REST API Summary

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/` | — | HTML with injected script |
| GET | `/comments` | — | `Comment[]` |
| POST | `/comments` | `{ selector, excerpt, body }` | `Comment` (201) |
| PATCH | `/comments/:id/resolve` | — | `{ success: true }` |

---

## Error Cases to Handle

| Scenario | Behavior |
|----------|----------|
| `docreview open` called with non-existent file | Print error and exit with code 1 |
| `docreview agent list` called with no active session | Print `No active docreview session. Run: docreview open <file.html>` and exit 1 |
| `docreview agent resolve <id>` with unknown id | Print `Comment not found: <id>` and exit 1 |
| Port 5391–5401 all in use | Print error suggesting a manual port flag (Phase 2 feature) and exit 1 |
| HTML file cannot be read | Print the OS error message and exit 1 |

---

## Claude Code Skill File

Create this file at `skills/docreview/SKILL.md` in the project root. This is what gets installed into Claude Code via `npx skills add`.

````markdown
# docreview

Review HTML design documents with inline comments and resolve them as an agent.

## /docreview-open

Opens an HTML design file in the browser with the comment layer active.

Usage: `/docreview-open <path-to-file.html>`

Steps:
1. Run `docreview open <path>` in the shell
2. Tell the user the browser has opened and they can click any element to leave a comment
3. Remind them to run `/docreview-review` when ready for you to address the comments

## /docreview-review

Reads all open comments on the active HTML file and addresses each one.

Steps:
1. Run `docreview agent list` and parse the JSON output
2. For each comment in `openComments`:
   a. Read the `selector` and `excerpt` to identify which element is being commented on
   b. Open the HTML file on disk and locate the element matching the selector
   c. Apply the change described in `body`
   d. Run `docreview agent resolve <id>` to mark it resolved
3. After all comments are addressed, tell the user what was changed and ask them to refresh the browser to review
````

---

## Build and Install Steps (Windows)

```powershell
# From the project root
npm install
npm run build

# Install globally for dev use
npm install -g .

# Verify
docreview --help
```

After `npm run build`, the `dist/` folder must contain:
- `dist/cli.js`
- `dist/server.js`
- `dist/store.js`
- `dist/inject.js` (if you split injection logic)

The `src/client.js` file must be copied to `dist/client.js` as part of the build. Since `tsc` does not copy `.js` files, add a `postbuild` script:

```json
"postbuild": "copy src\\client.js dist\\client.js"
```

> Use `copy` (Windows CMD syntax). If you need cross-platform later, replace with `shx` or `copyfiles`. For Phase 1, Windows-only is fine.

---

## Out of Scope for Phase 1

Do not implement the following — they are explicitly Phase 2+:

- Comment badges/indicators on elements in the page
- Sidebar comment panel listing all threads
- Live reload when the HTML file changes on disk
- Multi-file support
- `--port` flag
- Comment editing or deletion
- Any authentication or multi-user support
- Markdown rendering in comment bodies
- Keyboard shortcut to open comment box

---

## Definition of Done for Phase 1

The following scenario must work end to end on Windows:

1. `npm install && npm run build && npm install -g .` completes without errors
2. `docreview open C:\path\to\design.html` opens the browser
3. Clicking an `<h1>` element in the browser shows the comment box
4. Typing a comment and clicking Submit stores it in `design.comments.json`
5. `docreview agent list` in a new terminal prints the comment as JSON
6. `docreview agent resolve <id>` marks it resolved
7. `docreview agent list` now returns an empty `openComments` array
