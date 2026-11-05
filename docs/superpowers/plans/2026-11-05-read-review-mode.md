# Read / Review Mode Toggle Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Read/Review mode toggle (read = no commenting, badges hidden) and make the sidebar start collapsed on every page load.

**Architecture:** A single module-level `mode` variable in `src/client.js` drives a `__dr-mode-review__` class on `<body>`. CSS keyed off that class hides badges and sidebar card actions in read mode; the click/hover handlers get an extra guard. The sidebar always starts `collapsed` and no longer touches `sessionStorage`.

**Tech Stack:** Vanilla JS IIFE (`src/client.js`, no TypeScript/imports), injected CSS, TypeScript build via `npm run build`.

**Spec:** `docs/superpowers/specs/2026-11-05-read-review-mode-design.md`

**Testing note:** The repo has no test suite and `client.js` runs only in a browser. Each task is verified with `node --check` (syntax) plus manual browser checks. Manual checks need a built, running instance: `npm run build`, then `node dist/cli.js open <some.html>` (any local HTML file). After each rebuild, run `node dist/cli.js complete <port>` then open again.

**Branch:** `read-review-mode-toggle` (already created; trunk-based, PR to `main`).

---

## Chunk 1: Client changes

### Task 1: Sidebar starts collapsed on every load

**Files:**
- Modify: `src/client.js:576-596` (`injectSidebar` tail, `openSidebar`, `toggleSidebar`)

- [ ] **Step 1: Replace the sessionStorage restore in `injectSidebar`**

Replace:

```javascript
    // Restore collapsed state from session
    const isOpen = sessionStorage.getItem("__dr_sidebar_open__") !== "false";
    if (!isOpen) {
      sidebar.classList.add("collapsed");
    }
```

with:

```javascript
    // Always start collapsed; the user expands it on demand
    sidebar.classList.add("collapsed");
```

- [ ] **Step 2: Remove sessionStorage writes from `openSidebar` and `toggleSidebar`**

Replace the two functions with:

```javascript
  function openSidebar() {
    const sidebar = document.getElementById("__dr-sidebar__");
    if (!sidebar) return;
    sidebar.classList.remove("collapsed");
  }

  function toggleSidebar() {
    const sidebar = document.getElementById("__dr-sidebar__");
    if (!sidebar) return;
    sidebar.classList.toggle("collapsed");
  }
```

- [ ] **Step 3: Verify syntax and no stale references**

Run: `node --check src/client.js`
Expected: no output (exit 0).

Run: `grep -n "__dr_sidebar_open__" src/client.js`
Expected: no matches. (`__dr_show_resolved__` must remain untouched.)

- [ ] **Step 4: Manual check**

Build, open a file with at least one comment. Expected: sidebar is the 48px collapsed strip. Click the icon: it expands. Reload: collapsed again.

- [ ] **Step 5: Commit**

```bash
git add src/client.js
git commit -m "feat: start sidebar collapsed on every page load

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 2: Mode state, toggle UI, and gating

**Files:**
- Modify: `src/client.js` (state at line 9; styles ~line 170; `injectHeader` ~line 307; new `setMode`; handlers ~lines 1007-1059; init ~line 1067)

- [ ] **Step 1: Add mode state**

After `let activeTab = "review"; // "review" | "history"` add:

```javascript
  let mode = "read"; // "read" | "review" — read mode disables commenting
```

- [ ] **Step 2: Add toggle CSS in `injectStyles()`**

The version span currently carries `margin-left: auto`. Move that to the toggle. Replace:

```css
      #__dr-header-version__ {
        margin-left: auto; flex-shrink: 0;
        color: #52525b; font-size: 11px;
      }
```

with:

```css
      #__dr-mode-toggle__ {
        margin-left: auto; flex-shrink: 0;
        display: flex; background: #27272a; border-radius: 6px; padding: 2px;
      }
      .__dr-mode-btn__ {
        border: none; cursor: pointer; background: none; color: #a1a1aa;
        font-family: system-ui, sans-serif; font-size: 11px; font-weight: 600;
        padding: 3px 10px; border-radius: 4px;
        transition: color 0.15s, background 0.15s;
      }
      .__dr-mode-btn__:hover { color: #e4e4e7; }
      .__dr-mode-btn--active__ { background: #6366f1; color: #fff; }
      .__dr-mode-btn--active__:hover { background: #4f46e5; color: #fff; }
      #__dr-header-version__ {
        margin-left: 12px; flex-shrink: 0;
        color: #52525b; font-size: 11px;
      }
```

- [ ] **Step 3: Build the toggle in `injectHeader()`**

Before `header.appendChild(version);` insert:

```javascript
    const toggle = document.createElement("div");
    toggle.id = "__dr-mode-toggle__";
    [["read", "Read"], ["review", "Review"]].forEach(([value, label]) => {
      const btn = document.createElement("button");
      btn.id = `__dr-mode-${value}__`;
      btn.className = "__dr-mode-btn__" + (value === mode ? " __dr-mode-btn--active__" : "");
      btn.textContent = label;
      btn.addEventListener("click", () => setMode(value));
      toggle.appendChild(btn);
    });
```

and change the append order so the toggle comes before the version:

```javascript
    header.appendChild(filepath);
    header.appendChild(toggle);
    header.appendChild(version);
```

(replacing the existing `header.appendChild(filepath); header.appendChild(version);` lines).

- [ ] **Step 3b: Set initial body class state**

No class is needed in read mode (default). `setMode` toggles `__dr-mode-review__`.

- [ ] **Step 4: Add `setMode` after `switchTab`**

```javascript
  // ─── Mode switching (read / review) ───────────────────────────────────────
  function setMode(next) {
    mode = next;
    document.body.classList.toggle("__dr-mode-review__", mode === "review");

    const readBtn = document.getElementById("__dr-mode-read__");
    const reviewBtn = document.getElementById("__dr-mode-review__");
    if (readBtn) readBtn.classList.toggle("__dr-mode-btn--active__", mode === "read");
    if (reviewBtn) reviewBtn.classList.toggle("__dr-mode-btn--active__", mode === "review");

    if (mode === "read") {
      const box = document.getElementById("__docreview__");
      if (box) box.remove();
      if (hoveredEl) {
        hoveredEl.classList.remove("__dr-highlight__", "__dr-highlight--annotated__");
        hoveredEl = null;
      }
    }
  }
```

Note: the toggle button IDs are `__dr-mode-read__` / `__dr-mode-review__`; the body class is `__dr-mode-review__` too, but one is an id and one is a class, so they do not collide.

- [ ] **Step 5: Gate the handlers**

In the `click`, `mouseover`, and `mouseout` handlers, change
`if (activeTab !== "review") return;` to
`if (activeTab !== "review" || mode !== "review") return;`
(three occurrences, ~lines 1008, 1037, 1053).

- [ ] **Step 6: Verify syntax**

Run: `node --check src/client.js`
Expected: exit 0.

Run: `grep -n 'mode !== "review"' src/client.js`
Expected: 3 matches.

- [ ] **Step 7: Manual check**

Build and open a file. Expected:
- Header shows Read | Review switch, Read highlighted, right side before the version text; header height unchanged.
- In Read: hovering and clicking page content does nothing.
- Click Review: hover highlight and click-to-comment work. Click Read with the comment box open: box closes and highlight clears.
- Clicking the toggle itself never opens a comment box (header is excluded by the existing guard).

- [ ] **Step 8: Commit**

```bash
git add src/client.js
git commit -m "feat: add read/review mode toggle gating comment creation

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 3: Hide badges and sidebar card actions in read mode

**Files:**
- Modify: `src/client.js` (`injectStyles`, add rules)

- [ ] **Step 1: Add CSS rules in `injectStyles()`**

Add after the `#__dr-mode-toggle__` rules from Task 2. Badges set `display: flex` via inline `cssText`, so the rule needs `!important`:

```css
      /* Read mode: hide badges and thread-card mutation actions */
      body:not(.__dr-mode-review__) .__dr-badge__ { display: none !important; }
      body:not(.__dr-mode-review__) .__dr-edit-btn__,
      body:not(.__dr-mode-review__) .__dr-resolve-btn__,
      body:not(.__dr-mode-review__) .__dr-delete-btn__ { display: none !important; }
```

`.__dr-scroll-btn__` ("Show in page") is intentionally not hidden.

- [ ] **Step 2: Verify syntax**

Run: `node --check src/client.js`
Expected: exit 0.

- [ ] **Step 3: Manual check**

Build, open a file that has open comments (create some in Review mode first). Expected:
- Read mode: no badges on the page. Expanded sidebar cards show only "Show in page"; Edit/Resolve/Delete hidden.
- Review mode: badges and all four buttons visible; badge click expands the sidebar and pulses the card.
- Run `node dist/cli.js agent resolve <id> <port>` while in Read mode: `comments-updated` re-renders; badges stay hidden (CSS keys off body class, not render logic).
- Switch to "View All Comments" tab and back in both modes: still correct, history tab works.
- Reload: Read mode, sidebar collapsed.

- [ ] **Step 4: Commit**

```bash
git add src/client.js
git commit -m "feat: hide badges and card actions in read mode

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

## Chunk 2: Docs and version

### Task 4: Update docs and bump version

**Files:**
- Modify: `CLAUDE.md` (module-level state block; Tab behavior section)
- Modify: `README.md:53-59` (interaction table), and any other description of default behavior
- Modify: `package.json:3` (version `0.3.0` → `0.4.0`)
- Check: `skills/concurly/SKILL.md` for statements about click-to-comment or sidebar default

- [ ] **Step 1: CLAUDE.md**

In the "Module-level state in client.js" block add `let mode = "read"; // "read" | "review" — read mode disables commenting; badges and card edit/resolve/delete hidden via body class __dr-mode-review__`. Add a short "Mode behavior" subsection after "Tab behavior" describing: header toggle, default read, not persisted, sidebar always starts collapsed.

- [ ] **Step 2: README.md**

Update the table rows at lines 53-59: clicks only comment in Review mode; sidebar starts collapsed and the "state is remembered per tab" wording is removed. Add a row for the Read | Review toggle. Update line 165 ("click any element") to mention switching to Review mode first.

- [ ] **Step 3: SKILL.md check**

Run: `grep -n -i "click\|sidebar" skills/concurly/SKILL.md`
Update only if it describes user-facing click or sidebar behavior now made inaccurate.

- [ ] **Step 4: Bump version**

Edit `package.json` line 3 to `"version": "0.4.0"`.

- [ ] **Step 5: Final build and smoke test**

Run: `npm run build`
Expected: exits 0, `dist/client.js` present.

Open a file; confirm the header shows `v0.4.0` and the earlier manual checks still pass.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md README.md package.json skills/concurly/SKILL.md
git commit -m "docs: document read/review mode and collapsed sidebar; bump to 0.4.0

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

(Omit `skills/concurly/SKILL.md` from `git add` if unchanged.)

## Wrap-up

After all tasks: push the branch and open a PR to `main` titled `feat: read/review mode toggle and collapsed-by-default sidebar` (no Jira ticket; none was provided). End the PR body with the Claude Code attribution line.
