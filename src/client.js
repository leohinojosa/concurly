(function () {
  const PORT = "__PORT__"; // Replaced at inject time by cli.ts
  const FILE_PATH = "__FILE_PATH__"; // Replaced at inject time by cli.ts
  const THEME_DATA = "__THEMES__"; // Replaced at inject time by cli.ts with src/themes.json

  // Module-level state
  let openCommentsBySelector = {};
  let hoveredEl = null;
  let scrollTimer = null;
  let activeTab = "review"; // "review" | "history"
  let mode = "read"; // "read" | "review" — read mode disables commenting

  // Source: src/icons/window-collapse-left.svg
  const COLLAPSE_ICON_SVG = `<svg viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg"><g fill="none" fill-rule="evenodd" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" transform="translate(3 3)"><path d="m.5 12.5v-10c0-1.1045695.8954305-2 2-2h10c1.1045695 0 2 .8954305 2 2v10c0 1.1045695-.8954305 2-2 2h-10c-1.1045695 0-2-.8954305-2-2z"/><path d="m2.5 12.5v-10c0-1.1045695.8954305-2 2-2h-2c-1 0-2 .8954305-2 2v10c0 1.1045695 1 2 2 2h2c-1.1045695 0-2-.8954305-2-2z" fill="currentColor"/><path d="m7.5 10.5-3-3 3-3"/><path d="m12.5 7.5h-8"/></g></svg>`;

  // Magnifying glass icon for annotation badge
  const MAGNIFYING_GLASS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" fill="currentColor"><path d="M480 272C480 317.9 465.1 360.3 440 394.7L566.6 521.4C579.1 533.9 579.1 554.2 566.6 566.7C554.1 579.2 533.8 579.2 521.3 566.7L394.7 440C360.3 465.1 317.9 480 272 480C157.1 480 64 386.9 64 272C64 157.1 157.1 64 272 64C386.9 64 480 157.1 480 272zM272 416C351.5 416 416 351.5 416 272C416 192.5 351.5 128 272 128C192.5 128 128 192.5 128 272C128 351.5 192.5 416 272 416z"/></svg>`;

  const CHROME_H = 44; // one header bar; the tabs are centered over it

  // ─── Themes ───────────────────────────────────────────────────────────────
  const THEME_KEY = "concurly-theme";
  const THEMES_BY_ID = Object.fromEntries(THEME_DATA.themes.map((t) => [t.id, t]));
  let savedTheme = null; // the user's explicit choice (persisted), or null → follow the OS

  function isThemeId(id) {
    return typeof id === "string" && Object.prototype.hasOwnProperty.call(THEMES_BY_ID, id);
  }
  function osTheme() {
    const dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    return dark ? THEME_DATA.default.dark : THEME_DATA.default.light;
  }
  function effectiveTheme() {
    return savedTheme || osTheme();
  }
  function readStoredTheme() {
    try {
      const v = localStorage.getItem(THEME_KEY);
      return isThemeId(v) ? v : null;
    } catch {
      return null;
    }
  }
  function storeTheme(id) {
    try { localStorage.setItem(THEME_KEY, id); } catch { /* private mode etc. */ }
  }
  function putThemePreference(id) {
    fetch(`http://localhost:${PORT}/preferences`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: id }),
    }).catch(() => {});
  }

  /** Applies a theme to the page (no persistence). Safe to call for previews. */
  function showTheme(id) {
    const t = THEMES_BY_ID[id];
    if (!t) return;
    const root = document.documentElement;
    root.setAttribute("data-dr-theme", t.id);
    root.setAttribute("data-dr-tabs", t.tabs);
    root.setAttribute("data-dr-cards", t.cards);
  }

  /** The user committed a choice: apply it and persist it (localStorage + server). */
  function chooseTheme(id) {
    if (!isThemeId(id)) return;
    savedTheme = id;
    showTheme(id);
    storeTheme(id);
    putThemePreference(id);
  }

  async function syncThemeFromServer() {
    try {
      const res = await fetch(`http://localhost:${PORT}/preferences`, { cache: "no-store" });
      if (!res.ok) return;
      const prefs = await res.json();
      if (isThemeId(prefs.theme)) {
        if (prefs.theme !== savedTheme) {
          savedTheme = prefs.theme;
          storeTheme(prefs.theme);
          showTheme(prefs.theme);
        }
      } else if (savedTheme) {
        putThemePreference(savedTheme); // server has none yet: seed it from this browser
      }
    } catch { /* server unreachable: localStorage / OS default still apply */ }
  }

  function initTheme() {
    savedTheme = readStoredTheme();
    showTheme(effectiveTheme());
    if (window.matchMedia) {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = () => { if (!savedTheme) showTheme(osTheme()); };
      if (mq.addEventListener) mq.addEventListener("change", onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
    syncThemeFromServer();
  }

  // ─── Selector builder ────────────────────────────────────────────────────
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

  // ─── Styles ───────────────────────────────────────────────────────────────
  /** One CSS-variable block per theme: html[data-dr-theme="<id>"] { --dr-<token>: … } */
  function themeCss() {
    return THEME_DATA.themes
      .map((t) => {
        const decls = Object.entries(t.vars).map(([k, v]) => `--dr-${k}:${v};`).join("");
        return `html[data-dr-theme="${t.id}"]{${decls}--dr-scheme:${t.mode};}`;
      })
      .join("\n");
  }

  const BASE_CSS = `
    body { padding-top: ${CHROME_H}px !important; }

    /* Native controls inside OUR UI follow the theme; the reviewed page is untouched. */
    #__dr-header__, #__dr-tabs__, #__dr-sidebar__, #__dr-history-panel__,
    #__docreview__, #__dr-theme-menu__ { color-scheme: var(--dr-scheme); }

    /* ── Header ── */
    #__dr-header__ {
      position: fixed; top: 0; left: 0; right: 0; height: ${CHROME_H}px; z-index: 999993;
      display: flex; align-items: center; gap: 10px; padding: 0 14px; box-sizing: border-box;
      background: var(--dr-bg); color: var(--dr-fg); border-bottom: 1px solid var(--dr-line);
      font-family: var(--dr-font-ui); font-size: 12px; white-space: nowrap;
    }
    #__dr-header-brand__ {
      flex-shrink: 0; font-family: var(--dr-font-display); font-size: 15px;
      font-style: var(--dr-brand-style); font-weight: var(--dr-brand-weight); letter-spacing: -0.01em;
    }
    #__dr-header-sep__ { display: none; }
    #__dr-header-filename__ { font-weight: 600; flex-shrink: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    #__dr-header-path__ {
      flex: 0 1 220px; min-width: 0; overflow: hidden; text-overflow: ellipsis;
      color: var(--dr-dim); font: 10.5px var(--dr-font-mono);
    }
    #__dr-mode-toggle__ {
      margin-left: auto; flex-shrink: 0; display: flex; padding: 2px;
      border-radius: calc(var(--dr-btn-radius) + 2px); background: var(--dr-seg-bg);
    }
    .__dr-mode-btn__ {
      border: 0; cursor: pointer; background: none; color: var(--dr-dim);
      font: 600 11px var(--dr-font-ui); padding: 3px 11px; border-radius: var(--dr-btn-radius);
      transition: color 0.15s, background 0.15s;
    }
    .__dr-mode-btn__:hover { color: var(--dr-fg); }
    .__dr-mode-btn--active__, .__dr-mode-btn--active__:hover {
      background: var(--dr-seg-active-bg); color: var(--dr-seg-active-fg);
    }
    #__dr-header-refresh__, #__dr-theme-btn__ {
      flex-shrink: 0; width: 28px; height: 28px; display: grid; place-items: center; padding: 0;
      border: 1px solid var(--dr-line); border-radius: var(--dr-btn-radius); background: transparent;
      color: var(--dr-fg); font-size: 14px; line-height: 1; cursor: pointer; transition: background 0.15s;
    }
    #__dr-header-refresh__:hover:not(:disabled), #__dr-theme-btn__:hover { background: var(--dr-ctl-hover); }
    #__dr-header-refresh__:disabled { opacity: 0.6; cursor: default; }
    #__dr-theme-btn__ svg { width: 15px; height: 15px; }
    #__dr-theme-btn__[aria-expanded="true"] { background: var(--dr-ctl-hover); }
    #__dr-header-remote__ { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
    #__dr-header-fetched__, #__dr-header-pinned__ { color: var(--dr-dim); font-size: 11px; }
    #__dr-header-refresh-status__ { color: var(--dr-dim); font-size: 11px; max-width: 300px; overflow: hidden; text-overflow: ellipsis; }
    #__dr-header-refresh-status__.__dr-error__ { color: var(--dr-danger); }
    #__dr-header-version__ { flex-shrink: 0; margin-left: 4px; color: var(--dr-dim); font-size: 11px; }
    #__dr-header-github__ { flex-shrink: 0; display: flex; align-items: center; color: var(--dr-dim); opacity: 0.7; transition: opacity 0.15s; }
    #__dr-header-github__:hover { opacity: 1; color: var(--dr-fg); }
    #__dr-header-github__ svg { width: 14px; height: 14px; }

    /* ── Tabs: a separate element, centered over the header ── */
    #__dr-tabs__ {
      position: fixed; top: 0; left: 50%; transform: translateX(-50%); height: ${CHROME_H}px;
      z-index: 999994; display: flex; align-items: center; gap: 6px; font-family: var(--dr-font-ui);
    }
    .__dr-tab__ {
      border: 0; background: none; cursor: pointer; color: var(--dr-dim); font: 13px var(--dr-font-ui);
      padding: 5px 14px; transition: color 0.15s, background 0.15s;
    }
    .__dr-tab__:hover { color: var(--dr-fg); }
    html[data-dr-tabs="underline"] #__dr-tabs__ { gap: 22px; }
    html[data-dr-tabs="underline"] .__dr-tab__ {
      height: 100%; padding: 1px 2px 0; border-radius: 0; border-bottom: 2px solid transparent; font-size: 14px;
    }
    html[data-dr-tabs="underline"] .__dr-tab--active__ { color: var(--dr-tab-active-fg); border-bottom-color: var(--dr-accent); }
    html[data-dr-tabs="pill"] #__dr-tabs__ {
      top: 7px; height: 30px; padding: 2px; gap: 2px; background: var(--dr-seg-bg);
      border: 1px solid var(--dr-line); border-radius: calc(var(--dr-btn-radius) + 3px);
    }
    html[data-dr-tabs="pill"] .__dr-tab__ { padding: 3px 14px; border-radius: calc(var(--dr-btn-radius) + 1px); font-size: 12.5px; }
    html[data-dr-tabs="pill"] .__dr-tab--active__ { background: var(--dr-tab-active-bg); color: var(--dr-tab-active-fg); }

    /* ── Sidebar ── */
    #__dr-sidebar__ {
      position: fixed; top: ${CHROME_H}px; right: 0; width: 312px; height: calc(100vh - ${CHROME_H}px);
      z-index: 999995; display: flex; flex-direction: column;
      background: var(--dr-side-bg); color: var(--dr-side-fg); border-left: 1px solid var(--dr-side-line);
      box-shadow: var(--dr-side-shadow);
      backdrop-filter: blur(var(--dr-side-blur)); -webkit-backdrop-filter: blur(var(--dr-side-blur));
      font-family: var(--dr-font-ui); font-size: 13px; transition: width 0.2s ease;
    }
    #__dr-sidebar__.collapsed { width: 48px; overflow: hidden; }
    #__dr-sidebar-header__ {
      display: flex; justify-content: space-between; align-items: center; height: 48px; box-sizing: border-box;
      padding: 12px 16px; border-bottom: 1px solid var(--dr-side-line);
      font-family: var(--dr-font-display); font-weight: 600;
    }
    #__dr-sidebar__.collapsed #__dr-sidebar-header__ { padding: 0; justify-content: center; border-bottom: 0; }
    #__dr-sidebar__.collapsed #__dr-sidebar-header__ > span:first-child { display: none; }
    #__dr-collapse-icon__ {
      display: flex; align-items: center; justify-content: center; width: 32px; height: 32px;
      flex-shrink: 0; cursor: pointer; border-radius: 6px;
    }
    #__dr-collapse-icon__:hover { background: var(--dr-ctl-hover); }
    #__dr-collapse-icon__ svg { width: 20px; height: 20px; color: var(--dr-side-dim); transition: transform 0.2s ease; transform: scaleX(-1); }
    #__dr-sidebar__.collapsed #__dr-collapse-icon__ svg { transform: scaleX(1); }
    #__dr-toggle-bar__ { padding: 6px 16px; border-bottom: 1px solid var(--dr-side-line); font-size: 12px; color: var(--dr-side-dim); }
    #__dr-toggle-bar__ label { cursor: pointer; display: flex; align-items: center; gap: 6px; user-select: none; }
    #__dr-show-resolved__ { cursor: pointer; accent-color: var(--dr-accent); }
    #__dr-sidebar-body__ { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
    #__dr-sidebar__.collapsed #__dr-sidebar-body__, #__dr-sidebar__.collapsed #__dr-toggle-bar__ { display: none; }
    .__dr-empty__ { color: var(--dr-side-dim); font-size: 13px; padding: 12px 0; text-align: center; }
    .__dr-empty--lg__ { font-size: 14px; padding: 48px 0; }

    /* ── Thread cards ── */
    .__dr-thread__ { position: relative; font-family: var(--dr-font-ui); color: var(--dr-side-fg); }
    .__dr-thread-resolved__ { opacity: 0.55; }
    .__dr-thread-selector__ {
      font: 10px var(--dr-font-mono); color: var(--dr-side-dim); margin-bottom: 4px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .__dr-thread-excerpt__ { font-style: italic; color: var(--dr-side-dim); font-size: 11px; margin-bottom: 6px; }
    .__dr-thread-resolved__ .__dr-thread-excerpt__ { text-decoration: line-through; }
    .__dr-thread-body__ { color: var(--dr-side-fg); margin-bottom: 8px; line-height: 1.45; }
    .__dr-thread-actions__ { display: flex; gap: 6px; flex-wrap: wrap; }
    .__dr-resolved-label__ { font-size: 10px; color: var(--dr-side-dim); margin-top: 4px; }
    html[data-dr-cards="boxed"] .__dr-thread__ {
      padding: 10px; border: 1px solid var(--dr-card-line); border-radius: var(--dr-card-radius);
      background: var(--dr-card-bg); transition: border-color 0.15s, box-shadow 0.15s;
    }
    html[data-dr-cards="boxed"] .__dr-thread__:hover { border-color: var(--dr-card-hover-line); box-shadow: var(--dr-card-hover-shadow); }
    html[data-dr-cards="ruled"] #__dr-sidebar-body__ { padding: 2px 16px 12px; gap: 0; }
    html[data-dr-cards="ruled"] .__dr-thread__ { padding: 14px 4px 14px 16px; border-bottom: 1px solid var(--dr-side-line); }
    html[data-dr-cards="ruled"] .__dr-thread__::before {
      content: ""; position: absolute; left: 0; top: 16px; bottom: 16px; width: 2px; border-radius: 2px; background: var(--dr-accent);
    }
    html[data-dr-cards="ruled"] .__dr-thread-resolved__::before { background: var(--dr-side-dim); }
    html[data-dr-cards="ruled"] .__dr-thread-body__ { font-family: var(--dr-font-display); font-size: 14px; }

    /* ── Buttons ── */
    .__dr-scroll-btn__, .__dr-edit-btn__, .__dr-resolve-btn__, .__dr-delete-btn__, .__dr-save-btn__, .__dr-cancel-btn__ {
      font: 11px var(--dr-font-ui); padding: 3px 8px; border-radius: var(--dr-btn-radius); cursor: pointer;
      border: 1px solid var(--dr-btn-line); background: var(--dr-btn-bg); color: var(--dr-btn-fg); transition: background 0.15s;
    }
    .__dr-scroll-btn__:hover, .__dr-edit-btn__:hover, .__dr-delete-btn__:hover, .__dr-cancel-btn__:hover { background: var(--dr-btn-hover); }
    .__dr-delete-btn__ { color: var(--dr-danger); }
    .__dr-resolve-btn__, .__dr-save-btn__ { background: var(--dr-accent); border-color: var(--dr-accent); color: var(--dr-accent-fg); }
    .__dr-resolve-btn__:hover, .__dr-save-btn__:hover { filter: brightness(1.1); }
    html[data-dr-cards="ruled"] .__dr-thread-actions__ { gap: 6px 14px; }
    html[data-dr-cards="ruled"] .__dr-scroll-btn__, html[data-dr-cards="ruled"] .__dr-edit-btn__,
    html[data-dr-cards="ruled"] .__dr-resolve-btn__, html[data-dr-cards="ruled"] .__dr-delete-btn__ {
      padding: 2px 0; border-radius: 0; border-color: transparent; background: transparent;
    }
    html[data-dr-cards="ruled"] .__dr-resolve-btn__ { color: var(--dr-accent-text); font-weight: 600; }
    html[data-dr-cards="ruled"] .__dr-scroll-btn__:hover, html[data-dr-cards="ruled"] .__dr-edit-btn__:hover,
    html[data-dr-cards="ruled"] .__dr-delete-btn__:hover { background: transparent; text-decoration: underline; text-underline-offset: 3px; }
    .__dr-edit-area__ {
      width: 100%; box-sizing: border-box; border: 1px solid var(--dr-accent); border-radius: 6px; padding: 6px;
      font: 13px var(--dr-font-ui); resize: vertical; min-height: 60px; margin-bottom: 6px; outline: none;
      background: var(--dr-pop-field); color: var(--dr-side-fg);
    }
    .__dr-edit-actions__ { display: flex; gap: 6px; margin-bottom: 6px; }

    /* ── Read mode: hide mutation controls and badges ── */
    body:not(.__dr-mode-review__) .__dr-badge__ { display: none !important; }
    body:not(.__dr-mode-review__) .__dr-edit-btn__,
    body:not(.__dr-mode-review__) .__dr-resolve-btn__,
    body:not(.__dr-mode-review__) .__dr-delete-btn__ { display: none !important; }

    /* ── Highlights, pulse, badge ── */
    .__dr-highlight__ { outline: 2px solid var(--dr-hl) !important; outline-offset: 2px !important; transition: outline 0.15s ease; }
    .__dr-highlight--annotated__ { outline: 2px solid var(--dr-hl-strong) !important; outline-offset: 2px !important; transition: outline 0.15s ease; }
    .__dr-highlight-pulse__ { background-color: rgba(250, 204, 21, 0.3) !important; transition: background-color 0.3s ease; }
    @keyframes __dr_threadPulse {
      0%, 100% { box-shadow: 0 0 0 0 transparent; background-color: transparent; }
      50% { box-shadow: 0 0 0 3px var(--dr-hl-strong); background-color: var(--dr-accent-soft); }
    }
    .__dr-thread--pulse__ { animation: __dr_threadPulse 0.8s ease-in-out 2; }
    .__dr-badge__ {
      position: fixed; width: 24px; height: 24px; box-sizing: border-box; padding: 3px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center; z-index: 999990; cursor: pointer;
      background: var(--dr-badge-bg); color: var(--dr-badge-fg); box-shadow: var(--dr-badge-glow);
      transition: transform 0.15s ease, filter 0.15s ease;
    }
    .__dr-badge__:hover { transform: scale(1.15); filter: brightness(1.12); }
    .__dr-badge__ svg { width: 100%; height: 100%; fill: currentColor; }

    /* ── Comment box ── */
    #__docreview__ {
      position: fixed; width: 300px; z-index: 999999; box-sizing: border-box; padding: 12px;
      background: var(--dr-pop-bg); color: var(--dr-pop-fg); border: 1px solid var(--dr-pop-line);
      border-radius: calc(var(--dr-btn-radius) + 6px); box-shadow: var(--dr-pop-shadow);
      font-family: var(--dr-font-ui); font-size: 13px;
    }
    .__dr-pop-label__ { margin-bottom: 6px; color: var(--dr-pop-dim); font-size: 11px; }
    .__dr-pop-input__ {
      width: 100%; height: 72px; box-sizing: border-box; padding: 8px; resize: vertical; outline: none;
      border: 1px solid var(--dr-pop-line); border-radius: 6px; background: var(--dr-pop-field); color: var(--dr-pop-fg);
      font: 13px var(--dr-font-ui);
    }
    .__dr-pop-input__:focus { border-color: var(--dr-accent); }
    .__dr-pop-row__ { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
    .__dr-pop-cancel__, .__dr-pop-submit__ { font: 600 12px var(--dr-font-ui); padding: 5px 12px; border-radius: var(--dr-btn-radius); cursor: pointer; }
    .__dr-pop-cancel__ { border: 1px solid var(--dr-pop-line); background: transparent; color: var(--dr-pop-dim); }
    .__dr-pop-submit__ { border: 0; background: var(--dr-accent); color: var(--dr-accent-fg); }
    .__dr-pop-submit__:disabled { opacity: 0.6; cursor: default; }

    /* ── History panel ── */
    #__dr-history-panel__ {
      position: fixed; top: ${CHROME_H}px; left: 0; right: 0; bottom: 0; z-index: 999991;
      display: none; /* shown as flex by switchTab */
      background: var(--dr-hist-bg); color: var(--dr-side-fg); font-family: var(--dr-font-ui);
    }
    #__dr-history-main__ { flex: 1; overflow-y: auto; display: flex; flex-direction: column; }
    #__dr-history-header__ {
      position: sticky; top: 0; z-index: 1; padding: 20px 32px 14px; background: var(--dr-hist-bg);
      border-bottom: 1px solid var(--dr-side-line); font: 700 17px var(--dr-font-display);
    }
    #__dr-history-body__ { padding: 16px 32px 32px; display: flex; flex-direction: column; gap: 12px; }
    .__dr-history-card__ {
      padding: 16px; border-radius: var(--dr-card-radius); background: var(--dr-card-bg); border: 1px solid var(--dr-card-line);
    }
    html[data-dr-cards="ruled"] #__dr-history-body__ { gap: 0; }
    html[data-dr-cards="ruled"] .__dr-history-card__ {
      padding: 14px 0 16px; border: 0; border-bottom: 1px solid var(--dr-side-line); border-radius: 0; background: transparent;
    }
    .__dr-history-card-top__ { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 6px; }
    .__dr-history-selector__ {
      flex: 1; font: 10px var(--dr-font-mono); color: var(--dr-side-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .__dr-history-badge__ { flex-shrink: 0; font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 99px; white-space: nowrap; }
    .__dr-history-badge--pending__ { background: var(--dr-pending-bg); color: var(--dr-pending-fg); border: 1px solid var(--dr-pending-line); }
    .__dr-history-badge--implemented__ { background: var(--dr-done-bg); color: var(--dr-done-fg); border: 1px solid var(--dr-done-line); }
    .__dr-history-comment__ { font-size: 13px; line-height: 1.5; margin-bottom: 8px; }
    .__dr-history-date__ { font-size: 11px; color: var(--dr-side-dim); }
    #__dr-history-stats__ {
      width: 176px; flex-shrink: 0; padding: 24px 20px; display: flex; flex-direction: column; gap: 20px; overflow-y: auto;
      background: var(--dr-side-bg); border-left: 1px solid var(--dr-side-line);
    }
    .__dr-stat-block__ { display: flex; flex-direction: column; gap: 4px; }
    .__dr-stat-label__ { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--dr-side-dim); }
    .__dr-stat-value__ { font: 700 36px/1 var(--dr-font-display); }
    .__dr-stat-value--pending__ { color: var(--dr-pending-fg); }
    .__dr-stat-value--implemented__ { color: var(--dr-done-fg); }
    .__dr-stat-divider__ { height: 1px; background: var(--dr-side-line); margin: 4px 0; }

    /* ── Theme menu ── */
    #__dr-theme-menu__ {
      position: fixed; top: ${CHROME_H + 6}px; width: 236px; max-height: calc(100vh - 64px); overflow: auto;
      z-index: 999998; box-sizing: border-box; padding: 6px;
      background: var(--dr-pop-bg); color: var(--dr-pop-fg); border: 1px solid var(--dr-pop-line);
      border-radius: 12px; box-shadow: var(--dr-pop-shadow); font-family: var(--dr-font-ui); font-size: 13px;
    }
    .__dr-theme-group__ {
      padding: 8px 10px 4px; color: var(--dr-pop-dim); font-size: 10.5px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;
    }
    .__dr-theme-item__ {
      display: flex; align-items: center; gap: 10px; width: 100%; padding: 7px 10px; border: 0; border-radius: 8px;
      background: none; color: inherit; font: inherit; text-align: left; cursor: pointer;
    }
    .__dr-theme-item__:hover, .__dr-theme-item__:focus-visible { background: var(--dr-ctl-hover); outline: none; }
    .__dr-theme-item__[aria-checked="true"] { font-weight: 600; }
    .__dr-swatch__ { display: flex; flex-shrink: 0; border-radius: 6px; overflow: hidden; box-shadow: 0 0 0 1px rgba(128, 128, 128, 0.35); }
    .__dr-swatch__ i { width: 12px; height: 20px; display: block; }
    .__dr-theme-check__ { margin-left: auto; visibility: hidden; }
    .__dr-theme-item__[aria-checked="true"] .__dr-theme-check__ { visibility: visible; }

    /* ── Narrow viewports: keep the centered tabs clear of header content ── */
    @media (max-width: 1100px) { #__dr-header-path__, #__dr-header-fetched__ { display: none; } }
    @media (max-width: 860px) { #__dr-header-filename__, #__dr-header-version__ { display: none; } }
  `;

  function injectStyles() {
    const style = document.createElement("style");
    style.id = "__dr-styles__";
    style.textContent = themeCss() + "\n" + BASE_CSS;
    document.head.appendChild(style);
  }

  // ─── Header bar ───────────────────────────────────────────────────────────
  function injectHeader() {
    const fileName = FILE_PATH.replace(/.*[\\/]/, "") || FILE_PATH;

    const header = document.createElement("div");
    header.id = "__dr-header__";

    const brand = document.createElement("span");
    brand.id = "__dr-header-brand__";
    brand.textContent = "🤝 concurly";

    const sep = document.createElement("span");
    sep.id = "__dr-header-sep__";
    sep.textContent = "·";

    const filename = document.createElement("span");
    filename.id = "__dr-header-filename__";
    filename.textContent = fileName;

    const filepath = document.createElement("span");
    filepath.id = "__dr-header-path__";
    filepath.textContent = FILE_PATH;
    filepath.title = FILE_PATH;

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

    const version = document.createElement("span");
    version.id = "__dr-header-version__";
    version.textContent = "v__VERSION__";

    const ghLink = document.createElement("a");
    ghLink.id = "__dr-header-github__";
    ghLink.href = "https://github.com/leohinojosa/concurly";
    ghLink.target = "_blank";
    ghLink.rel = "noopener noreferrer";
    ghLink.title = "concurly on GitHub";
    ghLink.innerHTML = `<svg viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`;

    header.appendChild(brand);
    header.appendChild(sep);
    header.appendChild(filename);
    header.appendChild(filepath);
    // Standalone refresh, next to the other tools. Reloads the page (re-reads the
    // file from disk); remote sessions swap this for a refetch in initRemoteControls().
    const refreshBtn = document.createElement("button");
    refreshBtn.id = "__dr-header-refresh__";
    refreshBtn.textContent = "↻";
    refreshBtn.title = "Refresh";
    refreshBtn.setAttribute("aria-label", "Refresh");
    refreshBtn.onclick = () => window.location.reload();

    header.appendChild(toggle);
    header.appendChild(refreshBtn);
    header.appendChild(buildThemeButton()); // right of refresh
    header.appendChild(version);
    header.appendChild(ghLink);

    document.body.prepend(header);
  }

  // ─── Theme picker ─────────────────────────────────────────────────────────
  const PALETTE_SVG = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2a6 6 0 1 0 0 12c.9 0 1.3-.6 1.3-1.2 0-.9-.8-1.1-.8-1.9 0-.7.6-1.2 1.3-1.2H12a2 2 0 0 0 2-2C14 4.4 11.3 2 8 2z"/><circle cx="5" cy="7.2" r=".7" fill="currentColor"/><circle cx="8" cy="5" r=".7" fill="currentColor"/><circle cx="11" cy="7.2" r=".7" fill="currentColor"/></svg>`;

  let themeMenu = null;

  function themeItems() {
    return themeMenu ? Array.from(themeMenu.querySelectorAll(".__dr-theme-item__")) : [];
  }

  function closeThemeMenu(returnFocus) {
    if (!themeMenu) return;
    themeMenu.remove();
    themeMenu = null;
    const btn = document.getElementById("__dr-theme-btn__");
    if (btn) {
      btn.setAttribute("aria-expanded", "false");
      if (returnFocus) btn.focus({ preventScroll: true });
    }
    showTheme(effectiveTheme()); // drop any hover preview
  }

  function openThemeMenu() {
    if (themeMenu) return;
    const btn = document.getElementById("__dr-theme-btn__");
    if (!btn) return;
    const current = effectiveTheme();

    const menu = document.createElement("div");
    menu.id = "__dr-theme-menu__";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Theme");

    [["light", "Light"], ["dark", "Dark"]].forEach(([mode, title]) => {
      const group = document.createElement("div");
      group.className = "__dr-theme-group__";
      group.textContent = title;
      menu.appendChild(group);

      THEME_DATA.themes.filter((t) => t.mode === mode).forEach((t) => {
        const item = document.createElement("button");
        item.className = "__dr-theme-item__";
        item.dataset.theme = t.id;
        item.setAttribute("role", "menuitemradio");
        item.setAttribute("aria-checked", String(t.id === current));

        const swatch = document.createElement("span");
        swatch.className = "__dr-swatch__";
        [t.vars.bg, t.vars.accent, t.vars.fg].forEach((color) => {
          const chip = document.createElement("i");
          chip.style.background = color;
          swatch.appendChild(chip);
        });

        const name = document.createElement("span");
        name.textContent = t.label;

        const check = document.createElement("span");
        check.className = "__dr-theme-check__";
        check.textContent = "✓";

        item.appendChild(swatch);
        item.appendChild(name);
        item.appendChild(check);

        item.addEventListener("mouseenter", () => showTheme(t.id)); // live preview
        item.addEventListener("focus", () => showTheme(t.id));
        item.addEventListener("click", () => {
          chooseTheme(t.id);
          closeThemeMenu(true);
        });
        menu.appendChild(item);
      });
    });

    const r = btn.getBoundingClientRect();
    menu.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
    document.body.appendChild(menu);
    themeMenu = menu;
    btn.setAttribute("aria-expanded", "true");

    const items = themeItems();
    (items.find((i) => i.dataset.theme === current) || items[0]).focus({ preventScroll: true });
  }

  function buildThemeButton() {
    const btn = document.createElement("button");
    btn.id = "__dr-theme-btn__";
    btn.title = "Theme";
    btn.setAttribute("aria-label", "Theme");
    btn.setAttribute("aria-haspopup", "menu");
    btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = PALETTE_SVG;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (themeMenu) closeThemeMenu(false);
      else openThemeMenu();
    });
    return btn;
  }

  // Keyboard inside the open menu.
  document.addEventListener("keydown", (e) => {
    if (!themeMenu) return;
    const items = themeItems();
    const i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === "Home") { e.preventDefault(); items[0].focus(); }
    else if (e.key === "End") { e.preventDefault(); items[items.length - 1].focus(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeThemeMenu(true); }
    else if (e.key === "Tab") { closeThemeMenu(false); }
  }, true);

  // A click outside only closes the menu; swallow it so it can't also place a comment box.
  document.addEventListener("click", (e) => {
    if (!themeMenu) return;
    if (e.target.closest("#__dr-theme-menu__") || e.target.closest("#__dr-theme-btn__")) return;
    e.preventDefault();
    e.stopPropagation();
    closeThemeMenu(false);
  }, true);

  window.addEventListener("resize", () => closeThemeMenu(false));

  // ─── Remote source controls (remote sessions only) ────────────────────────
  function timeAgo(iso) {
    const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return "just now";
    const m = Math.round(s / 60);
    if (m < 60) return m + "m ago";
    const h = Math.round(m / 60);
    if (h < 48) return h + "h ago";
    return Math.round(h / 24) + "d ago";
  }

  async function initRemoteControls() {
    let info;
    try {
      const res = await fetch(`http://localhost:${PORT}/source`, { cache: "no-store" });
      if (!res.ok) return; // local-file session: no remote controls
      info = await res.json();
    } catch {
      return;
    }

    const header = document.getElementById("__dr-header__");
    const versionEl = document.getElementById("__dr-header-version__");
    if (!header || !versionEl) return;

    // Show the source URL instead of the cache path.
    const pathEl = document.getElementById("__dr-header-path__");
    if (pathEl) {
      pathEl.textContent = info.sourceUrl;
      pathEl.title = info.sourceUrl;
    }

    const wrap = document.createElement("span");
    wrap.id = "__dr-header-remote__";

    const fetched = document.createElement("span");
    fetched.id = "__dr-header-fetched__";
    const renderFetched = () => {
      fetched.textContent = info.fetchedAt ? "fetched " + timeAgo(info.fetchedAt) : "";
    };
    renderFetched();
    setInterval(renderFetched, 30000);
    wrap.appendChild(fetched);

    if (info.isPinned) {
      const pinned = document.createElement("span");
      pinned.id = "__dr-header-pinned__";
      pinned.textContent = "pinned to commit";
      wrap.appendChild(pinned);
    } else {
      // Reuse the standalone button from injectHeader(): refetch instead of reload.
      const btn = document.getElementById("__dr-header-refresh__");

      const status = document.createElement("span");
      status.id = "__dr-header-refresh-status__";

      btn.onclick = async () => {
        btn.disabled = true;
        status.className = "";
        status.textContent = "Refetching…";
        status.title = "";
        try {
          const res = await fetch(`http://localhost:${PORT}/refresh`, { method: "POST" });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
          info.fetchedAt = data.fetchedAt;
          renderFetched();
          status.textContent = data.status === "unchanged" ? "No changes" : "Updated";
          setTimeout(() => { status.textContent = ""; }, 3000);
        } catch (err) {
          status.className = "__dr-error__";
          status.textContent = "Couldn't refetch: " + err.message;
          status.title = err.message;
        } finally {
          btn.disabled = false;
        }
      };

      wrap.appendChild(status);
    }

    header.insertBefore(wrap, versionEl);
  }

  // ─── Tab bar ──────────────────────────────────────────────────────────────
  function injectTabBar() {
    const bar = document.createElement("div");
    bar.id = "__dr-tabs__";

    const reviewBtn = document.createElement("button");
    reviewBtn.id = "__dr-tab-review__";
    reviewBtn.className = "__dr-tab__ __dr-tab--active__";
    reviewBtn.textContent = "Review";
    reviewBtn.addEventListener("click", () => switchTab("review"));

    const historyBtn = document.createElement("button");
    historyBtn.id = "__dr-tab-history__";
    historyBtn.className = "__dr-tab__";
    historyBtn.textContent = "View All Comments";
    historyBtn.addEventListener("click", () => switchTab("history"));

    bar.appendChild(reviewBtn);
    bar.appendChild(historyBtn);
    document.body.appendChild(bar);
  }

  // ─── History panel ────────────────────────────────────────────────────────
  function injectHistoryPanel() {
    const panel = document.createElement("div");
    panel.id = "__dr-history-panel__";

    // ── Main scrollable column ─────────────────────────────────────────────
    const main = document.createElement("div");
    main.id = "__dr-history-main__";

    const header = document.createElement("div");
    header.id = "__dr-history-header__";
    header.textContent = "All Comments";

    const body = document.createElement("div");
    body.id = "__dr-history-body__";

    main.appendChild(header);
    main.appendChild(body);

    // ── Stats sidebar ──────────────────────────────────────────────────────
    const stats = document.createElement("div");
    stats.id = "__dr-history-stats__";

    const pendingBlock = document.createElement("div");
    pendingBlock.className = "__dr-stat-block__";
    const pendingLabel = document.createElement("div");
    pendingLabel.className = "__dr-stat-label__";
    pendingLabel.textContent = "Pending";
    const pendingValue = document.createElement("div");
    pendingValue.className = "__dr-stat-value__ __dr-stat-value--pending__";
    pendingValue.id = "__dr-stats-pending__";
    pendingValue.textContent = "0";
    pendingBlock.appendChild(pendingLabel);
    pendingBlock.appendChild(pendingValue);

    const divider = document.createElement("div");
    divider.className = "__dr-stat-divider__";

    const implementedBlock = document.createElement("div");
    implementedBlock.className = "__dr-stat-block__";
    const implementedLabel = document.createElement("div");
    implementedLabel.className = "__dr-stat-label__";
    implementedLabel.textContent = "Implemented";
    const implementedValue = document.createElement("div");
    implementedValue.className = "__dr-stat-value__ __dr-stat-value--implemented__";
    implementedValue.id = "__dr-stats-implemented__";
    implementedValue.textContent = "0";
    implementedBlock.appendChild(implementedLabel);
    implementedBlock.appendChild(implementedValue);

    stats.appendChild(pendingBlock);
    stats.appendChild(divider);
    stats.appendChild(implementedBlock);

    panel.appendChild(main);
    panel.appendChild(stats);
    document.body.appendChild(panel);
  }

  function renderHistoryPanel() {
    const body = document.getElementById("__dr-history-body__");
    const pendingEl = document.getElementById("__dr-stats-pending__");
    const implementedEl = document.getElementById("__dr-stats-implemented__");
    if (!body) return;

    fetch(`http://localhost:${PORT}/comments`, { cache: "no-store" })
      .then((r) => r.json())
      .then((comments) => {
        const open = comments.filter((c) => c.status === "open");
        const resolved = comments.filter((c) => c.status === "resolved");

        if (pendingEl) pendingEl.textContent = String(open.length);
        if (implementedEl) implementedEl.textContent = String(resolved.length);

        // Pending first (newest created), then implemented (newest resolved)
        const sorted = [
          ...open.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
          ...resolved.sort((a, b) => new Date(b.resolvedAt).getTime() - new Date(a.resolvedAt).getTime()),
        ];

        body.innerHTML = "";

        if (sorted.length === 0) {
          const empty = document.createElement("div");
          empty.className = "__dr-empty__ __dr-empty--lg__";
          empty.textContent = "No comments yet.";
          body.appendChild(empty);
          return;
        }

        sorted.forEach((comment) => {
          const isPending = comment.status === "open";

          const card = document.createElement("div");
          card.className = "__dr-history-card__";

          // Top row: selector + status badge
          const top = document.createElement("div");
          top.className = "__dr-history-card-top__";

          const selectorEl = document.createElement("div");
          selectorEl.className = "__dr-history-selector__";
          selectorEl.textContent = comment.selector;
          selectorEl.title = comment.selector;

          const badge = document.createElement("span");
          badge.className = "__dr-history-badge__ " + (isPending
            ? "__dr-history-badge--pending__"
            : "__dr-history-badge--implemented__");
          badge.textContent = isPending ? "Pending" : "Implemented";

          top.appendChild(selectorEl);
          top.appendChild(badge);

          const commentEl = document.createElement("div");
          commentEl.className = "__dr-history-comment__";
          commentEl.textContent = comment.body;

          const dateEl = document.createElement("div");
          dateEl.className = "__dr-history-date__";
          if (isPending) {
            dateEl.textContent = `Added ${new Date(comment.createdAt).toLocaleString()}`;
          } else {
            const dateStr = comment.resolvedAt
              ? new Date(comment.resolvedAt).toLocaleString()
              : "—";
            dateEl.textContent = `Implemented ${dateStr}`;
          }

          card.appendChild(top);
          card.appendChild(commentEl);
          card.appendChild(dateEl);
          body.appendChild(card);
        });
      })
      .catch(() => {});
  }

  // ─── Tab switching ────────────────────────────────────────────────────────
  function switchTab(tab) {
    activeTab = tab;

    const reviewBtn = document.getElementById("__dr-tab-review__");
    const historyBtn = document.getElementById("__dr-tab-history__");
    const sidebar = document.getElementById("__dr-sidebar__");
    const historyPanel = document.getElementById("__dr-history-panel__");

    if (tab === "review") {
      if (reviewBtn) reviewBtn.classList.add("__dr-tab--active__");
      if (historyBtn) historyBtn.classList.remove("__dr-tab--active__");
      if (sidebar) sidebar.style.display = "";
      if (historyPanel) historyPanel.style.display = "none";
      clearBadges();
      Object.entries(openCommentsBySelector).forEach(([selector, list]) => {
        injectBadge(selector, list.length);
      });
    } else {
      if (reviewBtn) reviewBtn.classList.remove("__dr-tab--active__");
      if (historyBtn) historyBtn.classList.add("__dr-tab--active__");
      if (sidebar) sidebar.style.display = "none";
      if (historyPanel) historyPanel.style.display = "flex";
      clearBadges();
      const box = document.getElementById("__docreview__");
      if (box) box.remove();
      if (hoveredEl) {
        hoveredEl.classList.remove("__dr-highlight__", "__dr-highlight--annotated__");
        hoveredEl = null;
      }
      renderHistoryPanel();
    }
  }

  // ─── Mode switching (read / review) ───────────────────────────────────────
  function setMode(next) {
    mode = next;
    document.body.classList.toggle("__dr-mode-review__", mode === "review");

    const readBtn = document.getElementById("__dr-mode-read__");
    const reviewBtn = document.getElementById("__dr-mode-review__");
    if (readBtn) readBtn.classList.toggle("__dr-mode-btn--active__", mode === "read");
    if (reviewBtn) reviewBtn.classList.toggle("__dr-mode-btn--active__", mode === "review");

    // Review expands the sidebar; Read collapses it
    const sidebar = document.getElementById("__dr-sidebar__");
    if (sidebar) sidebar.classList.toggle("collapsed", mode === "read");

    if (mode === "read") {
      const box = document.getElementById("__docreview__");
      if (box) box.remove();
      // Cancel any in-progress inline edit so it can't be saved in read mode
      document.querySelectorAll(".__dr-cancel-btn__").forEach((b) => b.click());
      if (hoveredEl) {
        hoveredEl.classList.remove("__dr-highlight__", "__dr-highlight--annotated__");
        hoveredEl = null;
      }
    }
  }

  // ─── Sidebar DOM ──────────────────────────────────────────────────────────
  function injectSidebar() {
    const sidebar = document.createElement("div");
    sidebar.id = "__dr-sidebar__";

    // Header row
    const header = document.createElement("div");
    header.id = "__dr-sidebar-header__";

    const title = document.createElement("span");
    title.innerHTML = 'Comments (<span id="__dr-count__">0</span>)';

    const collapseIcon = document.createElement("div");
    collapseIcon.id = "__dr-collapse-icon__";
    collapseIcon.innerHTML = COLLAPSE_ICON_SVG;
    collapseIcon.addEventListener("click", (e) => { e.stopPropagation(); toggleSidebar(); });

    header.appendChild(title);
    header.appendChild(collapseIcon);

    // Toggle bar — sits between header and body
    const toggleBar = document.createElement("div");
    toggleBar.id = "__dr-toggle-bar__";

    const toggleLabel = document.createElement("label");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = "__dr-show-resolved__";
    checkbox.checked = sessionStorage.getItem("__dr_show_resolved__") === "true";
    checkbox.addEventListener("change", () => {
      sessionStorage.setItem("__dr_show_resolved__", String(checkbox.checked));
      refreshComments();
    });

    const toggleText = document.createElement("span");
    toggleText.innerHTML = 'Show resolved (<span id="__dr-resolved-count__">0</span>)';

    toggleLabel.appendChild(checkbox);
    toggleLabel.appendChild(toggleText);
    toggleBar.appendChild(toggleLabel);

    // Thread list body
    const body = document.createElement("div");
    body.id = "__dr-sidebar-body__";

    // Order: header → toggleBar → body
    sidebar.appendChild(header);
    sidebar.appendChild(toggleBar);
    sidebar.appendChild(body);

    document.body.appendChild(sidebar);

    // Always start collapsed; the user expands it on demand
    sidebar.classList.add("collapsed");
  }

  // ─── Sidebar open / collapse ──────────────────────────────────────────────
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

  function scrollSidebarToSelector(selector) {
    const body = document.getElementById("__dr-sidebar-body__");
    if (!body) return;
    for (const card of body.querySelectorAll(".__dr-thread__")) {
      if (card.dataset.selector === selector) {
        card.scrollIntoView({ behavior: "smooth", block: "nearest" });
        break;
      }
    }
  }

  function pulseThreadCard(selector) {
    const body = document.getElementById("__dr-sidebar-body__");
    if (!body) return;
    for (const card of body.querySelectorAll(".__dr-thread__")) {
      if (card.dataset.selector === selector) {
        card.classList.remove("__dr-thread--pulse__");
        void card.offsetWidth; // Trigger reflow to restart animation
        card.classList.add("__dr-thread--pulse__");
        setTimeout(() => card.classList.remove("__dr-thread--pulse__"), 1700);
        break;
      }
    }
  }

  // ─── Comment box ─────────────────────────────────────────────────────────
  function showCommentBox(x, y, selector, excerpt) {
    const existing = document.getElementById("__docreview__");
    if (existing) existing.remove();

    const box = document.createElement("div");
    box.id = "__docreview__";
    // Only the position is dynamic; colors, borders and fonts come from the theme stylesheet.
    box.style.cssText = `
      top: ${Math.min(y, window.innerHeight - 190)}px;
      left: ${Math.min(x, window.innerWidth - 320)}px;
    `;

    const label = document.createElement("div");
    label.className = "__dr-pop-label__";
    label.textContent = `On: ${excerpt.slice(0, 60)}${excerpt.length > 60 ? "…" : ""}`;

    const textarea = document.createElement("textarea");
    textarea.className = "__dr-pop-input__";
    textarea.placeholder = "Leave a comment…";

    const btnRow = document.createElement("div");
    btnRow.className = "__dr-pop-row__";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "__dr-pop-cancel__";
    cancelBtn.textContent = "Cancel";
    cancelBtn.onclick = () => box.remove();

    const submitBtn = document.createElement("button");
    submitBtn.className = "__dr-pop-submit__";
    submitBtn.textContent = "Submit";
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
        refreshComments();
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

  // ─── Badges ───────────────────────────────────────────────────────────────
  function clearBadges() {
    document.querySelectorAll(".__dr-badge__").forEach((b) => b.remove());
  }

  function injectBadge(selector, count) {
    const el = document.querySelector(selector);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const badge = document.createElement("div");
    badge.className = "__dr-badge__";
    badge.dataset.selector = selector;
    badge.innerHTML = MAGNIFYING_GLASS_SVG;
    // Only the position is dynamic; size, colors, glow and hover come from `.__dr-badge__`.
    badge.style.cssText = `top: ${rect.top}px; left: ${rect.right - 20}px;`;
    badge.addEventListener("click", (e) => {
      e.stopPropagation();
      openSidebar();
      scrollSidebarToSelector(selector);
      pulseThreadCard(selector);
    });
    document.body.appendChild(badge);
  }

  function repositionBadges() {
    document.querySelectorAll(".__dr-badge__").forEach((badge) => {
      const selector = badge.dataset.selector;
      if (!selector) return;
      const el = document.querySelector(selector);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      badge.style.top = `${rect.top}px`;
      badge.style.left = `${rect.right - 20}px`;
    });
  }

  // ─── Inline edit UI inside a thread card ─────────────────────────────────
  function openInlineEdit(card, comment) {
    const bodyEl = card.querySelector(".__dr-thread-body__");
    const actionsEl = card.querySelector(".__dr-thread-actions__");
    if (!bodyEl || !actionsEl) return;

    if (card.querySelector(".__dr-edit-area__")) return;

    const original = bodyEl.textContent;
    bodyEl.style.display = "none";
    actionsEl.style.display = "none";

    const textarea = document.createElement("textarea");
    textarea.className = "__dr-edit-area__";
    textarea.value = original;

    const editActions = document.createElement("div");
    editActions.className = "__dr-edit-actions__";

    const saveBtn = document.createElement("button");
    saveBtn.className = "__dr-save-btn__";
    saveBtn.textContent = "Save";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "__dr-cancel-btn__";
    cancelBtn.textContent = "Cancel";

    const cleanup = () => {
      textarea.remove();
      editActions.remove();
      bodyEl.style.display = "";
      actionsEl.style.display = "";
    };

    cancelBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      cleanup();
    });

    saveBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const newBody = textarea.value.trim();
      if (!newBody || newBody === original) {
        cleanup();
        return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";
      try {
        await fetch(`http://localhost:${PORT}/comments/${comment.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: newBody }),
        });
        cleanup();
        refreshComments();
      } catch (e) {
        saveBtn.disabled = false;
        saveBtn.textContent = "Error — retry";
      }
    });

    editActions.appendChild(saveBtn);
    editActions.appendChild(cancelBtn);

    card.insertBefore(textarea, actionsEl);
    card.insertBefore(editActions, actionsEl);
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
  }

  // ─── Thread card builder ──────────────────────────────────────────────────
  function buildThreadCard(comment, isResolved) {
    const card = document.createElement("div");
    card.className = "__dr-thread__" + (isResolved ? " __dr-thread-resolved__" : "");
    card.dataset.id = comment.id;
    card.dataset.selector = comment.selector;

    const selectorEl = document.createElement("div");
    selectorEl.className = "__dr-thread-selector__";
    selectorEl.textContent = comment.selector;

    const excerptEl = document.createElement("div");
    excerptEl.className = "__dr-thread-excerpt__";
    if (comment.excerpt) {
      const truncated = comment.excerpt.slice(0, 80);
      excerptEl.textContent = `"${truncated}${comment.excerpt.length > 80 ? "…" : ""}"`;
    }

    const bodyEl = document.createElement("div");
    bodyEl.className = "__dr-thread-body__";
    bodyEl.textContent = comment.body;

    card.appendChild(selectorEl);
    card.appendChild(excerptEl);
    card.appendChild(bodyEl);

    if (isResolved) {
      const resolvedLabel = document.createElement("div");
      resolvedLabel.className = "__dr-resolved-label__";
      const dateStr = comment.resolvedAt
        ? new Date(comment.resolvedAt).toLocaleString()
        : "resolved";
      resolvedLabel.textContent = `Resolved ${dateStr}`;
      card.appendChild(resolvedLabel);
    } else {
      const actions = document.createElement("div");
      actions.className = "__dr-thread-actions__";

      const scrollBtn = document.createElement("button");
      scrollBtn.className = "__dr-scroll-btn__";
      scrollBtn.textContent = "↳ Show in page";
      scrollBtn.addEventListener("click", () => {
        const target = document.querySelector(comment.selector);
        if (!target) return;
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.add("__dr-highlight-pulse__");
        setTimeout(() => target.classList.remove("__dr-highlight-pulse__"), 1500);
      });

      const editBtn = document.createElement("button");
      editBtn.className = "__dr-edit-btn__";
      editBtn.textContent = "✎ Edit";
      editBtn.addEventListener("click", () => openInlineEdit(card, comment));

      const resolveBtn = document.createElement("button");
      resolveBtn.className = "__dr-resolve-btn__";
      resolveBtn.textContent = "✓ Resolve";
      resolveBtn.addEventListener("click", async () => {
        resolveBtn.disabled = true;
        resolveBtn.textContent = "Resolving…";
        try {
          await fetch(`http://localhost:${PORT}/comments/${comment.id}/resolve`, {
            method: "PATCH",
          });
          refreshComments();
        } catch (e) {
          resolveBtn.disabled = false;
          resolveBtn.textContent = "✓ Resolve";
        }
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "__dr-delete-btn__";
      deleteBtn.textContent = "✕ Delete";
      deleteBtn.addEventListener("click", async () => {
        deleteBtn.disabled = true;
        deleteBtn.textContent = "Deleting…";
        try {
          await fetch(`http://localhost:${PORT}/comments/${comment.id}`, {
            method: "DELETE",
          });
          refreshComments();
        } catch (e) {
          deleteBtn.disabled = false;
          deleteBtn.textContent = "✕ Delete";
        }
      });

      actions.appendChild(scrollBtn);
      actions.appendChild(editBtn);
      actions.appendChild(resolveBtn);
      actions.appendChild(deleteBtn);
      card.appendChild(actions);
    }

    return card;
  }

  // ─── Refresh (central update entry point) ─────────────────────────────────
  function refreshComments() {
    fetch(`http://localhost:${PORT}/comments`, { cache: "no-store" })
      .then((r) => r.json())
      .then((comments) => {
        const open = comments.filter((c) => c.status === "open");
        const resolved = comments.filter((c) => c.status === "resolved");
        const showResolved = sessionStorage.getItem("__dr_show_resolved__") === "true";

        // Rebuild selector index for open comments
        openCommentsBySelector = {};
        open.forEach((c) => {
          if (!openCommentsBySelector[c.selector]) openCommentsBySelector[c.selector] = [];
          openCommentsBySelector[c.selector].push(c);
        });

        // Badges only on the Review tab
        clearBadges();
        if (activeTab === "review") {
          Object.entries(openCommentsBySelector).forEach(([selector, list]) => {
            injectBadge(selector, list.length);
          });
        }

        // Update counts
        const countEl = document.getElementById("__dr-count__");
        if (countEl) countEl.textContent = String(open.length);
        const resolvedCountEl = document.getElementById("__dr-resolved-count__");
        if (resolvedCountEl) resolvedCountEl.textContent = String(resolved.length);

        // Re-render sidebar body
        const body = document.getElementById("__dr-sidebar-body__");
        if (!body) return;
        body.innerHTML = "";

        if (open.length === 0 && (!showResolved || resolved.length === 0)) {
          const empty = document.createElement("div");
          empty.className = "__dr-empty__";
          empty.textContent = "No open comments";
          body.appendChild(empty);
          return;
        }

        open.forEach((c) => body.appendChild(buildThreadCard(c, false)));
        if (showResolved) {
          resolved.forEach((c) => body.appendChild(buildThreadCard(c, true)));
        }
      })
      .catch(() => {});
  }

  // ─── Live reload via WebSocket ─────────────────────────────────────────────
  function connectReloadSocket() {
    let ws;
    try {
      ws = new WebSocket(`ws://localhost:${PORT}`);
    } catch (e) {
      return;
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "reload") {
          window.location.reload();
        } else if (msg.type === "comments-updated") {
          refreshComments();
          if (activeTab === "history") renderHistoryPanel();
        }
      } catch (e) {}
    };

    ws.onclose = () => {
      setTimeout(connectReloadSocket, 2000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  // ─── Event handlers ───────────────────────────────────────────────────────
  document.addEventListener("click", (e) => {
    if (activeTab !== "review" || mode !== "review") return;
    if (e.target.closest("#__docreview__")) return;
    if (e.target.closest("#__dr-sidebar__")) return;
    if (e.target.closest("#__dr-tabs__")) return;
    if (e.target.closest("#__dr-header__")) return;
    if (e.target.closest("#__dr-theme-menu__")) return;

    const selector = getSelector(e.target);
    const hasComments = openCommentsBySelector[selector]?.length > 0;

    if (hasComments) {
      openSidebar();
      scrollSidebarToSelector(selector);
      pulseThreadCard(selector);
    } else {
      const excerpt = (e.target.innerText || e.target.textContent || "")
        .trim()
        .slice(0, 120);
      showCommentBox(e.clientX + 8, e.clientY + 8, selector, excerpt);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const box = document.getElementById("__docreview__");
      if (box) box.remove();
    }
  });

  document.addEventListener("mouseover", (e) => {
    if (activeTab !== "review" || mode !== "review") return;
    if (e.target.closest("#__dr-sidebar__") || e.target.closest("#__docreview__")) return;
    if (e.target.closest("#__dr-tabs__") || e.target.closest("#__dr-header__")) return;
    if (e.target.closest("#__dr-theme-menu__")) return;
    if (hoveredEl) {
      hoveredEl.classList.remove("__dr-highlight__");
      hoveredEl.classList.remove("__dr-highlight--annotated__");
    }
    hoveredEl = e.target;
    const selector = getSelector(hoveredEl);
    const isAnnotated = openCommentsBySelector[selector]?.length > 0;
    hoveredEl.classList.add(
      isAnnotated ? "__dr-highlight--annotated__" : "__dr-highlight__"
    );
  });

  document.addEventListener("mouseout", () => {
    if (activeTab !== "review" || mode !== "review") return;
    if (hoveredEl) {
      hoveredEl.classList.remove("__dr-highlight__");
      hoveredEl.classList.remove("__dr-highlight--annotated__");
    }
    hoveredEl = null;
  });

  window.addEventListener("scroll", () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(repositionBadges, 100);
  });

  // ─── Init ─────────────────────────────────────────────────────────────────
  initTheme();
  injectStyles();
  injectHeader();
  initRemoteControls();
  injectTabBar();
  injectHistoryPanel();
  injectSidebar();
  connectReloadSocket();
  refreshComments();
})();
