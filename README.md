# 🤝 concurly

> Review software architecture concurrently with an expert AI peer.

Open any HTML file in the browser, leave comments on any element, then let an AI agent apply the fixes and mark them resolved — all without leaving your editor. Run as many parallel review sessions as you need; each file gets its own port.

---

## Installation

Clone the repository:

```sh
git clone https://github.com/leohinojosa/concurly
cd concurly
```

Install `concurly` as a global CLI command:

```sh
npm install -g .
```

Verify it worked:

```sh
concurly --help
```

---

## Running concurly

Open an HTML file for review:

```sh
concurly open path/to/design.html
```

Shorthand — omitting `open` defaults to it:

```sh
concurly path/to/design.html
```

This starts a local server on the next available port, opens the file in your browser with the comment overlay injected, and watches both the HTML file and the comments file for changes. If the file is already open in another session, the existing session is reused.

### Browser controls

| Action | What happens |
|---|---|
| Hover any element | Faint indigo outline (no comments) or bright indigo outline (has comments) |
| Click an element with no comments | Opens a comment box to leave a note |
| Click an element with comments | Opens the sidebar scrolled to that thread |
| **↳ Show in page** | Scrolls to the element and pulses it yellow |
| **✎ Edit** | Opens an inline textarea to update the comment |
| **✓ Resolve** | Marks the comment resolved |
| **✕ Delete** | Permanently removes the comment |
| Sidebar toggle (✕ / ▶) | Collapses or expands the sidebar; state is remembered per tab |
| Show resolved checkbox | Displays resolved comments greyed out below open ones |

---

## Managing instances

Each `concurly open` call starts an independent server process on its own port, so you can review multiple files in parallel.

### List all running sessions

```sh
concurly list
```

Output shows port, PID, status (`running` or `stale`), file path, and URL for every active instance.

### Stop a session

```sh
concurly complete <port|path>
```

Sends a graceful shutdown signal to the session identified by port number or file path. The server stops and the instance entry is removed. **The comments JSON file is never deleted** — it is kept for historic reference.

Examples:

```sh
concurly complete 5391
concurly complete path/to/design.html
```

---

## Installing the Claude Code Skills

Skills let Claude Code open files for review and apply comments automatically.

```powershell
Copy-Item -Recurse -Force skills\concurly $HOME\.claude\skills\concurly
```

On macOS / Linux:

```sh
cp -r skills/concurly ~/.claude/skills/concurly
```

---

## Available Skills

### `/concurly open`

Opens an HTML file in the browser with the concurly overlay active.

```
/concurly open path/to/design.html
```

Shorthand (defaults to open):

```
/concurly path/to/design.html
```

### `/concurly list`

Lists all running concurly instances.

```
/concurly list
```

### `/concurly review`

Reads all open comments and applies the requested changes to the HTML file.

```
/concurly review
```

If multiple sessions are running, specify a port or path:

```
/concurly review 5391
/concurly review path/to/design.html
```

Claude will address each comment, save the changes, and mark each comment resolved. The browser reloads automatically when the file updates, and the sidebar clears resolved comments in real time.

### `/concurly complete`

Stops a specific review session. Comments are preserved.

```
/concurly complete 5391
/concurly complete path/to/design.html
```

---

## Review Workflow

1. **Open the file** — run `/concurly open path/to/design.html` in Claude Code. The browser opens with the overlay.

2. **Leave comments** — click any element and describe the change you want. Repeat for all feedback.

3. **Start the review** — run `/concurly review`. Claude reads every open comment, edits the HTML file, and resolves each comment when done.

4. **Check the result** — the browser reloads automatically as changes are saved. The sidebar clears resolved comments in real time. Review the updated design and repeat the cycle if needed.

5. **Close the session** — run `/concurly complete <port>` when the review is finished. Comments are preserved in the JSON file alongside the HTML for future reference.

---

## CLI Reference

```
concurly open <file.html>                Open a file in the browser (one instance per file)
concurly list                            List all running instances with port, PID, and status
concurly review [port|path]              Print open comments as JSON
concurly complete <port|path>            Stop a session (comments JSON preserved)
concurly agent resolve <id> [port|path]  Mark a specific comment as resolved
```

---

## Building from source

Prerequisites: Node.js 20+ and npm.

```sh
git clone https://github.com/leohinojosa/concurly
cd concurly
npm install
npm run build
```

`npm run build` compiles the TypeScript sources with `tsc` and copies `src/client.js` into `dist/`. After a successful build, install the CLI globally:

```sh
npm install -g .
concurly --help
```

To rebuild after making changes to any source file:

```sh
npm run build
```

Then restart any open sessions (`concurly complete <port>`, then `concurly open <file>`) to pick up the new client script.
