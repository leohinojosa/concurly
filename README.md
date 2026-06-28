# docreview

A local HTML design review tool. Open any HTML file in the browser, leave comments on any element, then let an AI agent apply the fixes and mark them resolved — all without leaving your editor.

---

## Installation

From the project directory, install `docreview` as a global CLI command:

```sh
npm install -g .
```

Verify it worked:

```sh
docreview --help
```

---

## Running docreview

Open an HTML file for review:

```sh
docreview open path/to/design.html
```

This starts a local server and opens the file in your browser with the comment overlay injected. The page automatically reloads when the file changes on disk.

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

## Installing the Claude Code Skills

Skills let Claude Code open files for review and apply comments automatically.

Copy the skill directory to your Claude skills folder:

```powershell
Copy-Item -Recurse -Force skills\docreview $HOME\.claude\skills\docreview
```

On macOS / Linux:

```sh
cp -r skills/docreview ~/.claude/skills/docreview
```

---

## Available Skills

### `/docreview-open`

Opens an HTML file in the browser with the docreview overlay active.

```
/docreview-open path/to/design.html
```

Claude will start the server, open the browser, and walk you through leaving comments.

### `/docreview-review`

Reads all open comments and applies the requested changes to the HTML file.

```
/docreview-review
```

Claude will address each comment, save the changes, and mark each comment resolved. The browser reloads automatically when the file and comments are updated.

---

## Review Workflow

1. **Open the file** — run `/docreview-open path/to/design.html` in Claude Code. The browser opens with the overlay.

2. **Leave comments** — click any element and describe the change you want. Repeat for all feedback.

3. **Start the review** — switch back to Claude Code and run `/docreview-review`. Claude reads every open comment, edits the HTML file, and resolves each comment when done.

4. **Check the result** — the browser reloads automatically as changes are saved. The sidebar clears resolved comments in real time. Review the updated design and repeat the cycle if needed.

---

## CLI Reference

```
docreview open <file.html>        Open a file in the browser with the comment overlay
docreview review                  Print all open comments as JSON (used by the skill)
docreview agent resolve <id>      Mark a specific comment as resolved
```
