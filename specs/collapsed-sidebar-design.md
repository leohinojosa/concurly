# Collapsed Sidebar Design — Concurly

**Date:** 2026-06-29  
**Status:** Approved  
**Author:** Leo Hinojosa

---

## Overview

Enhance the concurly comment sidebar with a collapsible vertical icon bar. When collapsed, the sidebar reduces to a 48px icon bar containing only the collapse/expand toggle. When expanded, the full comment sidebar displays as normal. The icon flips direction to indicate the next action.

---

## Visual Design

### Collapsed State (48px)

- **Width:** 48px fixed vertical bar anchored to the right viewport edge
- **Position:** Fixed, `top: 85px` (below header + tabs chrome), `right: 0`
- **Content:** Single SVG icon, centered both horizontally and vertically
- **Icon:** window-collapse-left SVG (from svgrepo), **flipped right** (→ direction) to indicate "expand" action
- **Icon Size:** 20–24px
- **Background:** Match expanded sidebar (white, `#fff`)
- **Clickable Area:** Full 48px bar is clickable to expand
- **No Text:** "Comments" label and all comments are hidden

### Expanded State (320px)

- **Width:** 320px (unchanged from current)
- **Position:** Fixed, `top: 85px`, `right: 0`
- **Header:** "Comments" text on left, collapse icon on right
- **Icon:** window-collapse-left SVG **flipped left** (← direction) to indicate "collapse" action
- **Icon Size:** 20–24px
- **Icon Clickable Area:** The icon button in the header (same as current `#__dr-collapse__`)
- **Content:** Full comment list displays as normal

---

## Behavior & Interactions

### State Toggle

- **Trigger:** Click the icon in either collapsed or expanded state
- **Result:** Sidebar toggles between 48px and 320px width
- **Animation:** Smooth 0.2s transition (reuse existing CSS `transition`)
- **Persistence:** State stored in `sessionStorage` under key `__dr_sidebar_open__` (already implemented)

### Icon Direction Flipping

- **Logic:** Use CSS `transform: scaleX(-1)` to flip the SVG left ↔ right
- **When collapsed:** Icon flips right (→), indicating click will expand
- **When expanded:** Icon flips left (←), indicating click will collapse

### No Intermediate States

- Bar is either 48px (collapsed) or 320px (expanded)
- No partial width states
- Transition is smooth via CSS `transform`

---

## Technical Implementation

### Icon Asset

- **Source:** https://www.svgrepo.com/show/342936/window-collapse-left.svg
- **Format:** Inline SVG embedded in `src/client.js` (downloaded locally, not fetched from URL)
- **Local Copy:** Store the SVG in `src/icons/window-collapse-left.svg` (or similar) and inline it into the client script at build time
- **Size in DOM:** 20–24px (adjustable)
- **Flip Method:** CSS `transform: scaleX(-1)` applied conditionally via class

### DOM Changes

1. **New element:** `#__dr-collapse-icon__` — contains the SVG
   - Positioned in the center of the 48px bar when collapsed
   - Positioned in the header top-right when expanded

2. **Class state:** Add class `collapsed` to `#__dr-sidebar__` when narrow
   - Existing CSS already uses this class
   - Icon visibility and flip logic driven by this class

### CSS Changes

1. **Collapsed bar styling:**
   - `#__dr-sidebar__.collapsed` — change from `transform: translateX(288px)` to `width: 48px`
   - Center the icon in the 48px space
   - Remove any content overflow visibility

2. **Icon flip:**
   - `.collapsed #__dr-collapse-icon__` — apply `transform: scaleX(-1)` 
   - Icon naturally flips when sidebar collapses

3. **Transitions:**
   - Keep existing `transition: transform 0.2s ease` or update to `transition: width 0.2s ease` for smoother collapse animation

### JavaScript Changes

1. **Icon rendering:**
   - Embed the SVG inline as a string constant in `src/client.js`
   - Replace current `collapseBtn.textContent = "✕"` with SVG element

2. **Toggle logic:**
   - No changes to `toggleSidebar()`, `openSidebar()` functions — they already manage the `collapsed` class
   - CSS handles the visual flip automatically

3. **State persistence:**
   - No changes — existing `sessionStorage` logic already works

---

## Acceptance Criteria

- [ ] Collapsed bar is exactly 48px wide
- [ ] Icon is centered both H and V in the 48px space
- [ ] Icon flips direction on toggle (right when collapsed, left when expanded)
- [ ] Smooth 0.2s transition on collapse/expand
- [ ] Clicking the icon toggles the sidebar
- [ ] State persists across page reload (sessionStorage)
- [ ] All comment content is hidden when collapsed (no text overflow)
- [ ] Icon is clickable in both states
- [ ] No console errors

---

## Future Enhancements (Out of Scope)

- Add search icon/feature in the expanded header (placeholder for future)
- Add additional action icons in the collapsed bar (e.g., add comment, settings)
- Customize icon styling (color, hover effects)

---

## Notes

- The current implementation uses `transform: translateX(288px)` to slide the sidebar off-screen. This design switches to a true collapse that keeps the 48px bar visible.
- SVG flipping via `scaleX(-1)` is more maintainable than storing two separate icon assets.
- Existing sessionStorage and event handling require no changes.
