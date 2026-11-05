# Read / Review Mode Toggle and Collapsed-by-Default Sidebar — Design

Date: 2026-11-05
Scope: `src/client.js` only (browser overlay). No server, CLI, store, or REST changes.

## Problem

The overlay always allows click-to-comment, and the sidebar starts expanded. Reading a design
is noisy: every click opens a comment box, and the sidebar covers content.

## Goals

1. A **Read / Review mode toggle**. Read mode = no commenting. Review mode = click a section to comment.
2. The sidebar **starts collapsed on every page load** and is only shown when the user expands it.

## Non-goals

- Persisting mode across reloads.
- Any change to the comments data model, REST API, WebSocket events, or CLI.
- Changing the "View All Comments" history tab (already read-only).

## Design

### Mode state
- New module-level `let mode = "read"; // "read" | "review"` in `client.js`. Always `"read"` on load; not persisted.
- `activeTab` is unchanged and independent.
- `setMode(next)` updates `mode`, the toggle UI, and toggles class `__dr-mode-review__` on `<body>`.

### Toggle UI
- A two-option switch labeled "Read | Review" in `#__dr-header__`, right side, before the GitHub icon.
- Built in `injectHeader()` (or a helper it calls). All IDs/classes use the `__dr-` prefix; CSS added in `injectStyles()`.
- Header height (45px) and the 85px chrome offset are unchanged.

### Gating
- The document `click` and `mouseover` handlers (and the scroll/hover logic at the same site) guard with
  `if (activeTab !== "review" || mode !== "review") return`.
- Switching to read mode: remove hover highlight (`hoveredEl`), close any open comment box (`#__docreview__`).

### Badges
- Hidden in read mode via CSS keyed off the body class (e.g. `body:not(.__dr-mode-review__) .__dr-badge__ { display: none }`).
- `openCommentsBySelector` and badge DOM are left intact, so switching back to review shows them immediately.
- The WebSocket `comments-updated` re-render must not make badges visible in read mode (CSS rule covers this, as it keys off body class, not render logic).

### Sidebar
- Starts collapsed on every load: `injectSidebar()` always adds `collapsed`; the `sessionStorage` restore is removed.
- `openSidebar()` / `toggleSidebar()` stop reading/writing `__dr_sidebar_open__`.
- Expandable in read mode so existing comments can be read.
- In read mode, the edit, resolve, and delete buttons on thread cards are hidden (CSS keyed off body class). Scroll-to-element stays enabled.
- Any code that auto-opens the sidebar on comment creation continues to work (comment creation only occurs in review mode).

### Docs
- Update `CLAUDE.md` (module-level state, browser UI notes) and `README.md`; bump version in `package.json`.

## Verification (manual, no test suite in repo)
1. Load a file: starts in read mode, sidebar collapsed; clicking page content does nothing, no hover highlight.
2. Toggle to Review: hover highlight and click-to-comment work; badges visible.
3. Toggle back to Read with the comment box open: box closes, badges hidden, sidebar edit/resolve/delete hidden.
4. Reload: back in read mode, sidebar collapsed even if it was expanded before.
5. Trigger a `comments-updated` event in read mode (e.g. `concurly agent resolve`): badges stay hidden.
6. History tab still works in both modes.
