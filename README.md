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

### Reviewing a remote page

`concurly open` also accepts an `http(s)` URL — handy for raw HTML on GitHub:

```sh
concurly open "https://raw.githubusercontent.com/org/repo/main/docs/design.html?token=..."
concurly open https://github.com/org/repo/blob/main/docs/design.html   # blob links are rewritten to raw
```

- The page is fetched into `~/.concurly/reviews/<hash>/` and reviewed like a local file. Comments are stored there too and survive across sessions; the same URL always maps to the same folder, even when the `?token=` changes.
- Click the **↻** refresh icon in the header (or run `concurly refresh [port|url]`) to refetch. Your comments are kept. If the content is unchanged you'll see "No changes".
- Pages pinned to a commit SHA can't change, so they show "pinned to commit" instead of a Refresh button.
- concurly sends no credentials of its own — only what is already in the URL. If a link has expired, the refetch fails with a clear error and the cached copy stays; get a fresh "Raw" link and run `concurly open <fresh-url>` (or `concurly refresh <fresh-url>`) to carry on in the same session.
- The `?token=` is never written to disk or printed.

### Browser controls

| Action | What happens |
|---|---|
| **Read \| Review** toggle (header) | Read mode (default) disables commenting and hides badges; Review mode enables it |
| **↻** refresh icon (header, next to the toggle; tooltip "Refresh") | Local file: reloads the page. Remote page: refetches it from the source (comments are kept) |
| **Theme** button (header, right of ↻; tooltip "Theme") | Opens the theme menu — see [Themes](#themes) |
| Hover any element (Review mode) | Faint accent-colored outline (no comments) or bright outline (has comments) |
| Click an element with no comments (Review mode) | Opens a comment box to leave a note |
| Click an element with comments (Review mode) | Opens the sidebar scrolled to that thread |
| **↳ Show in page** | Scrolls to the element and pulses it yellow |
| **✎ Edit** | Opens an inline textarea to update the comment |
| **✓ Resolve** | Marks the comment resolved |
| **✕ Delete** | Permanently removes the comment |
| Sidebar toggle (✕ / ▶) | Collapses or expands the sidebar; it starts collapsed on every page load, expands when you switch to Review, and collapses when you switch to Read |
| Show resolved checkbox | Displays resolved comments greyed out below open ones |

### Themes

Click the palette button in the header (right of ↻) to pick a theme. **Hover** a theme to preview it live; **click** to keep it. `Esc`, clicking elsewhere, or `Tab` closes the menu and reverts the preview; the arrow keys move through the list.

| | Light | Dark |
|---|---|---|
| | **Paper** — warm editorial, serif headings | **Midnight** — modern, frosted sidebar, violet glow |
| | **Slate** — cool, crisp, neutral blue | **Nord** — frosty blue-grey |
| | **Mint** — fresh, soft green | **Ember** — warm charcoal and amber |
| | | **Terminal** — near-black, monospace, green |

- Until you choose, concurly follows your system's light/dark setting (Paper in light mode, Midnight in dark mode) and updates live if that setting changes.
- Your choice is remembered in the browser **and** in `~/.concurly/preferences.json`, so it carries across sessions and across ports (every concurly session runs on its own port, and browsers don't share storage between ports).
- Every theme is checked for readable contrast (WCAG AA) as part of the test suite.

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
New-Item -ItemType Directory -Force $HOME\.claude\skills\concurly | Out-Null
Copy-Item skills\concurly\* $HOME\.claude\skills\concurly\ -Recurse -Force
```

On macOS / Linux:

```sh
mkdir -p ~/.claude/skills/concurly && cp -r skills/concurly/. ~/.claude/skills/concurly/
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

Remote HTML works too (see [Reviewing a remote page](#reviewing-a-remote-page)):

```
/concurly open https://raw.githubusercontent.com/org/repo/main/docs/design.html?token=...
```

**Finding a GitHub file by name** — if you have the [GitHub CLI](https://cli.github.com/) (`gh`) installed and logged in, the skill can locate the file for you and fetch it, including from private repos:

```
/concurly open design.html org/repo            # looks on the repo's default branch
/concurly open design.html org/repo my-branch  # or a specific branch, tag, or commit
/concurly open https://github.com/org/repo/blob/main/docs/design.html
```

If the name matches several files the skill asks which one; if it isn't on that branch it asks where to look. `gh` is only used by the skill to build the URL — the `concurly` CLI itself never needs it, and any URL you paste works without it.

### `/concurly refresh`

Refetches a remote page in an active session; comments are kept.

```
/concurly refresh
/concurly refresh https://raw.githubusercontent.com/org/repo/main/docs/design.html?token=<fresh>
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

2. **Leave comments** — switch to Review mode in the header, then click any element and describe the change you want. Repeat for all feedback.

3. **Start the review** — run `/concurly review`. Claude reads every open comment, edits the HTML file, and resolves each comment when done.

4. **Check the result** — the browser reloads automatically as changes are saved. The sidebar clears resolved comments in real time. Review the updated design and repeat the cycle if needed.

5. **Close the session** — run `/concurly complete <port>` when the review is finished. Comments are preserved in the JSON file alongside the HTML for future reference.

---

## CLI Reference

```
concurly open <file.html | url>          Open a file or remote HTML URL (one instance per file/URL)
concurly list                            List all running instances with port, PID, and status
concurly review [port|path]              Print open comments as JSON
concurly complete <port|path>            Stop a session (comments JSON preserved)
concurly refresh [port|url]              Refetch a remote page (a fresh ?token= URL replaces an expired link)
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
