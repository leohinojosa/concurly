# Theme system — Design

**Date:** 2026-11-05
**Status:** Draft for review
**Context:** Follows the UI-direction exploration (`ui-directions` comparison page). Paper and Midnight were chosen; this adds a theme picker and five more themes.

## Goal

Replace concurly's single hard-coded look with a **theme system**: the Paper/Midnight layout becomes the only layout, seven themes skin it, a header button switches between them, and the choice persists.

## Decisions (from discussion)

| Topic | Decision |
|---|---|
| Direction | The Paper/Midnight layout (single 44 px bar, centered tabs) replaces today's two-bar chrome. |
| Themes | 7 total: **Paper** and **Midnight** (kept) + **Slate**, **Mint**, **Nord**, **Ember**, **Terminal**. |
| Picker | A button immediately **right of the refresh (↻) button** opens a theme menu. |
| Persistence | `localStorage` **plus** `~/.concurly/preferences.json` via the concurly server. |
| Default | Until the user picks, **follow the OS** light/dark setting (Paper / Midnight). |

**Why the server file too:** each concurly session runs on its own port (5391, 5392, …) and browsers treat every port as a separate origin, so `localStorage` alone is not shared. A theme chosen on `:5391` would not appear on `:5392`, or after a restart lands on a different port. The synced file makes the choice global; `localStorage` stays as the instant, flash-free cache.

## Layout

- **Chrome height 85 px → 44 px.** One header bar; the tab bar no longer has its own row.
- The tabs (`#__dr-tabs__`, still a separate element) are positioned **fixed and centered** over the header (`z-index` above the header). Header order: brand · file name · source path · *(centered tabs)* · Read|Review · ↻ · theme button · fetched label · version · GitHub.
- Page offset (`body padding-top`), sidebar `top`, history panel `top` all derive from one `CHROME_H = 44` constant.
- Narrow viewports: ≤1100 px hide the source path and "fetched" label; ≤860 px also hide the file name and version, so the centered tabs never collide with header content.

## Theme model

**Data lives in `src/themes.json`** (not code), so it is testable in plain Node and injected into the page by `cli.ts` via a `"__THEMES__"` placeholder (same mechanism as `"__PORT__"`).

```jsonc
{
  "default": { "light": "paper", "dark": "midnight" },
  "themes": [{
    "id": "paper", "label": "Paper", "mode": "light",   // mode: light | dark → picker grouping + color-scheme
    "tabs": "underline",                                  // archetype: underline | pill
    "cards": "ruled",                                     // archetype: ruled | boxed
    "vars": { "bg": "#FAF9F5", "...": "54 tokens, identical key set in every theme" }
  }]
}
```

- **Tokens** become CSS custom properties named `--dr-<token>` on `html[data-dr-theme="<id>"]`. The `--dr-` prefix keeps them from colliding with the reviewed page.
- **Token groups:** chrome (`bg fg dim line seg-bg ctl-hover` + active tab/segment + brand style), accent (`accent accent-fg accent-soft accent-text`), sidebar (`side-*`, glass blur), cards (`card-*`), buttons (`btn-*`, `danger`), highlights/badge (`hl hl-strong badge-*`), comment box (`pop-*`), history (`hist-bg pending-* done-*`), fonts (`font-ui font-display font-mono`).
- **Archetypes** select structural CSS via `data-dr-tabs` / `data-dr-cards` on `<html>`: `underline` vs `pill` tabs; `ruled` (hairline-separated entries with an accent tick, text actions) vs `boxed` (bordered cards with hover glow, filled actions).
- `color-scheme` is set **only on concurly's own containers** (never on `<html>`), so native controls inside the overlay match the theme without changing the reviewed page's scrollbars or form controls.
- **No hard-coded colors in `client.js`.** Everything currently inline (comment box, badges, empty states) moves to token-driven classes.

### The seven themes

| Theme | Mode | Tabs / Cards | Feel | Accent |
|---|---|---|---|---|
| **Paper** | light | underline / ruled | warm editorial, serif display | clay `#B84A24` |
| **Midnight** | dark | pill / boxed | modern, frosted sidebar, glow | violet `#6C5CE7` |
| **Slate** | light | pill / boxed | cool, crisp, neutral SaaS | blue `#2563EB` |
| **Mint** | light | underline / ruled | fresh, soft green-tinted | green `#0B7F63` |
| **Nord** | dark | pill / boxed | frosty blue-grey | ice blue `#88C0D0` |
| **Ember** | dark | underline / ruled | warm charcoal, serif display (Paper's dark twin) | amber `#F59E0B` |
| **Terminal** | dark | underline / ruled | near-black, monospace throughout | green `#3FB950` |

Midnight's accent was darkened from the exploration page's `#7C6CF6` and gets a separate lighter `accent-text` (`#A99EFF`), because the original failed contrast for text. Paper's clay was darkened slightly for the same reason.

**Accessibility guarantee:** a test checks **WCAG AA (4.5:1)** for every text/background pair in every theme (translucent colors are composited over the theme background). Adding a theme that fails the test fails the build.

## Picker

- Button `#__dr-theme-btn__` (palette icon, `aria-haspopup="menu"`, `aria-expanded`, tooltip "Theme"), styled like ↻, placed right after it.
- Menu `#__dr-theme-menu__` (`role="menu"`), right-aligned under the button, grouped **Light** / **Dark**. Each row (`role="menuitemradio"`) shows a three-chip swatch (bg · accent · fg), the name, and a ✓ on the saved theme.
- **Hover/focus previews** a theme live; **click commits** it. Closing without a click (Esc, click outside, Tab, resize) reverts to the saved theme.
- Keyboard: ↑/↓/Home/End move, Enter selects, Esc closes and returns focus to the button.
- A click outside the open menu only closes it — it is swallowed so it does not also drop a comment box in Review mode.

## Persistence & resolution

| Moment | Behavior |
|---|---|
| Page load (sync) | `localStorage["concurly-theme"]` if it names a known theme, else the OS theme (`prefers-color-scheme`). Applied before the overlay renders, so no flash. |
| Just after load | `GET /preferences`. If it returns a known theme that differs, apply it and refresh `localStorage`. If the server has none but this browser does, `PUT` it to seed the file. |
| User picks a theme | Apply; write `localStorage`; `PUT /preferences`. A failed `PUT` is ignored (the local choice still stands). |
| No saved choice | The theme follows the OS and updates live if the OS setting changes. Picking a theme ends this. |
| `localStorage` unavailable (private mode) | Wrapped in try/catch; the server file still works. |
| Unknown theme id (e.g. a removed theme) | Ignored; falls back to the OS default. |

### Server API (`src/server.ts`, new `src/prefs.ts`, new `src/paths.ts`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/preferences` | Returns `Preferences` (`{ theme?: string }`); `{}` if none. |
| `PUT` | `/preferences` | Body `{ theme }`; `theme` must match `^[a-z0-9-]{1,32}$` else `400`. Merges into the stored object, atomic write (temp + rename). |

- Stored at `<concurly home>/preferences.json`; `concurlyHome()` (new `paths.ts`) is `CONCURLY_HOME` or `~/.concurly`, and `remote.ts` is refactored to use it.
- The server does not know the theme list (it lives in client data); it only validates the id's shape. The client ignores ids it does not recognize.
- The preferences object is merged, not replaced, so future preferences can share the file.

## Components touched

| File | Change |
|---|---|
| `src/themes.json` | **New** — the 7 themes. |
| `src/paths.ts` | **New** — `concurlyHome()`. |
| `src/prefs.ts` | **New** — read/validate/write preferences. |
| `src/remote.ts` | Use `concurlyHome()`. |
| `src/server.ts` | `GET/PUT /preferences`. |
| `src/cli.ts` | Inject themes JSON via `"__THEMES__"`. |
| `src/client.js` | Token-driven stylesheet, single-bar layout, theme engine, picker, de-hard-coded colors. |
| `test/themes.test.js`, `test/prefs.test.js`, `test/cli.e2e.test.js` | New/extended tests. |
| `README.md`, `CLAUDE.md`, `skills/concurly/SKILL.md`, `package.json` | Docs; version `0.6.0`. |

## Error handling

- Corrupt/missing `preferences.json` → treated as `{}`; never throws into the request.
- `PUT` with a bad id → `400`, file untouched.
- Server unreachable from the page → theme still works from `localStorage`/OS.

## Testing

- **Node tests (`npm test`):** theme registry shape (7 themes, unique ids, enums, identical token sets, defaults exist and match their mode); WCAG AA for every pair in every theme; preferences read/write/merge/validation/corruption; `GET`/`PUT /preferences`; CLI end-to-end (served page contains the injected theme data).
- **Browser verification (headless Edge, scripted):** screenshot every theme (set through `PUT /preferences` so the real persistence path is exercised) in review state and on the history tab; drive the picker over the Chrome DevTools Protocol to check open/preview/commit/revert, keyboard, outside-click, and persistence across a reload.

## Out of scope

- User-defined/custom themes and per-file themes.
- A High-Contrast theme (easy to add later: one JSON entry + the existing contrast test).
- Scheduled/automatic day-night switching beyond following the OS.
- Reworking comment-card behavior; only styling and layout change. Action buttons keep their current text + glyph labels.
