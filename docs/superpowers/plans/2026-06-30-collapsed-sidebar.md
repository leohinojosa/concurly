# Collapsed Sidebar Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the concurly sidebar collapse behavior from a slide-off animation to a true collapse into a 48px icon bar, with an SVG icon that flips direction to indicate the next action.

**Architecture:** The sidebar will toggle between two states using CSS `width` transitions instead of `transform` slides. The collapse icon (window-collapse-left SVG) will be embedded inline in the client script, centered in the 48px bar when collapsed, and flipped horizontally via CSS `scaleX(-1)` to show expand/collapse direction.

**Tech Stack:** Vanilla JavaScript, CSS transforms, SVG embedded as string constant, sessionStorage for state persistence (no new dependencies).

---

## File Structure

### Create
- `src/icons/window-collapse-left.svg` — Local copy of the collapse icon

### Modify
- `src/client.js` — Update styles, icon rendering, DOM structure, toggle logic
- `package.json` — Add postbuild script to copy SVG to dist (if needed)

---

## Chunk 1: Download and Store SVG Locally

### Task 1: Download the SVG from svgrepo

**Files:**
- Create: `src/icons/window-collapse-left.svg`

- [ ] **Step 1: Download the SVG file**

Download from: https://www.svgrepo.com/show/342936/window-collapse-left.svg

Expected output: An SVG file with a window-collapse icon (looks like a rectangle with a left-pointing arrow).

- [ ] **Step 2: Save as `src/icons/window-collapse-left.svg`**

Create the directory `src/icons/` and save the downloaded SVG there. The file should be roughly 1-2 KB.

- [ ] **Step 3: Verify the file content**

Open the file and confirm it contains a valid SVG element with a `<svg>` root. The SVG should have viewBox and width/height attributes or be scalable.

- [ ] **Step 4: Commit the SVG asset**

```bash
git add src/icons/window-collapse-left.svg
git commit -m "assets: add window-collapse-left icon"
```

---

## Chunk 2: Update Client Styles for Collapsed Bar

### Task 2: Modify CSS for 48px collapsed bar

**Files:**
- Modify: `src/client.js` — `injectStyles()` function, lines 37-246

The collapsed sidebar currently uses `transform: translateX(288px)` to slide off-screen. We'll change it to show a 48px wide icon bar instead.

- [ ] **Step 1: Locate the current collapsed styles**

In `src/client.js`, find the rule:
```
#__dr-sidebar__.collapsed { transform: translateX(288px); cursor: pointer; }
```

This is around line 48.

- [ ] **Step 2: Replace the collapsed styling**

Change the rule from:
```css
#__dr-sidebar__.collapsed { transform: translateX(288px); cursor: pointer; }
```

To:
```css
#__dr-sidebar__.collapsed {
  width: 48px;
  overflow: hidden;
  transition: width 0.2s ease;
}
```

This makes the sidebar shrink to 48px instead of sliding off-screen.

- [ ] **Step 3: Update the main sidebar transition**

Find the main `#__dr-sidebar__` rule (lines 42-47):
```css
#__dr-sidebar__ {
  position: fixed; top: 85px; right: 0; width: 320px; height: calc(100vh - 85px);
  background: #fff; z-index: 999995; display: flex; flex-direction: column;
  box-shadow: -4px 0 24px rgba(0,0,0,0.12); font-family: system-ui, sans-serif;
  font-size: 13px; transition: transform 0.2s ease;
}
```

Update the `transition` to use `width` instead of `transform`:
```css
#__dr-sidebar__ {
  position: fixed; top: 85px; right: 0; width: 320px; height: calc(100vh - 85px);
  background: #fff; z-index: 999995; display: flex; flex-direction: column;
  box-shadow: -4px 0 24px rgba(0,0,0,0.12); font-family: system-ui, sans-serif;
  font-size: 13px; transition: width 0.2s ease;
}
```

- [ ] **Step 4: Add new styles for the icon container**

After the `#__dr-sidebar-header__` rule (around line 53), add new styles for the icon:

```css
#__dr-collapse-icon__ {
  display: flex; align-items: center; justify-content: center;
  width: 48px; height: 48px; cursor: pointer;
  flex-shrink: 0;
}
#__dr-collapse-icon__ svg {
  width: 24px; height: 24px; color: #6b7280;
  transition: transform 0.2s ease;
}
#__dr-sidebar__.collapsed #__dr-collapse-icon__ svg {
  transform: scaleX(-1);
}
```

This centers the icon in the 48px space and flips it when collapsed.

- [ ] **Step 5: Ensure header doesn't break when sidebar collapses**

Update `#__dr-sidebar-header__` to ensure it works in both states:

```css
#__dr-sidebar-header__ {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 16px; border-bottom: 1px solid #e5e7eb;
  font-weight: 600; color: #111;
  min-height: 48px;
}
#__dr-sidebar__.collapsed #__dr-sidebar-header__ {
  padding: 0; justify-content: center; border-bottom: none;
}
#__dr-sidebar__.collapsed #__dr-sidebar-header__ > span:first-child {
  display: none;
}
```

This hides the "Comments" title when collapsed but keeps the header structure intact.

- [ ] **Step 6: Hide the body content when collapsed**

Find `#__dr-sidebar-body__` and add a collapsed state:

```css
#__dr-sidebar__.collapsed #__dr-sidebar-body__ {
  display: none;
}
```

- [ ] **Step 7: Hide the toggle bar when collapsed**

Find `#__dr-toggle-bar__` and add:

```css
#__dr-sidebar__.collapsed #__dr-toggle-bar__ {
  display: none;
}
```

- [ ] **Step 8: Run the app to test CSS**

```bash
npm run build
```

Verify the build succeeds. Don't run the app yet—we need the icon rendering logic first.

- [ ] **Step 9: Commit the CSS changes**

```bash
git add src/client.js
git commit -m "style: update sidebar collapse to 48px bar with width transitions"
```

---

## Chunk 3: Embed SVG Icon in Client Script

### Task 3: Convert SVG to inline constant and render in DOM

**Files:**
- Modify: `src/client.js` — `injectSidebar()` function, lines 489-553

- [ ] **Step 1: Read the SVG file and create a constant**

Read `src/icons/window-collapse-left.svg`. Extract the `<svg>` element (without the XML declaration).

Example result (adjust based on actual SVG):
```javascript
const COLLAPSE_ICON_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><!-- icon content --></svg>`;
```

Add this constant near the top of the client.js file, after the module-level state declarations (around line 10):

```javascript
const COLLAPSE_ICON_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="..."/></svg>`;
```

- [ ] **Step 2: Locate the current collapse button creation**

Find the `injectSidebar()` function and locate where `collapseBtn` is created (around line 500):

```javascript
const collapseBtn = document.createElement("button");
collapseBtn.id = "__dr-collapse__";
collapseBtn.textContent = "✕";
collapseBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleSidebar(); });
```

- [ ] **Step 3: Replace button with icon container**

Replace the button creation with:

```javascript
const collapseIcon = document.createElement("div");
collapseIcon.id = "__dr-collapse-icon__";
collapseIcon.innerHTML = COLLAPSE_ICON_SVG;
collapseIcon.addEventListener("click", (e) => { e.stopPropagation(); toggleSidebar(); });
```

- [ ] **Step 4: Update header to append the icon instead of the button**

Find where the button is appended to the header:

```javascript
header.appendChild(collapseBtn);
```

Replace with:

```javascript
header.appendChild(collapseIcon);
```

- [ ] **Step 5: Update the toggle logic to not change text**

Find `toggleSidebar()` function (around line 565):

```javascript
function toggleSidebar() {
  const sidebar = document.getElementById("__dr-sidebar__");
  const collapseBtn = document.getElementById("__dr-collapse__");
  if (!sidebar) return;
  const isCollapsed = sidebar.classList.toggle("collapsed");
  if (collapseBtn) collapseBtn.textContent = isCollapsed ? "▶" : "✕";
  sessionStorage.setItem("__dr_sidebar_open__", String(!isCollapsed));
}
```

Simplify to remove the text change (CSS will handle the flip):

```javascript
function toggleSidebar() {
  const sidebar = document.getElementById("__dr-sidebar__");
  if (!sidebar) return;
  const isCollapsed = sidebar.classList.toggle("collapsed");
  sessionStorage.setItem("__dr_sidebar_open__", String(!isCollapsed));
}
```

- [ ] **Step 6: Update openSidebar() function**

Find `openSidebar()` (around line 556):

```javascript
function openSidebar() {
  const sidebar = document.getElementById("__dr-sidebar__");
  const collapseBtn = document.getElementById("__dr-collapse__");
  if (!sidebar) return;
  sidebar.classList.remove("collapsed");
  if (collapseBtn) collapseBtn.textContent = "✕";
  sessionStorage.setItem("__dr_sidebar_open__", "true");
}
```

Remove the text change:

```javascript
function openSidebar() {
  const sidebar = document.getElementById("__dr-sidebar__");
  if (!sidebar) return;
  sidebar.classList.remove("collapsed");
  sessionStorage.setItem("__dr_sidebar_open__", "true");
}
```

- [ ] **Step 7: Update the initialization logic**

Find the initialization block at the bottom of `injectSidebar()` (around line 541):

```javascript
const isOpen = sessionStorage.getItem("__dr_sidebar_open__") !== "false";
if (!isOpen) {
  sidebar.classList.add("collapsed");
  collapseBtn.textContent = "▶";
}
```

Remove the text change:

```javascript
const isOpen = sessionStorage.getItem("__dr_sidebar_open__") !== "false";
if (!isOpen) {
  sidebar.classList.add("collapsed");
}
```

- [ ] **Step 8: Build and test**

```bash
npm run build
```

Verify the build succeeds with no errors.

- [ ] **Step 9: Test the icon rendering**

Open any HTML file with concurly:
```bash
concurly open <path-to-test.html>
```

In the browser:
1. The sidebar should show with the icon in the header (pointing left ←)
2. Click the icon to collapse
3. The sidebar should shrink to 48px wide with the icon centered and pointing right (→)
4. Click again to expand
5. Icon should flip back to pointing left (←)

If the sidebar doesn't shrink smoothly or the icon doesn't appear, check the console for errors.

- [ ] **Step 10: Commit the icon rendering**

```bash
git add src/client.js
git commit -m "feat: embed SVG icon and update toggle logic"
```

---

## Chunk 4: Test the Complete Collapse Behavior

### Task 4: End-to-end test of collapsed sidebar

**Files:**
- Test: Manual browser testing

- [ ] **Step 1: Start a fresh concurly session**

```bash
concurly complete <port>  # Stop any running sessions
```

Then open a test HTML file:
```bash
concurly open <path-to-test.html>
```

- [ ] **Step 2: Test collapsed state visuals**

1. Refresh the page
2. Verify the sidebar shows at full width (320px) with the collapse icon in the top-right
3. Icon should be visible and point left (←)
4. "Comments" text should be visible

- [ ] **Step 3: Test collapse animation**

1. Click the collapse icon
2. Sidebar should smoothly shrink to 48px over 0.2s
3. Icon should remain visible, centered in the 48px bar
4. Icon should flip to point right (→)
5. All comment content should be hidden

- [ ] **Step 4: Test expanded state after collapse**

1. Click the icon again in the 48px bar
2. Sidebar should smoothly expand back to 320px
3. Icon should flip back to pointing left (←)
4. "Comments" text and comment list should reappear

- [ ] **Step 5: Test state persistence**

1. Collapse the sidebar
2. Refresh the page (F5)
3. Sidebar should remain collapsed (showing the 48px bar)
4. Expand the sidebar
5. Refresh the page again
6. Sidebar should be expanded

If any of these fail, check browser console for JavaScript errors and verify CSS rules were applied correctly.

- [ ] **Step 6: Test hover and click interactions**

1. Hover over the 48px collapsed bar—should show cursor: pointer
2. Click the icon in both collapsed and expanded states
3. Verify clicks reliably toggle the state

- [ ] **Step 7: Test on different viewport sizes**

1. Open DevTools and test responsive design
2. Narrow the viewport to mobile size (375px width)
3. The 48px bar should still be visible
4. Expand to full width and verify 320px sidebar displays correctly

- [ ] **Step 8: Verify no regressions**

1. Open the sidebar in expanded state
2. Leave some comments on the page
3. Verify comment threads render correctly in the sidebar
4. Test the other sidebar features (resolve, delete, edit comments)
5. Verify these features still work when collapsed/expanded

- [ ] **Step 9: Check console for errors**

Open DevTools console and verify there are no errors or warnings related to:
- Missing elements
- SVG rendering issues
- Event listener failures

- [ ] **Step 10: Final commit and documentation**

```bash
git add -A
git commit -m "test: verify collapsed sidebar behavior end-to-end"
```

---

## Summary

**Total tasks:** 4  
**Expected time:** 30-45 minutes  
**Key changes:**
- CSS: `width` transition instead of `transform` slide
- DOM: SVG icon instead of text button
- JavaScript: Removed text-based state changes, rely on CSS
- Assets: Local SVG file stored in `src/icons/`

**Testing strategy:** Manual browser testing with concurly to verify UI behavior in real session.

**Risk areas:**
- SVG not rendering due to encoding or XML namespace issues → verify SVG content
- CSS transitions not smooth → check z-index and parent constraints
- Icon doesn't flip — verify CSS rule is applied to correct element
- Icon not clickable — verify event listeners attached correctly

**Rollback plan:** If issues arise, revert to the previous `transform: translateX()` approach (it's still in the codebase history).
