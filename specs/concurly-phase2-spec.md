# concurly — Phase 2 Implementation Specification
> Feed this document to your LLM code generator after Phase 1 is complete and working.
> Phase 1 must be fully functional before starting Phase 2.

---

## Phase 2 Goals

Phase 2 transforms the minimal Phase 1 loop into a comfortable daily-driver tool. The four
objectives are:

1. **Page header bar** — a thin fixed bar at the top of every served page showing the app name
   and the path of the file under review
2. **Visual comment layer** — elements with comments show visible badges; hovering an element
   shows its annotation state before clicking
3. **Sidebar panel** — a persistent right-side panel listing all comment threads, with
   scroll-to-anchor, inline editing, and manual resolve/delete
4. **Comment editing and deletion** — open comments can be updated or permanently deleted from
   the sidebar without opening a new comment box

Phase 2 does not change the REST API shape or the CLI commands defined in Phase 1. All
changes in Phase 2 are additive to the server API (two new endpoints) and additive to the
client (new UI injected alongside existing Phase 1 behavior).

---

## Target Environment

Same as Phase 1:
- **OS**: Windows 10/11
- **Runtime**: Node.js 20+
- **Shell**: PowerShell and CMD
- All new npm dependencies must be CommonJS-compatible or wrapped with dynamic import

---

## Files Changed or Added in Phase 2

```
concurly/
├── src/
│   ├── cli.ts           ← Add FILE_PATH placeholder replacement at inject time
│   ├── server.ts        ← Add PATCH /comments/:id and DELETE /comments/:id
│   ├── store.ts         ← Add updateComment() and deleteComment()
│   └── client.js        ← Significant additions: header, badges, sidebar, edit/delete UI
├── package.json         ← No changes
├── tsconfig.json        ← No changes
└── skills/
    └── concurly/
        └── SKILL.md     ← Updated to document sidebar actions and header bar
```

---

## Feature 1 — Page Header Bar

### Behavior

A thin fixed bar is injected at the top of every served page. It shows:
- The app brand name **"concurly"** on the left
- A visual separator `·`
- The **filename** (basename only, bold white)
- The **full file path** (muted smaller text, truncated with ellipsis on long paths; full path
  is visible as a tooltip on hover via `title` attribute)

The bar is `position: fixed; top: 0; left: 0; right: 0` so it does not affect the design
document's layout. The sidebar (z-index `999995`) overlaps the bar's right edge.

### Passing the path from server to client

`cli.ts` injects the path at script-build time using a placeholder replacement, the same
pattern used for `PORT`:

```typescript
// src/cli.ts — in cmdOpen(), after reading the client script
const portedScript = clientScript
  .replace('"__PORT__"', String(port))
  .replace('"__FILE_PATH__"', JSON.stringify(htmlPath));
```

In `client.js`, declare the constant at the top of the IIFE:

```javascript
const PORT = "__PORT__";       // replaced at inject time by cli.ts
const FILE_PATH = "__FILE_PATH__"; // replaced at inject time by cli.ts
```

### Header DOM structure

```html
<div id="__dr-header__">
  <span id="__dr-header-brand__">concurly</span>
  <span id="__dr-header-sep__">·</span>
  <span id="__dr-header-filename__">design.html</span>
  <span id="__dr-header-path__">/full/path/to/design.html</span>
</div>
```

Extract the filename in plain JS to avoid a Node.js dependency in the browser client:

```javascript
const fileName = FILE_PATH.replace(/.*[\\/]/, "") || FILE_PATH;
```

This regex strips everything up to and including the last `/` or `\`, covering both Unix and
Windows paths.

### Header styles (part of `injectStyles()`)

```css
#__dr-header__ {
  position: fixed; top: 0; left: 0; right: 0; height: 36px;
  background: #18181b; z-index: 999993;
  display: flex; align-items: center; padding: 0 16px; gap: 10px;
  font-family: system-ui, sans-serif; font-size: 12px;
  white-space: nowrap; overflow: hidden; box-sizing: border-box;
}
#__dr-header-brand__ {
  color: #818cf8; font-family: monospace; font-weight: 700;
  font-size: 13px; letter-spacing: 0.05em; flex-shrink: 0;
}
#__dr-header-sep__ { color: #52525b; flex-shrink: 0; }
#__dr-header-filename__ { color: #f4f4f5; font-weight: 600; flex-shrink: 0; }
#__dr-header-path__ {
  color: #71717a; font-size: 11px;
  overflow: hidden; text-overflow: ellipsis; min-width: 0;
}
```

---

## Feature 2 — Comment Badges on Elements

### Behavior

- On page load, `client.js` fetches `GET /comments` and groups results by `selector`
- For each selector with at least one **open** comment, the corresponding DOM element receives
  a small badge overlaid on its top-right corner
- The badge shows the count of open comments on that element (e.g. `2`)
- Hovering an element with comments shows a **brighter indigo** outline (`#6366f1`)
- Hovering an element with no comments shows a **faint indigo** outline (`#a5b4fc`)
- Clicking an element that already has comments opens the sidebar focused on that element's
  thread, rather than opening the new-comment box
- Clicking an element with no comments opens the new-comment box as in Phase 1

### Badge DOM structure

Badges are injected as `position: fixed` children of `document.body`, not children of the
target element. This avoids breaking the layout of the design document.

```javascript
function injectBadge(selector, count) {
  const el = document.querySelector(selector);
  if (!el) return;

  const rect = el.getBoundingClientRect();
  const badge = document.createElement("div");
  badge.className = "__dr-badge__";
  badge.dataset.selector = selector;
  badge.textContent = count;
  badge.style.cssText = `
    position: fixed;
    top: ${rect.top}px;
    left: ${rect.right - 20}px;
    width: 18px; height: 18px; border-radius: 50%;
    background: #6366f1; color: #fff; font-size: 10px; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
    z-index: 999990; pointer-events: none; font-family: system-ui, sans-serif;
  `;
  document.body.appendChild(badge);
}
```

Coordinates use `rect.top` and `rect.right` directly (viewport-relative) since the badge
uses `position: fixed`. Do not add `scrollY`/`scrollX`.

### Badge lifecycle

- `clearBadges()` removes all `.__dr-badge__` elements; called before every re-render
- `refreshComments()` re-fetches, rebuilds `openCommentsBySelector`, clears and re-injects
  badges, and re-renders the sidebar in one call
- Call `refreshComments()` on: page load, after a comment is submitted, after edit, resolve,
  or delete

### Scroll handling

On scroll, reposition all badges by re-reading `getBoundingClientRect()` on their target
elements. Throttle with a 100ms debounce:

```javascript
let scrollTimer = null;
window.addEventListener("scroll", () => {
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(repositionBadges, 100);
});
```

`repositionBadges()` iterates `document.querySelectorAll(".__dr-badge__")` and updates each
badge's `top`/`left` from a fresh `getBoundingClientRect()` call.

---

## Feature 3 — Sidebar Comment Panel

### Layout

Fixed panel on the right edge of the viewport:
- Width: `320px`, Height: `100vh`
- Position: `fixed; top: 0; right: 0`, Z-index: `999995`
- Background: `#fff`, box-shadow: `−4px 0 24px rgba(0,0,0,0.12)`
- Overlays the design document (does not shift layout)

### Sidebar DOM structure

```html
<div id="__dr-sidebar__">
  <div id="__dr-sidebar-header__">
    <span>Comments (<span id="__dr-count__">3</span>)</span>
    <button id="__dr-collapse__">✕</button>
  </div>
  <div id="__dr-sidebar-body__">
    <!-- One thread card per open comment -->
    <div class="__dr-thread__" data-id="abc-123" data-selector="body > h1:nth-child(1)">
      <div class="__dr-thread-selector__">body > h1:nth-child(1)</div>
      <div class="__dr-thread-excerpt__">"Welcome to the platform…"</div>
      <div class="__dr-thread-body__">This heading is too generic</div>
      <div class="__dr-thread-actions__">
        <button class="__dr-scroll-btn__">↳ Show in page</button>
        <button class="__dr-edit-btn__">✎ Edit</button>
        <button class="__dr-resolve-btn__">✓ Resolve</button>
        <button class="__dr-delete-btn__">✕ Delete</button>
      </div>
    </div>
  </div>
</div>
```

No footer. The nudge button is deferred to a later phase.

### Thread card actions

| Button | Behavior |
|--------|----------|
| **↳ Show in page** | `scrollIntoView({ behavior: 'smooth', block: 'center' })` then pulses the element yellow for 1.5s via `.__dr-highlight-pulse__` |
| **✎ Edit** | Hides the body text and actions, inserts an inline `<textarea>` pre-filled with the comment body. Shows **Save** and **Cancel** buttons. Save calls `PATCH /comments/:id` then `refreshComments()`. Cancel restores the original view. Guard: clicking Save/Cancel calls `e.stopPropagation()` so the click does not bubble to the document handler and trigger `showCommentBox`. |
| **✓ Resolve** | `PATCH /comments/:id/resolve`, then `refreshComments()` |
| **✕ Delete** | `DELETE /comments/:id`, then `refreshComments()`. Only available for open comments (the server rejects deletes on resolved comments). |

### Inline edit guard

The most common bug: clicking **Save** can bubble to the document click handler, which
calls `showCommentBox`. This happens when `cleanup()` synchronously detaches the button
from the DOM before the event finishes bubbling — `e.target.closest("#__dr-sidebar__")`
then traverses a detached node and returns `null`. Fix by stopping propagation:

```javascript
cancelBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  cleanup();
});

saveBtn.addEventListener("click", async (e) => {
  e.stopPropagation();
  // ... rest of handler
});
```

### Collapse / expand

- The `✕` button translates the sidebar `288px` to the right (leaves a `32px` sliver with
  the `▶` icon visible) via CSS class `collapsed`
- State persists in `sessionStorage` under `__dr_sidebar_open__`

### Click routing (Phase 1 handler updated)

```javascript
document.addEventListener("click", (e) => {
  if (e.target.closest("#__concurly__")) return;
  if (e.target.closest("#__dr-sidebar__")) return;

  const selector = getSelector(e.target);
  const hasComments = openCommentsBySelector[selector]?.length > 0;

  if (hasComments) {
    openSidebar();
    scrollSidebarToSelector(selector);
  } else {
    const excerpt = (e.target.innerText || e.target.textContent || "").trim().slice(0, 120);
    showCommentBox(e.clientX + 8, e.clientY + 8, selector, excerpt);
  }
});
```

`openCommentsBySelector` is a module-level map rebuilt on every `refreshComments()` call:

```javascript
let openCommentsBySelector = {};
```

`scrollSidebarToSelector(selector)` iterates `.__dr-thread__` cards and compares
`card.dataset.selector === selector` — do not use attribute selector interpolation, as
selector strings contain special characters that would need escaping.

---

## Feature 4 — Comment Edit and Delete

### New store functions (`src/store.ts`)

```typescript
export function updateComment(storePath: string, id: string, body: string): boolean {
  const comments = readComments(storePath);
  const target = comments.find(c => c.id === id && c.status === "open");
  if (!target) return false;
  target.body = body;
  fs.writeFileSync(storePath, JSON.stringify(comments, null, 2), "utf-8");
  return true;
}

export function deleteComment(storePath: string, id: string): boolean {
  const comments = readComments(storePath);
  const index = comments.findIndex(c => c.id === id && c.status === "open");
  if (index === -1) return false;
  comments.splice(index, 1);
  fs.writeFileSync(storePath, JSON.stringify(comments, null, 2), "utf-8");
  return true;
}
```

Both functions guard on `status === "open"` — resolved comments cannot be edited or deleted.

### New REST endpoints (`src/server.ts`)

```typescript
// Update the body of an open comment
app.patch("/comments/:id", (req, res) => {
  const { body } = req.body as { body?: string };
  if (!body || !body.trim()) {
    res.status(400).json({ error: "body is required" });
    return;
  }
  const ok = updateComment(storePath, req.params.id, body.trim());
  if (!ok) {
    res.status(404).json({ error: "Comment not found or already resolved" });
    return;
  }
  res.json({ success: true });
});

// Delete an open comment permanently
app.delete("/comments/:id", (req, res) => {
  const ok = deleteComment(storePath, req.params.id);
  if (!ok) {
    res.status(404).json({ error: "Comment not found or already resolved" });
    return;
  }
  res.json({ success: true });
});
```

Note: `PATCH /comments/:id` (update body) is distinct from `PATCH /comments/:id/resolve`
(change status). Express matches the more specific path first.

---

## Hover Highlight

Two distinct hover classes for annotated vs. plain elements:

```css
.__dr-highlight__ {
  outline: 2px solid #a5b4fc !important; /* faint — no comments */
  outline-offset: 2px !important;
  transition: outline 0.15s ease;
}
.__dr-highlight--annotated__ {
  outline: 2px solid #6366f1 !important; /* bright — has open comments */
  outline-offset: 2px !important;
  transition: outline 0.15s ease;
}
```

```javascript
let hoveredEl = null;

document.addEventListener("mouseover", (e) => {
  if (e.target.closest("#__dr-sidebar__") || e.target.closest("#__concurly__")) return;
  if (hoveredEl) {
    hoveredEl.classList.remove("__dr-highlight__");
    hoveredEl.classList.remove("__dr-highlight--annotated__");
  }
  hoveredEl = e.target;
  const selector = getSelector(hoveredEl);
  const isAnnotated = openCommentsBySelector[selector]?.length > 0;
  hoveredEl.classList.add(isAnnotated ? "__dr-highlight--annotated__" : "__dr-highlight__");
});

document.addEventListener("mouseout", () => {
  if (hoveredEl) {
    hoveredEl.classList.remove("__dr-highlight__");
    hoveredEl.classList.remove("__dr-highlight--annotated__");
  }
  hoveredEl = null;
});
```

---

## Init Order

```javascript
injectStyles();
injectHeader();   // must come before injectSidebar so body.prepend doesn't shift sidebar
injectSidebar();
refreshComments();
```

---

## Phase 2 Definition of Done

1. `concurly open design.html` opens browser; a dark header bar appears at the top showing
   **"concurly · design.html /full/path/to/design.html"**
2. The filename is bold white; the full path is smaller muted text (truncated on long paths,
   full path on hover); the brand "concurly" is indigo monospace
3. Two comments from a Phase 1 session show purple badges on their respective elements
4. Hovering any element shows a faint outline; elements with comments show a brighter outline
5. Clicking an element with a badge opens the sidebar scrolled to that thread
6. Clicking an element without a badge opens the Phase 1 comment box
7. "↳ Show in page" scrolls the element into view and pulses it yellow
8. "✎ Edit" opens an inline textarea; saving persists the change and refreshes the sidebar
9. Clicking Save or Cancel does **not** trigger the comment box popup
10. "✓ Resolve" resolves the comment and removes the thread card
11. "✕ Delete" permanently removes the comment and removes the thread card
12. The sidebar comment count badge updates after every action
13. Collapse/expand persists within the session

---

## Out of Scope for Phase 2

- Agent nudge button (deferred to Phase 3)
- Multi-file support
- Comment history (showing resolved comments)
- Keyboard shortcut to leave a comment without clicking
- The `--port` CLI flag
- Any form of authentication
