(function () {
  const PORT = "__PORT__"; // Replaced at inject time by cli.ts
  const FILE_PATH = "__FILE_PATH__"; // Replaced at inject time by cli.ts

  // Module-level state
  let openCommentsBySelector = {};
  let hoveredEl = null;
  let scrollTimer = null;
  let activeTab = "review"; // "review" | "history"

  const HEADER_H = 45;
  const TABS_H = 40;
  const CHROME_H = HEADER_H + TABS_H; // 85px

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
  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      body { padding-top: 85px !important; }

      #__dr-sidebar__ {
        position: fixed; top: 85px; right: 0; width: 320px; height: calc(100vh - 85px);
        background: #fff; z-index: 999995; display: flex; flex-direction: column;
        box-shadow: -4px 0 24px rgba(0,0,0,0.12); font-family: system-ui, sans-serif;
        font-size: 13px; transition: width 0.2s ease;
      }
      #__dr-sidebar__.collapsed { width: 48px; overflow: hidden; }
      #__dr-sidebar-header__ {
        display: flex; justify-content: space-between; align-items: center;
        padding: 12px 16px; border-bottom: 1px solid #e5e7eb;
        font-weight: 600; color: #111; min-height: 48px;
      }
      #__dr-sidebar__.collapsed #__dr-sidebar-header__ {
        padding: 0; justify-content: center; border-bottom: none;
      }
      #__dr-sidebar__.collapsed #__dr-sidebar-header__ > span:first-child {
        display: none;
      }
      #__dr-collapse-icon__ {
        display: flex; align-items: center; justify-content: center;
        width: 32px; height: 32px; cursor: pointer; flex-shrink: 0;
        border-radius: 4px;
      }
      #__dr-collapse-icon__:hover { background: #f3f4f6; }
      #__dr-collapse-icon__ svg {
        width: 20px; height: 20px; color: #6b7280;
        transition: transform 0.2s ease;
      }
      #__dr-sidebar__.collapsed #__dr-collapse-icon__ svg {
        transform: scaleX(-1);
      }
      #__dr-toggle-bar__ {
        padding: 6px 16px; border-bottom: 1px solid #e5e7eb;
        font-size: 12px; color: #6b7280;
      }
      #__dr-toggle-bar__ label {
        cursor: pointer; display: flex; align-items: center;
        gap: 6px; user-select: none;
      }
      #__dr-show-resolved__ { cursor: pointer; }
      #__dr-sidebar-body__ {
        flex: 1; overflow-y: auto; padding: 12px;
        display: flex; flex-direction: column; gap: 10px;
      }
      #__dr-sidebar__.collapsed #__dr-sidebar-body__ { display: none; }
      #__dr-sidebar__.collapsed #__dr-toggle-bar__ { display: none; }
      .__dr-thread__ {
        border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px;
        background: #fafafa;
      }
      .__dr-thread-resolved__ {
        opacity: 0.5; border-color: #e5e7eb; background: #f9fafb;
      }
      .__dr-thread-selector__ {
        font-size: 10px; color: #9ca3af; font-family: monospace;
        margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .__dr-thread-excerpt__ {
        font-style: italic; color: #6b7280; font-size: 11px; margin-bottom: 6px;
      }
      .__dr-thread-resolved__ .__dr-thread-excerpt__ { text-decoration: line-through; }
      .__dr-thread-body__ { color: #111; margin-bottom: 8px; line-height: 1.4; }
      .__dr-thread-actions__ { display: flex; gap: 6px; flex-wrap: wrap; }
      .__dr-scroll-btn__, .__dr-resolve-btn__, .__dr-edit-btn__, .__dr-delete-btn__ {
        font-size: 11px; padding: 3px 8px; border-radius: 4px; cursor: pointer; border: 1px solid;
      }
      .__dr-scroll-btn__ { border-color: #d1d5db; background: #f9fafb; color: #374151; }
      .__dr-resolve-btn__ { border-color: #6366f1; background: #6366f1; color: #fff; }
      .__dr-resolve-btn__:hover { background: #4f46e5; }
      .__dr-edit-btn__ { border-color: #d1d5db; background: #f9fafb; color: #374151; }
      .__dr-edit-btn__:hover { background: #e5e7eb; }
      .__dr-delete-btn__ { border-color: #fca5a5; background: #fff; color: #dc2626; }
      .__dr-delete-btn__:hover { background: #fee2e2; }
      .__dr-edit-area__ {
        width: 100%; box-sizing: border-box; border: 1px solid #a5b4fc;
        border-radius: 4px; padding: 6px; font-size: 13px; resize: vertical;
        min-height: 60px; margin-bottom: 6px; font-family: system-ui, sans-serif;
        outline: none;
      }
      .__dr-edit-actions__ { display: flex; gap: 6px; margin-bottom: 6px; }
      .__dr-save-btn__ {
        font-size: 11px; padding: 3px 10px; border-radius: 4px; cursor: pointer;
        border: 1px solid #6366f1; background: #6366f1; color: #fff;
      }
      .__dr-save-btn__:hover { background: #4f46e5; }
      .__dr-cancel-btn__ {
        font-size: 11px; padding: 3px 10px; border-radius: 4px; cursor: pointer;
        border: 1px solid #d1d5db; background: #f9fafb; color: #374151;
      }
      .__dr-resolved-label__ { font-size: 10px; color: #6b7280; margin-top: 4px; }
      .__dr-highlight__ {
        outline: 2px solid #a5b4fc !important;
        outline-offset: 2px !important;
        transition: outline 0.15s ease;
      }
      .__dr-highlight--annotated__ {
        outline: 2px solid #6366f1 !important;
        outline-offset: 2px !important;
        transition: outline 0.15s ease;
      }
      .__dr-highlight-pulse__ {
        background-color: rgba(250, 204, 21, 0.3) !important;
        transition: background-color 0.3s ease;
      }
      #__dr-header__ {
        position: fixed; top: 0; left: 0; right: 0; height: 45px;
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
      #__dr-header-version__ {
        margin-left: auto; flex-shrink: 0;
        color: #52525b; font-size: 11px;
      }
      #__dr-header-github__ {
        margin-left: 8px; flex-shrink: 0;
        color: #52525b; text-decoration: none;
        display: flex; align-items: center;
        opacity: 0.6; transition: opacity 0.15s, color 0.15s;
      }
      #__dr-header-github__:hover { opacity: 1; color: #a1a1aa; }
      #__dr-header-github__ svg { width: 14px; height: 14px; }

      /* ── Tab bar ─────────────────────────────────────────────────────────── */
      #__dr-tabs__ {
        position: fixed; top: 45px; left: 0; right: 0; height: 40px;
        background: #1c1c1f; z-index: 999994;
        display: flex; align-items: center; padding: 0 12px; gap: 2px;
        border-bottom: 1px solid #3f3f46; box-sizing: border-box;
      }
      .__dr-tab__ {
        padding: 5px 14px; border-radius: 5px; border: none; cursor: pointer;
        font-size: 13px; font-family: system-ui, sans-serif;
        background: none; color: #a1a1aa;
        transition: color 0.15s, background 0.15s;
      }
      .__dr-tab__:hover { color: #e4e4e7; }
      .__dr-tab--active__ { background: #6366f1; color: #fff; }
      .__dr-tab--active__:hover { background: #4f46e5; color: #fff; }

      /* ── History panel ───────────────────────────────────────────────────── */
      #__dr-history-panel__ {
        position: fixed; top: 85px; left: 0; right: 0; bottom: 0;
        background: #f9fafb; z-index: 999991;
        display: none; /* shown as flex by switchTab */
        font-family: system-ui, sans-serif;
      }
      #__dr-history-main__ {
        flex: 1; overflow-y: auto; display: flex; flex-direction: column;
      }
      #__dr-history-header__ {
        padding: 20px 32px 14px;
        font-size: 17px; font-weight: 700; color: #111;
        border-bottom: 1px solid #e5e7eb;
        position: sticky; top: 0; background: #f9fafb; z-index: 1;
      }
      #__dr-history-body__ {
        padding: 16px 32px 32px;
        display: flex; flex-direction: column; gap: 12px;
      }
      .__dr-history-card__ {
        background: #fff; border: 1px solid #e5e7eb;
        border-radius: 8px; padding: 16px;
      }
      .__dr-history-card-top__ {
        display: flex; justify-content: space-between; align-items: flex-start;
        gap: 12px; margin-bottom: 6px;
      }
      .__dr-history-selector__ {
        font-size: 10px; color: #9ca3af; font-family: monospace;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;
      }
      .__dr-history-badge__ {
        flex-shrink: 0; font-size: 10px; font-weight: 600;
        padding: 2px 8px; border-radius: 99px; white-space: nowrap;
      }
      .__dr-history-badge--pending__ {
        background: #fff7ed; color: #c2410c; border: 1px solid #fed7aa;
      }
      .__dr-history-badge--implemented__ {
        background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0;
      }
      .__dr-history-comment__ {
        color: #111; font-size: 13px; line-height: 1.5; margin-bottom: 8px;
      }
      .__dr-history-date__ { font-size: 11px; color: #9ca3af; }

      /* ── History stats sidebar ───────────────────────────────────────────── */
      #__dr-history-stats__ {
        width: 176px; flex-shrink: 0;
        background: #fff; border-left: 1px solid #e5e7eb;
        padding: 24px 20px; display: flex; flex-direction: column; gap: 20px;
        overflow-y: auto;
      }
      .__dr-stat-block__ {
        display: flex; flex-direction: column; gap: 4px;
      }
      .__dr-stat-label__ {
        font-size: 11px; font-weight: 600; letter-spacing: 0.06em;
        text-transform: uppercase; color: #9ca3af;
      }
      .__dr-stat-value__ {
        font-size: 36px; font-weight: 700; line-height: 1; color: #111;
      }
      .__dr-stat-value--pending__ { color: #c2410c; }
      .__dr-stat-value--implemented__ { color: #15803d; }
      .__dr-stat-divider__ {
        height: 1px; background: #f3f4f6; margin: 4px 0;
      }
    `;
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
    header.appendChild(version);
    header.appendChild(ghLink);

    document.body.prepend(header);
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
          empty.style.cssText = "color:#9ca3af; text-align:center; padding:48px 0; font-size:14px;";
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

  // ─── Sidebar DOM ──────────────────────────────────────────────────────────
  function injectSidebar() {
    const sidebar = document.createElement("div");
    sidebar.id = "__dr-sidebar__";

    // Header row
    const header = document.createElement("div");
    header.id = "__dr-sidebar-header__";

    const title = document.createElement("span");
    title.innerHTML = 'Comments (<span id="__dr-count__">0</span>)';

    const collapseBtn = document.createElement("button");
    collapseBtn.id = "__dr-collapse__";
    collapseBtn.textContent = "✕";
    collapseBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleSidebar(); });

    header.appendChild(title);
    header.appendChild(collapseBtn);

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

    // Restore collapsed state from session
    const isOpen = sessionStorage.getItem("__dr_sidebar_open__") !== "false";
    if (!isOpen) {
      sidebar.classList.add("collapsed");
      collapseBtn.textContent = "▶";
    }

    sidebar.addEventListener("click", (e) => {
      if (!sidebar.classList.contains("collapsed")) return;
      e.stopPropagation();
      openSidebar();
    });
  }

  // ─── Sidebar open / collapse ──────────────────────────────────────────────
  function openSidebar() {
    const sidebar = document.getElementById("__dr-sidebar__");
    const collapseBtn = document.getElementById("__dr-collapse__");
    if (!sidebar) return;
    sidebar.classList.remove("collapsed");
    if (collapseBtn) collapseBtn.textContent = "✕";
    sessionStorage.setItem("__dr_sidebar_open__", "true");
  }

  function toggleSidebar() {
    const sidebar = document.getElementById("__dr-sidebar__");
    const collapseBtn = document.getElementById("__dr-collapse__");
    if (!sidebar) return;
    const isCollapsed = sidebar.classList.toggle("collapsed");
    if (collapseBtn) collapseBtn.textContent = isCollapsed ? "▶" : "✕";
    sessionStorage.setItem("__dr_sidebar_open__", String(!isCollapsed));
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

  // ─── Comment box ─────────────────────────────────────────────────────────
  function showCommentBox(x, y, selector, excerpt) {
    const existing = document.getElementById("__docreview__");
    if (existing) existing.remove();

    const box = document.createElement("div");
    box.id = "__docreview__";
    box.style.cssText = `
      position: fixed;
      top: ${Math.min(y, window.innerHeight - 180)}px;
      left: ${Math.min(x, window.innerWidth - 320)}px;
      width: 300px;
      background: #fff;
      border: 2px solid #6366f1;
      border-radius: 8px;
      padding: 12px;
      z-index: 999999;
      box-shadow: 0 4px 24px rgba(0,0,0,0.18);
      font-family: system-ui, sans-serif;
      font-size: 13px;
    `;

    const label = document.createElement("div");
    label.style.cssText = "margin-bottom:6px; color:#555; font-size:11px;";
    label.textContent = `On: ${excerpt.slice(0, 60)}${excerpt.length > 60 ? "…" : ""}`;

    const textarea = document.createElement("textarea");
    textarea.style.cssText =
      "width:100%; height:72px; box-sizing:border-box; border:1px solid #ccc; border-radius:4px; padding:6px; font-size:13px; resize:vertical;";
    textarea.placeholder = "Leave a comment…";

    const btnRow = document.createElement("div");
    btnRow.style.cssText =
      "display:flex; gap:8px; margin-top:8px; justify-content:flex-end;";

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.style.cssText =
      "padding:4px 12px; border:1px solid #ccc; background:#f5f5f5; border-radius:4px; cursor:pointer;";
    cancelBtn.onclick = () => box.remove();

    const submitBtn = document.createElement("button");
    submitBtn.textContent = "Submit";
    submitBtn.style.cssText =
      "padding:4px 12px; background:#6366f1; color:#fff; border:none; border-radius:4px; cursor:pointer;";
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
    badge.textContent = count;
    badge.style.cssText = `
      position: fixed;
      top: ${rect.top}px;
      left: ${rect.right - 20}px;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: #6366f1;
      color: #fff;
      font-size: 10px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 999990;
      pointer-events: none;
      font-family: system-ui, sans-serif;
    `;
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
          empty.style.cssText =
            "color: #9ca3af; font-size: 13px; padding: 12px 0; text-align: center;";
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
    if (activeTab !== "review") return;
    if (e.target.closest("#__docreview__")) return;
    if (e.target.closest("#__dr-sidebar__")) return;
    if (e.target.closest("#__dr-tabs__")) return;
    if (e.target.closest("#__dr-header__")) return;

    const selector = getSelector(e.target);
    const hasComments = openCommentsBySelector[selector]?.length > 0;

    if (hasComments) {
      openSidebar();
      scrollSidebarToSelector(selector);
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
    if (activeTab !== "review") return;
    if (e.target.closest("#__dr-sidebar__") || e.target.closest("#__docreview__")) return;
    if (e.target.closest("#__dr-tabs__") || e.target.closest("#__dr-header__")) return;
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
    if (activeTab !== "review") return;
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
  injectStyles();
  injectHeader();
  injectTabBar();
  injectHistoryPanel();
  injectSidebar();
  connectReloadSocket();
  refreshComments();
})();
